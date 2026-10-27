import {readFile,writeFile,appendFile,stat} from 'node:fs/promises';
import {dirname,join,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {randomInt,randomUUID,createHash} from 'node:crypto';
import {installIntro} from './overlay.mjs';
import {waitForMainWindow} from './main-window.mjs';
import {mainTarget} from './cdp.mjs';
import {runWithLaunchLease} from './launch-lease.mjs';

const exec=promisify(execFile),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const packageRoot=dirname(fileURLToPath(import.meta.url));
const powershell=join(process.env.WINDIR||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
export function choose(playlist,previous,draw=randomInt){
  if(!Array.isArray(playlist)||!playlist.length)throw Error('No intro films configured');
  const candidates=playlist.length>1?playlist.filter(name=>name!==previous):playlist;
  return candidates[draw(candidates.length)];
}
async function selectedFilm(root,config,args){
  let previous=null;try{previous=JSON.parse(await readFile(join(root,'selection.json'),'utf8')).last}catch{}
  const override=args.find(arg=>arg.startsWith('--film='))?.slice(7),name=override||choose(config.playlist,previous);
  if(!config.playlist.includes(name)||basename(name)!==name||/[\\/]/.test(name))throw Error('Requested film is not in the playlist');
  await writeFile(join(root,'selection.json'),JSON.stringify({last:name}),'utf8');
  return {name,path:join(root,'films',name)};
}
async function readMedia(selected){
  const info=await stat(selected.path);if(info.size>64*1024*1024)throw Error('Intro film exceeds the 64 MB limit');
  const file=await readFile(selected.path);if(file.subarray(4,8).toString()!=='ftyp')throw Error('Intro film is not MP4');return file;
}
function startBootstrap(root,log){
  // The helper may wait for CDP and wallpaper. Startup video never waits for it.
  const child=spawn(powershell,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',join(root,'Start-CodexForIntro.ps1'),'-NativeSplash'],{cwd:root,windowsHide:true,stdio:'ignore',detached:true});
  child.once('error',e=>{void log(`Bootstrap error: ${e.message}`).catch(()=>{})});child.unref();return child;
}
async function verifyListener(root,port){
  try{
    const {stdout}=await exec(powershell,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',join(root,'Verify-CodexListener.ps1'),'-Port',String(port)],{windowsHide:true,timeout:5000,maxBuffer:1024*1024});
    if(stdout.trim()!=='verified')throw Error('Owner verifier did not confirm official Codex');
  }catch(cause){
    const text=`${cause.stdout||''} ${cause.stderr||''} ${cause.message}`;
    const error=Error(/CDP listener unavailable/i.test(text)?'Codex debugger listener is not available yet':`Codex debugger ownership verification failed: ${text}`);
    error.code=/CDP listener unavailable/i.test(text)?'NOT_READY':'UNVERIFIED_OWNER';throw error;
  }
}
async function evaluate(client,expression,timeout=12000,userGesture=false){
  const result=await client.call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,userGesture},timeout);
  if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text||'Codex overlay evaluation failed');
  return result.result?.value;
}
function owned(sessionId,statement){return `(()=>{const intro=window.__kurumiIntro;if(!intro||intro.sessionId!==${JSON.stringify(sessionId)})throw Error('Startup page changed while loading video');return ${statement}})()`;}
async function statusFor(client,sessionId){return evaluate(client,`window.__kurumiIntro?.sessionId===${JSON.stringify(sessionId)}?window.__kurumiIntro.status():(window.__kurumiIntroResult?.sessionId===${JSON.stringify(sessionId)}?window.__kurumiIntroResult:null)`);}
function preloadSource(sessionId){return `(()=>{if(window.top!==window)return;const target={type:'page',url:location.href};if(!(${mainTarget.toString()})(target))return;(${installIntro.toString()})(window,${JSON.stringify(sessionId)});})()`;}

export async function runStartup({root=packageRoot,config,args=[],sessionId=randomUUID(),
  log=async()=>{},bootstrap=()=>startBootstrap(root,log),verify=()=>verifyListener(root,config.port),
  select=()=>selectedFilm(root,config,args),loadMedia=readMedia,
  connect=options=>waitForMainWindow({port:config.port,...options}),now=Date.now,wait=sleep}={}){
  if(!config||config.port!==9335)throw Error('The in-app intro expects loopback port 9335');
  if(!args.includes('--bootstrap-started'))bootstrap();
  const selected=await select();await log(`Starting in-app film ${selected.name}`);
  const until=now()+45000;
  while(true){
    try{await verify();break}catch(error){if(error.code!=='NOT_READY'||now()>=until)throw error;await wait(100);}
  }
  let playbackRequested=false;
  for(let attempt=1;attempt<=3;attempt++){
    let client,preload;
    try{
      client=await connect({timeoutMs:Math.max(100,until-now())});
      await verify(); // Recheck after renderer startup/reconnection, before DOM mutation.
      await client.call('Page.enable');
      const registered=await client.call('Page.addScriptToEvaluateOnNewDocument',{source:preloadSource(sessionId)});preload=registered.identifier;
      const installed=await evaluate(client,`(${installIntro.toString()})(window,${JSON.stringify(sessionId)})`);
      if(!installed?.installed)throw Error('Codex window rejected the startup cover');
      if(installed.existing&&installed.sessionId!==sessionId)return {state:'existing'};
      if(installed.terminal){
        if(installed.state==='skipped'||installed.state==='ended')return installed;
        const error=Error(installed.error||`Startup cover terminated (${installed.state}) before playback`);error.code='INTRO_TERMINAL';throw error;
      }
      try{await client.call('Page.bringToFront')}catch{}
      await log(`Opaque startup cover installed, attempt ${attempt}`);
      // Disk reading and the 4K payload transfer happen only behind the opaque layer.
      const file=await loadMedia(selected);await evaluate(client,owned(sessionId,'intro.begin()'));
      for(let offset=0;offset<file.length;offset+=1024*1024){
        const chunk=file.subarray(offset,offset+1024*1024).toString('base64');
        await evaluate(client,owned(sessionId,`intro.addChunk(${JSON.stringify(chunk)})`));
      }
      // The preload protects only initial reloads while receiving; it must not
      // recreate an animation after playback, completion, or a later navigation.
      if(preload){await client.call('Page.removeScriptToEvaluateOnNewDocument',{identifier:preload});preload=null;}
      playbackRequested=true;await evaluate(client,owned(sessionId,'intro.start()'),12000,true);
      const playbackUntil=now()+25000;let loggedFrame=false;
      while(now()<playbackUntil){
        const state=await statusFor(client,sessionId);
        if(!state)throw Error('Startup page changed during playback');
        if(state.terminal){if(state.state==='error')throw Error(state.error||'Intro playback failed');await log(`Finished ${selected.name}: ${state.state}`);return state;}
        if(state.firstFrame&&!loggedFrame){loggedFrame=true;await log(`First frame: ${state.width}x${state.height}, t=${state.currentTime}`);}
        await wait(100);
      }
      throw Error('Startup playback did not finish');
    }catch(error){
      const terminal=client?await statusFor(client,sessionId).catch(()=>null):null;
      if(terminal?.terminal&&terminal.state==='skipped')return terminal;
      if(client)await evaluate(client,`window.__kurumiIntro?.sessionId===${JSON.stringify(sessionId)}&&window.__kurumiIntro.dispose('error')`).catch(()=>{});
      if(error.code==='INTRO_TERMINAL'||playbackRequested||attempt===3||now()>=until||!/fetch|timeout|disconnect|closed|page changed|context|target|not open|main window/i.test(error.message))throw error;
      await log(`Renderer startup retry ${attempt}: ${error.message}`);await wait(100);await verify();
    }finally{
      if(preload&&client)await client.call('Page.removeScriptToEvaluateOnNewDocument',{identifier:preload}).catch(()=>{});
      client?.close();
    }
  }
}
async function main(){
  const config=JSON.parse(await readFile(join(packageRoot,'config.json'),'utf8')),args=process.argv.slice(2);
  const log=message=>appendFile(join(packageRoot,'intro.log'),`${new Date().toISOString()} [pid=${process.pid}] ${message}\n`,'utf8');
  if(args.includes('--check')){
    const films=await Promise.all(config.playlist.map(async name=>({name,bytes:(await stat(join(packageRoot,'films',name))).size})));
    console.log(JSON.stringify({port:config.port,startupMode:config.startupMode,films},null,2));return;
  }
  const key='\\\\.\\pipe\\CodexKurumiIntro-'+createHash('sha256').update(packageRoot.toLowerCase()).digest('hex').slice(0,24);
  const result=await runWithLaunchLease(key,()=>runStartup({root:packageRoot,config,args,log}));
  if(!result.acquired)await log('Duplicate in-app launch ignored');
}
if(process.argv[1]&&fileURLToPath(import.meta.url).toLowerCase()===process.argv[1].toLowerCase()){
  main().catch(async error=>{await appendFile(join(packageRoot,'intro.log'),`${new Date().toISOString()} ERROR ${error.stack||error}\n`,'utf8').catch(()=>{});process.exitCode=1;});
}
