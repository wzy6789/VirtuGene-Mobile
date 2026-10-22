import fs from 'node:fs';
import {build} from 'esbuild';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {basename,join} from 'node:path';
const out='.tmp-preview/ui-overhaul-20261016/call-glass-refinement';
const evidence=process.env.VG_ORB_IDENTITY_OUT??out;
fs.mkdirSync(evidence,{recursive:true});
async function load(path,motionRoot){
  const source=fs.readFileSync(path,'utf8');
  const result=await build({stdin:{contents:source,loader:'ts',resolveDir:process.cwd()+'/src/lib'},bundle:true,write:false,platform:'node',format:'cjs',plugins:motionRoot?[{name:'frozen-reviewed-motion',setup(b){b.onLoad({filter:/[\\/]orb-(personality|vitality)\.ts$/},args=>({contents:fs.readFileSync(join(motionRoot,basename(args.path)),'utf8'),loader:'ts',resolveDir:process.cwd()+'/src/lib'}));}}]:[]});
  const module={exports:{}};vm.runInNewContext(result.outputFiles[0].text,{module,exports:module.exports});return module.exports.createOrbPainter;
}
const before=await load(out+'/before/source/orb-render.ts'),after=await load('src/lib/orb-render.ts');
// The user subsequently authorized a larger, cuter interaction choreography.
// Keep the historical reading/voice contract, and compare interaction against
// that explicitly accepted, hash-verified motion batch rather than reverting it.
const acceptedRoot='.tmp-preview/starfield-upgrade-20261017/P9/orb-authorized';
const acceptedStage=JSON.parse(fs.readFileSync(acceptedRoot+'/manifest.json','utf8'));
for(const file of acceptedStage.files){
  for(const path of [file.path,acceptedRoot+'/'+file.path.split('/').at(-1)]){
    assert.equal(createHash('sha256').update(fs.readFileSync(path)).digest('hex'),file.sha256,'Approved interaction source remains unchanged; review new motion changes explicitly');
  }
}
const accepted=await load(acceptedRoot+'/orb-render.ts',acceptedRoot);
const keys=['rig','face','left','right','mouth','blush','orbit','shadow','darkMouth','brows','orbitDot','waves','thoughts','sleep','tear','cross','sparkles','sheen','coreA','coreB','coreC','focus','ripple'];
function node(){return {values:{},children:[],setAttribute(name,value){this.values[name]=value}};}
function refs(){return Object.fromEntries(keys.map(key=>{const current=node();current.children=[node(),node(),node()];return [key,{current}]}));}
function state(r){return Object.fromEntries(keys.map(key=>[key,{...r[key].current.values,children:r[key].current.children.map(n=>n.values)}]));}
const pose={eyeWidth:8,eyeOpen:1,rightOpen:1,eyeCurve:0,eyeGap:22,mouthWidth:6,mouthCurve:4,mouthOpen:2,mouthDark:0,tilt:0,faceX:0,faceY:0,scaleX:1,scaleY:1,lift:0,blush:0,brow:0,browLift:0,browTilt:0,orbit:.23,orbitDot:2.4,listening:0,thought:0,busy:0,sleep:0,tear:0,cross:0,sparkles:0};
const response={elapsed:500,scale:0,lift:0,tilt:0};let checks=0;
for(const context of ['reading','interaction','voice'])for(const intensity of ['gentle','lively','reduced'])for(const move of [true,false]){
  const a=refs(),b=refs(),c=refs(),paintA=before(a,224,.7),paintB=after(b,224,.7),paintAccepted=accepted(c,224,.7);
  for(const time of [0,16,32,48,120,550,1200]){
    const args=[pose,time,0,move,move?1:0,[.2,-.1],[.1,-.05],response,'listening',false,false,{intensity,context,signal:{captureLevel:.2,playback:true},focus:[0,0]}];
    paintA(...args);paintB(...args);paintAccepted(...args);
    if(context==='voice'){
      for(const key of keys.filter(key=>!['coreA','coreC'].includes(key)))assert.deepEqual(state(a)[key],state(b)[key],`Voice ${key} movement remains unchanged`);
      for(const key of ['coreA','coreC'])assert.ok(Math.abs(+b[key].current.values.opacity-+a[key].current.values.opacity*.45)<.0011,'White layer gain changes only voice material');
    }else if(context==='interaction')assert.deepEqual(state(c),state(b),'Interaction retains the user-approved expressive motion');
    else assert.deepEqual(state(a),state(b),`${context} rendering stays identical`);
    checks++;
  }
}
for(const mood of ['idle','curious','listening','thinking','working','happy','surprised','shy','sleepy','sad','error','success'])for(const context of ['reading','interaction','voice'])for(const move of [true,false]){
  const currentRefs=refs(),acceptedRefs=refs(),paintCurrent=after(currentRefs,44,.7),paintReviewed=accepted(acceptedRefs,44,.7);
  for(const time of [0,16,32,120,550,925,1280,1800,2100,3000,5300,6800,7600]){
    const args=[pose,time,0,move,move?1:0,[.2,-.1],[.1,-.05],response,mood,false,false,{intensity:'gentle',context,signal:{captureLevel:.2,playback:true},focus:[0,0]}];
    paintCurrent(...args);paintReviewed(...args);assert.deepEqual(state(currentRefs),state(acceptedRefs),`${mood}/${context} matches frozen authorized motion modules`);checks++;
  }
}
fs.writeFileSync(evidence+'/render-identity.json',JSON.stringify({status:'pass',checks,acceptedMotionStage:acceptedRoot+'/manifest.json',scope:'126 historical-renderer comparisons with shared motion dependencies plus 936 comparisons against frozen hash-verified authorized modules for all 12 moods, 3 contexts, active/paused states at 44px. Historical checks sample listening; they do not prove every voice mood stayed identical to old choreography. No device GPU claim.'},null,2)+'\n');
console.log(`PASS ${checks} renderer comparisons`);
