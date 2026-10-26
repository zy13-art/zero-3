import {mainTarget,socketUrl,attach} from './cdp.mjs';

export function mainPageStatus() {
  const main=document.querySelector('main:is(.main-surface,[data-app-shell-main-surface],[class*="_MainContentSurface_"])');
  const rect=main?.getBoundingClientRect();
  const style=main?getComputedStyle(main):null;
  return {visible:!document.hidden,loaded:document.readyState==='complete',root:!!document.querySelector('#root'),
    mainReady:!!rect&&rect.width>200&&rect.height>100&&style.display!=='none'&&style.visibility!=='hidden',
    width:innerWidth,height:innerHeight};
}

// A listener or renderer can disappear while Electron finishes a cold start.
export async function waitForMainWindow({port,timeoutMs=60000,settleMs=600,
  list=async()=>{const r=await fetch(`http://127.0.0.1:${port}/json/list`,{signal:AbortSignal.timeout(2000)});if(!r.ok)throw Error(`Debugger HTTP ${r.status}`);return r.json()},
  connect=target=>attach(socketUrl(target.webSocketDebuggerUrl,port)),
  now=Date.now,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}) {
  const until=now()+timeoutMs,stable=new Map();let lastError='';
  while(now()<until){
    try{
      const targets=(await list()).filter(mainTarget);
      for(const target of targets){
        let client;
        try{
          client=await connect(target);
          try{
            const w=await client.call('Browser.getWindowForTarget',{targetId:target.id});
            if(w.bounds?.windowState==='minimized')await client.call('Browser.setWindowBounds',{windowId:w.windowId,bounds:{windowState:'normal'}});
          }catch{}
          // Electron may reject window lookup while still allowing page activation.
          try{await client.call('Page.bringToFront')}catch{}
          const response=await client.call('Runtime.evaluate',{expression:`(${mainPageStatus.toString()})()`,returnByValue:true});
          const v=response.result?.value;
          if(v?.visible&&v.loaded&&v.root&&v.mainReady&&v.width>0&&v.height>0){
            if(!stable.has(target.id))stable.set(target.id,now());
            if(now()-stable.get(target.id)>=settleMs)return client;
          }else stable.delete(target.id);
        }catch(error){lastError=error.message;stable.delete(target.id)}
        client?.close();
      }
      const ids=new Set(targets.map(t=>t.id));for(const id of stable.keys())if(!ids.has(id))stable.delete(id);
    }catch(error){lastError=error.message;stable.clear()}
    await wait(200);
  }
  throw Error(`Codex main window was not ready${lastError?`: ${lastError}`:''}`);
}
