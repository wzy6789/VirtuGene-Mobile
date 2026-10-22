import { db } from '@release/db/index';
import { useAuthStore } from '@release/store/auth-store';
import { prepareCallContext } from '@release/lib/voice-call/context';
import { VoiceCallController } from '@release/lib/voice-call/controller';
import { knowledgeRepo } from '@release/db/knowledge-repo';
let reads=0, rowsRead=0;
db.use({stack:'dbcore',name:'voice-speed-reads',create:down=>({...down,table:name=>{
 const table=down.table(name);return {...table,
 get:async req=>{reads++;const row=await table.get(req);rowsRead+=Number(!!row);return row;},
 getMany:async req=>{reads++;const rows=await table.getMany(req);rowsRead+=rows.filter(Boolean).length;return rows;},
 query:async req=>{reads++;const result=await table.query(req);rowsRead+=result.result.length;return result;},
 openCursor:async req=>{reads++;const cursor=await table.openCursor(req);if(!cursor)return cursor;
   const start=cursor.start.bind(cursor);const seen=new Set<string>();
   const count=()=>{const key=JSON.stringify([cursor.key,cursor.primaryKey]);if(cursor.value&&!seen.has(key)){rowsRead++;seen.add(key);}};
   count();cursor.start=callback=>start(()=>{count();callback();});return cursor;},
 };}})});
Object.assign(window,{voiceSpeed:async()=>{
 await db.delete();await db.open();useAuthStore.setState({userId:'u'});const now=1791856800000;
 await db.characters.put({id:'a',createdBy:'u',name:'测试角色',systemPrompt:'说话简洁认真，保留自己的判断。',createdAt:now,tags:[]} as any);
 await db.sessions.put({id:'s',userId:'u',characterId:'a',type:'single',title:'通话',createdAt:now,updatedAt:now,unreadCount:0} as any);
 await db.worlds.put({id:'w',userId:'u',name:'测试世界',createdAt:now,isDefault:true} as any);
 await db.messages.bulkPut(Array.from({length:2000},(_,i)=>({id:'m'+i,sessionId:'s',role:i%2?'assistant':'user',content:'记得一起观星'+i,createdAt:now+i})) as any);
 await db.diaries.bulkPut(Array.from({length:600},(_,i)=>({id:'d'+i,userId:'u',date:'2026-10-13',title:'观星'+i,content:'观星记录。'+'正文'.repeat(500),characterId:'a',visibility:i<6?'world':'private',worldEventId:i<6?'e'+i:undefined,createdAt:now,updatedAt:now,revision:1,tags:[]})) as any);
 await db.characterKnowledge.bulkPut(Array.from({length:10000},(_,i)=>({id:'unrelated'+i,userId:'u',worldId:'w',characterId:'a',eventId:'other'+i,knowledgeLevel:'full',canMention:true,learnedAt:now})) as any);
 for(let i=0;i<6;i++){
  await db.worldEvents.put({id:'e'+i,userId:'u',worldId:'w',type:'stage',title:'一起观星'+i,summary:'观星地点'+i,visibility:'world',participants:['c:a'],sourceType:'diary',sourceId:'d'+i,timestamp:now,createdAt:now,updatedAt:now,memoryIds:[]} as any);
  await knowledgeRepo.upsert({userId:'u',worldId:'w',characterId:'a',eventId:'e'+i,knowledgeLevel:'full',canMention:true});
  await knowledgeRepo.upsert({userId:'u',worldId:'w',characterId:'a',eventId:'diary:d'+i,knowledgeLevel:'full',canMention:true});
 }
 const samples=[];
 for(let i=0;i<3;i++){
  reads=0;rowsRead=0;let prepareMs=0,prepareRows=0,prompt='';let completed:any;let frames=0;
  const audio:any={start:async()=>({echoCancellation:true,noiseSuppression:true,routes:[]}),beginPlayback:async()=>{},append:async()=>({playedFrames:++frames,writtenFrames:frames,sampleRate:24000}),drain:async()=>({playedFrames:frames,writtenFrames:frames,sampleRate:24000,complete:true}),interrupt:async()=>({playedFrames:frames,writtenFrames:frames}),close:async()=>{}};
  const controller=new VoiceCallController('speed'+i,{inputMode:'text',audio,voice:'mimo_default',style:'',onView:()=>{},
   context:async(text,exchanges,signal,mode)=>{const start=performance.now(),before=rowsRead;const prepared=await prepareCallContext({userId:'u',characterId:'a',sessionId:'s',worldId:'w'},text,exchanges,signal,mode);prepareMs=performance.now()-start;prepareRows=rowsRead-before;prompt=JSON.stringify(prepared.messages);return prepared;},
   api:{recognize:async()=>{throw Error('ASR must be isolated');},dialogue:async(_,opts)=>{await opts.onText('还记得那次观星。');},synthesize:async(_,v,s,opts)=>{for(let n=0;n<10;n++)await opts.onPcm(new Uint8Array(960));}},
   onExchange:exchange=>{completed=exchange;}} as any);
  await controller.start();const started=performance.now();await controller.sendText('还记得一起观星吗');
  while(!completed){if(performance.now()-started>90000)throw Error('turn timed out');await new Promise(r=>setTimeout(r,10));}
  const totalMs=performance.now()-started;await controller.end();
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(prompt));
  samples.push({prepareMs,prepareRows,firstTextMs:completed.metrics.firstTextMs,firstPlaybackMs:completed.metrics.firstPlaybackMs,totalMs,reads,rowsRead,promptFingerprint:Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('')});
 }
 return {samples,diaries:600,historyMessages:2000,unrelatedKnowledge:10000,modelCalls:0,scope:'actual IndexedDB and context/controller; simulated model and playback; desktop Chrome CPU 4x; excludes network, ASR, Android audio'};
}});
