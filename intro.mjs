import { readFile, writeFile, appendFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomInt, randomUUID, createHash } from 'node:crypto';
import { installIntro } from './overlay.mjs';
import { waitForMainWindow } from './main-window.mjs';
import { runWithLaunchLease } from './launch-lease.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const exec = promisify(execFile);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const config = JSON.parse(await readFile(join(root, 'config.json'), 'utf8'));
const base = `http://127.0.0.1:${config.port}`;
const controller = join(root, 'Start-CodexForIntro.ps1');
const verifier = join(config.wallpaperProject, 'verify-cdp.ps1');

export function choose(playlist, previous, draw = randomInt) {
  if (!Array.isArray(playlist) || playlist.length === 0) throw new Error('No intro films configured');
  const candidates = playlist.length > 1 ? playlist.filter(name => name !== previous) : playlist;
  return candidates[draw(candidates.length)];
}

async function log(message) {
  await appendFile(join(root, 'intro.log'), `${new Date().toISOString()} [pid=${process.pid}] ${message}\n`);
}
async function cdpAlive() {
  try { const response = await fetch(`${base}/json/version`, { signal: AbortSignal.timeout(1500) }); return response.ok; }
  catch { return false; }
}
async function verified() {
  try {
    const { stdout } = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', verifier],
      { windowsHide: true, timeout: 15000 });
    if (stdout.trim() !== 'verified') throw new Error('Codex debugger ownership verification failed');
  } catch(error) {
    if(!(await cdpAlive()))throw Error('Debugger temporarily unavailable during verification');
    throw error;
  }
}
async function officialRunning() {
  const { stdout } = await exec('powershell.exe', ['-NoProfile', '-Command',
    "@(Get-Process -Name ChatGPT -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*OpenAI.Codex*' }).Count"],
    { windowsHide: true, timeout: 15000 });
  return Number(stdout.trim()) > 0;
}
async function ensureCodex() {
  if (await cdpAlive()) return;
  for (let attempt = 0; attempt < 15; attempt++) {
    await sleep(300);
    if (await cdpAlive()) return;
  }
  if (await officialRunning()) {
    for (let attempt=0; attempt<40; attempt++) { await sleep(400); if(await cdpAlive())return; }
    throw new Error('Codex is already open without the wallpaper debugger; close it normally, then try the animation shortcut again');
  }
  await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', controller],
    { windowsHide: true, timeout: 90000, maxBuffer: 1024 * 1024 });
  for(let attempt=0;attempt<30;attempt++){if(await cdpAlive())return;await sleep(500);}
  throw new Error('Debugger temporarily unavailable after Codex launch');
}
async function mainClient() {
  return waitForMainWindow({port:config.port});
}
async function evaluate(client, expression, timeout = 15000, userGesture = false) {
  const result = await client.call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture }, timeout);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Codex overlay evaluation failed');
  return result.result?.value;
}
async function selectedFilm() {
  let previous = null;
  try { previous = JSON.parse(await readFile(join(root, 'selection.json'), 'utf8')).last; } catch {}
  const override = process.argv.find(arg => arg.startsWith('--film='))?.slice('--film='.length);
  if (override && !config.playlist.includes(override)) throw new Error('Requested film is not in the playlist');
  const name = override || choose(config.playlist, previous);
  const film = join(root, 'films', name);
  const file = await readFile(film);
  if (file.length > 64 * 1024 * 1024) throw new Error('Intro film exceeds the 64 MB limit');
  if (file.subarray(4, 8).toString() !== 'ftyp') throw new Error('Intro film is not MP4');
  await writeFile(join(root, 'selection.json'), JSON.stringify({ last: name }), 'utf8');
  return { name, file };
}
function owned(sessionId, statement) {
  return `(()=>{const intro=window.__kurumiIntro;if(!intro||intro.sessionId!==${JSON.stringify(sessionId)})throw Error('Startup page changed while loading video');return ${statement}})()`;
}
async function statusFor(client,sessionId) {
  return evaluate(client,`window.__kurumiIntro?.sessionId===${JSON.stringify(sessionId)}?window.__kurumiIntro.status():(window.__kurumiIntroResult?.sessionId===${JSON.stringify(sessionId)}?{...window.__kurumiIntroResult,terminal:true}:null)`);
}
async function play(client, file, sessionId) {
  const installed = await evaluate(client, `(${installIntro.toString()})(window,${JSON.stringify(sessionId)})`);
  if (!installed?.installed) throw new Error('Codex window rejected the intro layer');
  if (installed.existing) return {existing:true};
  for (let offset = 0; offset < file.length; offset += 1024 * 1024) {
    const chunk = file.subarray(offset, offset + 1024 * 1024).toString('base64');
    await evaluate(client, owned(sessionId,`intro.addChunk(${JSON.stringify(chunk)})`));
  }
  await log(`Media prepared: ${file.length} bytes`);
  await evaluate(client, owned(sessionId,'intro.start()'), 15000, true);
  const until = Date.now() + 15000;
  while (Date.now() < until) {
    const status = await statusFor(client,sessionId);
    if(status?.terminal){if(status.state==='error')throw Error(status.error);return {...status,skipped:status.state==='skipped'};}
    if (status?.state === 'playing' && status.currentTime > 0.05 && status.width === 3840 && status.height === 2160) return status;
    if (!status) throw new Error('Startup page changed before playback was confirmed');
    await sleep(100);
  }
  throw new Error('Intro playback was not confirmed');
}
async function waitForEnd(client,sessionId) {
  const until=Date.now()+25000;
  while(Date.now()<until){
    const status=await statusFor(client,sessionId);
    if(!status)throw Error('Startup page changed during playback');
    if(status.terminal){if(status.state==='error')throw Error(status.error);return status.state;}
    await sleep(200);
  }
  throw Error('Startup playback did not finish');
}

