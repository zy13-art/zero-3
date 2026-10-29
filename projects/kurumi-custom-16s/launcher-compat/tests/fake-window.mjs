export function fakeWindow({body=true,root=true}={}) {
  const elements=[],listeners=new Map(),timers=new Map();let serial=0,frameCallback=null;
  const original={isConnected:true,focused:0,focus(){this.focused++;}};
  function element(tag){const e={tagName:tag.toUpperCase(),style:{},children:[],attrs:{},isConnected:false,currentTime:0,videoWidth:3840,videoHeight:2160,duration:8,readyState:2,muted:false,paused:true,
    setAttribute(k,v){this.attrs[k]=v},removeAttribute(k){delete this.attrs[k]},append(...items){this.children.push(...items);for(const x of items){x.parentNode=this;x.isConnected=this.isConnected}},remove(){this.removed=true;this.isConnected=false;if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(x=>x!==this)},focus(){doc.activeElement=this},pause(){this.paused=true},load(){},play(){this.paused=false;return Promise.resolve()},
    requestVideoFrameCallback(fn){frameCallback=fn;return 1},cancelVideoFrameCallback(){frameCallback=null}};elements.push(e);return e;}
  const html=element('html');html.isConnected=true;const bodyElement=body?element('body'):null;if(bodyElement){bodyElement.isConnected=true;html.append(bodyElement);}
  const doc={body:bodyElement,documentElement:html,activeElement:original,hidden:false,createElement:element,querySelector:s=>s==='#root'&&root?{}:null,
    addEventListener(name,fn){listeners.set(name,fn)},removeEventListener(name,fn){if(listeners.get(name)===fn)listeners.delete(name)}};
  const win={document:doc,innerWidth:1000,innerHeight:700,location:new URL('app://-/index.html?initialRoute=%2Flocal%2Ftest'),performance:{now:()=>0},
    setTimeout(fn,ms){const id=++serial;timers.set(id,{fn,ms});return id},clearTimeout(id){timers.delete(id)},requestAnimationFrame(fn){fn();return 1},
    URL:{created:[],revoked:[],createObjectURL(blob){this.created.push(blob);return 'blob:owned-film'},revokeObjectURL(url){this.revoked.push(url)}},Blob:globalThis.Blob,atob:s=>Buffer.from(s,'base64').toString('binary')};
  win.top=win;
  return {win,doc,elements,listeners,timers,original,video:()=>elements.find(x=>x.tagName==='VIDEO'),shell:()=>elements.find(x=>x.id==='kurumi-intro'),firstFrame(){const fn=frameCallback;frameCallback=null;fn?.(0,{mediaTime:0});}};
}
