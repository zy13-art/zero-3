import test from 'node:test';
import assert from 'node:assert/strict';
import { waitForMainWindow } from '../main-window.mjs';
const target={id:'main',type:'page',url:'app://-/index.html?initialRoute=%2Flocal%2Ftest',webSocketDebuggerUrl:'ws://127.0.0.1:9335/devtools/page/main'};
function clock(){let n=0;return {now:()=>n,wait:async ms=>{n+=ms}}}
const early={visible:true,documentElement:true,top:true,loaded:false,root:false,mainReady:false,width:1000,height:700};
function client(status=early){return {closed:false,calls:[],async call(method){this.calls.push(method);if(method==='Runtime.evaluate')return {result:{value:status}};return {};},close(){this.closed=true}}}
test('an early visible document is selected before the chat or document is ready',async()=>{
 const c=clock(),page=client();
 assert.equal(await waitForMainWindow({port:9335,...c,timeoutMs:1000,list:async()=>[target],connect:async()=>page}),page);
 assert.equal(c.now(),0);assert.equal(page.closed,false);
 assert.ok(!page.calls.includes('Page.bringToFront'),'the visible chat must not be activated before its cover is mounted');
});
test('listener and renderer startup races retry without waiting for chat readiness',async()=>{
 const c=clock();let lists=0,connections=0;const page=client();
 const result=await waitForMainWindow({port:9335,...c,timeoutMs:2000,list:async()=>{if(++lists===1)throw Error('listener not ready');return [target]},connect:async()=>{if(++connections===1)throw Error('context destroyed');return page}});
 assert.equal(result,page);assert.equal(connections,2);
});
test('ambiguous main pages are never attached or activated',async()=>{
 const c=clock();let connections=0;
 await assert.rejects(waitForMainWindow({port:9335,...c,timeoutMs:400,list:async()=>[target,{...target,id:'other'}],connect:async()=>{connections++;return client()}}),/unique|ambiguous/i);
 assert.equal(connections,0);
});
test('mini routes never receive an overlay and a hidden main page is never activated',async()=>{
 const c=clock(),page=client({...early,visible:false});let connections=0;
 await assert.rejects(waitForMainWindow({port:9335,...c,timeoutMs:400,list:async()=>[target,{...target,id:'mini',url:'app://-/index.html?initialRoute=%2Fmini'}],connect:async()=>{connections++;return page}}),/main window/i);
 assert.ok(connections>0);assert.ok(!page.calls.includes('Page.bringToFront'));assert.equal(page.closed,true);
});
