import './voice-context-latency';
import { db } from '../../src/db';
import { prepareCallContext } from '../../src/lib/voice-call/context';
import { VoiceCallController, type CallView, type CallExchange } from '../../src/lib/voice-call/controller';
import type { NativeAudioEvent } from '../../src/lib/voice-call/native-audio';
const fixture=window as any,sleep=(ms:number)=>new Promise<void>(r=>setTimeout(r,Math.max(0,ms)));
const hash=async(value:unknown)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)))),b=>b.toString(16).padStart(2,'0')).join('');
type ReadWork={rows:number;keys:number;requests:number;tables:Record<string,{rows:number;keys:number}>};
const emptyWork=():ReadWork=>({rows:0,keys:0,requests:0,tables:{}});let work=emptyWork();
db.use({stack:'dbcore',name:'voice-chain-read-work',create:down=>({...down,table:name=>{
 const table=down.table(name),add=(kind:'rows'|'keys',n:number)=>{work[kind]+=n;(work.tables[name]??={rows:0,keys:0})[kind]+=n;};
 return {...table,
  count:request=>{work.requests++;return table.count(request);},
  get:async request=>{work.requests++;const row=await table.get(request);add('rows',Number(!!row));return row;},
  getMany:async request=>{work.requests++;const rows=await table.getMany(request);add('rows',rows.filter(Boolean).length);return rows;},
  query:async request=>{work.requests++;const result=await table.query(request);add(request.values===false?'keys':'rows',result.result.length);return result;},
  openCursor:async request=>{work.requests++;const cursor=await table.openCursor(request);if(!cursor)return cursor;
   const seen=new Set<string>(),start=cursor.start.bind(cursor),count=()=>{const id=JSON.stringify([cursor.key,cursor.primaryKey]);if(!seen.has(id)){seen.add(id);add(request.values===false?'keys':'rows',1);}};
   count();cursor.start=callback=>start(()=>{count();callback();});return cursor;},
 };
}})});
Object.assign(window,{voiceChainSpeed:async(rounds=30,sessionCount=128)=>{
 await fixture.voiceContextLatency(true,true,true);
 const now=Date.now();await db.characterStates.put({characterId:'a',userId:'u',affinity:0,mood:70,milestones:[],updatedAt:now});
 await db.sessions.bulkPut(Array.from({length:sessionCount},(_,i)=>({id:'unrelated-private-'+i,userId:'u',characterId:'a',type:'single',title:'无关会话'+i,createdAt:now-100_000-i,updatedAt:now-100_000-i,unreadCount:0})) as any);
 // Ensure the complete input contains both a source-backed durable memory and
 // selected raw original chat, so repeated session authorization is exercised.
 const rows=[],reply='这个我明白了。';
 for(let round=0;round<rounds;round++){
  let callback!:(event:NativeAudioEvent)=>void,view:CallView|undefined,completed:CallExchange|undefined,turnId='',written=0,tailAt=0,firstAt:number|undefined,firstTextAt=0,llmInput:unknown;
  const packets:{start:number,firstFrame:number,lastFrame:number}[]=[],audio:number[]=[],tts:string[]=[];const requests={asr:0,dialogue:0,tts:0};
  const played=()=>Math.min(written,packets.reduce((sum,p)=>sum+Math.min(p.lastFrame-p.firstFrame,Math.max(0,Math.floor((performance.now()-p.start)*24))),0));
  const receipt=(throughFrame?:number)=>({turnId,playedFrames:played(),writtenFrames:written,sampleRate:24000,...(throughFrame===undefined?{}:{throughFrame})});
  const controller=new VoiceCallController('chain-speed-'+round,{inputMode:'text',voice:'茉莉',style:'',onView:v=>{view=v;},onExchange:r=>{completed=r;},
   context:(text,exchanges,signal,mode)=>prepareCallContext({userId:'u',characterId:'a',sessionId:'s',worldId:'w'},text,exchanges,signal,mode),
   api:{recognize:async()=>{requests.asr++;throw Error('ASR forbidden');},dialogue:async(messages,stream)=>{requests.dialogue++;llmInput=messages;
    for(const marker of ['CHAT_SOURCE','CHAT_MEMORY','SHARED_MEMORY','TODO_SOURCE','CONTINUITY_SOURCE','MOMENT_SOURCE','REACTION_SOURCE'])
     if(!messages[0].content.includes(marker))throw Error('Full input omitted source marker '+marker);
    await sleep(100);firstTextAt=performance.now();await stream.onText(reply);},
    synthesize:async(text,_voice,_style,stream)=>{requests.tts++;tts.push(text);await sleep(100);const bytes=new Uint8Array(text.length*2400),data=new DataView(bytes.buffer);for(let i=0;i<bytes.length/2;i++)data.setUint16(i*2,text.charCodeAt(Math.floor(i/1200)),true);await stream.onPcm(bytes);}},
   audio:{start:async cb=>{callback=cb;return {sampleRate:16000,echoCancellation:true,noiseSuppression:true,routes:[],segmentDrain:true};},beginPlayback:async id=>{turnId=id;},
    append:async(_id,bytes)=>{firstAt??=performance.now();const start=Math.max(performance.now(),tailAt),frames=bytes.length/2;packets.push({start,firstFrame:written,lastFrame:written+frames});written+=frames;tailAt=start+frames/24;audio.push(...bytes);return receipt();},
    drain:async(_id,_signal,target)=>{const through=target??written,p=packets.find(p=>p.lastFrame>=through)!;await sleep(p.start+(through-p.firstFrame)/24-performance.now());while(played()<through)await sleep(1);return {...receipt(target),complete:true};},
    interrupt:async()=>receipt(),mute:async()=>{},resume:async()=>({routes:[]}),close:async()=>{}}});
  await controller.start();fixture.resetVoiceContextReadCounts();work=emptyWork();const started=performance.now();
  const ticker=setInterval(()=>{if(turnId)callback({callId:'chain-speed-'+round,type:'playback',at:performance.now(),...receipt()});},20);
  try{
   await controller.sendText('还记得一起观星 CHAT_MEMORY SHARED_MEMORY TODO_SOURCE CONTINUITY_SOURCE MOMENT_SOURCE REACTION_SOURCE 吗');
   while(!completed){if(performance.now()-started>30000||view?.phase==='error')throw Error(view?.error??'timeout');await sleep(10);}
  }finally{clearInterval(ticker);await controller.end();}
  if(completed!.heardText!==reply||completed!.generatedText!==reply||tts.join('')!==reply||requests.dialogue!==1||requests.tts!==1)throw Error('Output changed');
  rows.push({round,firstFromSendMs:firstAt!-started,firstFromTextMs:firstAt!-firstTextAt,elapsedMs:performance.now()-started,inputHash:await hash(llmInput),pcmHash:await hash(audio),spokenHash:await hash(tts.join('')),heard:completed!.heardText,metrics:completed!.metrics,reads:fixture.voiceContextReadCounts(),readWork:structuredClone(work),requests});
 }
 return {rows,fixture:{sameRoleUnrelatedSessions:sessionCount,sameRoleUnrelatedViews:10000,tombstones:13605},apiCalls:0,microphone:false,scope:'Actual controller/context, stocked isolated IndexedDB, 4x desktop CPU, synthetic 100ms dialogue and TTS, frame-progress sink. Not actual provider, Android or physical audio.'};
}});
