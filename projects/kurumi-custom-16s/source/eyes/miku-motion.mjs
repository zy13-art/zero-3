import {mikuOpenness} from './miku-capture.mjs';
export function capturedOpenness(seconds){
 if(seconds<0||seconds>=.4-1e-10)return 1;
 const p=Math.max(0,Math.min(24,seconds*60)),i=Math.min(23,Math.floor(p+1e-9)),u=p-i;
 return Math.max(0,Math.min(1,mikuOpenness[i]*(1-u)+mikuOpenness[i+1]*u));
}
export function eyeMotion(time,introTime,background=false,reduced=false){
 const clamp=x=>Math.max(0,Math.min(1,x)),smooth=x=>{x=clamp(x);return x*x*(3-2*x)};
 if(reduced)return {open:1,closure:0,phase:'rest'};
 const cycle=((time%16)+16)%16;let open=1,phase='rest';
 for(const start of [10.70,13.86]){const local=cycle-start,value=capturedOpenness(local);if(value<open){open=value;phase=local<.2?'closing':local<.22?'closed':'opening';}}
 const awakening=background?1:smooth((introTime-3.16)/.90);
 return {open:awakening*open,closure:1-awakening*open,phase};
}
