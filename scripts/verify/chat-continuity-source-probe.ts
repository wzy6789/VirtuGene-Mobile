import {db,type Message} from '../../src/db';
import {continuityRepo} from '../../src/db/continuity-repo';
import {messageRepo} from '../../src/db/message-repo';
import {buildCharacterMemoryContext,revalidateCharacterMemoryContext,type CharacterMemoryContext,type CharacterMemoryRequest} from '../../src/lib/character-memory';
import {fakeCharacter} from './world-harness';
import {syncContinuityThreadToWorld} from '../../src/lib/world/world-writer';
import {findRelevantHistory} from '../../src/lib/world/world-recall';
import {emptySceneState} from '../../src/db/world-scene-repo';
import {knowledgeRepo} from '../../src/db/knowledge-repo';
import {memorySourceTombstoneRepo} from '../../src/db/memory-source-tombstone-repo';

const owner='isolated-continuity-probe-owner',actor='isolated-continuity-probe-role',sourceSession='isolated-continuity-source-session';
const checks:Array<{name:string;ok:boolean;detail?:unknown}>=[];
const check=(name:string,ok:unknown,detail?:unknown)=>checks.push({name,ok:!!ok,...(detail===undefined?{}:{detail})});
let networkAttempts=0;
window.fetch=async()=>{networkAttempts++;throw Error('No network is authorized in the isolated continuity source probe');};
const request:CharacterMemoryRequest={userId:owner,characterId:actor,mode:'private-chat',sources:['chat'],topic:'黑沙码头',excludeSessionId:'isolated-continuity-current-session',budget:4000};
const sourceEvidence=(source:Message)=>({kind:'private-chat',domain:'unclassified',sources:[{messageId:source.id,sessionId:source.sessionId,revision:source.revision??1,start:0,end:source.content.length}]});
let manualSentinelId='',manualSentinelEventId='';
async function seed(){
 await db.delete();await db.open();
 const now=Date.now();
 await db.characters.add(fakeCharacter(actor,'隔离资料核验角色',owner,{systemPrompt:'隔离合成角色。对话样本：用户说你好 → 你说来啦。'}));
 await db.sessions.add({id:sourceSession,userId:owner,characterId:actor,type:'private',title:'合成来源',createdAt:now,updatedAt:now});
 const source:Message={id:'synthetic-continuity-user-source',sessionId:sourceSession,role:'user',content:'周六14点去黑沙码头，坐地铁。',revision:1,createdAt:now,isProactive:false};
 await messageRepo.create(source);
 // Same production repository shape used by emotion-store settlement. The
 // model/settlement itself is outside this probe; no extraction is simulated.
 await continuityRepo.createMany([{characterId:actor,userId:owner,kind:'plan',title:'黑沙码头约定',detail:'周六14点去黑沙码头，坐地铁。',sourceMessageIds:[source.id],sourceEvidence:sourceEvidence(source),origin:'ai'} as any]);
 let thread=(await continuityRepo.getOpenByCharacter(actor,owner))[0];
 const repositoryStoredThread=thread;
 const repositoryPreservedEvidence=JSON.stringify((thread as any).sourceEvidence)===JSON.stringify(sourceEvidence(source));
 check('fixture-repository-preserves-private-chat-source-evidence',repositoryPreservedEvidence,{repositoryStoredThread,readFixtureSupplementedAsImportedRecord:!repositoryPreservedEvidence});
 // Keep creation wiring independently RED while exercising the read boundary
 // with a real persisted imported record, even on an old repository that drops
 // the newly optional metadata. Current production must preserve it itself.
 if(!repositoryPreservedEvidence){await db.continuityThreads.update(thread.id,{sourceEvidence:sourceEvidence(source)} as any);thread=(await db.continuityThreads.get(thread.id))!;}
 await continuityRepo.create({characterId:actor,userId:owner,kind:'reminder',title:'独立手动哨兵',detail:'用户直接维护的独立事项',origin:'user'});
 manualSentinelId=(await continuityRepo.getOpenByCharacter(actor,owner)).find(row=>row.title==='独立手动哨兵')!.id;
 manualSentinelEventId=(await db.worldEvents.toArray()).find(event=>event.sourceId===manualSentinelId)!.id;
 const context=await buildCharacterMemoryContext(request);
 const reference=context.references.find(ref=>ref.id===thread.id);
 check('fixture-real-repository-created-ai-thread',!!thread&&thread.sourceMessageIds?.[0]===source.id,thread);
 check('fixture-thread-is-actually-selected-for-recall',!!reference,context.references);
 if(!reference)throw Error('Fixture failed: actual recall did not select the synthetic thread');
 const selected:CharacterMemoryContext={...context,references:[reference]};
 return {source,thread,selected};
}
function selectedReadProbe(){
 const reads:Array<{table:string;method:string;keys:unknown;returnedIds:string[];index?:string;cursorVisits?:number;count?:number;returnedKeys?:number}>=[],restore:Array<()=>void>=[];
 for(const table of [db.messages,db.sessions,db.continuityThreads,db.memorySourceTombstones])for(const method of ['get','getMany','query','openCursor','count']){
  const core=table.core as any,original=core[method];
  core[method]=function(...args:any[]){
   const read:{table:string;method:string;keys:unknown;returnedIds:string[];index?:string;cursorVisits?:number;count?:number;returnedKeys?:number}={table:table.name,method,keys:method==='getMany'?args[0]?.keys:method==='get'?[args[0]?.key]:[],returnedIds:[],index:args[0]?.query?.index?.name};reads.push(read);
   const body=(row:any)=>{if(row&&typeof row.id==='string')read.returnedIds.push(row.id);};
   return original.apply(this,args).then((result:any)=>{
    if(method==='get')body(result);
    if(method==='getMany')result.forEach(body);
    if(method==='query'&&args[0]?.values!==false)result.result.forEach(body);
    if(method==='query'&&args[0]?.values===false)read.returnedKeys=result.result.length;
    if(method==='count')read.count=Number(result)||0;
    if(method==='openCursor'&&result){
     const start=result.start;read.cursorVisits=0;result.start=function(callback:()=>void){return start.call(this,()=>{read.cursorVisits!++;callback();});};
     let object=result,descriptor:PropertyDescriptor|undefined;while(object&&!descriptor){descriptor=Object.getOwnPropertyDescriptor(object,'value');object=Object.getPrototypeOf(object);}
     if(!descriptor?.get)throw Error('Cannot inspect native cursor value reads');
     const getValue=descriptor.get,seen=new Set<string>();Object.defineProperty(result,'value',{configurable:true,get(){const row=getValue.call(result),key=JSON.stringify([result.key,result.primaryKey]);if(!seen.has(key)){seen.add(key);body(row);}return row;}});
    }
    return result;
   });
  };
  restore.push(()=>{core[method]=original;});
 }
 return {reads,restore:()=>restore.reverse().forEach(fn=>fn())};
}
async function worldSelection(threadId:string){
 const event=(await db.worldEvents.toArray()).find(event=>event.sourceType==='continuity'&&event.sourceId===threadId);
 if(!event)throw Error('Fixture missing actual continuity world derivative');
 const worldRequest:CharacterMemoryRequest={...request,sources:['world'],worldId:event.worldId,withCatalog:true};
 const context=await buildCharacterMemoryContext(worldRequest),reference=context.references.find(ref=>ref.id===event.id);
 check('world-derivative-fixture-is-actually-selected',!!reference,{event,references:context.references});
 if(!reference)throw Error('Fixture failed: actual world derivative not selected');
 const history=await findRelevantHistory({userId:owner,characterId:actor,worldId:event.worldId,query:request.topic!,limit:8});
 check('world-history-fixture-is-actually-selected',history.some(hit=>hit.id===event.id),history);
 return {event,worldRequest,selected:{...context,references:[reference]} as CharacterMemoryContext};
}
async function checkFreshInvalid(name:string,threadId:string,eventId?:string,worldRequest?:CharacterMemoryRequest){
 const chat=await buildCharacterMemoryContext({...request,withCatalog:true});
 check(name+'-fresh-recall-and-catalog-read-is-available',chat.retrieval?.status!=='unavailable'&&chat.catalog!==undefined,{retrieval:chat.retrieval,catalogPresent:chat.catalog!==undefined});
 check(name+'-private-manual-sentinel-survives',chat.references.some(ref=>ref.id===manualSentinelId)&&chat.catalog?.threads.some(thread=>thread.id===manualSentinelId),chat.references);
 check(name+'-fresh-private-recall-rejects',!chat.references.some(ref=>ref.id===threadId),chat.references);
 check(name+'-catalog-rejects',!chat.catalog?.threads.some(thread=>thread.id===threadId),chat.catalog?.threads);
 if(eventId&&worldRequest){
  const world=await buildCharacterMemoryContext(worldRequest);
  check(name+'-world-recall-and-catalog-read-is-available',world.retrieval?.status!=='unavailable'&&world.catalog!==undefined,{retrieval:world.retrieval,catalogPresent:world.catalog!==undefined});
  check(name+'-world-manual-sentinel-survives',world.references.some(ref=>ref.id===manualSentinelEventId)&&world.catalog?.events.some(event=>event.id===manualSentinelEventId),world.references);
  check(name+'-derived-world-recall-rejects',!world.references.some(ref=>ref.id===eventId),world.references);
  check(name+'-derived-world-catalog-rejects',!world.catalog?.events.some(event=>event.id===eventId),world.catalog?.events);
  const history=await findRelevantHistory({userId:owner,characterId:actor,worldId:worldRequest.worldId!,query:request.topic!,limit:8});
  check(name+'-standalone-world-history-rejects',!history.some(hit=>hit.id===eventId),history);
 }
 return chat;
}

