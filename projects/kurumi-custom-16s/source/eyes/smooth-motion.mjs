import {mikuOpenness} from './miku-capture.mjs';
const anchors=mikuOpenness.slice(0,13),last=anchors.length-1;
const differences=anchors.slice(1).map((value,i)=>value-anchors[i]);
// Uniform PCHIP/Hermite slopes. Clamp both endpoints to zero velocity to meet rest/hold.
const slopes=anchors.map((_,i)=>{
 if(i===0||i===last)return 0;
 const a=differences[i-1],b=differences[i];
 return a*b>0?2*a*b/(a+b):0;
});
const clamp=value=>Math.max(0,Math.min(1,value));
const smooth=value=>{const x=clamp(value);return x*x*(3-2*x);};
export function sampleClosing(seconds){
 if(seconds<=0)return 1;if(seconds>=last/60)return 0;
 const position=seconds*60,i=Math.min(last-1,Math.floor(position)),t=position-i;
 const t2=t*t,t3=t2*t;
 return clamp((2*t3-3*t2+1)*anchors[i]+(t3-2*t2+t)*slopes[i]+(-2*t3+3*t2)*anchors[i+1]+(t3-t2)*slopes[i+1]);
}
// Round just the hard stop near half-open. Keep A's established path elsewhere.
export function lowerLidFollow(aperture,balance=0){
 const a=clamp(aperture),b=clamp(balance),u=(a-.45)/.10;
 const follow=a<=.45?2*a:a>=.55?1:.9+.2*u-.1*u*u;
 return follow*(1-b)+a*b;
}
export function hybridBlink(localSeconds){
 const closeEnd=12/60,openStart=13/60,openSeconds=.90;
 if(localSeconds<0||localSeconds>=openStart+openSeconds-1e-10)return {open:1,closure:0,phase:'rest',lidBalance:0};
 if(localSeconds<closeEnd){const open=sampleClosing(localSeconds);return {open,closure:1-open,phase:'closing',lidBalance:1};}
 if(localSeconds<openStart-1e-10)return {open:0,closure:1,phase:'closed',lidBalance:1};
 const open=smooth((localSeconds-openStart)/openSeconds);return {open,closure:1-open,phase:'opening',lidBalance:0};
}
export function eyeMotion(time,introTime,background=false,reduced=false){
 if(reduced)return {open:1,closure:0,phase:'rest',lidBalance:0};
 const cycle=((time%16)+16)%16;let state={open:1,closure:0,phase:'rest',lidBalance:0};
 for(const start of [10.70,13.86]){const candidate=hybridBlink(cycle-start);if(candidate.open<state.open||candidate.phase==='closing')state=candidate;}
 const awakening=background?1:smooth((introTime-3.16)/.90),open=awakening*state.open;
 return {...state,open,closure:1-open};
}
