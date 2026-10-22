import './chat-human-live';
import {db,type Message} from '../../src/db';
import {useChatStore} from '../../src/store/chat-store';
import type {ChatConversationState} from '../../src/lib/chat-conversation-state';
import type {TopicRecord,TopicEvidence} from '../../src/lib/chat-topic-outcomes';
import {ChatReplyStream} from '../../src/lib/chat-stream';
import {sendRoleChatReply,type ChatRequest} from '../../src/lib/chat/send-service';
import {withChatSessionLock} from '../../src/lib/chat/request-coordinator';
import {memorySourceTombstoneRepo} from '../../src/db/memory-source-tombstone-repo';

declare const PERF_FIXED_BASE:number;
const api=window as any,owner='isolated-live-expression-owner',actor='isolated-live-role',sessionId='isolated-live-session';
const question='之前安排的最新时间是什么？';
const raw='是周四下午三点。\n---\n看你最后改的那条就对了。';
const fixtureHelpers=api.topicPerformanceSeed as {
 updateChatConversationState:typeof import('../../src/lib/chat-conversation-state').updateChatConversationState;
 appendTopicReplyEvidence:typeof import('../../src/lib/chat-topic-replies').appendTopicReplyEvidence;
 replyRecordSources:typeof import('../../src/lib/chat-topic-replies').replyRecordSources;
 supportsTopicReply:typeof import('../../src/lib/chat-topic-replies').supportsTopicReply;
};
type Read={calls:number;returnedBodies:number;requestedKeys:number;cursorVisits:number;indexedCountSum:number;indices:string[];kinds:Record<string,number>;cursorValueTracking?:boolean};
type Reads=Record<string,Read>;
let stage='pre-request';
/** Preserve DBCore's original promise and transaction zone. */
function readProbe(){
 const reads:Reads={},restore:Array<()=>void>=[];
 for(const table of db.tables){
  const core=table.core as any;
  for(const method of ['query','getMany','get','openCursor','count']){
   const original=core[method];if(typeof original!=='function')continue;
   core[method]=function(...args:any[]){
    const item=reads[stage+':'+table.name+'.'+method]??={calls:0,returnedBodies:0,requestedKeys:0,cursorVisits:0,indexedCountSum:0,indices:[],kinds:{}};
    item.calls++;
    const index=args[0]?.query?.index?.name;if(typeof index==='string'&&!item.indices.includes(index))item.indices.push(index);
    if(method==='getMany')item.requestedKeys+=args[0]?.keys?.length??0;
    if(method==='get')item.requestedKeys++;
    const body=(row:any)=>{
     if(row==null)return;item.returnedBodies++;
     const kind=table.name==='memorySourceTombstones'?'unrelated-tombstone':table.name==='diaries'?'private-diary':table.name==='messages'?(row.id==='perf-current-source'?'current':row.id==='perf-511'?'cached-role-reply':String(row.id).startsWith('perf-')?'history':'generated'):'other';
     item.kinds[kind]=(item.kinds[kind]??0)+1;
    };
    return original.apply(this,args).then((result:any)=>{
     if(method==='count'){item.indexedCountSum+=Number(result)||0;return result;}
     if(method==='openCursor'){
      if(result){
       const start=result.start;
       result.start=function(callback:()=>void){return start.call(this,()=>{item.cursorVisits++;callback();});};
       let object=result,descriptor:PropertyDescriptor|undefined;
       while(object&&!descriptor){descriptor=Object.getOwnPropertyDescriptor(object,'value');object=Object.getPrototypeOf(object);}
       if(descriptor?.get){
        const getValue=descriptor.get,seen=new Set<string>();
        Object.defineProperty(result,'value',{configurable:true,get(){const row=getValue.call(result),key=JSON.stringify([result.key,result.primaryKey]);if(!seen.has(key)){seen.add(key);body(row);}return row;}});
        item.cursorValueTracking=true;
       }else item.cursorValueTracking=false;
      }
      return result;
     }
     if(method==='query'){if(args[0]?.values!==false)for(const row of result?.result??[])body(row);}
     else if(method==='getMany')for(const row of result??[])body(row);
     else body(result);
     return result;
    });
   };
   restore.push(()=>{core[method]=original;});
  }
 }
 return {reads,restore:()=>restore.reverse().forEach(fn=>fn())};
}
function userFacts(topics:TopicRecord[]=[]){
 return topics.map(({id,kind,label,outcome,source,outcomeSource,anchorSource,slots,slotHistory,unresolvedSlots,needsConfirmation,confirmationSource,scope,domain})=>
  ({id,kind,label,outcome,source,outcomeSource,anchorSource,slots,slotHistory,unresolvedSlots,needsConfirmation,confirmationSource,scope,domain}));
}
/** Independent fixture checks run outside the measured send, never in place of
 * production guards. Read every declared source afresh by its exact key. */
