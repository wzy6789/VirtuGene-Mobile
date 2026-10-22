import {build} from 'esbuild';
import {runInNewContext} from 'node:vm';
import {mkdirSync,writeFileSync} from 'node:fs';
const out='.tmp-preview/orb-cute-20261017';
const result=await build({stdin:{contents:"export * from './src/lib/orb-personality';export * from './src/lib/orb-vitality';",resolveDir:process.cwd()},bundle:true,write:false,platform:'node',format:'cjs'});
const module={exports:{}};runInNewContext(result.outputFiles[0].text,{module,exports:module.exports});
const {sampleOrbLife,orbVitalityProfile}=module.exports;
const checks=[];const check=(name,pass)=>checks.push({name,pass:!!pass});
const happy=sampleOrbLife('happy',1280,0,6),idle=sampleOrbLife('idle',1280,0,6);
check('happy primary hop is at least 13 SVG units',idle.lift-happy.lift>13);
const shy=sampleOrbLife('shy',2100,0,6),neutral=sampleOrbLife('idle',2100,0,6);
check('shy tucks down and visibly compresses',shy.faceY>=2.8&&shy.lift>3&&shy.stretch>neutral.stretch);
const peek=sampleOrbLife('curious',1800,0,6);
check('curious head tilt is readable',sampleOrbLife('idle',1800,0,6).tilt-peek.tilt>=6);
check('reading and voice retain quiet envelopes',orbVitalityProfile('gentle','reading').body===.24&&orbVitalityProfile('gentle','voice').body===.3);
for(const mood of ['idle','curious','listening','thinking','working','happy','surprised','shy','sleepy','sad','error','success']){
 const samples=Array.from({length:2401},(_,i)=>sampleOrbLife(mood,i*10,0,10));
 check(`${mood} finite bounded choreography`,samples.every(v=>Object.values(v).every(Number.isFinite)&&Math.abs(v.lift)<24&&Math.abs(v.tilt)<9&&Math.abs(v.stretch)<.065));
 let maxStep=0;for(let i=1;i<samples.length;i++)maxStep=Math.max(maxStep,Math.abs(samples[i].lift-samples[i-1].lift));
 check(`${mood} no discontinuous jump at cycle boundary`,maxStep<1.2);
}
mkdirSync(out,{recursive:true});writeFileSync(`${out}/${process.env.VG_ORB_CUTE_PHASE??'after'}.json`,JSON.stringify({checks,pass:checks.every(c=>c.pass)},null,2));
console.log(JSON.stringify({checks:checks.length,failed:checks.filter(c=>!c.pass)},null,2));if(checks.some(c=>!c.pass))process.exitCode=1;
