import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';
import { mkdirSync, writeFileSync } from 'node:fs';
const bundle=await build({stdin:{contents:"export * from './src/lib/orb-personality';export * from './src/lib/orb-vitality';export * from './src/lib/orb-render';",resolveDir:process.cwd()},bundle:true,write:false,platform:'node',format:'cjs'});
const module={exports:{}};runInNewContext(bundle.outputFiles[0].text,{module,exports:module.exports});
const {sampleOrbLife,orbVitalityProfile,createOrbPainter}=module.exports;
const checks=[];const check=(pass,name)=>checks.push({name,pass:!!pass});
const gentle=orbVitalityProfile('gentle','interaction'),lively=orbVitalityProfile('lively','interaction');
check(gentle.body>=.7&&gentle.touch>=.75,'default interaction has clearly visible body and release energy');
check(lively.body>gentle.body&&lively.touch>gentle.touch,'lively remains stronger than gentle');
check(orbVitalityProfile('gentle','reading').body===.24&&orbVitalityProfile('lively','reading').body===.38,'reading keeps its existing quiet envelope');
check(orbVitalityProfile('gentle','voice').body===.3,'voice body does not fabricate audio activity');
const neutral=sampleOrbLife('idle',1800,0,6),peek=sampleOrbLife('curious',1800,0,6);
check(neutral.tilt-peek.tilt>=4.5,'curiosity has a legible head tilt');
const pre=sampleOrbLife('happy',925,0,6),rest=sampleOrbLife('idle',925,0,6);
check(pre.stretch-rest.stretch>.022,'happy takeoff includes a visible squash');
const atPeak=sampleOrbLife('happy',1280,0,6);
check(sampleOrbLife('idle',1280,0,6).lift-atPeak.lift>10,'happy hop rises before its softer echo');
// Observe actual renderer transforms: reduced motion must not retain choreography.
const names=['rig','face','left','right','mouth','blush','orbit','shadow','darkMouth','brows','orbitDot','waves','thoughts','sleep','tear','cross','sparkles','sheen'];
const pose={eyeWidth:9,eyeOpen:1,rightOpen:1,eyeGap:23,scaleX:1,scaleY:1};
const p=new Proxy(pose,{get:(o,k)=>o[k]??0});
const accent={elapsed:320,lift:0,tilt:0,scale:0};
function sample(move,mood){
  const refs=Object.fromEntries(names.map(name=>[name,{current:{attributes:{},children:[],setAttribute(k,v){this.attributes[k]=v;}}}]));
  const paint=createOrbPainter(refs,160,0),out=[];
  for(let t=0;t<=2200;t+=1000/120){paint(p,t,0,move,1,[0,0],[0,0],accent,mood,false,false,{intensity:'gentle',context:'interaction',focus:[0,0]});out.push(refs.rig.current.attributes.transform);}
  return out;
}
const still=sample(false,'happy');check(new Set(still).size===1,'reduced motion has no body displacement or deformation');
const transforms=sample(true,'happy');
const scales=transforms.map(t=>Number(/ scale\(([^ ]+)/.exec(t)[1]));
check(Math.max(...scales)-Math.min(...scales)>.025,'real renderer carries squash and stretch instead of discarding choreography');
for(const mood of ['idle','curious','listening','thinking','working','happy','surprised','shy','sleepy','sad','error','success']){
  const values=Array.from({length:2401},(_,i)=>sampleOrbLife(mood,i*10,0,10));
  check(values.every(v=>Object.values(v).every(Number.isFinite)&&Math.abs(v.lift)<24&&Math.abs(v.tilt)<9&&Math.abs(v.stretch)<.065),`${mood}: complete-cycle bounded movement`);
}
const out='.tmp-preview/starfield-upgrade-20261017/P6a';mkdirSync(out,{recursive:true});
writeFileSync(`${out}/${process.env.VG_ORB_EXPRESSIVE_PHASE??'after'}.json`,JSON.stringify({checks,pass:checks.every(c=>c.pass)},null,2));
console.log(JSON.stringify({checks:checks.length,failed:checks.filter(c=>!c.pass)},null,2));
if(checks.some(c=>!c.pass))process.exitCode=1;
