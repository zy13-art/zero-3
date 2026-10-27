// Temporary video layer inspired by chenyi380/baili-codex. Early opaque mounting,
// session ownership, first-frame readiness and fail-open guards follow the same
// principles as 6shenhonghong9/dsh-startup-screen and dsh-wallpaper-engine.
export function installIntro(win, sessionId = 'legacy') {
  if(win.top!==win)return {installed:false};
  if(win.__kurumiIntro)return {installed:true,existing:true,sessionId:win.__kurumiIntro.sessionId};
  if(win.__kurumiIntroResult?.sessionId===sessionId)return {installed:true,terminal:true,...win.__kurumiIntroResult};
  const doc=win.document,priorFocus=doc.activeElement;
  const shell=doc.createElement('div');shell.id='kurumi-intro';shell.tabIndex=-1;
  shell.setAttribute('role','dialog');shell.setAttribute('aria-label','Codex 入场动画');shell.setAttribute('aria-modal','true');
  Object.assign(shell.style,{position:'fixed',inset:'0',zIndex:'2147483647',background:'#000',display:'grid',placeItems:'center',overflow:'hidden',pointerEvents:'auto',isolation:'isolate'});
  const video=doc.createElement('video');video.setAttribute('playsinline','');video.setAttribute('aria-label','时崎狂三 Codex 入场动画');
  video.playsInline=true;video.muted=false;video.defaultMuted=false;video.volume=.75;video.preload='auto';
  Object.assign(video.style,{width:'100%',height:'100%',objectFit:'contain',display:'block',opacity:'0',background:'#000'});
  const skip=doc.createElement('button');skip.textContent='跳过 · Esc';skip.setAttribute('aria-label','跳过入场动画');
  Object.assign(skip.style,{position:'absolute',right:'24px',top:'20px',padding:'7px 12px',border:'1px solid #7d7d7d',borderRadius:'6px',color:'#fff',background:'rgba(0,0,0,.55)',font:'14px Segoe UI, sans-serif',cursor:'pointer'});
  shell.append(video,skip);
  let parts=[],objectUrl=null,state='receiving',error='',disposed=false,firstFrame=false,watchdog=null,frameRequest=null,observer=null;
  function arm(ms,message){if(watchdog!==null)win.clearTimeout(watchdog);watchdog=win.setTimeout(()=>fail(message),ms);}
  function mount(){
    if(disposed||shell.isConnected)return;
    const host=doc.body||doc.documentElement;if(!host)return;
    host.append(shell);try{shell.focus({preventScroll:true})}catch{}
    observer?.disconnect();observer=null;
  }
  function keydown(e){
    e.stopImmediatePropagation?.();
    if(e.key==='Escape'){e.preventDefault();dispose('skipped');}
    else if(e.key==='Tab'){e.preventDefault();skip.focus();}
  }
  function status(){return {state,error,currentTime:video.currentTime,width:video.videoWidth,height:video.videoHeight,readyState:video.readyState,muted:video.muted,duration:video.duration,disposed,firstFrame};}
  function dispose(reason='removed'){
    if(disposed)return;disposed=true;
    win.__kurumiIntroResult={sessionId,...status(),state:reason,terminal:true};state='done';
    if(watchdog!==null)win.clearTimeout(watchdog);watchdog=null;
    observer?.disconnect();observer=null;
    if(frameRequest!==null)video.cancelVideoFrameCallback?.(frameRequest);frameRequest=null;
    video.onplaying=video.onloadeddata=video.ontimeupdate=video.onended=video.onerror=null;
    video.pause();video.removeAttribute('src');video.load();parts=[];shell.remove();
    doc.removeEventListener('keydown',keydown,true);
    if(objectUrl){win.URL.revokeObjectURL(objectUrl);objectUrl=null;}
    if(win.__kurumiIntro===api)delete win.__kurumiIntro;
    if(priorFocus?.isConnected)try{priorFocus.focus({preventScroll:true})}catch{}
  }
  function fail(message){if(disposed)return;error=String(message);dispose('error');}
  function frameReady(){
    if(disposed||firstFrame||video.readyState<2)return;
    firstFrame=true;state='playing';video.style.opacity='1';arm(12000,'Intro playback stalled');
  }
  function awaitFrame(){
    if(disposed||firstFrame)return;
    if(video.requestVideoFrameCallback){if(frameRequest===null)frameRequest=video.requestVideoFrameCallback(()=>{frameRequest=null;frameReady()});}
    else if(video.readyState>=2)win.requestAnimationFrame(()=>win.requestAnimationFrame(frameReady));
  }
  const api={installed:true,sessionId,
    begin(){if(disposed||state!=='receiving')throw Error('Intro is not receiving');parts=[];},
    addChunk(encoded){
      if(disposed||state!=='receiving')throw Error('Intro is not receiving');
      const binary=win.atob(encoded),bytes=new Uint8Array(binary.length);
      for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);parts.push(bytes);
    },
    start(){
      if(disposed||state!=='receiving'||!parts.length)throw Error('Intro film is empty or already started');
      objectUrl=win.URL.createObjectURL(new win.Blob(parts,{type:'video/mp4'}));parts=[];state='loading';
      arm(10000,'Intro decoder did not present a frame');video.src=objectUrl;video.load();awaitFrame();
      try{const playing=video.play();playing?.catch(e=>fail(e.message));}catch(e){fail(e.message);}
    },status,dispose};
  win.__kurumiIntro=api;
  doc.addEventListener('keydown',keydown,true);skip.onclick=()=>dispose('skipped');
  video.onended=()=>dispose('ended');video.onerror=()=>fail(video.error?.message||`Film decode failed (${video.error?.code??'unknown'})`);
  video.onplaying=awaitFrame;video.onloadeddata=awaitFrame;
  video.ontimeupdate=()=>{if(firstFrame&&video.currentTime>=8)dispose('ended');};
  arm(20000,'Intro media transfer expired');mount();
  if(!shell.isConnected&&win.MutationObserver){observer=new win.MutationObserver(mount);observer.observe(doc,{childList:true,subtree:true});}
  return {installed:true,pending:!shell.isConnected};
}
