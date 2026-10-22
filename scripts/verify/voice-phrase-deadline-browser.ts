import './voice-context-latency';
import { db } from '../../src/db';
import { prepareCallContext } from '../../src/lib/voice-call/context';
import { VoiceCallController, type CallView, type CallExchange } from '../../src/lib/voice-call/controller';
import type { NativeAudioEvent } from '../../src/lib/voice-call/native-audio';
const fixture=window as any;
const sleep=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,Math.max(0,ms)));
const hash=async(value:unknown)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)))),b=>b.toString(16).padStart(2,'0')).join('');
function pcm(text:string){const bytes=new Uint8Array(text.length*1200*2),data=new DataView(bytes.buffer);for(let i=0;i<text.length;i++)for(let frame=0;frame<1200;frame++)data.setUint16((i*1200+frame)*2,text.charCodeAt(i),true);return bytes;}
Object.assign(window,{phraseDatabaseRun:async()=>{
 await fixture.voiceContextLatency(true,true,true);
 await db.characterStates.put({characterId:'a',userId:'u',affinity:0,mood:70,milestones:[],updatedAt:Date.now()});
 const rows=[],reply='这个我明白了接下来我们一起整理';
 for(let round=0;round<30;round++){
  let callback!:(event:NativeAudioEvent)=>void,view:CallView|undefined,completed:CallExchange|undefined,turnId='',written=0,tailAt=0,firstAt:number|undefined,firstTextAt=0,llmInput:unknown;
  const packets:{start:number,end:number,firstFrame:number,lastFrame:number}[]=[],audio:number[]=[],ttsText:string[]=[];
  const counts={dialogue:0,tts:0};
  const played=()=>Math.min(written,packets.reduce((sum,p)=>sum+Math.min(p.lastFrame-p.firstFrame,Math.max(0,Math.floor((performance.now()-p.start)*24))),0));
  const receipt=(throughFrame?:number)=>({turnId,playedFrames:played(),writtenFrames:written,sampleRate:24000,...(throughFrame===undefined?{}:{throughFrame})});
  const controller=new VoiceCallController(`phrase-db-${round}`,{inputMode:'text',voice:'茉莉',style:'',onView:v=>{view=v;},onExchange:r=>{completed=r;},
   context:(text,exchanges,signal,mode)=>prepareCallContext({userId:'u',characterId:'a',sessionId:'s',worldId:'w'},text,exchanges,signal,mode),
   api:{recognize:async()=>{throw Error('ASR forbidden');},dialogue:async(messages,stream)=>{counts.dialogue++;llmInput=messages;firstTextAt=performance.now();await stream.onText(reply);await sleep(1200);},
    synthesize:async(text,_voice,_style,stream)=>{counts.tts++;ttsText.push(text);await sleep(100);await stream.onPcm(pcm(text));}},
   audio:{start:async cb=>{callback=cb;return {sampleRate:16000,echoCancellation:true,noiseSuppression:true,routes:[],segmentDrain:true};},
    beginPlayback:async id=>{turnId=id;},append:async(_id,bytes)=>{firstAt??=performance.now();const start=Math.max(performance.now(),tailAt),frames=bytes.length/2;
      packets.push({start,end:start+frames/24,firstFrame:written,lastFrame:written+frames});written+=frames;tailAt=start+frames/24;audio.push(...bytes);return receipt();},
    drain:async(_id,_signal,target)=>{const through=target??written,p=packets.find(p=>p.lastFrame>=through)!;await sleep(p.start+(through-p.firstFrame)/24-performance.now());while(played()<through)await sleep(1);return {...receipt(target),complete:true};},
    interrupt:async()=>receipt(),mute:async()=>{},resume:async()=>({routes:[]}),close:async()=>{}}});
  await controller.start();fixture.resetVoiceContextReadCounts();const start=performance.now();
  const ticker=setInterval(()=>{if(turnId)callback({callId:`phrase-db-${round}`,type:'playback',at:performance.now(),...receipt()});},20);
  try{
   await controller.sendText('还记得一起观星 CHAT_MEMORY SHARED_MEMORY TODO_SOURCE CONTINUITY_SOURCE MOMENT_SOURCE REACTION_SOURCE 吗');
   while(!completed){if(performance.now()-start>15000||view?.phase==='error')throw Error('Stocked phrase failed '+(view?.error??'timeout'));await sleep(10);}
  }finally{clearInterval(ticker);await controller.end();}
  if(completed!.heardText!==reply||completed!.generatedText!==reply||ttsText.join('')!==reply||counts.dialogue!==1)throw Error('Reply/input changed '+JSON.stringify({heard:completed!.heardText,ttsText,counts}));
  rows.push({round,inputHash:await hash(llmInput),pcmHash:await hash(audio),spokenHash:await hash(ttsText.join('')),counts,reads:fixture.voiceContextReadCounts(),metrics:completed!.metrics,
   firstFromSendMs:firstAt!-start,firstFromTextMs:firstAt!-firstTextAt,elapsedMs:performance.now()-start,heard:completed!.heardText});
 }
 return {rows,apiCalls:0,microphone:false,scope:'Actual controller/context and stocked isolated IndexedDB; fixed 1200ms synthetic dialogue tail and 100ms synthetic TTS, frame-progress sink. Not provider/Android/physical sound.'};
}});
