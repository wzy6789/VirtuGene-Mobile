import './voice-context-latency';
import { db } from '../../src/db';
import { prepareCallContext } from '../../src/lib/voice-call/context';
import { VoiceCallController, type CallExchange, type CallView } from '../../src/lib/voice-call/controller';
import type { NativeAudioEvent } from '../../src/lib/voice-call/native-audio';
const fixture = window as any;
const hash = async (input: unknown) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(input)))),b=>b.toString(16).padStart(2,'0')).join('');
const sleep = (ms: number) => new Promise<void>(resolve=>setTimeout(resolve,Math.max(0,ms)));
Object.assign(window,{ segmentDatabaseRun: async()=>{
  await fixture.voiceContextLatency(true,true,true);
  await db.characterStates.put({characterId:'a',userId:'u',affinity:0,mood:70,milestones:[],updatedAt:Date.now()});
  const rows=[];
  for(let round=0;round<30;round++){
    let callback!:(event:NativeAudioEvent)=>void, view:CallView|undefined, complete:CallExchange|undefined;
    let turnId='',written=0,tailAt=0,sourceChecks=0;
    const packets:{start:number;end:number;firstFrame:number;lastFrame:number;label:number;bytes:number}[]=[],inputs:unknown[]=[];
    const counts={dialogue:0,tts:0};
    const played=()=>Math.min(written,packets.reduce((sum,p)=>sum+Math.min(p.lastFrame-p.firstFrame,Math.max(0,Math.floor((performance.now()-p.start)*24))),0));
    const receipt=(throughFrame?:number)=>({turnId,playedFrames:played(),writtenFrames:written,sampleRate:24000,...(throughFrame===undefined?{}:{throughFrame})});
    const controller=new VoiceCallController(`segment-db-${round}`,{inputMode:'text',voice:'茉莉',style:'',onView:v=>{view=v;},onExchange:r=>{complete=r;},
      context:async(text,exchanges,signal,mode)=>{
        const result=await prepareCallContext({userId:'u',characterId:'a',sessionId:'s',worldId:'w'},text,exchanges,signal,mode);
        const assertCurrent=result.assertCurrent!; result.assertCurrent=async()=>{sourceChecks++;await assertCurrent();};
        return result;
      },api:{recognize:async()=>{throw Error('ASR forbidden');},dialogue:async(messages,stream)=>{
        counts.dialogue++;inputs.push(messages);await stream.onText('我在听。');await stream.onText('你继续说。');
      },synthesize:async(text,_v,_s,stream)=>{
        counts.tts++;inputs.push(text);const label=text==='我在听。'?1:2;
        await sleep(20);await stream.onPcm(new Uint8Array(label===1?9600:19200).fill(label));await sleep(100);await stream.onPcm(new Uint8Array(9600).fill(label));
      }},audio:{start:async cb=>{callback=cb;return {sampleRate:16000,routes:[],echoCancellation:true,noiseSuppression:true,segmentDrain:true} as any;},
        beginPlayback:async id=>{turnId=id;},append:async(_id,pcm)=>{
          const start=Math.max(performance.now(),tailAt),frames=pcm.length/2;
          packets.push({start,end:start+frames/24,firstFrame:written,lastFrame:written+frames,label:pcm[0],bytes:pcm.length});
          written+=frames;tailAt=start+frames/24;return receipt();
        },drain:async(_id,_signal,throughFrame?:number)=>{
          const target=throughFrame??written,p=packets.find(p=>p.lastFrame>=target)!;
          await sleep(p.start+(target-p.firstFrame)/24-performance.now());
          // setTimeout may wake before the final sample; actual frame progress remains authoritative.
          while(played()<target) await sleep(1);
          return {...receipt(throughFrame),complete:true};
        },interrupt:async()=>receipt(),mute:async()=>{},resume:async()=>({routes:[]}),close:async()=>{},
      }});
    await controller.start();fixture.resetVoiceContextReadCounts();const started=performance.now();
    const ticker=setInterval(()=>{if(turnId)callback({callId:`segment-db-${round}`,type:'playback',at:performance.now(),...receipt()});},20);
    try{
      await controller.sendText('还记得一起观星 CHAT_MEMORY SHARED_MEMORY TODO_SOURCE CONTINUITY_SOURCE MOMENT_SOURCE REACTION_SOURCE 吗');
      while(!complete){if(performance.now()-started>15000||view?.phase==='error')throw Error(`Stocked playback failed ${view?.error??'timeout'}`);await sleep(10);}
    }finally{clearInterval(ticker);await controller.end();}
    if(complete!.heardText!=='我在听。你继续说。'||counts.dialogue!==1||counts.tts!==2)throw Error('Model calls or heard content changed '+JSON.stringify({counts,heard:complete!.heardText,error:view?.error,segments:complete!.segments}));
    const firstEnd=packets.filter(p=>p.label===1).at(-1)!.end,secondStart=packets.find(p=>p.label===2)!.start;
    rows.push({round,inputHash:await hash(inputs),counts,sourceChecks,reads:fixture.voiceContextReadCounts(),
      gapMs:Math.max(0,secondStart-firstEnd),metrics:complete!.metrics,heard:complete!.heardText,
      packetSizes:packets.map(p=>[p.label,p.bytes]),elapsedMs:performance.now()-started});
  }
  return {rows,apiCalls:0,microphone:false,scope:'Actual context/controller and stocked isolated IndexedDB; synthetic transport and frame-progress sink, not Android or physical audio'};
}});
