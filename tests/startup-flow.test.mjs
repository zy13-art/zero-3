import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import * as launcher from '../intro.mjs';
import {fakeWindow} from './fake-window.mjs';
function page(events,{disconnectOnStart=false,failFirstChunk=false}={}){
 const f=fakeWindow(),context=vm.createContext({window:f.win,URL,Uint8Array});
 const client={closed:false,async call(method,params={}){
  events.push(method);
  if(method==='Page.addScriptToEvaluateOnNewDocument')return {identifier:'preload-1'};
  if(method==='Runtime.evaluate'){
   if(failFirstChunk&&params.expression.includes('intro.addChunk(')){failFirstChunk=false;throw Error('Debugger context unavailable');}
   if(params.expression.includes('intro.start()'))events.push('play-request');
   if(disconnectOnStart&&params.expression.includes('intro.start()'))throw Error('Debugger disconnected');
   try{
    const value=vm.runInContext(params.expression,context);
    if(params.expression.includes('intro.start()')){f.firstFrame();f.video().currentTime=8;f.video().ontimeupdate();}
    return {result:{value}};
   }catch(e){return {exceptionDetails:{text:e.message}}}
  }
  return {};
 },close(){this.closed=true;events.push('closed')}};
 return {f,client};
}
function dependencies(events,p){let time=0;return {root:'unused-fixture',config:{port:9335},args:[],bootstrap(){events.push('bootstrap')},verify:async()=>{events.push('verified')},select:async()=>({name:'test.mp4'}),loadMedia:async()=>{events.push(p.f.shell()?.isConnected?'read-behind-cover':'read-without-cover');return Buffer.from([0,0,0,16,102,116,121,112])},connect:async()=>p.client,log:async()=>{},now:()=>time,wait:async ms=>{time+=ms},sessionId:'flow'}}
test('bootstrap starts immediately and an opaque cover exists before reading or transferring video',async()=>{
 assert.equal(typeof launcher.runStartup,'function');
 const events=[],p=page(events);const result=await launcher.runStartup(dependencies(events,p));
 assert.equal(events[0],'bootstrap');assert.ok(events.includes('read-behind-cover'));assert.ok(!events.includes('read-without-cover'));
 assert.equal(result.state,'ended');assert.equal(p.client.closed,true);
 const remove=events.indexOf('Page.removeScriptToEvaluateOnNewDocument'),start=events.indexOf('play-request');assert.ok(remove>=0&&remove<start);
});
test('an unverified listener is never attached and an unavailable listener retries while bootstrap runs',async()=>{
 assert.equal(typeof launcher.runStartup,'function');
 const events=[],p=page(events),options=dependencies(events,p);let count=0;
 options.verify=async()=>{if(++count<3){const e=Error('listener pending');e.code='NOT_READY';throw e;}};
 assert.equal((await launcher.runStartup(options)).state,'ended');assert.ok(count>=3);assert.equal(events[0],'bootstrap');
 const denied=dependencies([],page([]));let attached=false;denied.verify=async()=>{const e=Error('impostor');e.code='UNVERIFIED_OWNER';throw e};denied.connect=async()=>{attached=true};
 await assert.rejects(launcher.runStartup(denied),/impostor/);assert.equal(attached,false);
});
test('C#-started bootstrap is not duplicated and playback is never replayed after a start request',async()=>{
 assert.equal(typeof launcher.runStartup,'function');
 const events=[],p=page(events,{disconnectOnStart:true}),options=dependencies(events,p);options.args=['--bootstrap-started'];let connections=0;options.connect=async()=>{connections++;return p.client};
 await assert.rejects(launcher.runStartup(options),/disconnected/);assert.equal(connections,1);assert.ok(!events.includes('bootstrap'));assert.equal(p.client.closed,true);
});
test('a failed cover retained in the same renderer cannot turn a retry into a successful startup',async()=>{
 const events=[],p=page(events,{failFirstChunk:true}),options=dependencies(events,p);let connections=0;options.connect=async()=>{connections++;return p.client};
 await assert.rejects(launcher.runStartup(options),/terminated|failed/i);
 assert.equal(connections,2);assert.equal(p.f.win.__kurumiIntroResult.state,'error');assert.ok(!events.includes('play-request'));
});
