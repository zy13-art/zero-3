import test from 'node:test';
import assert from 'node:assert/strict';
import { waitForMainWindow } from '../main-window.mjs';

const target={id:'main',type:'page',url:'app://-/index.html?initialRoute=%2Flocal%2Ftest',webSocketDebuggerUrl:'ws://127.0.0.1:9335/devtools/page/main'};
function clock(){let n=0;return {now:()=>n,wait:async ms=>{n+=ms}}}
function client(read){return {closed:false,front:false,async call(method){
 if(method==='Browser.getWindowForTarget')throw Error('Browser window not found');
 if(method==='Page.bringToFront'){this.front=true;return {}}
 if(method==='Runtime.evaluate')return {result:{value:read()}};
 throw Error('Unexpected protocol command '+method);
},close(){this.closed=true}}}
const ready={visible:true,loaded:true,root:true,mainReady:true,width:1000,height:700};

test('startup retries a disappearing listener and a renderer connection failure',async()=>{
 const c=clock();let requests=0,connections=0;
 const chosen=await waitForMainWindow({port:9335,...c,timeoutMs:2000,settleMs:200,
  list:async()=>{if(++requests<3)throw Error('fetch failed');return [target]},
  connect:async()=>{if(++connections===1)throw Error('renderer destroyed');return client(()=>ready)}});
 assert.equal(chosen.closed,false);assert.equal(chosen.front,true);chosen.close();
});

test('an outer root without the real main surface never starts an animation',async()=>{
 const c=clock();const seen=[];
 await assert.rejects(waitForMainWindow({port:9335,...c,timeoutMs:600,settleMs:200,
  list:async()=>[target],connect:async()=>{const a=client(()=>({...ready,mainReady:false}));seen.push(a);return a}}),/main window/i);
 assert.ok(seen.length>0);assert.ok(seen.every(a=>a.closed));
});

test('ready main surface must remain ready across successive checks',async()=>{
 const c=clock();let probes=0;
 const chosen=await waitForMainWindow({port:9335,...c,timeoutMs:2000,settleMs:400,
  list:async()=>[target],connect:async()=>client(()=>{probes++;return {...ready,mainReady:probes!==2}})});
 assert.ok(c.now()>=800,'the early readiness flicker must reset the stable interval');chosen.close();
});
