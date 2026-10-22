import {VoiceCallController,type CallAudioPort,type CallView} from '../../src/lib/voice-call/controller';
import type {NativeAudioEvent} from '../../src/lib/voice-call/native-audio';
const cases:{name:string;passed:boolean;detail?:unknown}[]=[];
const tick=()=>new Promise(r=>setTimeout(r,0));
async function until(fn:()=>boolean){for(let i=0;i<100;i++){if(fn())return;await tick();}throw Error('timed out');}
function fixture(id:string){
 let now=0,sequence=0,callback!:(event:NativeAudioEvent)=>void,view:CallView|undefined,requests=0,frames=0;
 let rejectRoute!:(error:Error)=>void;
 const audio:CallAudioPort={start:async cb=>{callback=cb;return{sampleRate:16000,echoCancellation:true,noiseSuppression:true,routes:[{id:1,type:7,label:'蓝牙',selected:true},{id:2,type:2,label:'外放',selected:false}]};},
 beginPlayback:async()=>{frames=0;},append:async(_,pcm)=>({playedFrames:frames+=pcm.length/2,writtenFrames:frames}),drain:async()=>({playedFrames:frames,writtenFrames:frames,complete:true}),interrupt:async()=>({playedFrames:frames,writtenFrames:frames}),pause:async()=>{},mute:async()=>{},resume:async()=>({routes:[]}),close:async()=>{},route:async()=>new Promise((_,reject)=>{rejectRoute=reject;})};
 const controller=new VoiceCallController(id,{audio,now:()=>now,voice:'茉莉',style:'',onView:v=>{view=v;},context:async()=>[],api:{recognize:async()=>'',dialogue:async(_,opts)=>{requests++;await opts.onText('还在吗？');},synthesize:async(_,v,s,opts)=>{await opts.onPcm(new Uint8Array(480));}}});
 const capture=(amplitude=0)=>{const pcm=new Uint8Array(3200),dv=new DataView(pcm.buffer);for(let i=0;i<pcm.length;i+=2)dv.setInt16(i,amplitude,true);callback({callId:id,type:'capture',sampleRate:16000,pcm:btoa(String.fromCharCode(...pcm)),sequence:sequence++,at:now});};
 return{controller,get requests(){return requests;},get view(){return view;},setTime:(value:number)=>{now=value;},quiet:(ms:number)=>{for(let i=0;i<ms/100;i++){now+=100;capture();}},capture,pause:()=>callback({callId:id,type:'paused',reason:'background-or-lock',at:now}),reject:()=>rejectRoute(new Error('voice:route_failed')),routeReady:()=>!!rejectRoute};
}
async function main(){
 const gap=fixture('gap');await gap.controller.start();gap.setTime(25000);gap.capture();await tick();await tick();
 cases.push({name:'capture gap is not evidence of continuous silence',passed:gap.requests===0,detail:gap.requests});await gap.controller.end();
 const route=fixture('cancel-route');await route.controller.start();const changing=route.controller.selectRoute(2).catch(()=>{});await until(route.routeReady);route.pause();route.reject();await changing;
 cases.push({name:'cancelled route preserves device/background pause reason',passed:route.view?.phase==='paused'&&route.view.error==='background-or-lock',detail:route.view?.error});await route.controller.end();
 const alreadyPaused=fixture('paused-route-error');await alreadyPaused.controller.start();alreadyPaused.pause();await tick();
 const failedSelection=alreadyPaused.controller.selectRoute(2).catch(()=>{});await until(alreadyPaused.routeReady);alreadyPaused.reject();await failedSelection;
 cases.push({name:'genuine selection failure while already paused is still reported',passed:alreadyPaused.view?.phase==='error'&&alreadyPaused.view.error==='voice:route_failed',detail:alreadyPaused.view?.error});await alreadyPaused.controller.end();
 const noise=fixture('noise');await noise.controller.start();noise.capture();noise.quiet(20200);await until(()=>noise.controller.getRecords().length===1);
 noise.capture(8000);noise.quiet(1000);await tick();await tick();noise.quiet(20200);await tick();await tick();
 cases.push({name:'discarded short noise cannot rearm an already asked presence check',passed:noise.requests===1,detail:noise.requests});await noise.controller.end();
 console.log(JSON.stringify({cases,realApiCalls:0,modelTokens:0,deviceTested:false}));if(cases.some(c=>!c.passed))process.exitCode=1;
}
main().catch(e=>{console.error(e);process.exitCode=1;});
