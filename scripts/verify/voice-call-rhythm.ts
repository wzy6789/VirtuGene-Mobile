import assert from 'node:assert/strict';
import { VoiceCallController, type CallView, type CallAudioPort } from '../../src/lib/voice-call/controller';
import { projectCallMessages } from '../../src/lib/voice-call/record';
import { SpokenSentenceBuffer } from '../../src/lib/voice-call/utterance';
import {NativeCallAudio, type NativeAudioEvent, type NativeCallPlugin} from '../../src/lib/voice-call/native-audio';
let checks=0;const check=(condition:unknown,label:string)=>{assert.ok(condition,label);checks++;};
const tick=()=>new Promise(r=>setTimeout(r,0));
async function until(test:()=>boolean){for(let n=0;n<100;n++){if(test())return;await tick();}throw Error('timed out');}
async function main(){
 let now=0,view:CallView|undefined,callback!:(event:NativeAudioEvent)=>void,requests=0,asr=0,stops=0,routes=0,frames=0,sequence=0;
 let hold=false,release!:(value?:unknown)=>void,signal:AbortSignal|undefined;const triggers:unknown[]=[];
 const audio:CallAudioPort={start:async cb=>{callback=cb;return{sampleRate:16000,echoCancellation:true,noiseSuppression:true,routes:[{id:1,type:7,label:'蓝牙',selected:true},{id:2,type:2,label:'外放',selected:false}]};},
 beginPlayback:async()=>{frames=0;},append:async(_,pcm)=>({writtenFrames:frames+=pcm.length/2,playedFrames:frames}),drain:async()=>({writtenFrames:frames,playedFrames:frames,complete:true}),interrupt:async()=>{stops++;return{writtenFrames:frames,playedFrames:frames};},mute:async()=>{},pause:async()=>{},resume:async()=>({routes:[{id:1,type:7,label:'蓝牙',selected:true}]}),route:async()=>{routes++;return{routes:[]};},close:async()=>{}};
 const controller=new VoiceCallController('idle',{audio,now:()=>now,voice:'茉莉',style:'',onView:v=>{view=v;},
 context:async(text,history,signal,mode,trigger)=>{triggers.push(trigger);return[{role:'system',content:trigger?'自然确认对方还在。':'人物设定'}];},
 api:{recognize:async()=>{asr++;return'我还在。';},dialogue:async(_,opts)=>{requests++;signal=opts.signal;if(hold)await new Promise(r=>{release=r;});if(!opts.signal?.aborted)await opts.onText('还在吗？');},synthesize:async(_,v,s,opts)=>{await opts.onPcm(new Uint8Array(480));}}});
 const capture=(amplitude=0)=>{const pcm=new Uint8Array(3200);const dv=new DataView(pcm.buffer);for(let i=0;i<pcm.length;i+=2)dv.setInt16(i,amplitude,true);callback({callId:'idle',type:'capture',sampleRate:16000,pcm:btoa(String.fromCharCode(...pcm)),sequence:sequence++,at:now});};
 const quiet=(ms:number)=>{for(let i=0;i<ms/100;i++){now+=100;capture();}};
 await controller.start();await controller.selectRoute(1);check(routes===0&&stops===0,'active Bluetooth selection does not interrupt or call native route');
 capture();quiet(19900);await tick();check(requests===0,'ordinary pauses do not trigger a presence request');
 quiet(200);await until(()=>controller.getRecords().length===1);
 check(requests===1&&asr===0&&triggers[0]==='presence-check','silence generates a role turn without ASR or fabricated user input');
 const exchange=controller.getRecords()[0];check(exchange.origin==='presence-check'&&!exchange.userText&&exchange.heardText==='还在吗？','only played presence speech is recorded');
 const projected=projectCallMessages({id:'idle',userId:'u',characterId:'c',sessionId:'s',startedAt:0,endedAt:now,voice:'茉莉',summaryState:'pending',messageIds:[],exchanges:[exchange]});
 check(projected.length===1&&projected[0].role==='assistant'&&projected[0].isProactive&&!projected[0].replyToUserMessageId,'presence record has no synthetic user message or reply link');
 now=90000;capture();await tick();check(requests===1,'one presence check per uninterrupted silence');
 await controller.setInputMode('text').catch(()=>{}); // No mode adapter: remains voice and reports unavailable.
 check(view?.inputMode==='voice','unsupported mode switch cannot silently change the call');
 callback({callId:'idle',type:'paused',reason:'background',at:now});now=120000;capture();await tick();check(requests===1,'background cannot initiate a presence request');
 await controller.resume();now=120100;capture();await tick();check(requests===1,'resume resets silence delay');
 await controller.mute(true);now=150000;capture();await tick();check(requests===1,'muted microphone never prompts the user');
 await controller.mute(false);now=150100;capture();await tick();check(requests===1,'unmute does not immediately prompt');
 hold=true;quiet(20100);await until(()=>requests===2);
 check(!signal?.aborted,'new silence permits one new presence request after explicit resume');
 now+=100;capture(8000);await until(()=>!!signal?.aborted);check(signal?.aborted,'real speech cancels the pending presence turn');
 release();hold=false;for(let n=0;n<8;n++){now+=100;capture(n<2?8000:0);}now+=800;capture();
 await until(()=>asr===1);check(asr===1,'real user speech resumes the normal ASR path');
 await controller.end();const before=requests;now+=30000;capture();await tick();check(requests===before,'hangup excludes late capture and future requests');
 const splitter=new SpokenSentenceBuffer();check(splitter.push('这件事我已经认真想过了，').length===1,'first meaningful clause can start before a long whole sentence');
 check(splitter.push('接下来，').length===0,'later clauses retain the original larger segment threshold');
 splitter.reset();check(splitter.push('(不能说的动作)<think>分析</think>这件事我已经认真想过了，')[0]==='这件事我已经认真想过了，','early segmentation still suppresses actions and reasoning');
 let settle!:(value:any)=>void;
 const nativePlugin={addListener:async()=>({remove:async()=>{}}),start:async()=>({sampleRate:16000,echoCancellation:true,noiseSuppression:true,routes:[]}),heartbeat:async()=>{},stopPlayback:async()=>({writtenFrames:0,playedFrames:0}),stop:async()=>{},setRoute:async()=>new Promise(resolve=>{settle=resolve;})} as unknown as NativeCallPlugin;
 const native=new NativeCallAudio('route-settle',nativePlugin,10,50,100);await native.start(()=>{});
 const routeSettling=native.route(3);await new Promise(r=>setTimeout(r,25));settle({routes:[{id:3,type:7,label:'蓝牙',selected:true}]});
 check((await routeSettling).routes[0].selected,'route confirmation has a separate deadline, not the short general bridge timeout');
 const staleRoute=native.route(4);const staleRejected=assert.rejects(staleRoute,e=>(e as Error).name==='AbortError');await tick();await native.close();settle({routes:[]});await staleRejected;checks++;
 console.log(JSON.stringify({checks,realApiCalls:0,modelTokens:0,deviceTested:false,scope:'controlled controller/bridge, interruption and receipts; no external calls'}));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
