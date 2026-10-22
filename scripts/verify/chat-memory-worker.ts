import './chat-human-live';
import {db} from '../../src/db';
import {messageRepo} from '../../src/db/message-repo';
import {memoryRepo} from '../../src/db/memory-repo';
import {memoryLedgerRepo} from '../../src/db/memory-ledger-repo';
import {processMemoryJobs} from '../../src/lib/memory-jobs';
import {useAuthStore} from '../../src/store/auth-store';
import {collectSyncData,importSyncData} from '../../src/lib/sync';
import {extractMemories} from '../../src/lib/ai/memory-consolidator';
import {taskChat} from '../../src/lib/ai/task-client';
import {setGatewayAccessToken} from '../../src/lib/ai/gateway';
const api=window as any,owner='isolated-live-expression-owner',sessionId='isolated-live-session',characterId='isolated-live-role',sourceId='worker-source-1';
api.runMemoryWorker=async()=>{
 const checks:string[]=[],rows:any[]=[];const check=(ok:unknown,label:string)=>{if(!ok)throw Error(label);checks.push(label);};
 const setup=async()=>{
  await api.liveExpression.setup({name:'林舟',tags:[],systemPrompt:'你是林舟。',greeting:'你好。',signature:''},.5);
  await messageRepo.create({id:sourceId,sessionId,role:'user',content:'我喜欢薄荷味。',revision:1,createdAt:1000,isProactive:false});
 };
 for(const scenario of ['valid','takeover','expire','source-edit','source-delete','new-correction','restore','change-account','account-round-trip','session-transfer','character-transfer','mid-write-account','local-write-failure','failed-user','unknown-evidence']){
  await setup();let calls=0,taken:any;
  if(scenario==='failed-user')await messageRepo.markFailed(sourceId,true);
  const controller=new AbortController(),scope={sessionId,sourcePrefix:'worker-',characterId};
  const saveMany=memoryRepo.createMany;
  if(scenario==='mid-write-account')memoryRepo.createMany=async memories=>{const result=await saveMany.call(memoryRepo,memories);useAuthStore.setState({userId:'other-owner'});return result;};
  if(scenario==='local-write-failure')memoryRepo.createMany=async()=>{throw Error('Synthetic local failure');};
  let completed;
  try{completed=await processMemoryJobs(owner,'synthetic-not-a-credential',1,{signal:controller.signal,scope,extract:async params=>{
   calls++;
   if(scenario==='takeover')taken=(await memoryLedgerRepo.leaseNextBatch(owner,8,Date.now()+100000,90000,scope))[0];
   if(scenario==='expire'){const running=(await db.memoryJobs.toArray())[0];await db.memoryJobs.update(running.id,{leaseUntil:Date.now()-1});}
   if(scenario==='source-edit')await messageRepo.update(sourceId,{content:'现在不喜欢薄荷味了。'});
   if(scenario==='source-delete')await messageRepo.deleteById(sourceId);
   if(scenario==='new-correction')await messageRepo.create({id:'worker-source-2',sessionId,role:'user',content:'更正，现在不喜欢薄荷味了。',revision:1,createdAt:2000,isProactive:false});
   if(scenario==='restore')await importSyncData(JSON.parse(JSON.stringify(await collectSyncData(owner,'隔离测试'))));
   if(scenario==='change-account')useAuthStore.setState({userId:'other-owner'});
   if(scenario==='account-round-trip'){useAuthStore.setState({userId:'other-owner'});useAuthStore.setState({userId:owner});}
   if(scenario==='session-transfer')await db.sessions.update(sessionId,{userId:'other-owner'});
   if(scenario==='character-transfer')await db.characters.update(characterId,{createdBy:'other-owner'});
   return {memories:['用户喜欢薄荷味。'],evidence:[{content:'用户喜欢薄荷味。',sourceIds:[scenario==='unknown-evidence'?'outside-batch':params.history[0].sourceId!]}]};
  }});}finally{memoryRepo.createMany=saveMany;}
  const [memories,jobs,claims]=await Promise.all([db.memories.toArray(),db.memoryJobs.toArray(),db.memoryClaims.toArray()]);
  if(scenario==='valid'||scenario==='failed-user'){
   check(completed===1&&calls===1&&memories.length===1&&jobs[0].status==='done','valid source commits once on '+scenario);
   check(memories[0].sourceMessageIds?.join(',')===sourceId&&memories[0].sourceMessageRevisions?.[sourceId]===1,'valid worker preserves exact source metadata on '+scenario);
  }else{
   check(completed===0&&memories.length===0&&claims.length===0,'old/invalid worker writes no derived memory on '+scenario);
   if(scenario==='takeover')check(jobs[0].status==='running'&&jobs[0].attempts===taken.attempts,'old worker cannot finish or retry the successor lease');
  }
  check(calls<=1,'worker does not spend an extra generation on '+scenario);
  rows.push({scenario,completed,calls,memories,jobs,claims});
  if(scenario==='expire'){
   const recovered=await processMemoryJobs(owner,'synthetic-not-a-credential',1,{signal:controller.signal,scope,extract:async params=>({memories:['用户喜欢薄荷味。'],evidence:[{content:'用户喜欢薄荷味。',sourceIds:[params.history[0].sourceId!]}]})});
   check(recovered===1&&(await db.memoryJobs.toArray())[0].attempts===2&&await db.memories.count()===1,'expired lease can be reclaimed and completed by a new worker');
  }
 }
 await setup();await db.memoryJobs.clear();await db.messages.update(sourceId,{content:'前段喜欢薄荷。后段周六出门。'});
 const original=(await db.messages.get(sourceId))!;
 const split=original.content.indexOf('后段');
 const first=await memoryLedgerRepo.enqueue({userId:owner,sessionId,characterIds:[characterId],sourceType:'chat',sourceIds:[sourceId],sourceRevisions:{[sourceId]:1},sourceOffsets:{[sourceId]:0},sourceEndOffsets:{[sourceId]:split},task:'extract'});
 await memoryLedgerRepo.enqueue({userId:owner,sessionId,characterIds:[characterId],sourceType:'chat',sourceIds:[sourceId],sourceRevisions:{[sourceId]:1},sourceOffsets:{[sourceId]:split},sourceEndOffsets:{[sourceId]:original.content.length},task:'extract'});
 let segmentCalls=0;
 const segmented=await processMemoryJobs(owner,'synthetic-not-a-credential',1,{signal:new AbortController().signal,scope:{sessionId,sourcePrefix:'worker-',characterId},extract:async params=>{
  segmentCalls++;
  check(params.history.length===2&&new Set(params.history.map(turn=>turn.sourceId)).size===2,'two segments of one original message have distinct model evidence labels');
  return {memories:['用户喜欢薄荷。','用户周六出门。'],evidence:[{content:'用户喜欢薄荷。',sourceIds:[params.history[0].sourceId!]},{content:'用户周六出门。',sourceIds:[params.history[1].sourceId!]}]};
 }});
 const segmentMemories=await db.memories.toArray();
 check(segmented===2&&segmentCalls===1,'same-message segmented jobs commit once in one extraction');
 check(segmentMemories.find(memory=>memory.content==='用户喜欢薄荷。')?.sourceMessageEndOffsets?.[sourceId]===split&&segmentMemories.find(memory=>memory.content==='用户周六出门。')?.sourceMessageOffsets?.[sourceId]===split,'distinct segment evidence returns to exact original offsets');
 check(segmentMemories.every(memory=>memory.sourceMessageIds?.join(',')===sourceId),'temporary segment labels never become persistent source ids');
 check((await db.memoryJobs.get(first))?.status==='done','segmented lease finished with durable original job identity');
 await setup();await messageRepo.update(sourceId,{content:'   \n我喜欢薄荷味。  '});
 let whitespaceText='';
 const whitespace=await processMemoryJobs(owner,'synthetic-not-a-credential',1,{signal:new AbortController().signal,scope:{sessionId,sourcePrefix:'worker-',characterId},extract:async params=>{
  whitespaceText=params.history[0].content;
  return {memories:['用户喜欢薄荷味。'],evidence:[{content:'用户喜欢薄荷味。',sourceIds:[params.history[0].sourceId!]}]};
 }});
 const whitespaceMemory=(await db.memories.toArray())[0],whitespaceSource=(await db.messages.get(sourceId))!;
 check(whitespace===1&&whitespaceText==='我喜欢薄荷味。','leading whitespace preserves the entire original utterance sent for extraction');
 check(whitespaceSource.content.slice(whitespaceMemory.sourceMessageOffsets![sourceId],whitespaceMemory.sourceMessageEndOffsets![sourceId]).trim()===whitespaceText,'extraction and persisted offsets use the same original coordinates');
 await setup();await db.memoryJobs.clear();await db.messages.update(sourceId,{content:'   \n我喜欢薄荷味。  '});
 await memoryLedgerRepo.enqueue({userId:owner,sessionId,characterIds:[characterId],sourceType:'chat',sourceIds:[sourceId],sourceRevisions:{[sourceId]:1},sourceOffsets:{[sourceId]:0},sourceEndOffsets:{[sourceId]:'我喜欢薄荷味。'.length},task:'extract'});
 let legacyText='';
 const legacyCompleted=await processMemoryJobs(owner,'synthetic-not-a-credential',1,{signal:new AbortController().signal,scope:{sessionId,sourcePrefix:'worker-',characterId},extract:async params=>{legacyText=params.history[0].content;return {memories:['用户喜欢薄荷味。'],evidence:[{content:'用户喜欢薄荷味。',sourceIds:[sourceId]}]};}});
 const legacyMemory=(await db.memories.toArray())[0];
 check(legacyCompleted===1&&legacyText==='我喜欢薄荷味。','legacy queued offsets on trimmed text retain the full source');
 check(legacyMemory.sourceMessageOffsets?.[sourceId]===4&&legacyMemory.sourceMessageEndOffsets?.[sourceId]===11,'legacy queued offsets are translated back to original coordinates before persistence');
 await setup();await db.memoryJobs.clear();await db.messages.update(sourceId,{content:'甲段。中间未引用。乙段。'});
 for(const [start,end] of [[0,3],[9,12]])await memoryLedgerRepo.enqueue({userId:owner,sessionId,characterIds:[characterId],sourceType:'chat',sourceIds:[sourceId],sourceRevisions:{[sourceId]:1},sourceOffsets:{[sourceId]:start},sourceEndOffsets:{[sourceId]:end},task:'extract'});
 const disjoint=await processMemoryJobs(owner,'synthetic-not-a-credential',1,{signal:new AbortController().signal,scope:{sessionId,sourcePrefix:'worker-',characterId},extract:async params=>({memories:['两个片段合起来的结论'],evidence:[{content:'两个片段合起来的结论',sourceIds:params.history.map(turn=>turn.sourceId!)}]})});
 check(disjoint===0&&await db.memories.count()===0&&(await db.memoryJobs.toArray()).every(job=>job.status==='retry'),'disjoint evidence is rejected instead of claiming an unseen middle interval');
 await setup();const scoped={sessionId,sourcePrefix:'worker-',characterId},controller=new AbortController();
 let resumeCalls=0;
 const failedExtract=await processMemoryJobs(owner,'synthetic-not-a-credential',1,{signal:controller.signal,scope:scoped,extract:async()=>{resumeCalls++;return {error:'server:error'};}});
 let retry=(await db.memoryJobs.toArray())[0];
 check(failedExtract===0&&retry.status==='retry'&&!retry.leaseToken&&!retry.leaseUntil,'provider failure relinquishes current lease into retry without derived output');
 await db.memoryJobs.update(retry.id,{availableAt:Date.now()-1});
 const resumed=await processMemoryJobs(owner,'synthetic-not-a-credential',1,{signal:controller.signal,scope:scoped,extract:async params=>{resumeCalls++;return {memories:['用户喜欢薄荷味。'],evidence:[{content:'用户喜欢薄荷味。',sourceIds:[params.history[0].sourceId!]}]};}});
 retry=(await db.memoryJobs.toArray())[0];
 check(resumed===1&&resumeCalls===2&&retry.status==='done'&&retry.attempts===2&&!retry.leaseToken,'a later explicit worker run recovers and completes retry with a new lease');
 check(await processMemoryJobs(owner,'synthetic-not-a-credential',1,{signal:controller.signal,scope:scoped,extract:async()=>{throw Error('Done jobs must not run');}})===0,'completed jobs do not spend another extraction');
 await setup();const leased=(await memoryLedgerRepo.leaseNextBatch(owner,8,Date.now(),90000,scoped))[0];
 const successor=(await memoryLedgerRepo.leaseNextBatch(owner,8,Date.now()+100000,90000,scoped))[0];
 check(!!leased.leaseToken&&successor.leaseToken!==leased.leaseToken,'every lease takeover creates a new identity');
 check(!await memoryLedgerRepo.finishJob(leased.id,{},leased)&&!await memoryLedgerRepo.cancelJob(leased.id,{},leased)&&!await memoryLedgerRepo.retryJob(leased.id,'old error',leased),'all old lease terminal commands reject without altering successor');
 check((await db.memoryJobs.get(successor.id))?.leaseToken===successor.leaseToken,'successor identity survives old commands');
 await setup();const cancelled=new AbortController();cancelled.abort();
 check(await processMemoryJobs(owner,null,1,{signal:cancelled.signal,scope:scoped,extract:async()=>{throw Error('Cancelled must not run');}})===0&&(await db.memoryJobs.toArray())[0].status==='queued','cancel before leasing leaves queued work intact');
 const priorFetch=window.fetch;
 try{
  for(const route of ['direct','gateway','parse-fallback','provider-fallback','blocked-fallback','blocked-direct','scoped','blocked-scoped']){
   await setup();setGatewayAccessToken('synthetic-gateway-session');
   let guardCalls=0,physicalCalls=0;const payloads:unknown[]=[];
   const content=JSON.stringify([{content:'用户喜欢薄荷味。',sourceIds:[sourceId]}]);
   window.fetch=async(url,init)=>{
    physicalCalls++;payloads.push(JSON.parse(String(init?.body)));
    if(!String(url).endsWith('/v1/chat')&&!String(url).endsWith('/chat/completions'))throw Error('Unexpected isolated transport');
    if(!String(url).endsWith('/v1/chat')&&route==='provider-fallback')return new Response('{}',{status:503});
    const text=!String(url).endsWith('/v1/chat')&&['parse-fallback','blocked-fallback'].includes(route)?'not json':content;
    return Response.json(String(url).endsWith('/v1/chat')?{content:text,modelId:'synthetic'}:{choices:[{message:{content:text}}]});
   };
   const localScopeTransport=async()=>{physicalCalls++;return content;};
   const completed=await processMemoryJobs(owner,route==='gateway'?'':'synthetic-not-a-credential',1,{signal:new AbortController().signal,scope:scoped,extract:params=>extractMemories({...params,
    ...(route.includes('scoped')?{transport:localScopeTransport}:{}),
    beforeRequest:async()=>{
     guardCalls++;
     const blockedAt=route==='blocked-fallback'?2:1;
     if(route.startsWith('blocked-')&&guardCalls===blockedAt)await messageRepo.update(sourceId,{content:'更正，现在不喜欢薄荷味了。'});
     await params.beforeRequest?.();
    },
   })});
   const blocked=route.startsWith('blocked-'),fallback=route==='parse-fallback'||route==='provider-fallback';
   check(completed===(blocked?0:1)&&await db.memories.count()===(blocked?0:1),'real extraction parser/worker result on '+route);
   check(physicalCalls===(route==='blocked-fallback'?1:blocked?0:fallback?2:1),'fresh guard runs before every physical transport on '+route);
   check(guardCalls===(fallback||route==='blocked-fallback'?2:1),'native extractor invokes request guard on '+route);
   check(payloads.every(payload=>!JSON.stringify(payload).includes('beforeRequest')),'local callbacks stay outside provider payload on '+route);
   rows.push({route,completed,physicalCalls,guardCalls,payloads});
  }
  await setup();setGatewayAccessToken('synthetic-gateway-session');useAuthStore.setState({apiKey:null});
  let guarded=0,sent=0;window.fetch=async()=>{sent++;return Response.json({content:'[]'});};
  await taskChat({apiKey:'',messages:[{role:'user',content:'合成任务'}],beforeRequest:async()=>{guarded++;}});
  check(sent===1&&guarded===1,'taskClient gateway branch guards its physical request after asynchronous key lookup');
  const denied=await taskChat({apiKey:'',messages:[{role:'user',content:'合成任务'}],beforeRequest:async()=>{throw Error('memory:context_changed');}}).then(()=>false,error=>error.message==='memory:context_changed');
  check(denied&&sent===1,'taskClient gateway branch cannot send after its local guard fails');
  for(const groupCase of ['witnessed','member-left','witness-missing','member-transferred']){
   await setup();await db.messages.clear();await db.memoryJobs.clear();
   const other='worker-group-member';await db.characters.add({...await db.characters.get(characterId),id:other} as any);
   await db.groups.put({id:'worker-group',userId:owner,name:'合成群',characterIds:[characterId,other],createdAt:1,updatedAt:1});
   await db.sessions.update(sessionId,{type:'group',groupId:'worker-group'});
   await messageRepo.create({id:sourceId,sessionId,role:'user',content:'我喜欢薄荷味。',createdAt:1,isProactive:false});
   if(groupCase==='member-left')await db.groups.update('worker-group',{characterIds:[characterId]});
   if(groupCase==='witness-missing')await db.messages.update(sourceId,{witnessedBy:[characterId]});
   if(groupCase==='member-transferred')await db.characters.update(other,{createdBy:'other-owner'});
   let groupCalls=0;window.fetch=async()=>{groupCalls++;return Response.json({choices:[{message:{content:JSON.stringify([{content:'用户喜欢薄荷味。',sourceIds:[sourceId]}])}}]});};
   const groupCompleted=await processMemoryJobs(owner,'synthetic-not-a-credential',1);
   const allowed=groupCase==='witnessed'||groupCase==='member-left';
   check(groupCompleted===(allowed?1:0)&&groupCalls===(allowed?1:0),'real background group worker respects original audience on '+groupCase);
   check(await db.memories.count()===(allowed?2:0),'group evidence and character ownership control derived rows on '+groupCase);
  }
 }finally{window.fetch=priorFetch;setGatewayAccessToken(null);}
 return {complete:true,checks,rows,paidCalls:0,scope:'Actual durable worker and native isolated DB; extraction substituted locally; no upstream API'};
};
