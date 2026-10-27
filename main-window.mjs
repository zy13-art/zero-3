import {mainTarget,socketUrl,attach} from './cdp.mjs';

export function mainPageStatus() {
  return {visible:!document.hidden,documentElement:!!document.documentElement,
    top:window.top===window,width:innerWidth,height:innerHeight,
    loaded:document.readyState==='complete'};
}

// Chat hydration and document.complete must not delay the startup cover.
export async function waitForMainWindow({port,timeoutMs=45000,
  list=async()=>{const r=await fetch(`http://127.0.0.1:${port}/json/list`,{signal:AbortSignal.timeout(1500)});if(!r.ok)throw Error(`Debugger HTTP ${r.status}`);return r.json()},
  connect=target=>attach(socketUrl(target.webSocketDebuggerUrl,port)),
  now=Date.now,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}) {
  const until=now()+timeoutMs;let lastError='';
  while(now()<until){
    let client;
    try{
      const targets=(await list()).filter(mainTarget);
      if(targets.length!==1){lastError=targets.length?'ambiguous main pages; a unique main page is required':'main page not created';}
      else {
        client=await connect(targets[0]);
        const response=await client.call('Runtime.evaluate',{expression:`(${mainPageStatus.toString()})()`,returnByValue:true});
        const v=response.result?.value;
        if(v?.visible&&v.documentElement&&v.top&&v.width>200&&v.height>100){
          // Activation belongs to the caller, after its opaque cover is mounted.
          return client;
        }
        lastError='main page is hidden or has no document element';
      }
    }catch(error){lastError=error.message}
    client?.close();
    await wait(100);
  }
  throw Error(`Codex main window was not ready${lastError?`: ${lastError}`:''}`);
}
export const waitForStartupWindow=waitForMainWindow;