async function main() {
  if (process.argv.includes('--check')) {
    const films = await Promise.all(config.playlist.map(async name => ({ name, bytes: (await stat(join(root, 'films', name))).size })));
    console.log(JSON.stringify({ port: config.port, wallpaperProject: config.wallpaperProject,
      cdpReady: await cdpAlive(), films }, null, 2));
    return;
  }
  const key='\\\\.\\pipe\\CodexKurumiIntro-'+createHash('sha256').update(root.toLowerCase()).digest('hex').slice(0,24);
  const result=await runWithLaunchLease(key,async()=>{
    const {name,file}=await selectedFilm();
    await log(`Starting ${name}`);
    for(let attempt=1;attempt<=3;attempt++){
      let client;const sessionId=randomUUID();let started=false;
      try{
        await ensureCodex();
        await verified();
        await log(`Connection verified, attempt ${attempt}`);
        client=await mainClient();
        await log('Main chat window ready');
        await verified();
        const status=await play(client,file,sessionId);
        if(status.existing){await log('Existing intro preserved');return;}
        if(status.skipped){await log(`Skipped ${name}`);return;}
        started=true;
        await log(`Played ${name}: ${status.width}x${status.height}, duration=${status.duration}, muted=${status.muted}, t=${status.currentTime.toFixed(2)}`);
        const finish=status.terminal?status.state:await waitForEnd(client,sessionId);
        await log(`Finished ${name}: ${finish}`);
        console.log(`Played ${name}`);return;
      }catch(error){
        const terminal=client?await statusFor(client,sessionId).catch(()=>null):null;
        if(terminal?.state==='skipped'){await log(`Skipped ${name}`);return;}
        if(client)await evaluate(client,`window.__kurumiIntro?.sessionId===${JSON.stringify(sessionId)}&&window.__kurumiIntro.dispose()`).catch(()=>{});
        if(started||attempt===3||!/fetch|timeout|disconnect|closed|page changed|context|target|not open|main window|temporarily unavailable/i.test(error.message))throw error;
        await log(`Retry ${attempt}: ${error.message}`);await sleep(500);
      }finally{client?.close();}
    }
  });
  if(!result.acquired){await log('Duplicate launch ignored while animation is active');console.log('Animation already starting or playing');}
}

if (process.argv[1] && fileURLToPath(import.meta.url).toLowerCase() === process.argv[1].toLowerCase()) {
  main().catch(async error => { await log(`ERROR ${error.stack || error}`); console.error(error.message); process.exitCode = 1; });
}
