import test from 'node:test';
import assert from 'node:assert/strict';
import {waitForMainWindow} from '../main-window.mjs';

test('the updated Codex spotlight utility does not make a real main page ambiguous',async()=>{
 const main={type:'page',url:'app://-/index.html',id:'main'};
 const spotlight={type:'page',url:'app://-/index.html?initialRoute=%2Fspotlight',id:'spotlight'};
 let time=0;const connected=[];
 const c={async call(){return {result:{value:{visible:true,documentElement:true,top:true,width:1280,height:720}}}},close(){}};
 const selected=await waitForMainWindow({port:9335,timeoutMs:400,now:()=>time,wait:async ms=>{time+=ms},
  list:async()=>[main,spotlight],connect:async target=>{connected.push(target.id);return c}});
 assert.equal(selected,c);assert.deepEqual(connected,['main']);
});

test('a visible spotlight cannot substitute for a hidden main window',async()=>{
 let time=0;const connected=[],calls=[];
 const main={type:'page',url:'app://-/index.html',id:'main'};
 const spotlight={type:'page',url:'app://-/index.html?initialRoute=%2Fspotlight',id:'spotlight'};
 await assert.rejects(waitForMainWindow({port:9335,timeoutMs:400,now:()=>time,wait:async ms=>{time+=ms},list:async()=>[main,spotlight],
  connect:async target=>{connected.push(target.id);return {async call(method){calls.push(method);return {result:{value:{visible:false,documentElement:true,top:true,width:1280,height:720}}}},close(){}}}}),/hidden/);
 assert.ok(connected.length>0);assert.ok(connected.every(id=>id==='main'));assert.ok(!calls.includes('Page.bringToFront'));
});
