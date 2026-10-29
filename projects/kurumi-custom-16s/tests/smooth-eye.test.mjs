import assert from 'node:assert/strict';
import {sampleClosing,hybridBlink,lowerLidFollow,eyeMotion} from '../source/eyes/smooth-motion.mjs';
import {mikuOpenness} from '../source/eyes/miku-capture.mjs';
import {hybridBlink as oldBlink} from './fixtures/previous-hybrid.mjs';
let assertions=0;
const near=(a,b,tol,label)=>{assert.ok(Math.abs(a-b)<=tol,`${label}: ${a} versus ${b}`);assertions++;};
for(let i=0;i<=12;i++)near(sampleClosing(i/60),mikuOpenness[i],1e-10,'Preserve captured B anchors');
let previous=1;
for(let i=0;i<=2400;i++){
 const value=sampleClosing(i/12000);assert.ok(value>=-1e-12&&value<=1+1e-12&&value<=previous+1e-12,'No reversal or overshoot');assertions++;previous=value;
}
let maxVelocityJump=0,previousVelocityJump=0;
const h=1e-7;
for(let i=0;i<=12;i++){
 const t=i/60,left=(sampleClosing(t)-sampleClosing(t-h))/h,right=(sampleClosing(t+h)-sampleClosing(t))/h;
 maxVelocityJump=Math.max(maxVelocityJump,Math.abs(left-right));near(left,right,.005,'C1 closing velocity at sample boundary');
 const oldLeft=(oldBlink(t).open-oldBlink(t-h).open)/h,oldRight=(oldBlink(t+h).open-oldBlink(t).open)/h;
 previousVelocityJump=Math.max(previousVelocityJump,Math.abs(oldLeft-oldRight));
}
for(let i=0;i<=54;i++){
 const time=13/60+i/60;near(hybridBlink(time).open,oldBlink(time).open,1e-10,'Preserve A opening and original timing');
}
for(const a of [.45,.5,.55,1]){
 const left=(lowerLidFollow(a,0)-lowerLidFollow(a-h,0))/h,right=(lowerLidFollow(a+h,0)-lowerLidFollow(a,0))/h;
 near(left,right,.005,'Lower lid follows without a velocity step');
}
for(const a of [0,.1,.25,.4,.6,.75,1])near(lowerLidFollow(a,0),Math.min(2*a,1),1e-12,'A lower path unchanged away from rounded stop');
let maxLowerPathChange=0;
for(let i=0;i<=1000;i++){const a=i/1000;maxLowerPathChange=Math.max(maxLowerPathChange,Math.abs(lowerLidFollow(a,0)-Math.min(a*2,1)));}
assert.ok(maxLowerPathChange<=.0250001);assertions++;
const openingStart=13/60;
const timedFollow=t=>lowerLidFollow(hybridBlink(t).open,hybridBlink(t).lidBalance);
near((timedFollow(openingStart)-timedFollow(openingStart-h))/h,(timedFollow(openingStart+h)-timedFollow(openingStart))/h,.005,'Zero-speed closed-to-open lower-lid transition');
for(const b of [0,1])for(const a of [0,.1,.25,.5,.75,1])assert.ok(lowerLidFollow(a,b)>=0&&lowerLidFollow(a,b)<=1);
let newSubframes=0;
for(let i=0;i<12;i++)if(Math.abs(sampleClosing((i+.5)/60)-(mikuOpenness[i]+mikuOpenness[i+1])*.5)>1e-6)newSubframes++;
assert.ok(newSubframes>=8);assertions++;
near(eyeMotion(10.8,0,true,true).open,1,0,'Reduced motion');
assert.ok(maxVelocityJump<previousVelocityJump/1000);assertions++;
console.log(JSON.stringify({status:'PASS',assertions,maxVelocityJump,previousVelocityJump,newNonlinearClosingSubframes:newSubframes,maxLowerPathChange,closingSeconds:.2,openingSeconds:.9,sourceArtworkRegenerated:false}));
