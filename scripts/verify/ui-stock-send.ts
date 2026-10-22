import {db,type Character,type Message} from '../../src/db';
import {useAuthStore} from '../../src/store/auth-store';
import {useChatStore} from '../../src/store/chat-store';
import {useSettingsStore} from '../../src/store/settings-store';
import {webApi} from '../../src/lib/web-api';
import {sendRoleChatReply} from '../../src/lib/chat/send-service';
import {ChatReplyStream} from '../../src/lib/chat-stream';
import {knowledgeRepo} from '../../src/db/knowledge-repo';
import {chatQualityReport} from '../../src/lib/chat-quality-metrics';
import {memorySourceTombstoneRepo} from '../../src/db/memory-source-tombstone-repo';

window.fetch=async()=>{throw Error('Stock performance fixture blocks external network');};
webApi.context.summarize=async()=>({error:'server:error'});
webApi.context.settle=async()=>({error:'server:error'});
webApi.memory.extract=async()=>({memories:[]});
const now=Date.now(),owner='stock-owner';
declare const __VG_STOCK_ROUNDS__: number;
const rounds=typeof __VG_STOCK_ROUNDS__==='number'?__VG_STOCK_ROUNDS__:2;
let suppressionCalls=0;const suppressions=memorySourceTombstoneRepo.suppressedMessages.bind(memorySourceTombstoneRepo);memorySourceTombstoneRepo.suppressedMessages=async(...args)=>{suppressionCalls++;return suppressions(...args);};
const hash=async(value:unknown)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)))),byte=>byte.toString(16).padStart(2,'0')).join('');
Object.assign(window,{stockSend:async()=>{
 await db.delete();await db.open();
 useAuthStore.getState().login(owner,'隔离资料回归','synthetic-no-provider-key','');
 useSettingsStore.setState({aiVoiceMode:false,ttsEnabled:false});
 const characters=['alpha','beta','zero','unrelated'].map(id=>({id,createdBy:owner,name:id,avatar:'',systemPrompt:'你是成年朋友，说话自然直接，有自己的想法。',tags:[],isPreset:false,isCustom:true,published:false,proactivity:0,signature:'',greeting:'',createdAt:now}) as Character);
 await db.characters.bulkPut(characters);
 await db.diaries.bulkPut(Array.from({length:600},(_,i)=>({id:'diary-'+i,userId:owner,date:'2026-10-16',title:'授权资料标记 '+i,content:'隔离合成日记。'+'正文'.repeat(500),characterId:i<6?'alpha':i<12?'beta':'unrelated',visibility:i<12?'selected':'private',visibleTo:i<6?['alpha']:i<12?['beta']:[],createdAt:now,updatedAt:now,revision:1,tags:[],mood:3})) as any);
 await db.characterKnowledge.bulkPut(Array.from({length:10000},(_,i)=>({id:'knowledge-'+i,userId:i%5?'stock-owner':'other-account',worldId:'stock-world',characterId:i%2?'unrelated':'alpha',eventId:'unrelated-'+i,knowledgeLevel:'full',canMention:true,learnedAt:now})) as any);
 for(let i=0;i<12;i++)await knowledgeRepo.upsert({userId:owner,worldId:'stock-world',characterId:i<6?'alpha':'beta',eventId:'diary:diary-'+i,knowledgeLevel:'full',canMention:true});
 await db.memorySourceTombstones.bulkPut(Array.from({length:10105},(_,i)=>({id:'tombstone-'+i,userId:i<8105?owner:'other-account',characterId:i<2?'beta':i<8105?'unrelated':'alpha',sourceType:'message',sourceId:'deleted-source-'+i,sourceRevision:1,status:'deleted',updatedAt:now,suppressedMessageIds:['deleted-message-'+i]})) as any);
 const oldMessages:Message[]=[];
 for(const character of characters){const sessionId='history-'+character.id;await db.sessions.put({id:sessionId,userId:owner,characterId:character.id,title:'合成历史',createdAt:now-10000,updatedAt:now-1} as any);for(let i=0;i<(character.id==='unrelated'?4000:512);i++)oldMessages.push({id:sessionId+'-'+i,sessionId,role:i%2?'assistant':'user',content:'这是留在历史中的普通聊天。'+'合成正文'.repeat(40),createdAt:now-10000+i,revision:1});}
 await db.messages.bulkPut(oldMessages);
 const samples=[];
 for(const character of characters.slice(0,3))for(let iteration=0;iteration<rounds;iteration++){
  const sessionId='current-'+character.id+'-'+iteration;
  await db.sessions.put({id:sessionId,userId:owner,characterId:character.id,title:'本轮',createdAt:now,updatedAt:now,modelAsked:true,model:{provider:'deepseek',model:'deepseek-flash'}} as any);
  const source:Message={id:sessionId+'-source',sessionId,role:'user',content:'你好，今天怎么样？',createdAt:now,revision:1};await db.messages.put(source);
  useChatStore.setState({characters,currentSessionId:sessionId,selectedCharacterId:character.id,messages:[source],hasMoreMessages:false});
  const reads:Record<string,{calls:number;bodyRows:number;keyRows:number}>={},restores:Array<()=>void>=[];
  for(const table of db.tables){const core=table.core as any;for(const method of ['get','getMany','query']){const original=core[method];if(!original)continue;core[method]=async function(...args:any[]){const output=await original.apply(this,args),values=method==='query'?output.result:output,rows=Array.isArray(values)?values.filter(Boolean).length:Number(values!=null),metric=reads[table.name]??={calls:0,bodyRows:0,keyRows:0};metric.calls++;if(method==='query'&&args[0]?.values===false)metric.keyRows+=rows;else metric.bodyRows+=rows;return output;};restores.push(()=>{core[method]=original;});}}
  suppressionCalls=0;let calls=0,preparationMs:number|undefined,firstCallbackMs:number|undefined,requestHash='',disableThinking:boolean|undefined;
  const started=performance.now();webApi.chat.send=async params=>{calls++;preparationMs=performance.now()-started;disableThinking=params.disableThinking;const {apiKey,signal,onDelta,onRawResponse,onUsage,...request}=params;requestHash=await hash(request);await new Promise(resolve=>setTimeout(resolve,100));params.onDelta?.('嗯，我在听。');return {content:'嗯，我在听。',modelId:'synthetic-transport'};};
  const stream=new ChatReplyStream(sessionId,()=>{firstCallbackMs??=performance.now()-started;});
  try{await sendRoleChatReply(character,source,{userId:owner,controller:new AbortController(),stream,completed:false,stopped:false},{userId:owner,text:source.content});}finally{stream.dispose();restores.forEach(restore=>restore());}
  const totalMs=performance.now()-started,replies=(await db.messages.where('sessionId').equals(sessionId).toArray()).filter(row=>row.role==='assistant'&&row.replyToUserMessageId===source.id);
  if(calls!==1||replies.length!==1||replies[0].content!=='嗯，我在听。'||firstCallbackMs===undefined)throw Error('Actual send did not save exactly one controlled reply');
  const diaryIds=(replies[0].contextTrace?.crossChannelReferences??[]).filter(ref=>ref.source==='diary').map(ref=>ref.id);
  if(character.id==='zero'&&diaryIds.length)throw Error('Zero-match role obtained another role diary');
  if(diaryIds.some(id=>{const i=Number(id.slice(6));return character.id==='alpha'?i>=6:character.id==='beta'?i<6||i>=12:true;}))throw Error('Cross-role diary leak');
  if(character.id!=='zero'&&!diaryIds.length)throw Error('Authorized diary context was silently omitted');
  samples.push({character:character.id,iteration,preparationMs,firstCallbackMs,totalMs,calls,suppressionCalls,requestHash,disableThinking: disableThinking??null,diaryIds,reads,quality:chatQualityReport().events.at(-1)});
 }
 return {samples,fixture:{diaries:600,knowledge:10012,tombstones:10105,ownerTombstones:8105,matchingBetaTombstones:2,matchingAlphaOrZeroTombstones:0,historyMessages:oldMessages.length},modelCalls:0,scope:'Current actual send pipeline, isolated synthetic IndexedDB, 100ms mock transport. First callback is stream notification, not a decoded browser frame or Android first paint.'};
}});