async function freshEvidence(){
 return db.transaction('r',db.sessions,db.characters,db.messages,db.memorySourceTombstones,async()=>{
  const [session,character]=await Promise.all([db.sessions.get(sessionId),db.characters.get(actor)]);
  if(session?.userId!==owner||session.characterId!==actor||session.type==='group'||character?.createdBy!==owner)throw Error('Fixture principal changed');
  const topics=session.conversation?.topics??[];
  const cached=topics.flatMap(topic=>(topic.responses??[]).filter(record=>record.userSource.messageId==='perf-510').map(record=>({topic,record})));
  if(cached.length!==1)throw Error('Exactly one cached source-backed answer required');
  const refs:TopicEvidence[]=[...topics.flatMap(topic=>topic.source),...cached.flatMap(({topic,record})=>fixtureHelpers.replyRecordSources(topic,record)??[])];
  const ids=[...new Set(refs.map(ref=>ref.messageId))];
  const [rows,suppressed]=await Promise.all([db.messages.bulkGet(ids),memorySourceTombstoneRepo.selectedSuppressedMessages(owner,actor,ids)]);
  const byId=new Map(rows.filter(row=>row!==undefined).map(row=>[row.id,row]));
  for(const ref of refs){const row=byId.get(ref.messageId);if(!row||row.sessionId!==sessionId||(row.revision??1)!==ref.revision||!Number.isInteger(ref.start)||!Number.isInteger(ref.end)||ref.start<0||ref.end<=ref.start||ref.end>row.content.length||suppressed.has(row.id))throw Error('Fixture source revision/range/liveness mismatch');}
  for(const topic of topics)for(const ref of topic.source)if(byId.get(ref.messageId)?.role!=='user'||byId.get(ref.messageId)?.secretaryDispatch?.bodyOrigin==='composed')throw Error('User fact source role mismatch');
  const {topic,record}=cached[0];
  if(!fixtureHelpers.supportsTopicReply(topic,record,byId,suppressed)||record.replyTurnId!=='perf-511'||record.replySources.length!==1
   ||record.replySources[0].messageId!=='perf-511'||!record.acts.some(act=>act.kind==='answered-slot'&&act.field==='time'&&act.value==='15点'))throw Error('Cached complete assistant answer failed fresh evidence check');
  return {userFacts:userFacts(topics),cachedRecord:record,selectedSources:ids.map(id=>byId.get(id)),sourceCount:ids.length,suppressedCount:suppressed.size};
 });
}
async function seed(){
 await api.liveExpression.setup({name:'林舟',tags:['直率'],systemPrompt:'你是林舟，成年朋友，表达自然，重视对方说过的内容。\n称呼：你。\n判断习惯：先听清具体情况。\n对话样本：用户说你好 → 你说来啦。',greeting:'你好。',signature:''},.5);
 api.virtugeneChatQuality.clear();
 const now=PERF_FIXED_BASE;
 await db.characters.update(actor,{createdAt:now});
 await db.sessions.update(sessionId,{createdAt:now,updatedAt:now});
 await db.messages.bulkPut(Array.from({length:512},(_,i)=>({id:'perf-'+i,sessionId,role:i%2?'assistant':'user',content:i===510?'刚才安排是几点？':i===511?'15点。':'合成旧对话'+i,createdAt:now+i,revision:1,isProactive:false,...(i===511?{replyToUserMessageId:'perf-510',replyCompletion:'complete'}:i%2?{replyToUserMessageId:'perf-'+(i-1),replyBatchId:'perf-b'+i}:{})})) as Message[]);
 let conversation:ChatConversationState|undefined;
 for(const index of [492,494,496,498,500,502,506,508,510]){
  const source=(await db.messages.get('perf-'+index))!;
  if(index!==510)source.content=index===506?'周五15点面试。':index===508?'面试原先周五。'+'前情说明。'.repeat(245)+'最后纠正：周四15点。':`学科${index}考试周一。`;
  await db.messages.put(source);
  conversation=fixtureHelpers.updateChatConversationState(conversation,source.content,'',undefined,source.createdAt,'',{message:source,domain:'user-reality'});
 }
 const cachedUser=(await db.messages.get('perf-510'))!,cachedReply=(await db.messages.get('perf-511'))!;
 conversation=fixtureHelpers.appendTopicReplyEvidence(conversation!,cachedUser,[cachedReply],'user-reality');
 await db.sessions.update(sessionId,{conversation});
 const topicCount=conversation?.topics?.length??0;
 if(topicCount!==7)throw Error('Exactly seven source-backed topics required');
 await db.memorySourceTombstones.bulkPut(Array.from({length:8105},(_,i)=>({id:'perf-t'+i,userId:owner,characterId:i<2?actor:'unrelated-'+i%5,sourceType:'message' as const,sourceId:'removed-'+i,sourceRevision:1,status:'deleted' as const,updatedAt:now,suppressedMessageIds:['removed-'+i]})));
 await db.diaries.bulkPut(Array.from({length:40},(_,i)=>({id:'perf-private-'+i,userId:owner,date:'2026-10-18',title:'不可见合成日记'+i,content:'PRIVATE-SYNTHETIC-MUST-NOT-APPEAR',visibility:'private',visibleTo:[],createdAt:now,updatedAt:now,revision:1,tags:[]})) as any);
 const stockMessages=await db.messages.where('sessionId').equals(sessionId).sortBy('createdAt');
 if(stockMessages.length!==512)throw Error('Cached answer must reuse the 512-row stock');
 const source:Message={id:'perf-current-source',sessionId,role:'user',content:question,createdAt:now+10_000,revision:1,isProactive:false};
 await db.messages.add(source);
 useChatStore.setState({messages:[...stockMessages,source].slice(-200),hasMoreMessages:true});
 const fixtureData={stockMessages,currentUser:source,character:await db.characters.get(actor),session:await db.sessions.get(sessionId),tombstones:await db.memorySourceTombstones.toArray(),privateDiaries:await db.diaries.toArray()};
 return {source,character:fixtureData.character!,topicCount,fixtureData,evidence:await freshEvidence()};
}
const pause=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
api.runTopicReplyPerformance=async()=>{
 const samples:any[]=[],checks:string[]=[];
 const check=(ok:unknown,label:string)=>{if(!ok)throw Error(label);checks.push(label);};
 api.topicReplyPerformanceProgress={samples,checks};
 for(const transport of ['buffered-json','live-sse'])for(let iteration=0;iteration<4;iteration++){
  const fixture=await seed();let calls=0,auxiliaryRequests=0,requestAt=0,transportFirstBodyAt=0,outgoing:any,firstSnapshotAt=0;
  window.fetch=async(url,init)=>{
   if(!String(url).includes('/chat/completions'))throw Error('Unexpected network');
   const payload=JSON.parse(String(init?.body));
   if(payload.messages.at(-1)?.content!==question){auxiliaryRequests++;return Response.json({choices:[{message:{content:'[]'},finish_reason:'stop'}]});}
   calls++;requestAt=performance.now();outgoing=payload;
   stage='provider-wait';await pause(30);
   stage='post-response';transportFirstBodyAt=performance.now();
   if(transport==='buffered-json')return Response.json({choices:[{message:{content:raw},finish_reason:'stop'}]});
   const frames=['是周四下午三点。','\n---\n','看你最后改的那条就对了。'];
   const encoder=new TextEncoder();
   return new Response(new ReadableStream({async start(controller){
    for(const content of frames){controller.enqueue(encoder.encode('data: '+JSON.stringify({choices:[{delta:{content},finish_reason:null}]})+'\n\n'));await pause(20);}
    controller.enqueue(encoder.encode('data: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n'));controller.close();
   }}),{headers:{'Content-Type':'text/event-stream'}});
  };
  stage='pre-request';const probe=readProbe(),started=performance.now();
  const stream=new ChatReplyStream(sessionId,()=>{if(!firstSnapshotAt)firstSnapshotAt=performance.now();});
  const request:ChatRequest={userId:owner,stream,controller:new AbortController(),completed:false,stopped:false};
  let error='';
  try{await withChatSessionLock(sessionId,()=>sendRoleChatReply(fixture.character,fixture.source,request,{userId:owner,text:question}));}
  catch(reason){error=(reason as Error).message;}
  finally{probe.restore();stream.dispose();}
  const fullMs=performance.now()-started;
  const events=api.virtugeneChatQuality.report().events;
  const replies=(await db.messages.where('sessionId').equals(sessionId).toArray()).filter(row=>row.replyToUserMessageId===fixture.source.id);
  // Store the sample before assertions so failures retain timing and real reads.
  const sample={transport,iteration,fixture:{stockMessages:512,totalMessagesBeforeSend:513,tombstones:8105,privateDiaries:40,matchingActorTombstones:2,sourceBackedTopics:fixture.topicCount,loadedMessages:200,cachedUserId:'perf-510',cachedReplyId:'perf-511'},fixtureData:fixture.fixtureData,evidenceBefore:fixture.evidence,evidenceAfter:undefined as any,
   requestMs:Math.round((requestAt-started)*100)/100,firstTransportBodyMs:Math.round((transportFirstBodyAt-started)*100)/100,
   firstStreamSnapshotMs:Math.round((firstSnapshotAt-started)*100)/100,fullSendMs:Math.round(fullMs*100)/100,
   decodedUiMs:null,qualityEvent:events[0],reads:probe.reads,messages:outgoing?.messages,payload:outgoing,replies:replies.map(row=>row.content),calls,auxiliaryRequests,error};
  samples.push(sample);
  check(!error&&request.completed&&replies.length===2,'complete actual sender batch '+transport+'/'+iteration);
  check(calls===1&&auxiliaryRequests===0,'exactly one local foreground transport '+transport+'/'+iteration);
  check(events.length===1&&events[0].mode==='private','one per-turn raw quality timing '+transport+'/'+iteration);
  check(outgoing.messages.length>=14,'loaded historical stock reaches actual payload '+transport+'/'+iteration);
  check(JSON.stringify(outgoing.messages).includes('最后纠正：周四15点。'),'latest correction retained '+transport+'/'+iteration);
  check(!JSON.stringify(outgoing.messages).includes('PRIVATE-SYNTHETIC-MUST-NOT-APPEAR'),'private diary absent from payload '+transport+'/'+iteration);
  check(firstSnapshotAt>requestAt&&transportFirstBodyAt>requestAt,'transport and first snapshot timestamps observed '+transport+'/'+iteration);
  sample.evidenceAfter=await freshEvidence();
  check(JSON.stringify(sample.evidenceBefore.userFacts)===JSON.stringify(sample.evidenceAfter.userFacts),'every existing user fact, slot and source survives '+transport+'/'+iteration);
  check(JSON.stringify(sample.evidenceBefore.cachedRecord)===JSON.stringify(sample.evidenceAfter.cachedRecord),'cached answer exact IDs/revisions/ranges/roles survive fresh check '+transport+'/'+iteration);
  await pause(50);
 }
 return {complete:true,checks,samples,paidCalls:0,scope:'Desktop Chrome isolated synthetic IndexedDB; actual private sender, mocked buffered JSON and SSE transport, no decoded component/UI measurement, no Android or live model.',limitations:['Four sequential samples per transport/phase; timing noise, compilation/JIT and fixed execution order are not eliminated.','First stream snapshot is a ChatReplyStream callback, not a decoded/rendered UI frame.','Provider wait and token cadence use local 30 ms/20 ms substitutes.','Before overlays all five saved production files. Fixture-only helpers are current and identical across both phases; old sender does not call the new reply helper.','Read counters retain all actual guards and background work during the measured send. Fixture evidence checks run outside that measurement.','The after system prompt intentionally includes the source-backed role response annotation; history/current user and all existing user facts must remain exact.']};
};
