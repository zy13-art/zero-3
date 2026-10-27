import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,copyFile,writeFile,readFile,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const exec=promisify(execFile),root=fileURLToPath(new URL('../',import.meta.url));
async function fixture(){
 const dir=await mkdtemp(join(tmpdir(),'kurumi-dispatch-'));
 await copyFile(join(root,'CodexKurumiIntro.exe'),join(dir,'CodexKurumiIntro.exe'));
 await writeFile(join(dir,'config.json'),JSON.stringify({startupMode:'in-app-overlay',nodeExecutable:process.execPath,playlist:[]}),'utf8');
 await writeFile(join(dir,'intro.mjs'),`import {writeFileSync} from 'node:fs';writeFileSync(new URL('node-args.json',import.meta.url),JSON.stringify(process.argv.slice(2)));process.exitCode=7;`,'utf8');
 await writeFile(join(dir,'Start-CodexForIntro.ps1'),`$ErrorActionPreference='Stop'\nSet-Content -LiteralPath (Join-Path $PSScriptRoot 'bootstrap-fixture.txt') -Value 'fixture only'\n`,'utf8');
 return dir;
}
test('default in-app dispatch runs hidden Node without media or a Window and propagates its failure without native replay',async()=>{
 const dir=await fixture();let code=0;
 try{await exec(join(dir,'CodexKurumiIntro.exe'),['--film=fixture.mp4'],{windowsHide:true,timeout:10000})}catch(e){code=e.code}
 assert.equal(code,7,'the launcher must route to the Node fixture before requiring native films');
 const args=JSON.parse(await readFile(join(dir,'node-args.json'),'utf8'));assert.deepEqual(args,['--bootstrap-started','--film=fixture.mp4']);
 const events=(await readFile(join(dir,'native-startup.log'),'utf8')).trim().split(/\r?\n/).map(JSON.parse);
 assert.ok(events.some(x=>x.event==='InAppLauncherStarted'));assert.ok(!events.some(x=>x.event==='CoverShown'||x.event==='MediaRequested'));
});

test('blank public Node configuration discovers an installed runtime and still dispatches the animation controller',async()=>{
 const dir=await fixture();
 await writeFile(join(dir,'config.json'),JSON.stringify({startupMode:'in-app-overlay',nodeExecutable:'',playlist:[]}),'utf8');
 let code=0;try{await exec(join(dir,'CodexKurumiIntro.exe'),[],{windowsHide:true,timeout:10000})}catch(e){code=e.code}
 assert.equal(code,7,'empty public configuration must find the installed Node and execute the isolated controller');
 assert.deepEqual(JSON.parse(await readFile(join(dir,'node-args.json'),'utf8')),['--bootstrap-started']);
});
test('explicit native and preview modes bypass the Node route and preserve preview fail-open isolation',async()=>{
 for(const arg of ['--native','--preview']){
  const dir=await fixture();await assert.rejects(exec(join(dir,'CodexKurumiIntro.exe'),[arg],{windowsHide:true,timeout:10000}),e=>e.code===1);
  await assert.rejects(access(join(dir,'node-args.json')));
  const events=(await readFile(join(dir,'native-startup.log'),'utf8')).trim().split(/\r?\n/).map(JSON.parse);
  assert.ok(!events.some(x=>x.event==='InAppLauncherStarted'||x.event==='CoverShown'));
  if(arg==='--preview')assert.ok(!events.some(x=>x.event==='BootstrapStarted'));
 }
});
test('the native installation mutex remains owned while its in-app Node child is playing',async()=>{
 const dir=await fixture();
 await writeFile(join(dir,'intro.mjs'),`import {appendFileSync} from 'node:fs';appendFileSync(new URL('entries.txt',import.meta.url),'started\\n');await new Promise(r=>setTimeout(r,1000));`,'utf8');
 const first=exec(join(dir,'CodexKurumiIntro.exe'),[],{windowsHide:true,timeout:10000});
 let entered=false;for(let i=0;i<100;i++){try{await access(join(dir,'entries.txt'));entered=true;break}catch{}await new Promise(r=>setTimeout(r,20));}
 assert.ok(entered);await exec(join(dir,'CodexKurumiIntro.exe'),[],{windowsHide:true,timeout:10000});await first;
 assert.equal(await readFile(join(dir,'entries.txt'),'utf8'),'started\n');
 const events=(await readFile(join(dir,'native-startup.log'),'utf8')).trim().split(/\r?\n/).map(JSON.parse);
 assert.ok(events.some(x=>x.event==='DuplicateIgnored'));
});
