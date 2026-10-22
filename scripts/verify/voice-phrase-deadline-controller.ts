import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { VoiceCallController, type CallView } from '../../src/lib/voice-call/controller';
import type { NativeAudioEvent } from '../../src/lib/voice-call/native-audio';
import type { SpeechDeadlineScheduler } from '../../src/lib/voice-call/speech-deadline';
const before=process.argv.includes('--before'),hash=(value:unknown)=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
let checks=0;const check=(value:unknown,label:string)=>{assert.ok(value,label);checks++;};
const flush=async()=>{for(let i=0;i<120;i++)await Promise.resolve();};
class Clock implements SpeechDeadlineScheduler {
  value=0;id=0;tasks=new Map<number,{at:number,callback:()=>void}>();all:(()=>void)[]=[];
  now(){return this.value;}set(callback:()=>void,delay:number){const id=++this.id;this.tasks.set(id,{at:this.value+delay,callback});this.all.push(callback);return id;}
  clear(handle:unknown){this.tasks.delete(handle as number);}
  async advance(to:number){while(true){const next=[...this.tasks].filter(([,row])=>row.at<=to).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;this.value=next[1].at;this.tasks.delete(next[0]);next[1].callback();await flush();}this.value=to;await flush();}
  sleep(delay:number,signal:AbortSignal){return new Promise<void>((resolve,reject)=>{const finish=()=>{signal.removeEventListener('abort',abort);resolve();};const id=this.set(finish,delay);const abort=()=>{this.clear(id);signal.removeEventListener('abort',abort);reject(new DOMException('Aborted','AbortError'));};signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();});}
}
function fixture(delay:number){
  const clock=new Clock(),reply='我都看完了接下来我们一起处理',voice:string[]=[];let view:CallView|undefined,callback!:(e:NativeAudioEvent)=>void,firstPcm:number|undefined,frames=0,turnId='',dialogues=0,asrs=0,sourceChecks=0,inputHash='';
  const bytes:number[]=[];const state={withdrawn:false};
  const validate=async()=>{sourceChecks++;if(state.withdrawn)throw Error('voice:source_withdrawn');};
  const controller=new VoiceCallController('deadline-synthetic',{inputMode:'text',voice:'茉莉',style:'既有角色语气',now:()=>clock.now(),speechDeadlineScheduler:clock,
    context:async text=>({messages:[{role:'system',content:'保留原角色设定和经过授权的资料'},{role:'user',content:text}],assertCurrent:validate,
      reviewSpeech:async(text,observed)=>{await validate();observed?.(0);return text;}}),onView:value=>{view=value;},audio:{
      start:async cb=>{callback=cb;return {sampleRate:16000,echoCancellation:true,noiseSuppression:true,routes:[],segmentDrain:true};},
      beginPlayback:async id=>{turnId=id;frames=0;},append:async(_id,pcm)=>{firstPcm??=clock.now();frames+=pcm.length/2;bytes.push(...pcm);return {turnId,playedFrames:frames,writtenFrames:frames,sampleRate:24000};},
      drain:async(_id,_signal,target)=>({turnId,playedFrames:frames,writtenFrames:frames,sampleRate:24000,complete:true,throughFrame:target}),
      interrupt:async()=>({turnId,playedFrames:frames,writtenFrames:frames,sampleRate:24000}),mute:async()=>{},pause:async()=>{},resume:async()=>({routes:[]}),close:async()=>{},
    },api:{recognize:async()=>{asrs++;return '不应调用';},dialogue:async(messages,options)=>{dialogues++;inputHash=hash(messages);options.onRequest?.();await options.onText(reply);await clock.sleep(1200,options.signal);},
      synthesize:async(text,selectedVoice,style,options)=>{check(selectedVoice==='茉莉'&&style==='既有角色语气','timed segmentation preserves voice and delivery');voice.push(text);options.onRequest?.();await clock.sleep(delay,options.signal);
        const pcm=new Uint8Array(text.length*2),data=new DataView(pcm.buffer);for(let i=0;i<text.length;i++)data.setUint16(i*2,text.charCodeAt(i),true);await options.onPcm(pcm);},
    }});
  return {controller,clock,reply,voice,state,callback:(type:'paused'|'routeLost')=>callback({callId:'deadline-synthetic',type,at:clock.now(),reason:'test'}),
    get firstPcm(){return firstPcm;},get view(){return view;},get dialogues(){return dialogues;},get asrs(){return asrs;},get sourceChecks(){return sourceChecks;},get inputHash(){return inputHash;},get pcmHash(){return hash(bytes);}};
}
async function main(){
 const rows:any[]=[],cancellations:any[]=[];
 for(let round=0;round<30;round++)for(const ttsMs of [40,100,180]){
  const f=fixture(ttsMs);await f.controller.start();
  try{
   await f.controller.sendText('请帮我看这份资料');await flush();await f.clock.advance(449);
   check(f.voice.length===0,'no TTS request is made before the safe-clause deadline');await f.clock.advance(450+ttsMs);
   check(before?f.firstPcm===undefined:f.firstPcm===450+ttsMs,'safe clause reaches actual controller playback before simulated dialogue completion');
   await f.clock.advance(1200+ttsMs+10);const records=f.controller.getRecords();
   check(records.length===1&&records[0].heardText===f.reply&&records[0].generatedText===f.reply&&!records[0].interrupted,'full final dialogue and played history remain unchanged');
   check(f.asrs===0&&f.dialogues===1&&f.voice.length===(before?1:2)&&f.voice.join('')===f.reply,'only the phrase split changes synthetic TTS request count; no speculative ASR/dialogue');
   rows.push({round,ttsMs,firstPcmAtMs:f.firstPcm,finishedAtMs:f.clock.now(),inputHash:f.inputHash,pcmHash:f.pcmHash,spokenHash:hash(f.voice.join('')),dialogueRequests:f.dialogues,ttsRequests:f.voice.length,sourceChecks:f.sourceChecks});
  }finally{await f.controller.end();check(f.clock.tasks.size===0,'turn end releases phrase and synthetic transport timers');}
 }
 for(let round=0;round<30;round++)for(const action of ['interrupt','pause','withdraw'] as const){
  const f=fixture(100);await f.controller.start();try{
   await f.controller.sendText('请帮我看这份资料');await flush();await f.clock.advance(449);
   if(action==='interrupt')await f.controller.interrupt();else if(action==='pause')f.callback('paused');else f.state.withdrawn=true;
   await f.clock.advance(1400);for(const callback of f.clock.all)callback();await flush();
   check(f.voice.length===0&&f.firstPcm===undefined&&f.controller.getRecords().every(record=>!record.heardText),'cancelled, paused and withdrawn timed replies never synthesize or become heard facts');
   if(action==='withdraw')check(f.view?.error==='voice:source_withdrawn','deadline source withdrawal keeps the real error instead of a later abort');
   cancellations.push({round,action,ttsRequests:f.voice.length,heard:f.controller.getRecords().map(row=>row.heardText)});
  }finally{await f.controller.end();check(f.clock.tasks.size===0,'failure/stop clears all scheduled work');}
 }
 console.log(JSON.stringify({before,checks,rows,cancellations,apiCalls:0,microphone:false,scope:'Actual controller and deadline queue with deterministic transport, source-review and audio doubles; not real provider, populated DB or physical sound.'}));
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
