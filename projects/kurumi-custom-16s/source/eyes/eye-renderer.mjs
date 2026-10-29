// Approved layered artwork; only the lower-lid follow curve is smoothed for this version.
import {lowerLidFollow} from './smooth-motion.mjs';
export async function createEyeRenderer(canvas,{patchOnly=false}={}){
 const calibration=await fetch(new URL('./eye-calibration.json',import.meta.url)).then(r=>{if(!r.ok)throw Error('Eye calibration unavailable');return r.json()});
 const images=await Promise.all(['open','closed','half','skin'].map(name=>new Promise((ok,no)=>{const i=new Image();i.onload=()=>ok(i);i.onerror=no;i.src=new URL(`./assets/${name}.png`,import.meta.url)})));
 canvas.width=1920;canvas.height=960;
 const gl=canvas.getContext('webgl',{alpha:patchOnly,antialias:false,preserveDrawingBuffer:true,premultipliedAlpha:false});
 if(!gl)throw Error('Eye WebGL unavailable');
function curve(name,points){
 const n=x=>Number(x).toFixed(4);let s=`float ${name}(float x){if(x<=${n(points[0][0])})return ${n(points[0][1])};`;
 for(let i=1;i<points.length;i++){
  const a=points[i-1],b=points[i],prev=points[Math.max(0,i-2)],next=points[Math.min(points.length-1,i+1)];
  const slope0=(b[1]-prev[1])/(b[0]-prev[0]),slope1=(next[1]-a[1])/(next[0]-a[0]),dx=b[0]-a[0];
  s+=`if(x<${n(b[0])}){float t=(x-${n(a[0])})/${n(dx)};return clamp((2.*t*t*t-3.*t*t+1.)*${n(a[1])}+(t*t*t-2.*t*t+t)*${n(slope0*dx)}+(-2.*t*t*t+3.*t*t)*${n(b[1])}+(t*t*t-t*t)*${n(slope1*dx)},${n(Math.min(a[1],b[1]))},${n(Math.max(a[1],b[1]))});}`;
 }
 return s+`return ${n(points.at(-1)[1])};}`;
}
let curves='',passes='';
const fringe=[
 [[1222,330],[1251,330],[1252,350],[1250,365],[1254,377],[1246,375],[1232,363],[1224,347]],
 [[1281,330],[1300,330],[1305,353],[1308,371],[1306,381],[1297,390],[1294,382],[1288,368],[1284,348]],
 [[1572,330],[1672,330],[1672,397],[1662,408],[1664,432],[1667,447],[1650,438],[1625,418],[1604,394],[1586,362]],
 [[1512,330],[1530,330],[1537,369],[1546,407],[1558,441],[1570,469],[1558,456],[1544,431],[1534,400],[1524,365]]
];
function polygon(name,points){
 let s=`float ${name}(vec2 p){float d=1e6;bool inside=false;`;
 for(let i=0;i<points.length;i++){
  const a=points[i],b=points[(i+1)%points.length];
  s+=`{vec2 a=vec2(${a[0]}.,${a[1]}.),b=vec2(${b[0]}.,${b[1]}.);vec2 v=b-a;float t=clamp(dot(p-a,v)/dot(v,v),0.,1.);d=min(d,length(p-a-t*v));if((a.y>p.y)!=(b.y>p.y)){if(p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)inside=!inside;}}`;
 }
 return s+'return 1.-smoothstep(-.75,.75,inside?-d:d);}';
}
const fringeFunctions=fringe.map((p,i)=>polygon('fringe'+i,p)).join('\n');
calibration.eyes.forEach((eye,i)=>{
 for(const [name,key] of [['ou','upperOpen'],['hu','upperHalf'],['cu','upperClosed'],['ol','lowerOpen'],['hl','lowerHalf']])curves+=curve(`${name}${i}`,eye[key]);
 const [x0,y0,x1,y1]=eye.bounds.map(Number);
 passes+=`{
 float ou=ou${i}(p.x),hu=hu${i}(p.x),cu=cu${i}(p.x),ol=ol${i}(p.x),hl=hl${i}(p.x),cl=cu;
 float patch=smoothstep(${x0-7}.,${x0+2}.,p.x)*(1.-smoothstep(${x1-2}.,${x1+7}.,p.x));
 patch*=smoothstep(${y0-7}.,${y0+2}.,p.y)*(1.-smoothstep(${y1-2}.,${y1+7}.,p.y));
 patch*=smoothstep(ou-35.,ou-25.,p.y)*(1.-smoothstep(max(ol,cu)+20.,max(ol,cu)+32.,p.y));
 mask=max(mask,patch);
 float hair=1.-smoothstep(.25,.52,brightest(skinAt(p).rgb));
 if(patch>0. && aperture<.99999){
  float blend=aperture<.5?aperture*2.:(aperture-.5)*2.;
  float low=aperture<.5?0.:.5,high=aperture<.5?.5:1.;
  float u0=aperture<.5?cu:hu,u1=aperture<.5?hu:ou,l0=aperture<.5?cl:hl,l1=aperture<.5?hl:ol;
  float tc=mix(cu,ou+(ol-ou)*.606,lidBalance),bc=tc;
  float thU=mix(hu,(ou+tc)*.5,lidBalance),thL=mix(hl,(ol+bc)*.5,lidBalance);
  float tu=mix(tc,ou,aperture),tl=mix(tc,ol,lowerFollow);
  float edge=smoothstep(${eye.upperOpen[0][0]-5}.,${eye.upperOpen[0][0]+8}.,p.x)*(1.-smoothstep(${eye.upperOpen.at(-1)[0]-4}.,${eye.upperOpen.at(-1)[0]+7}.,p.x));
  vec4 eye=mix(surface(p,low,u0,l0,tu,tl,cu,ol,ou,edge),surface(p,high,u1,l1,tu,tl,cu,ol,ou,edge),blend);
  eye=mix(eye,skinAt(p),hair*(1.-smoothstep(.96,1.,aperture)));
  col=mix(col,eye,patch);
 }
 }`;
});
const vertex='attribute vec2 a;varying vec2 uv;void main(){uv=(a+1.)*.5;gl_Position=vec4(a,0.,1.);}';
const fragment=`precision highp float;varying vec2 uv;
uniform sampler2D opened;uniform sampler2D shut;uniform sampler2D halfShut;uniform sampler2D skin;uniform vec2 photo;uniform vec4 roi;uniform float aperture;uniform float lidBalance;uniform float lowerFollow;
vec4 openAt(vec2 p){return texture2D(opened,p/photo);}vec4 closedAt(vec2 p){return texture2D(shut,p/photo);}vec4 halfAt(vec2 p){return texture2D(halfShut,p/photo);}
vec4 skinAt(vec2 p){return texture2D(skin,p/photo);}
vec4 keyAt(vec2 p,float key){if(key<.25)return closedAt(p);if(key<.75)return halfAt(p);return openAt(p);}
float brightest(vec3 c){return max(c.r,max(c.g,c.b));}
vec4 surface(vec2 p,float key,float su,float sl,float tu,float tl,float cu,float ol,float ou,float edge){
 vec4 result=openAt(p);
 result=mix(result,skinAt(p),1.-smoothstep(tu-.6,tu+.6,p.y));
 result=mix(result,skinAt(p),smoothstep(tl-.6,tl+.6,p.y));
 vec4 lash=mix(closedAt(vec2(p.x,cu+p.y-tu)),openAt(vec2(p.x,ou+p.y-tu)),smoothstep(.35,.9,aperture));
 float ink=1.-smoothstep(.15,.36,brightest(lash.rgb));
 result=mix(result,lash,smoothstep(tu-2.,tu-.5,p.y)*(1.-smoothstep(14.,21.,p.y-tu))*ink*edge);
 vec4 lower=openAt(vec2(p.x,ol+p.y-tl));
 float li=1.-smoothstep(.12,.42,brightest(lower.rgb));
 float lm=smoothstep(tl-15.,tl-11.,p.y)*(1.-smoothstep(tl+2.,tl+5.,p.y));
 lm*=smoothstep(ou+12.,ou+20.,ol+p.y-tl);
 result=mix(result,lower,lm*li*edge*smoothstep(.04,.22,aperture));
 result=mix(result,closedAt(p),1.-smoothstep(0.,.10,aperture));
 result=mix(result,openAt(p),smoothstep(.96,1.,aperture));
 return result;
}
${fringeFunctions}
${curves}
void main(){vec2 p=roi.xy+vec2(uv.x,1.-uv.y)*roi.zw;vec4 col=openAt(p);float mask=0.;${passes}${patchOnly?'if(mask>1e-5){vec3 fg=(col.rgb-openAt(p).rgb*(1.-mask))/mask;gl_FragColor=vec4(clamp(fg,0.,1.),mask);}else{gl_FragColor=vec4(0.);}':'gl_FragColor=vec4(col.rgb,1.);'}}`;
function shader(kind,text){const s=gl.createShader(kind);gl.shaderSource(s,text);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;}
const program=gl.createProgram();gl.attachShader(program,shader(gl.VERTEX_SHADER,vertex));gl.attachShader(program,shader(gl.FRAGMENT_SHADER,fragment));gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));gl.useProgram(program);
const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
const at=gl.getAttribLocation(program,'a');gl.enableVertexAttribArray(at);gl.vertexAttribPointer(at,2,gl.FLOAT,false,0,0);
images.forEach((image,i)=>{gl.activeTexture(gl.TEXTURE0+i);const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);gl.uniform1i(gl.getUniformLocation(program,['opened','shut','halfShut','skin'][i]),i)});
gl.uniform2f(gl.getUniformLocation(program,'photo'),images[0].naturalWidth,images[0].naturalHeight);gl.uniform4f(gl.getUniformLocation(program,'roi'),...calibration.roi);
const aperture=gl.getUniformLocation(program,'aperture'),balance=gl.getUniformLocation(program,'lidBalance'),follow=gl.getUniformLocation(program,'lowerFollow');

 function draw(state){
  gl.viewport(0,0,canvas.width,canvas.height);gl.uniform1f(aperture,state.open);gl.uniform1f(balance,state.lidBalance||0);gl.uniform1f(follow,lowerLidFollow(state.open,state.lidBalance||0));gl.drawArrays(gl.TRIANGLES,0,6);
  if(gl.isContextLost())throw Error('Eye WebGL context lost');return state;
 }
 return {canvas,calibration,draw,gl};
}
