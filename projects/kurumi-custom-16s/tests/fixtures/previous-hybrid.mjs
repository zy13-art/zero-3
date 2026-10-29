import {capturedOpenness} from '../../source/eyes/miku-motion.mjs';
const closeSeconds=12/60,holdEnd=13/60,openSeconds=.90;
const smooth=value=>{const x=Math.max(0,Math.min(1,value));return x*x*(3-2*x);};
// User selection: exactly B's captured closing, then exactly A's reopening.
// Both painted endpoints are identical at full closure, so lid balance can switch there.
export function hybridBlink(localSeconds){
 if(localSeconds<0||localSeconds>=holdEnd+openSeconds-1e-10)return {open:1,closure:0,phase:'rest',lidBalance:0};
 if(localSeconds<closeSeconds){const open=capturedOpenness(localSeconds);return {open,closure:1-open,phase:'closing',lidBalance:1};}
 if(localSeconds<holdEnd-1e-10)return {open:0,closure:1,phase:'closed',lidBalance:1};
 const open=smooth((localSeconds-holdEnd)/openSeconds);return {open,closure:1-open,phase:'opening',lidBalance:0};
}
export function eyeMotion(time,introTime,background=false,reduced=false){
 if(reduced)return {open:1,closure:0,phase:'rest',lidBalance:0};
 const cycle=((time%16)+16)%16;
 let state={open:1,closure:0,phase:'rest',lidBalance:0};
 for(const start of [10.70,13.86]){const candidate=hybridBlink(cycle-start);if(candidate.open<state.open||candidate.phase==='closing')state=candidate;}
 const awakening=background?1:smooth((introTime-3.16)/.90),open=awakening*state.open;
 return {...state,open,closure:1-open};
}
