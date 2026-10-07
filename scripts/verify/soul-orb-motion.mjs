import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';
import assert from 'node:assert/strict';
const result=await build({entryPoints:['src/lib/soul-orb-motion.ts'],bundle:true,write:false,platform:'node',format:'cjs'});
const module={exports:{}};runInNewContext(result.outputFiles[0].text,{module,exports:module.exports});
const {settleOrbValue,stepOrbSpring,createOrbAccent,startOrbAccent,stepOrbAccent,sampleOrbOrbit,sampleOrbTouch,sampleOrbBlink}=module.exports;
let checks=0;
const check=(ok,label)=>{assert.ok(ok,label);checks++;};
for(const frequency of [8,16]){
  const target=1;
  const direct=settleOrbValue(-.5,2,target,.5,frequency);
  let current=[-.5,2];for(let i=0;i<30;i++)current=settleOrbValue(...current,target,1/60,frequency);
  check(Math.abs(current[0]-direct[0])<1e-10&&Math.abs(current[1]-direct[1])<1e-10,`frequency ${frequency} remains independent of frame rate`);
  current=[-.5,2];for(const dt of [.01,.064,.016,.05,.06,.1,.2])current=settleOrbValue(...current,target,dt,frequency);
  check(Math.abs(current[0]-direct[0])<1e-10,`frequency ${frequency} handles irregular frame intervals`);
}
const positions=Array.from({length:241},(_,i)=>sampleOrbOrbit(i/240));
check(positions.every(([x,y])=>Number.isFinite(x+y)&&x>=26&&x<=233&&y>=121&&y<=195),'orbit node remains within its authored arc');
check(Math.hypot(...positions[0].map((v,i)=>v-positions.at(-1)[i]))<1e-8,'orbit loop closes without a position jump');
check(Math.hypot(...sampleOrbOrbit(.0001).map((v,i)=>v-positions[0][i]))<.001,'orbit slows smoothly at its turnaround');
check(sampleOrbTouch(160).lift<=-11,'touch has a visible midpoint lift');
check([-1,0,320,1000].every(t=>{const p=sampleOrbTouch(t);return p.lift===0&&p.tilt===0;}),'touch accent starts and ends at rest within 320ms');
check(Math.abs(sampleOrbTouch(319.99).lift)<1e-6,'touch lands continuously without a final-frame snap');
check(sampleOrbTouch(64).squash>0&&sampleOrbTouch(160).squash<0&&sampleOrbTouch(256).squash>0,'touch compresses on takeoff and landing, stretches in flight');
check([-1,0,320,1000].every(t=>sampleOrbTouch(t).squash===0),'deformation returns to rest at both endpoints');
check(Array.from({length:321},(_,t)=>sampleOrbTouch(t)).every(p=>Math.abs(p.squash)<=.065),'touch deformation stays bounded under repeated sampling');
check(sampleOrbBlink(65)===1&&[-1,0,210,1000].every(t=>sampleOrbBlink(t)===0),'blink fully closes and returns to open');
check(sampleOrbBlink(32.5)>sampleOrbBlink(177.5),'eyelids close faster than they reopen');
check(Array.from({length:211},(_,t)=>sampleOrbBlink(t)).every(v=>v>=0&&v<=1),'blink never inverts eyelid geometry');
for(const ratio of [1,.8,.99999])for(const rate of [30,60,120]){
  const direct=stepOrbSpring(-.5,2,1,.5,24,ratio);
  let current=[-.5,2];for(let i=0;i<rate/2;i++)current=stepOrbSpring(...current,1,1/rate,24,ratio);
  check(Math.abs(current[0]-direct[0])<1e-10&&Math.abs(current[1]-direct[1])<1e-9,`spring ${ratio} agrees at ${rate}Hz`);
}
check(stepOrbSpring(0,0,1,0,24,.8)[0]===0,'zero time preserves the spring position');
check(stepOrbSpring(NaN,Infinity,1,.01)[0]===1,'invalid state falls back to the finite target');
check(stepOrbSpring(0,0,1,-1)[0]===1,'invalid duration has a safe static result');
check(Math.abs(stepOrbSpring(0,0,1,.2,45)[0]-1)<.1,'discrete gaze reaches 90% within 200ms');
let slow=[0,0];const slowSamples=[];for(let i=0;i<120;i++){slow=stepOrbSpring(...slow,1,1/120,8);slowSamples.push(slow[0]);}
check(slowSamples.every((v,i)=>v<=1&&(!i||v>=slowSamples[i-1])),'heavy critical pose never overshoots');
check(slowSamples[59]<.99&&slowSamples[119]>.99,'heavy pose remains visibly settling at 500ms and rests within one second');
for(const rate of [30,60,120]){
  const accent=createOrbAccent();startOrbAccent(accent,'success');const values=[];
  for(let i=0;i<Math.ceil(rate*.4);i++){stepOrbAccent(accent,1/rate);values.push(accent.scale);}
  const peak=Math.max(...values);
  check(peak>=.02&&peak<=.04,`success stretch is 2–4% at ${rate}Hz`);
  check(accent.elapsed===320&&accent.scale===0&&accent.lift===0&&accent.tilt===0,`success rests by 320ms at ${rate}Hz`);
}
const peakFor=compression=>{const a=createOrbAccent();startOrbAccent(a,'touch',compression);let peak=0;for(let i=0;i<40;i++){stepOrbAccent(a,1/120);peak=Math.max(peak,a.scale);}return peak;};
check(peakFor(.09)>peakFor(.02),'actual compression determines release energy');
const interrupted=createOrbAccent();startOrbAccent(interrupted,'success');stepOrbAccent(interrupted,.08);const visible=interrupted.scale;
startOrbAccent(interrupted,'error');check(interrupted.scale===visible,'failure interruption preserves the current visible position');
const attentionBundle=await build({stdin:{contents:"export * from './src/lib/orb-attention'; export * from './src/lib/orb-motion-profiles'; export * from './src/lib/orb-personality';",resolveDir:process.cwd()},bundle:true,write:false,platform:'node',format:'cjs'});
const attentionModule={exports:{}};runInNewContext(attentionBundle.outputFiles[0].text,{module:attentionModule,exports:attentionModule.exports});
const {resolveOrbAttention,constrainOrbGaze,ORB_CHANNEL_GROUPS,sampleOrbLife,resolveOrbTransition,orbPoseCoefficients}=attentionModule.exports;
const host={key:'task',point:{x:.6,y:.5}};
check(resolveOrbAttention([-.9,0],200,host,500,[0,0],100)[0]===-.9,'near pointer takes priority over host attention');
check(resolveOrbAttention([-.9,0],0,host,500,[0,0],100)[0]===.6,'expired pointer yields to host attention');
check(resolveOrbAttention([-.9,0],0,host,50,[.2,0],100)[0]===.2,'expired host yields to roaming');
check(Math.hypot(...constrainOrbGaze(2,2))<=1.000001,'diagonal gaze respects its total radius');
check(constrainOrbGaze(NaN,1).every(v=>v===0),'invalid attention is neutral');
check(Object.keys(ORB_CHANNEL_GROUPS).length===28,'all pose channels have exactly one motion group');
const repeat=createOrbAccent();let repeatedPeak=0;for(let i=0;i<500;i++){startOrbAccent(repeat,'success');stepOrbAccent(repeat,.064);repeatedPeak=Math.max(repeatedPeak,Math.abs(repeat.scale));}
check(Number.isFinite(repeatedPeak)&&repeatedPeak<.15,'rapid repeated cues have bounded energy');
const fields=['scale','scaleVelocity','lift','liftVelocity','tilt','tiltVelocity'];
const at=(kind,seconds,interval)=>{const a=createOrbAccent();startOrbAccent(a,kind);let remaining=seconds;while(remaining>1e-12){const dt=Math.min(interval,remaining);stepOrbAccent(a,dt);remaining-=dt;}return a;};
for(const kind of ['touch','success','error','surprised','happy'])for(const seconds of [.049,.051,.19,.241,.28,.319,.32]){
  const expected=at(kind,seconds,seconds);
  check([30,60,120].every(rate=>{const actual=at(kind,seconds,1/rate);return fields.every(field=>Math.abs(actual[field]-expected[field])<1e-8);}),`${kind} trajectory and velocity match across frame rates at ${seconds}s`);
}
const noTime=createOrbAccent();startOrbAccent(noTime,'success');const beforeInvalid=JSON.stringify(noTime);
for(const dt of [0,-1,NaN,Infinity])stepOrbAccent(noTime,dt);
check(JSON.stringify(noTime)===beforeInvalid,'invalid accent durations do not inject motion');
const tail=at('success',.28,1/120),tailVisible=tail.scale,tailVelocity=tail.scaleVelocity;
startOrbAccent(tail,'touch');
check(tail.scale===tailVisible&&tail.scaleVelocity===tailVelocity,'interrupting a landing retains visible position and actual velocity');
stepOrbAccent(tail,.001);
check(Math.abs(tail.scale-tailVisible)<.003,'landing takeover has no positional jump');
const moods=['idle','curious','listening','thinking','working','happy','surprised','shy','sleepy','sad','error','success'];
const signatures=new Set();
for(const mood of moods){
  const samples=Array.from({length:1201},(_,i)=>sampleOrbLife(mood,i*16,0,9));
  signatures.add(JSON.stringify(samples.filter((_,i)=>i%200===0)));
  check(samples.every(p=>Object.values(p).every(Number.isFinite)&&Math.abs(p.lift)<20&&Math.abs(p.tilt)<8&&Math.abs(p.stretch)<.06&&Math.abs(p.faceX)<4&&Math.abs(p.faceY)<4),`${mood} choreography remains bounded across complete gesture cycles`);
  check([4900,5300,5700,6200,6400,6800,7400,7600].every(t=>{const before=sampleOrbLife(mood,t-.001,0,9),after=sampleOrbLife(mood,t+.001,0,9);return Object.keys(before).every(key=>Math.abs(after[key]-before[key])<.001);}),`${mood} gesture loop has no endpoint jump`);
}
check(signatures.size===12,'all twelve moods have different body choreography');
const heldGlance=sampleOrbLife('thinking',1800,0,9),stillGlance=sampleOrbLife('thinking',2000,0,9);
check(heldGlance.faceX===3&&stillGlance.faceX===3&&sampleOrbLife('thinking',4000,0,9).faceX===0,'thinking looks, holds and returns instead of endlessly drifting');
check(sampleOrbLife('listening',1010,0,9).faceY<-.9&&sampleOrbLife('listening',3000,0,9).faceY===0,'listening nod has a deliberate gesture and a resting interval');
check(sampleOrbLife('happy',1280,0,9).mouth>1&&sampleOrbLife('happy',3500,0,9).mouth===0,'happy hop coordinates its smile and then rests');
check(Object.values(sampleOrbLife('idle',NaN,0)).every(v=>v===0),'invalid personality clock returns a neutral pose');
check(resolveOrbTransition('sad','happy')?.frequencies.body===16,'heavy-to-bright transition brings body response closer to facial response');
const progress=c=>1-c[0];
const coordinated=orbPoseCoefficients(.12,'happy',.32,resolveOrbTransition('sad','happy'));
const ordinary=orbPoseCoefficients(.12,'happy');
check(Math.abs(progress(coordinated.eyes)-progress(coordinated.body))<Math.abs(progress(ordinary.eyes)-progress(ordinary.body))*.5,'coordinated transition halves face/body progress disparity at 120ms');
check(resolveOrbTransition('happy','sad')?.frequencies.body===8,'bright-to-heavy transition retains the deliberate slow body');
check(['thinking','working','error'].every(mood=>resolveOrbTransition('sad',mood)===undefined),'live work and failure retain direct state response');
const transitionAt=(from,to,seconds,interval,group)=>{
  const profile=resolveOrbTransition(from,to);let remaining=profile?.duration??0,clock=0,value=-.5,velocity=2;
  while(clock<seconds-1e-12){const dt=Math.min(interval,seconds-clock),c=orbPoseCoefficients(dt,to,remaining,profile)[group],y=value-1;
    [value,velocity]=[1+c[0]*y+c[1]*velocity,c[2]*y+c[3]*velocity];remaining=Math.max(0,remaining-dt);clock+=dt;
  }return [value,velocity];
};
for(const [from,to] of [['sad','happy'],['sleepy','success'],['happy','sad']])for(const group of ['eyes','mouth','face','body','attachment']){
  const expected=transitionAt(from,to,.5,.5,group);
  check([30,60,120].every(rate=>transitionAt(from,to,.5,1/rate,group).every((v,i)=>Math.abs(v-expected[i])<1e-9)),`${from} to ${to} ${group} remains frame independent across the 320ms boundary`);
}
console.log(`PASS ${checks} soul orb motion checks`);
