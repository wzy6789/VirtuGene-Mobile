import './chat-continuity-resume';
import {db,type Character,type Message} from '../../src/db';
import {PRESET_CHARACTERS} from '../../src/lib/seed-init';
import {characterRepo} from '../../src/db/character-repo';
import {ensureOwnedChatCharacter} from '../../src/lib/character-chat';
import {useAuthStore} from '../../src/store/auth-store';
import {buildCharacterMemoryContext} from '../../src/lib/character-memory';
import {readValidatedConversation} from '../../src/db/chat-topic-state-repo';
import {messageRepo} from '../../src/db/message-repo';
import {collectBackupData} from '../../src/lib/backup';
import {encryptBackup,decryptBackup} from '../../src/lib/backup-crypto';
import {importSyncData} from '../../src/lib/sync';
const api=window as any,owner='resume-owner',actor='resume-actor',session='resume-new-session';
const otherOwner='matrix-owner-b',otherActor='matrix-actor-b',otherSession='matrix-session-b',fork='matrix-fork',forkSession='matrix-fork-session';
const principal={userId:owner,characterId:actor,sessionId:session};
const hash=async(value:unknown)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))).map(byte=>byte.toString(16).padStart(2,'0')).join('');
async function allRows(){const tables:Record<string,any[]>={};for(const table of db.tables)tables[table.name]=await table.toArray();return tables;}
async function restore(tables:Record<string,any[]>){await db.delete();await db.open();await db.transaction('rw',db.tables,async()=>{for(const table of db.tables)if(tables[table.name]?.length)await table.bulkPut(tables[table.name]);});await api.loadResumeTestSession();}
api.runBackupIsolation=async()=>{
 const checks:Array<{name:string;ok:boolean}>=[],rows:any[]=[];const check=(name:string,ok:unknown)=>checks.push({name,ok:!!ok});
 await api.prepareResumeReload();await api.loadResumeTestSession();
 const original=(await db.characters.get(actor))!,preset=PRESET_CHARACTERS.find(row=>row.name==='古月娜')!;
 await db.characters.put(preset);
 await db.characters.bulkPut([{...original,id:otherActor,createdBy:otherOwner},{...original,id:fork,sourcePresetId:undefined}] as Character[]);
 await db.sessions.bulkPut([{id:otherSession,userId:otherOwner,characterId:otherActor,type:'private',createdAt:1,updatedAt:1},{id:forkSession,userId:owner,characterId:fork,type:'private',createdAt:1,updatedAt:1}]);
 await db.messages.bulkPut([{id:'matrix-message-b',sessionId:otherSession,role:'user',content:'B_PRIVATE_SENTINEL',revision:1,createdAt:1,isProactive:false},{id:'matrix-message-fork',sessionId:forkSession,role:'user',content:'FORK_PRIVATE_SENTINEL',revision:1,createdAt:1,isProactive:false}]);
 await db.memories.bulkPut([{id:'matrix-memory-a',userId:owner,characterId:actor,content:'甲号独有记忆 A_PRIVATE_SENTINEL。',type:'manual',pinned:true,createdAt:1,updatedAt:1},{id:'matrix-memory-b',userId:otherOwner,characterId:otherActor,content:'乙号独有记忆 B_PRIVATE_SENTINEL。',type:'manual',pinned:true,createdAt:1,updatedAt:1},{id:'matrix-memory-fork',userId:owner,characterId:fork,content:'副本独有记忆 FORK_PRIVATE_SENTINEL。',type:'manual',pinned:true,createdAt:1,updatedAt:1}]);
 const thread=(await db.continuityThreads.get('resume-original-thread'))!;
 await db.continuityThreads.bulkPut([{...thread,id:'matrix-thread-b',userId:otherOwner,characterId:otherActor},{...thread,id:'matrix-thread-fork',characterId:fork}]);
 const beforeAdopt=await db.messages.count();
 const ownedA=await ensureOwnedChatCharacter(preset,owner),ownedFork=await ensureOwnedChatCharacter((await db.characters.get(fork))!,owner);
 useAuthStore.getState().login(otherOwner,'合成乙号','synthetic-not-a-credential','');
 const ownedB=await ensureOwnedChatCharacter(preset,otherOwner);
 check('shared Gu preset resolves to each account own ID and exact same-name fork',ownedA.id===actor&&ownedB.id===otherActor&&ownedFork.id===fork&&ownedA.name===ownedB.name&&ownedA.sourcePresetId===ownedB.sourcePresetId&&await db.messages.count()===beforeAdopt);
 let denied=false;try{await ensureOwnedChatCharacter(original,otherOwner);}catch{denied=true;}
 check('other account cannot adopt an unpublished private Gu clone',denied);
 await api.loadResumeTestSession();
 const profileTurn=await api.resumeTestTurn('晚上我不喝咖啡。');
 check('actual Gu sender establishes a source-backed current preference',!profileTurn.result.error&&profileTurn.conversation?.topics?.some((topic:any)=>topic.slots.object?.value==='咖啡'&&topic.slots.stance?.value==='不喝'));
 const memoryA=await buildCharacterMemoryContext({userId:owner,characterId:actor,query:'甲号独有记忆',mode:'private'});
 const memoryFork=await buildCharacterMemoryContext({userId:owner,characterId:fork,query:'副本独有记忆',mode:'private'});
 useAuthStore.getState().login(otherOwner,'合成乙号','synthetic-not-a-credential','');
 const memoryB=await buildCharacterMemoryContext({userId:otherOwner,characterId:otherActor,query:'乙号独有记忆',mode:'private'});
 check('same-name Gu copies retain distinct memory contents',memoryA.text.includes('A_PRIVATE_SENTINEL')&&!memoryA.text.includes('B_PRIVATE_SENTINEL')&&!memoryA.text.includes('FORK_PRIVATE_SENTINEL')&&memoryFork.text.includes('FORK_PRIVATE_SENTINEL')&&!memoryFork.text.includes('A_PRIVATE_SENTINEL')&&memoryB.text.includes('B_PRIVATE_SENTINEL')&&!memoryB.text.includes('A_PRIVATE_SENTINEL'));
 await api.loadResumeTestSession();
 check('same-name sessions never share conversation state',!(await readValidatedConversation({userId:owner,characterId:fork,sessionId:forkSession}))?.conversation?.topics?.length);
 let transferDenied=false;try{await characterRepo.update(actor,{createdBy:otherOwner});}catch{transferDenied=true;}
 check('actual character repository rejects account ownership transfer',transferDenied&&(await db.characters.get(actor))?.createdBy===owner);
 const backup=await collectBackupData(owner,'合成隔离甲号');
 const encrypted=await encryptBackup(JSON.stringify(backup),'synthetic-isolation-backup-only');
 const decoded=JSON.parse(await decryptBackup(encrypted,'synthetic-isolation-backup-only'));
 check('real backup excludes the other account private Gu records',!JSON.stringify(decoded).includes('B_PRIVATE_SENTINEL'));
 const fixture=await allRows(),fixtureHash=await hash(fixture);
 const payload=()=>({...structuredClone(decoded),__meta__:{...decoded.__meta__,kind:'sync'}});
 for(const kind of ['foreign-session','foreign-message','foreign-memory','foreign-thread','same-owner-session-role','same-owner-message-role','same-owner-memory-role','same-owner-thread-role','new-session-foreign-role','new-memory-foreign-role','new-state-foreign-role','new-emotion-other-role','duplicate-message-key','late-chunk-message-collision'] as const){
  await restore(fixture);const data=payload(),user=data.messages.find((row:Message)=>row.id===profileTurn.result.source.id);
  if(kind==='foreign-session'||kind==='same-owner-session-role'){
   const target=kind==='foreign-session'?otherSession:forkSession;
   const ownSession=data.sessions.find((row:any)=>row.id===session);ownSession.id=target;ownSession.updatedAt=Date.now()+100000;
   for(const message of data.messages)if(message.sessionId===session)message.sessionId=target;
  }
  if(kind==='foreign-message'||kind==='same-owner-message-role'){user.id=kind==='foreign-message'?'matrix-message-b':'matrix-message-fork';user.revision=999;}
  if(kind==='foreign-memory'||kind==='same-owner-memory-role'){const memory=data.memories.find((row:any)=>row.id==='matrix-memory-a');memory.id=kind==='foreign-memory'?'matrix-memory-b':'matrix-memory-fork';memory.updatedAt=Date.now()+100000;}
  if(kind==='foreign-thread'||kind==='same-owner-thread-role'){const row=data.continuityThreads.find((row:any)=>row.id==='resume-original-thread');row.id=kind==='foreign-thread'?'matrix-thread-b':'matrix-thread-fork';row.updatedAt=Date.now()+100000;}
  if(kind==='new-session-foreign-role')data.sessions.push({...data.sessions.find((row:any)=>row.id===session),id:'matrix-new-foreign-role',characterId:otherActor});
  if(kind==='new-memory-foreign-role')data.memories.push({...data.memories.find((row:any)=>row.id==='matrix-memory-a'),id:'matrix-new-foreign-memory',characterId:otherActor});
  if(kind==='new-state-foreign-role')data.characterStates.push({...data.characterStates[0],userId:owner,characterId:otherActor});
  if(kind==='new-emotion-other-role')data.emotionSnapshots.push({id:'matrix-new-emotion',characterId:fork,sessionId:session,dimensions:{valence:0.5,arousal:0.5,dominance:0.5},dominantEmotion:'happy',userEmotion:'只属于另一个古月娜副本',summary:'合成情绪',messageCount:1,createdAt:1});
  if(kind==='duplicate-message-key')data.messages.push({...user,sessionId:forkSession});
  if(kind==='late-chunk-message-collision'){data.messages.push(...Array.from({length:600},(_,index)=>({...user,id:'matrix-new-batch-'+index,content:'合成恢复原文'+index,createdAt:1000+index})));data.messages.push({...user,id:'matrix-message-b',revision:999});}
  const result=await importSyncData(data),afterHash=await hash(await allRows());
  check(kind+' conflicts fail atomically without changing any native row',!result.ok&&afterHash===fixtureHash);
  rows.push({kind,result,fixtureHash,afterHash});
 }
 await restore(fixture);const groupPayload=payload();
 groupPayload.groups.push({id:'matrix-valid-group',userId:owner,name:'合成群聊',characterIds:[actor,fork],createdAt:1,updatedAt:1});
 groupPayload.sessions.push({id:'matrix-valid-group-session',userId:owner,characterId:'matrix-valid-group',type:'group',groupId:'matrix-valid-group',createdAt:1,updatedAt:1});
 groupPayload.emotionSnapshots.push({id:'matrix-valid-group-emotion',characterId:fork,sessionId:'matrix-valid-group-session',dimensions:{valence:0.5,arousal:0.5,dominance:0.5},dominantEmotion:'happy',summary:'合成群聊角色情绪',messageCount:1,createdAt:1});
 const groupImport=await importSyncData(groupPayload);
 check('group emotion remains attached to its own member rather than a synthetic group character',groupImport.ok&&(await db.emotionSnapshots.get('matrix-valid-group-emotion'))?.characterId===fork);
 await restore(fixture);const ordinary=await importSyncData(payload());
 const valid=await readValidatedConversation(principal);
 check('ordinary encrypted backup retains Gu preference and other account untouched',ordinary.ok&&valid?.conversation?.topics?.some((topic:any)=>topic.slots.object?.value==='咖啡'&&topic.slots.stance?.value==='不喝')&&(await db.messages.get('matrix-message-b'))?.content==='B_PRIVATE_SENTINEL');
 await restore(fixture);await messageRepo.update(profileTurn.result.source.id,{content:'晚上我喝咖啡。'});const corrected=await importSyncData(payload());
 const edited=await readValidatedConversation(principal);
 check('old backup cannot restore a corrected source preference',corrected.ok&&(await db.messages.get(profileTurn.result.source.id))?.content==='晚上我喝咖啡。'&&!edited?.conversation?.topics?.some((topic:any)=>topic.slots.stance?.value==='不喝'));
 await restore(fixture);await messageRepo.deleteById(profileTurn.result.source.id);const replayed=await importSyncData(payload());const deleted=await readValidatedConversation(principal);
 check('old backup cannot restore a deleted source preference',replayed.ok&&!await db.messages.get(profileTurn.result.source.id)&&!deleted?.conversation?.topics?.some((topic:any)=>topic.slots.stance?.value==='不喝'));
 for(const hasFacts of [true,false]){
 await restore(fixture);
 if(!hasFacts){await db.messages.where('sessionId').equals(session).delete();await db.sessions.update(session,{conversation:undefined});await api.loadResumeTestSession();}
 const nativeFetch=window.fetch,waitingText=hasFacts?'周六15点去博物馆，坐地铁。':'古月娜，你好。';let beforeRestoreVersion:number|undefined,afterRestoreVersion:number|undefined,mainCalls=0,restoreResult:any;
 window.fetch=async(_url,init)=>{
  const body=JSON.parse(String(init?.body));
  if(body.messages.at(-1)?.content!==waitingText)return Response.json({choices:[{message:{content:'[]'}}]});
  mainCalls++;beforeRestoreVersion=(await db.sessions.get(session))?.conversation?.version??0;
  check('restore race precondition '+(hasFacts?'source-backed facts':'legacy empty state'),hasFacts?(await db.sessions.get(session))?.conversation?.topics?.some((topic:any)=>topic.slots.time?.value==='15点'&&topic.slots.place?.value==='博物馆'):beforeRestoreVersion===0);
  const currentBackup=await collectBackupData(owner,'合成等待中恢复');
  const cipher=await encryptBackup(JSON.stringify(currentBackup),'synthetic-wait-restore-only');
  const restored=JSON.parse(await decryptBackup(cipher,'synthetic-wait-restore-only'));
  const restorePayload={...restored,__meta__:{...restored.__meta__,kind:'sync'}};
  restoreResult=await (typeof api.importBackupFromWriter==='function'?api.importBackupFromWriter(restorePayload):importSyncData(restorePayload));
  afterRestoreVersion=(await db.sessions.get(session))?.conversation?.version??0;
  return Response.json({choices:[{message:{content:'嗯。'},finish_reason:'stop'}]});
 };
 let pending;try{pending=await api.resumeTestTurn(waitingText);}finally{window.fetch=nativeFetch;}
 check('restoring identical text while generation waits invalidates its conversation epoch '+hasFacts,restoreResult?.ok&&mainCalls===1&&afterRestoreVersion!>beforeRestoreVersion!&&!pending.result.request.completed&&pending.result.replies.length===0);
 const restoredFacts=await readValidatedConversation(principal);
 check('restore rejection preserves saved input and user facts '+hasFacts,!!await db.messages.get(pending.result.source.id)&&(!hasFacts||restoredFacts?.conversation?.topics?.some((topic:any)=>topic.slots.time?.value==='15点'&&topic.slots.place?.value==='博物馆')));
 rows.push({kind:'pending-generation-restore',hasFacts,mainCalls,beforeRestoreVersion,afterRestoreVersion,restoreResult,result:pending.result});
 }
 await restore(fixture);
 await db.messages.bulkPut(Array.from({length:10000},(_,index)=>({id:'matrix-stock-message-'+index,sessionId:otherSession,role:index%2?'assistant' as const:'user' as const,content:'无关存量消息'+index,revision:1,createdAt:100+index,isProactive:false})));
 await db.memories.bulkPut(Array.from({length:2000},(_,index)=>({id:'matrix-stock-memory-'+index,userId:otherOwner,characterId:otherActor,content:'无关存量记忆'+index,type:'manual' as const,createdAt:1})));
 await db.memorySourceTombstones.bulkPut(Array.from({length:8105},(_,index)=>({id:'matrix-stock-tombstone-'+index,userId:owner,characterId:'matrix-unrelated-role-'+index%7,sourceType:'message' as const,sourceId:'matrix-unrelated-source-'+index,sourceRevision:1,status:'withdrawn' as const,suppressedMessageIds:['matrix-unrelated-source-'+index],updatedAt:1})));
 const unrelated=async()=>({messages:await db.messages.where('sessionId').equals(otherSession).toArray(),memories:await db.memories.where('userId').equals(otherOwner).toArray(),tombstones:await db.memorySourceTombstones.where('userId').equals(owner).filter(row=>row.id.startsWith('matrix-stock-')).toArray()});
 const stockPayload=payload();stockPayload.messages.push(...Array.from({length:600},(_,index)=>({id:'matrix-new-valid-batch-'+index,sessionId:session,role:'user',content:'合成恢复原文'+index,revision:1,createdAt:1000+index,isProactive:false})));
 const stockFixtureHash=await hash(await allRows()),beforeUnrelated=await hash(await unrelated()),reads:Record<string,{calls:number;bodies:number;unrelatedBodies:number}>={},restoreProbes:Array<()=>void>=[];
 for(const table of db.tables){const core=(table as any).core;for(const method of ['get','getMany','query','openCursor']){
  const original=core[method];core[method]=function(request:any){const stats=reads[table.name+'.'+method]??={calls:0,bodies:0,unrelatedBodies:0};stats.calls++;
   const record=(row:any)=>{if(row){stats.bodies++;if(typeof row.id==='string'&&row.id.startsWith('matrix-stock-'))stats.unrelatedBodies++;}};
   return original.call(this,request).then((result:any)=>{
    if(method==='get')record(result);else if(method==='getMany')result.forEach(record);else if(method==='query'&&request.values)result.result.forEach(record);
    else if(method==='openCursor'&&result&&request.values){let object=result,descriptor;while(object&&!descriptor){descriptor=Object.getOwnPropertyDescriptor(object,'value');object=Object.getPrototypeOf(object);}if(!descriptor?.get)throw Error('Cannot observe native cursor body access');const getValue=descriptor.get,seen=new Set<string>();Object.defineProperty(result,'value',{configurable:true,get(){const row=getValue.call(result),key=JSON.stringify([result.key,result.primaryKey]);if(!seen.has(key)){seen.add(key);record(row);}return row;}});}
    return result;
   });
  };restoreProbes.push(()=>{core[method]=original;});
 }}
 let stockResult;const started=performance.now();try{stockResult=await importSyncData(stockPayload);}finally{restoreProbes.reverse().forEach(restore=>restore());}
 const durationMs=performance.now()-started,unrelatedBodies=Object.values(reads).reduce((sum,row)=>sum+row.unrelatedBodies,0);
 check('stock600-row import uses bounded selected keys without scanning unrelated10k messages2k memories8105 tombstones',stockResult.ok&&stockResult.counts!.messages>=600&&unrelatedBodies<32);
 check('stock import preserves every unrelated record',beforeUnrelated===await hash(await unrelated()));
 const request=profileTurn.calls.find((row:any)=>row.body.messages.at(-1)?.content===profileTurn.result.source.content)?.body;
 const observedLocalRequest=request?Object.fromEntries(['model','thinking','reasoning_effort','max_tokens','stream'].filter(key=>key in request).map(key=>[key,request[key]])):null;
 return {complete:checks.every(row=>row.ok),checks,failures:checks.filter(row=>!row.ok),rows,character:'actual built-in Gu Yue Na',fixtureHash,stock:{fixtureHash:stockFixtureHash,result:stockResult,durationMs,reads,unrelatedBodies,distribution:{unrelatedMessages:10000,unrelatedMemories:2000,unrelatedTombstones:8105}},observedLocalRequest,actualModelMessagesHash:request?await hash(request.messages):null,paidCalls:0,transport:'local stub only; not naturalness acceptance'};
};
api.importBackupInWriter=async(payload:unknown)=>{if(!db.isOpen())await db.open();return importSyncData(payload);};