(window as any).runContinuitySourceProbe=async()=>{
 const rows:any[]=[];checks.length=0;networkAttempts=0;
 for(const mutation of ['edit','delete'] as const){
  const fixture=await seed(),world=await worldSelection(fixture.thread.id);
  const validBefore=await revalidateCharacterMemoryContext(request,fixture.selected);
  check(mutation+'-valid-selected-thread-accepted-before-source-change',validBefore.references.some(ref=>ref.id===fixture.thread.id));
  if(mutation==='edit')await messageRepo.update(fixture.source.id,{content:'改成周日15点去白沙码头，坐公交。'});
  else await messageRepo.deleteById(fixture.source.id);
  const sourceAfter=await db.messages.get(fixture.source.id),threadAfter=await db.continuityThreads.get(fixture.thread.id);
  check(mutation+'-source-really-changed',mutation==='edit'?sourceAfter?.revision===2&&sourceAfter.content.includes('白沙码头'):sourceAfter===undefined,sourceAfter);
  check(mutation+'-thread-row-is-unchanged',JSON.stringify(threadAfter)===JSON.stringify(fixture.thread));
  const probe=selectedReadProbe(),started=performance.now();let validated:CharacterMemoryContext;
  try{validated=await revalidateCharacterMemoryContext(request,fixture.selected);}finally{probe.restore();}
  const validationDurationMs=performance.now()-started;
  const fresh=await buildCharacterMemoryContext(request);
  const accepted=validated.references.some(ref=>ref.id===fixture.thread.id),freshAccepted=fresh.references.some(ref=>ref.id===fixture.thread.id);
  check(mutation+'-selected-validation-rejects-invalid-thread-source',!accepted,{accepted,text:validated.text,reads:probe.reads});
  check(mutation+'-fresh-recall-rejects-invalid-thread-source',!freshAccepted,{freshAccepted,text:fresh.text});
  await checkFreshInvalid(mutation,fixture.thread.id,world.event.id,world.worldRequest);
  const worldValidated=await revalidateCharacterMemoryContext(world.worldRequest,world.selected);
  check(mutation+'-selected-world-validation-rejects-invalid-source',!worldValidated.references.some(ref=>ref.id===world.event.id),worldValidated.references);
  const foreign=await revalidateCharacterMemoryContext({...request,userId:'foreign-owner'},fixture.selected);
  check(mutation+'-owner-control-still-rejects',!foreign.references.some(ref=>ref.id===fixture.thread.id));
  await db.continuityThreads.update(fixture.thread.id,{status:'dropped',updatedAt:Date.now()+1});
  const dropped=await revalidateCharacterMemoryContext(request,fixture.selected);
  check(mutation+'-thread-row-control-still-rejects',!dropped.references.some(ref=>ref.id===fixture.thread.id));
  rows.push({mutation,sourceBefore:fixture.source,sourceAfter:sourceAfter??null,threadBefore:fixture.thread,threadAfter,selectedBefore:fixture.selected.references,validatedAfter:validated.references,validatedText:validated.text,freshAfter:fresh.references,freshText:fresh.text,selectedReads:probe.reads,validationDurationMs,tombstones:await db.memorySourceTombstones.toArray(),derivedWorldEvents:await db.worldEvents.toArray()});
 }
 // Source changes leave the selected thread snapshot untouched; rejection
 // cannot be credited to observing a modified thread row.
 for(const mutation of ['suppress','session-character-transfer','session-owner-transfer','source-session-group','source-session-deleted','composed-source','assistant-source'] as const){
  const fixture=await seed(),world=await worldSelection(fixture.thread.id);
  if(mutation==='suppress')await db.memorySourceTombstones.put({id:'probe-suppression',userId:owner,characterId:actor,sourceType:'message',sourceId:fixture.source.id,sourceRevision:1,status:'withdrawn',updatedAt:Date.now(),suppressedMessageIds:[fixture.source.id]});
  if(mutation==='session-character-transfer')await db.sessions.update(sourceSession,{characterId:'other-character'});
  if(mutation==='session-owner-transfer')await db.sessions.update(sourceSession,{userId:'other-owner'});
  if(mutation==='source-session-group')await db.sessions.update(sourceSession,{type:'group'});
  if(mutation==='source-session-deleted')await db.sessions.delete(sourceSession);
  if(mutation==='composed-source')await db.messages.update(fixture.source.id,{secretaryDispatch:{bodyOrigin:'composed'}} as any);
  if(mutation==='assistant-source')await db.messages.update(fixture.source.id,{role:'assistant'});
  const validated=await revalidateCharacterMemoryContext(request,fixture.selected);
  check(mutation+'-selected-validation-is-available',validated.retrieval?.status!=='unavailable',validated.retrieval);
  check(mutation+'-selected-thread-rejects',!validated.references.some(ref=>ref.id===fixture.thread.id),validated.references);
  const worldValidated=await revalidateCharacterMemoryContext(world.worldRequest,world.selected);
  check(mutation+'-selected-world-rejects',!worldValidated.references.some(ref=>ref.id===world.event.id),worldValidated.references);
  await checkFreshInvalid(mutation,fixture.thread.id,world.event.id,world.worldRequest);
  rows.push({mutation,source:await db.messages.get(fixture.source.id),session:await db.sessions.get(sourceSession),thread:await db.continuityThreads.get(fixture.thread.id),validated:validated.references,worldValidated:worldValidated.references});
 }
 {
  const fixture=await seed(),world=await worldSelection(fixture.thread.id);
  await db.messages.update(fixture.source.id,{failed:true});
  const oldSelected=await revalidateCharacterMemoryContext(request,fixture.selected),oldWorldSelected=await revalidateCharacterMemoryContext(world.worldRequest,world.selected);
  check('failed-user-flag-change-invalidates-old-private-snapshot',!oldSelected.references.some(ref=>ref.id===fixture.thread.id),oldSelected.references);
  check('failed-user-flag-change-invalidates-old-world-snapshot',!oldWorldSelected.references.some(ref=>ref.id===world.event.id),oldWorldSelected.references);
  const context=await buildCharacterMemoryContext({...request,withCatalog:true}),freshWorld=await buildCharacterMemoryContext(world.worldRequest);
  const freshThread=context.references.find(ref=>ref.id===fixture.thread.id),freshEvent=freshWorld.references.find(ref=>ref.id===world.event.id);
  const validated=await revalidateCharacterMemoryContext(request,{...context,references:freshThread?[freshThread]:[]});
  const worldValidated=await revalidateCharacterMemoryContext(world.worldRequest,{...freshWorld,references:freshEvent?[freshEvent]:[]});
  check('failed-user-source-remains-valid-direct-user-evidence',!!freshThread&&validated.references.some(ref=>ref.id===fixture.thread.id),validated.references);
  check('failed-user-source-remains-in-fresh-catalog',context.catalog?.threads.some(thread=>thread.id===fixture.thread.id),context.catalog?.threads);
  check('failed-user-source-keeps-valid-world-derivative',!!freshEvent&&worldValidated.references.some(ref=>ref.id===world.event.id),worldValidated.references);
 }
 // The final snapshot must be read after the asynchronous ACL awaits, not
 // precomputed at the start of selected validation and trusted afterwards.
 {
  const fixture=await seed(),world=await worldSelection(fixture.thread.id);
  const original=knowledgeRepo.getScopedForEvents;let edits=0;
  knowledgeRepo.getScopedForEvents=async(...args)=>{
   const known=await original.apply(knowledgeRepo,args);
   if(!edits++){await messageRepo.update(fixture.source.id,{content:'核验授权期间改成白沙码头。'});}
   return known;
  };
  let validated:CharacterMemoryContext;
  try{validated=await revalidateCharacterMemoryContext(world.worldRequest,world.selected);}finally{knowledgeRepo.getScopedForEvents=original;}
  check('acl-await-source-change-fixture-really-ran',edits>0&&(await db.messages.get(fixture.source.id))?.revision===2);
  check('acl-await-source-change-is-rejected-after-final-fresh-snapshot',!validated.references.some(ref=>ref.id===world.event.id),validated.references);
  rows.push({mutation:'source-edit-during-knowledge-await',edits,validated:validated.references});
 }
 // Imported malformed metadata is checked on a fresh read. Reusing an old
 {
  const fixture=await seed(),world=await worldSelection(fixture.thread.id);
  const original=knowledgeRepo.getScopedForEvents;let withdrawals=0;
  knowledgeRepo.getScopedForEvents=async(...args)=>{
   const known=await original.apply(knowledgeRepo,args);
   if(!withdrawals++)await memorySourceTombstoneRepo.record({userId:owner,characterId:actor,sourceType:'memory',sourceId:'withdrawn-derived-memory',sourceRevision:1,status:'withdrawn',suppressedMessageIds:[fixture.source.id]});
   return known;
  };
  let validated:CharacterMemoryContext;
  try{validated=await revalidateCharacterMemoryContext(world.worldRequest,world.selected);}finally{knowledgeRepo.getScopedForEvents=original;}
  check('acl-await-withdrawal-fixture-really-ran',withdrawals>0&&(await memorySourceTombstoneRepo.selectedSuppressedMessages(owner,actor,[fixture.source.id])).has(fixture.source.id));
  check('acl-await-withdrawal-does-not-need-message-or-thread-changes',JSON.stringify(await db.continuityThreads.get(fixture.thread.id))===JSON.stringify(fixture.thread)&&(await db.messages.get(fixture.source.id))?.revision===1);
  check('acl-await-withdrawal-is-rejected-by-final-selected-authorization',!validated.references.some(ref=>ref.id===world.event.id),validated.references);
  rows.push({mutation:'withdrawal-during-knowledge-await',withdrawals,validated:validated.references});
 }
 // Imported malformed metadata is checked on a fresh read. Reusing an old
 // snapshot here would merely test thread-row changes and miss bad imports.
 for(const mutation of ['revision-forged','session-id-forged','range-overflow','range-negative','missing-reference','extra-reference','over-six-sources','unknown-domain'] as const){
  const fixture=await seed(),world=await worldSelection(fixture.thread.id);
  const evidence=sourceEvidence(fixture.source),ids=[fixture.source.id];
  if(mutation==='revision-forged')evidence.sources[0].revision=2;
  if(mutation==='session-id-forged')evidence.sources[0].sessionId='forged-session';
  if(mutation==='range-overflow')evidence.sources[0].end=fixture.source.content.length+1;
  if(mutation==='range-negative')evidence.sources[0].start=-1;
  if(mutation==='missing-reference'){
   const extra={...fixture.source,id:'additional-required-source'};await db.messages.put(extra);ids.push(extra.id);
  }
  if(mutation==='extra-reference'){
   const extra={...fixture.source,id:'undeclared-additional-source'};await db.messages.put(extra);evidence.sources.push({...evidence.sources[0],messageId:extra.id});
  }
  if(mutation==='over-six-sources')for(let index=1;index<=6;index++){
   const extra={...fixture.source,id:'additional-source-'+index};await db.messages.put(extra);ids.push(extra.id);evidence.sources.push({...evidence.sources[0],messageId:extra.id});
  }
  if(mutation==='unknown-domain')(evidence as any).domain='forged-domain';
  await db.continuityThreads.update(fixture.thread.id,{sourceMessageIds:ids,sourceEvidence:evidence} as any);
  await checkFreshInvalid(mutation,fixture.thread.id,world.event.id,world.worldRequest);
  rows.push({mutation,thread:await db.continuityThreads.get(fixture.thread.id)});
 }
 for(const mutation of ['orphan-world-derivative','stale-world-derivative-text'] as const){
  const fixture=await seed(),world=await worldSelection(fixture.thread.id);
  if(mutation==='orphan-world-derivative')await db.continuityThreads.delete(fixture.thread.id);
  else await db.continuityThreads.update(fixture.thread.id,{detail:'更正后的白沙码头安排',updatedAt:Date.now()+1});
  const validated=await revalidateCharacterMemoryContext(world.worldRequest,world.selected);
  const fresh=await buildCharacterMemoryContext(world.worldRequest);
  const history=await findRelevantHistory({userId:owner,characterId:actor,worldId:world.event.worldId,query:request.topic!,limit:8});
  check(mutation+'-selected-world-event-is-rejected',!validated.references.some(ref=>ref.id===world.event.id),validated.references);
  check(mutation+'-fresh-world-event-is-rejected',fresh.retrieval?.status!=='unavailable'&&!fresh.references.some(ref=>ref.id===world.event.id),fresh.references);
  check(mutation+'-standalone-world-history-is-rejected',!history.some(hit=>hit.id===world.event.id),history);
 }

 // Legacy AI records remain available to the owner's management UI, but no
 // current revision is invented as retrospective evidence for old text.
 {
  const fixture=await seed();await continuityRepo.remove(fixture.thread.id);
  const legacy={...fixture.thread,id:'legacy-unknown-ai-thread',sourceEvidence:undefined,updatedAt:Date.now()};
  await db.continuityThreads.put(legacy);const eventId=await syncContinuityThreadToWorld({userId:owner,thread:legacy});
  check('legacy-ai-record-retained-in-database',!!await db.continuityThreads.get(legacy.id));
  const event=(await db.worldEvents.get(eventId))!;
  await checkFreshInvalid('legacy-ai-unknown',legacy.id,eventId,{...request,sources:['world'],worldId:event.worldId,withCatalog:true});
  rows.push({mutation:'legacy-ai-unknown',legacy,event});
 }
 {
  const fixture=await seed();await continuityRepo.remove(fixture.thread.id);
  await continuityRepo.create({characterId:actor,userId:owner,kind:'plan',title:'手动黑沙码头事项',detail:'用户手动维护的事项',origin:'user'});
  const manual=(await continuityRepo.getOpenByCharacter(actor,owner)).find(thread=>thread.title==='手动黑沙码头事项')!,world=await worldSelection(manual.id);
  await messageRepo.deleteById(fixture.source.id);
  const context=await buildCharacterMemoryContext({...request,withCatalog:true}),worldContext=await buildCharacterMemoryContext(world.worldRequest);
  check('manual-user-thread-without-chat-evidence-remains-recallable',context.references.some(ref=>ref.id===manual.id),context.references);
  check('manual-user-thread-remains-in-catalog',context.catalog?.threads.some(thread=>thread.id===manual.id),context.catalog?.threads);
  check('manual-user-derived-world-record-remains-recallable',worldContext.references.some(ref=>ref.id===world.event.id),worldContext.references);
 }
 {
  const fixture=await seed(),existingEvent=(await db.worldEvents.toArray()).find(event=>event.sourceId===fixture.thread.id)!;
  const now=Date.now(),sceneId='synthetic-continuity-world-scene';
  await db.worldScenes.put({id:sceneId,userId:owner,worldId:existingEvent.worldId,title:'镜湖灯塔',place:'黑沙码头',timeLabel:'合成场景',mood:'平静',characterIds:[actor],status:'active',state:emptySceneState(),startedAt:now,createdAt:now,updatedAt:now});
  for(const [kind,metadata]of [['scene',{sourceSceneId:sceneId}],['world',{sourceWorldEventId:existingEvent.id}]] as const){
   await continuityRepo.create({characterId:actor,userId:owner,kind:'topic',title:kind==='scene'?'镜湖灯塔':'霜原旧桥',detail:'黑沙码头的合成剧情线',origin:'ai',...metadata});
   const thread=(await continuityRepo.getOpenByCharacter(actor,owner)).find(thread=>kind==='scene'?thread.sourceSceneId===sceneId:thread.sourceWorldEventId===existingEvent.id)!;
   const context=await buildCharacterMemoryContext({...request,withCatalog:true});
   check(kind+'-origin-ai-thread-is-not-mistaken-for-legacy-private-chat',!!thread&&context.references.some(ref=>ref.id===thread.id)&&context.catalog?.threads.some(row=>row.id===thread.id),context);
  }
 }

 // A stale/forged knowledge pointer is not authorization to load another
 // account's private source bodies while rejecting its event later.
 {
  const fixture=await seed(),world=await worldSelection(fixture.thread.id);
  const foreignSource={...fixture.source,id:'foreign-source-body',sessionId:'foreign-source-session'};
  await db.sessions.put({id:foreignSource.sessionId,userId:'foreign-owner',characterId:actor,title:'合成异账号来源',createdAt:1,updatedAt:1});
  await db.messages.put(foreignSource);
  const foreignThread={...fixture.thread,id:'foreign-thread',userId:'foreign-owner',sourceMessageIds:[foreignSource.id],sourceEvidence:sourceEvidence(foreignSource)};
  await db.continuityThreads.put(foreignThread);
  const foreignEvent={...world.event,id:'foreign-derived-event',userId:'foreign-owner',sourceId:foreignThread.id};
  await db.worldEvents.put(foreignEvent);
  const known=(await db.characterKnowledge.where('eventId').equals(world.event.id).first())!;
  await db.characterKnowledge.put({...known,id:'foreign-event-stale-knowledge',eventId:foreignEvent.id});
  const probe=selectedReadProbe();let context:CharacterMemoryContext;
  try{context=await buildCharacterMemoryContext({...world.worldRequest,withCatalog:true});}finally{probe.restore();}
  check('foreign-event-is-not-authorized-by-stale-knowledge',!context.references.some(reference=>reference.id===foreignEvent.id));
  check('foreign-event-rejected-before-private-source-body-read',!probe.reads.some(read=>read.table==='messages'&&read.returnedIds.includes(foreignSource.id)),probe.reads);
  rows.push({mutation:'foreign-event-pointer-private-source-isolation',reads:probe.reads});
 }
 // Only the selected eight imported records are revalidated. Candidate scans
 // and fixture writes are outside this read probe; all records are synthetic.
 {
  const fixture=await seed();await continuityRepo.remove(fixture.thread.id);
  const now=Date.now(),sources=Array.from({length:8},(_,index)=>({...fixture.source,id:'batch-source-'+index,createdAt:now+index}));
  await db.messages.bulkPut(sources);
  const threads=sources.map((source,index)=>({...fixture.thread,id:'batch-thread-'+index,title:'黑沙码头事项'+index,sourceMessageIds:[source.id],sourceEvidence:sourceEvidence(source),createdAt:now+index,updatedAt:now+index}));
  await db.continuityThreads.bulkPut(threads);
  const context=await buildCharacterMemoryContext({...request,budget:6000});
  const selected={...context,references:context.references.filter(ref=>threads.some(thread=>thread.id===ref.id))};
  check('batch-fixture-selects-eight-actual-thread-references',selected.references.length===8,selected.references);
  await db.memorySourceTombstones.bulkPut(Array.from({length:8105},(_,index)=>({id:'unrelated-tombstone-'+index,userId:owner,characterId:index%2?actor:'other-character',sourceType:'message',sourceId:'unrelated-source-'+index,sourceRevision:1,status:'deleted',updatedAt:now,suppressedMessageIds:['unrelated-source-'+index]})) as any);
  const probe=selectedReadProbe();let valid:CharacterMemoryContext;
  try{valid=await revalidateCharacterMemoryContext(request,selected);}finally{probe.restore();}
  const messageReads=probe.reads.filter(read=>read.table==='messages'),tombstoneReads=probe.reads.filter(read=>read.table==='memorySourceTombstones');
  const readSourceIds=new Set(messageReads.flatMap(read=>read.returnedIds));
  check('batch-eight-valid-threads-survive-selected-validation',valid.references.length===8,valid.references);
  check('batch-selected-validation-reads-all-eight-real-sources',sources.every(source=>readSourceIds.has(source.id)),probe.reads);
  check('batch-source-checks-use-bounded-native-selected-reads',messageReads.filter(read=>read.method==='getMany').length<=3&&messageReads.filter(read=>read.method==='get').length===0&&!messageReads.some(read=>read.method==='query'||read.method==='openCursor')&&messageReads.reduce((sum,read)=>sum+read.returnedIds.length,0)<=16,probe.reads);
  const allowedMessageKeys=new Set([...threads.map(thread=>thread.id),...sources.map(source=>source.id)]),messageKeys=messageReads.flatMap(read=>Array.isArray(read.keys)?read.keys:[]);
  check('batch-message-requests-contain-only-selected-dependencies',messageKeys.length<=32&&messageKeys.every(key=>allowedMessageKeys.has(key)),messageReads);
  check('batch-check-skips-8105-unrelated-tombstone-bodies',tombstoneReads.every(read=>read.returnedIds.length===0)&&!tombstoneReads.some(read=>read.index==='[userId+characterId]'||read.index==='userId'),tombstoneReads);
  check('batch-tombstone-checks-do-not-hide-key-scans-or-missing-get-loops',tombstoneReads.length<=6&&tombstoneReads.every(read=>read.method!=='count'&&(read.cursorVisits??0)<=32&&(read.returnedKeys??0)<=32),tombstoneReads);
  rows.push({mutation:'batch-eight-with-8105-unrelated-tombstones',selectedCount:selected.references.length,validatedCount:valid.references.length,selectedReads:probe.reads,fixture:{threads:8,sourceMessages:8,tombstones:8105}});
 }
 check('no-network-or-model-attempts',networkAttempts===0,networkAttempts);
 return {complete:checks.every(item=>item.ok),checks,failures:checks.filter(item=>!item.ok),rows,networkAttempts,apiCalls:0,model:'未确认',reasoning:'未确认',scope:'Actual continuityRepo.createMany, buildCharacterMemoryContext and revalidateCharacterMemoryContext; native isolated Chromium IndexedDB; actual messageRepo edit/delete. Only selected thread references are revalidated, preserving their real transient snapshots. No model/settlement, title-matching changes, private user database, Android, microphone or publishing.'};
};
