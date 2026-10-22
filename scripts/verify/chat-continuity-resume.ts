import {db,type Message,type ContinuityThread} from '../../src/db';
import {captureContinuityChatEvidence,readContinuitySourceBatch} from '../../src/lib/continuity-sources';
import {sendRoleChatReply,type ChatRequest} from '../../src/lib/chat/send-service';
import {ChatReplyStream} from '../../src/lib/chat-stream';
import {withChatSessionLock} from '../../src/lib/chat/request-coordinator';
import {useAuthStore} from '../../src/store/auth-store';
import {useSettingsStore} from '../../src/store/settings-store';
import {useChatStore} from '../../src/store/chat-store';
import {fakeCharacter} from './world-harness';
import {messageRepo} from '../../src/db/message-repo';
import {PRESET_CHARACTERS} from '../../src/lib/seed-init';
import Dexie from 'dexie';
import {collectBackupData} from '../../src/lib/backup';
import {encryptBackup,decryptBackup} from '../../src/lib/backup-crypto';
import {importSyncData} from '../../src/lib/sync';
import {continuityRepo} from '../../src/db/continuity-repo';
const owner='resume-owner',actor='resume-actor',oldSession='resume-old-session',sessionId='resume-new-session';
const checks:Array<{name:string;ok:boolean}>=[],rows:any[]=[];
let calls:any[]=[],mutateDuringReply:(()=>Promise<void>)|undefined;
const check=(name:string,ok:unknown)=>checks.push({name,ok:!!ok});
window.fetch=async(url,init)=>{
 if(!String(url).includes('/chat/completions'))throw Error('No external provider requests');
 const body=JSON.parse(String(init?.body));calls.push({body,threads:await db.continuityThreads.toArray()});
 if(mutateDuringReply){const mutation=mutateDuringReply;mutateDuringReply=undefined;await mutation();}
 return new Response(JSON.stringify({choices:[{message:{content:'嗯。'},finish_reason:'stop'}]}),{headers:{'Content-Type':'application/json'}});
};
async function seed(status:ContinuityThread['status']='dropped'){
 await db.delete();await db.open();calls=[];mutateDuringReply=undefined;
 useAuthStore.getState().login(owner,'隔离跨会话','synthetic-not-a-credential','');
 useSettingsStore.setState({aiVoiceMode:false,ttsEnabled:false,defaultModel:{provider:'deepseek',model:'deepseek-flash'}});
 const preset=PRESET_CHARACTERS.find(character=>character.name==='古月娜');if(!preset)throw Error('Built-in Gu Yue Na preset missing');
 const character=fakeCharacter(actor,'古月娜',owner,{...preset,id:actor,createdBy:owner,isPreset:false,isCustom:true,sourcePresetId:preset.id,proactivity:0});await db.characters.put(character);
 await db.sessions.bulkPut([oldSession,sessionId].map(id=>({id,userId:owner,characterId:actor,title:'隔离会话',type:'private' as const,createdAt:1,updatedAt:1,modelAsked:true})));
 const source:Message={id:'resume-original-user',sessionId:oldSession,role:'user',content:'2030年1月7日14点去博物馆，交通坐地铁。',revision:1,createdAt:10,isProactive:false};await db.messages.put(source);
 const thread:ContinuityThread={id:'resume-original-thread',userId:owner,characterId:actor,kind:'plan',title:'博物馆计划',detail:source.content,dueAt:new Date(2030,0,7,14).getTime(),status,origin:'ai',sourceMessageIds:[source.id],sourceEvidence:captureContinuityChatEvidence([source],[source.id]),createdAt:10,updatedAt:11,...(status==='done'?{completedAt:11}:{})};await db.continuityThreads.put(thread);
 useChatStore.setState({characters:[character],selectedCharacterId:actor,currentSessionId:sessionId,messages:[]});
 return {source,thread,character};
}
async function turn(text:string){
 const character=(await db.characters.get(actor))!;
 const source:Message={id:crypto.randomUUID(),sessionId,role:'user',content:text,revision:1,createdAt:Date.now(),isProactive:false};await db.messages.put(source);useChatStore.getState().addMessage(source);
 const stream=new ChatReplyStream(sessionId,()=>undefined),request:ChatRequest={userId:owner,controller:new AbortController(),stream,stopped:false,completed:false};
 let error:string|undefined;
 try{await withChatSessionLock(sessionId,()=>sendRoleChatReply(character,source,request,{userId:owner,text}));}catch(caught){error=caught instanceof Error?caught.message:String(caught);}finally{stream.dispose();}
 return {source,error,request:{completed:request.completed,stopped:request.stopped},failed:!!(await db.messages.get(source.id))?.failed,replies:await db.messages.where('replyToUserMessageId').equals(source.id).toArray()};
}
(window as any).runContinuityResume=async()=>{
 for(const status of ['dropped','done','archived'] as const){
  const fixture=await seed(status),result=await turn('帮我恢复博物馆计划，原来是什么时间和交通？');
  const stored=(await db.continuityThreads.get(fixture.thread.id))!;
  check('cross-session explicit resume keeps original ID from '+status,!result.error&&!result.failed&&result.replies.length>0&&stored.status==='open'&&await db.continuityThreads.count()===1);
  check('known fields survive '+status,stored.detail===fixture.thread.detail&&stored.dueAt===fixture.thread.dueAt&&!stored.completedAt);
  const chatCalls=calls.filter(call=>call.body.messages.at(-1)?.content===result.source.content);
  check('resume is committed before the single chat request '+status,chatCalls.length===1&&chatCalls[0].threads.some((thread:any)=>thread.id===fixture.thread.id&&thread.status==='open'));
  check('actual prompt carries old sourced fields '+status,calls[0]?.body.messages[0].content.includes('[本轮接续事项]')&&calls[0].body.messages[0].content.includes('地铁')&&calls[0].body.messages[0].content.includes('2030'));
  check('actual current user source backs resume '+status,(stored as any).reopenEvidence?.sources?.some((ref:any)=>ref.messageId===result.source.id&&ref.sessionId===sessionId));
  rows.push({status,stored,calls,result});
 }
 for(const text of ['恢复博物馆计划吗？','我只是想问上次为什么取消博物馆计划。','继续听歌吧。','朋友说，恢复博物馆计划。','如果明天有空，恢复博物馆计划。','“朋友说，恢复博物馆计划。”这句话什么意思？']){
  const fixture=await seed();await turn(text);
  check('question/history/unrelated turn preserves closed item: '+text,JSON.stringify(await db.continuityThreads.get(fixture.thread.id))===JSON.stringify(fixture.thread));
 }
 let fixture=await seed();
 const second={...fixture.thread,id:'resume-other-day',dueAt:new Date(2030,0,8,14).getTime()};await db.continuityThreads.put(second);
 await turn('恢复博物馆计划。');
 check('same-title candidates are not guessed',(await db.continuityThreads.toArray()).every(thread=>thread.status==='dropped'));
 check('actual prompt asks selection for same title',calls[0]?.body.messages[0].content.includes('[本轮接续事项]')&&calls[0].body.messages[0].content.includes('多个'));
 fixture=await seed();await db.continuityThreads.put({...fixture.thread,id:'resume-other-day',dueAt:new Date(2030,0,8,14).getTime()});
 await turn('恢复2030年1月8日的博物馆计划。');
 check('explicit dated selection opens only selected occurrence',(await db.continuityThreads.get('resume-other-day'))?.status==='open'&&(await db.continuityThreads.get(fixture.thread.id))?.status==='dropped');
 fixture=await seed();await messageRepo.update(fixture.source.id,{content:'原始来源已经被编辑。'});await turn('恢复博物馆计划。');
 check('edited original source cannot be restored',(await db.continuityThreads.get(fixture.thread.id))?.status==='dropped');
 fixture=await seed();const result=await turn('恢复博物馆计划。');await messageRepo.deleteById(result.source.id);
 const afterDeletion=(await db.continuityThreads.get(fixture.thread.id))!;
 check('deleted resume source makes reopened state unavailable',!(await readContinuitySourceBatch({userId:owner,characterId:actor},[afterDeletion],false)).has(fixture.thread.id));
 fixture=await seed();mutateDuringReply=()=>db.continuityThreads.update(fixture.thread.id,{detail:'用户后来改过，不许覆盖。',updatedAt:999}).then(()=>undefined);
 const late=await turn('恢复博物馆计划。');
 check('late reply cannot publish with stale restored fields',(late.failed||!!late.error)&&late.replies.length===0&&(await db.continuityThreads.get(fixture.thread.id))?.detail==='用户后来改过，不许覆盖。');
 check('native scoped title index exists',db.continuityThreads.schema.indexes.some(index=>index.name==='[userId+characterId+title]'));
 fixture=await seed();
 const originals:Message[]=Array.from({length:6},(_,index)=>({...fixture.source,id:'resume-six-premises-'+index,content:fixture.source.content+' 原始依据'+index}));await db.messages.bulkPut(originals);
 await db.continuityThreads.update(fixture.thread.id,{sourceMessageIds:originals.map(message=>message.id),sourceEvidence:captureContinuityChatEvidence(originals,originals.map(message=>message.id))});
 await turn('恢复博物馆计划。');await turn('继续博物馆计划。');
 const repeated=(await db.continuityThreads.get(fixture.thread.id))!;
 check('repeated explicit resume keeps all six original premises',repeated.sourceEvidence?.sources.length===6&&repeated.sourceMessageIds?.length===6&&repeated.reopenEvidence?.sources.length===1&&(await readContinuitySourceBatch({userId:owner,characterId:actor},[repeated],false)).has(repeated.id));
 fixture=await seed();await db.continuityThreads.put({...fixture.thread,id:'other-owner-thread',userId:'other-owner',characterId:'other-actor',detail:'FOREIGN_RESUME_SENTINEL'});
 await turn('恢复博物馆计划。');
 check('same title in another account does not enter request',calls.every(call=>!JSON.stringify(call.body).includes('FOREIGN_RESUME_SENTINEL'))&&(await db.continuityThreads.get('other-owner-thread'))?.status==='dropped');
 fixture=await seed();const beforeBackup=await turn('恢复博物馆计划。');
 const originalResumed=(await db.continuityThreads.get(fixture.thread.id))!;
 const backup=await collectBackupData(owner,'合成隔离账号');
 const encrypted=await encryptBackup(JSON.stringify(backup),'synthetic-backup-fixture-only');
 const decoded=JSON.parse(await decryptBackup(encrypted,'synthetic-backup-fixture-only'));
 await db.delete();await db.open();
 const imported=await importSyncData({...decoded,__meta__:{...decoded.__meta__,kind:'sync'}});
 const restored=(await db.continuityThreads.get(fixture.thread.id))!;
 check('real backup collection/crypto/import preserves reopened item and both source types',imported.ok&&JSON.stringify(restored)===JSON.stringify(originalResumed)&&(await readContinuitySourceBatch({userId:owner,characterId:actor},[restored],false)).has(restored.id));
 check('restored rows populate the native exact-title index',(await db.continuityThreads.where('[userId+characterId+title]').equals([owner,actor,'博物馆计划']).primaryKeys())[0]===fixture.thread.id);
 await messageRepo.deleteById(beforeBackup.source.id);
 const reimported=await importSyncData({...decoded,__meta__:{...decoded.__meta__,kind:'sync'}});
 const withdrawn=(await db.continuityThreads.get(fixture.thread.id))!;
 check('old backup cannot revive deleted resume-source authority',reimported.ok&&!(await readContinuitySourceBatch({userId:owner,characterId:actor},[withdrawn],false)).has(withdrawn.id));
 const countBeforeForeign=await db.continuityThreads.count();
 const crossAccount=await importSyncData({...decoded,__meta__:{...decoded.__meta__,kind:'sync',userId:'other-owner'}});
 check('backup import rejects mixed account identity without partial thread writes',!crossAccount.ok&&await db.continuityThreads.count()===countBeforeForeign);
 fixture=await seed();
 const unrelated:Message={id:'resume-unrelated-control',sessionId,role:'user',content:'你好。',revision:1,createdAt:Date.now(),isProactive:false};await db.messages.put(unrelated);
 await continuityRepo.resumeFromUserMessage({userId:owner,characterId:actor,isCurrent:()=>true},unrelated,{title:fixture.thread.title});
 check('repository does not trust a caller-supplied control without matching current user words',(await db.continuityThreads.get(fixture.thread.id))?.status==='dropped');
 fixture=await seed();await continuityRepo.update(fixture.thread.id,{title:'报告，交接'});
 const quoted=await turn('恢复“报告，交接”。');
 check('quoted exact titles keep their internal punctuation',!quoted.error&&!quoted.failed&&(await db.continuityThreads.get(fixture.thread.id))?.status==='open');
 return {complete:checks.every(check=>check.ok),character:'古月娜',persona:'actual built-in preset via production runtime',modelTransport:'local stub only; no genuine-model voice acceptance',checks,failures:checks.filter(check=>!check.ok),rows,apiCalls:0};
};
const stockHash=async(value:unknown)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))).map(value=>value.toString(16).padStart(2,'0')).join('');
(window as any).prepareResumeStock=async(withFocus=false,extraMessages:Message[]=[])=>{
 await seed();
 await db.continuityThreads.bulkPut(Array.from({length:50000},(_,index)=>({id:'resume-unrelated-'+index,userId:owner,characterId:actor,kind:'plan' as const,title:'无关已结束事项'+index,detail:'不应逐轮扫描的无关合成记录',status:'done' as const,origin:'user' as const,createdAt:1,updatedAt:1})));
 await db.messages.bulkPut(Array.from({length:512},(_,index):Message=>({id:'resume-stock-message-'+index,sessionId,role:index%2?'assistant':'user',content:'存量合成聊天'+index,revision:1,createdAt:100+index,isProactive:false})));
 await db.memorySourceTombstones.bulkPut(Array.from({length:8105},(_,index)=>({id:'resume-withdrawal-'+index,userId:owner,characterId:index<2?actor:'resume-unrelated-actor-'+index%5,sourceType:'memory' as const,sourceId:'resume-unrelated-memory-'+index,status:'withdrawn' as const,suppressedMessageIds:['resume-unrelated-message-'+index],updatedAt:1})));
 await db.diaries.bulkPut(Array.from({length:40},(_,index)=>({id:'resume-private-'+index,userId:owner,date:'2026-01-01',title:'私密合成资料',content:'PRIVATE_RESUME_SENTINEL_'+index,visibility:'private' as const,createdAt:1,updatedAt:1})));
 if(withFocus){await (window as any).loadResumeTestSession();const result=await turn('恢复博物馆计划。');if(result.error||result.failed)throw Error('Could not prepare sourced native focus');}
 if(extraMessages.length)await db.messages.bulkPut(extraMessages.map(message=>({...message,sessionId})));
 const tables:Record<string,unknown[]>={};for(const table of db.tables)tables[table.name]=await table.toArray();
 const data={tables};return {data,sha256:await stockHash(data),clock:Date.now()+30000};
};
(window as any).runResumeStock=async(fixture:any,resume:boolean,followup=false,inputText?:string)=>{
 const samples=[],nativeDate=Date;
 globalThis.Date=new Proxy(nativeDate,{construct(target,args){return Reflect.construct(target,args.length?args:[fixture.clock]);},get(target,key,receiver){return key==='now'?()=>fixture.clock:Reflect.get(target,key,receiver);}});
 try{for(let iteration=0;iteration<3;iteration++){
  await db.delete();await db.open();await db.transaction('rw',db.tables,async()=>{for(const table of db.tables){const data=fixture.data.tables[table.name];if(data?.length)await table.bulkPut(data);}});
  const imported:Record<string,unknown[]>={};for(const table of db.tables)imported[table.name]=await table.toArray();
  if(await stockHash({tables:imported})!==fixture.sha256){
   const differences=Object.entries(imported).filter(([name,rows])=>JSON.stringify(rows)!==JSON.stringify(fixture.data.tables[name])).map(([name,rows])=>({table:name,expectedRows:fixture.data.tables[name]?.length,actualRows:rows.length,firstDifferentId:(rows.find((row:any,index)=>JSON.stringify(row)!==JSON.stringify(fixture.data.tables[name]?.[index])) as any)?.id}));
   throw Error('Full native stock differs: '+JSON.stringify(differences));
  }
  const character=(await db.characters.get(actor))!,loaded=(await db.messages.where('sessionId').equals(sessionId).sortBy('createdAt')).slice(-200);
  useAuthStore.getState().login(owner,'隔离存量','synthetic-not-a-credential','');useSettingsStore.setState({aiVoiceMode:false,ttsEnabled:false,defaultModel:{provider:'deepseek',model:'deepseek-flash'}});
  useChatStore.setState({characters:[character],selectedCharacterId:actor,currentSessionId:sessionId,messages:loaded});
  const reads:Record<string,{calls:number;bodies:number;keys:number;indexes:string[]}>={},restore:Array<()=>void>=[];
  for(const table of db.tables){const core=(table as any).core;for(const method of ['get','getMany','query','openCursor']){
   const original=core[method];core[method]=function(request:any){const row=reads[table.name+'.'+method]??={calls:0,bodies:0,keys:0,indexes:[]};row.calls++;const index=request.query?.index?.name;if(index&&!row.indexes.includes(index))row.indexes.push(index);
    return original.call(this,request).then((result:any)=>{if(method==='get')row.bodies+=result?1:0;else if(method==='getMany')row.bodies+=result.filter(Boolean).length;else if(method==='query')request.values?row.bodies+=result.result.length:row.keys+=result.result.length;else if(result){const start=result.start;result.start=function(callback:any){return start.call(this,()=>{request.values?row.bodies++:row.keys++;callback();});};}return result;});
   };restore.push(()=>{core[method]=original;});
  }}
  const text=inputText??(followup?'那原来几点，怎么去？':resume?'恢复博物馆计划。':'古月娜，今天想聊两句。'),messages:unknown[]=[],auxiliary:unknown[]=[];
  let firstRequestMs:number|undefined;const started=performance.now(),savedFetch=window.fetch;
  window.fetch=async(_url,init)=>{const body=JSON.parse(String(init?.body));if(body.messages?.[body.messages.length-1]?.content===text){firstRequestMs??=performance.now()-started;messages.push(body.messages);}else auxiliary.push(body.messages);
   return new Response(JSON.stringify({choices:[{message:{content:'嗯。'},finish_reason:'stop'}]}),{headers:{'Content-Type':'application/json'}});
  };
  try{const result=await turn(text);const wholeMs=performance.now()-started;const thread=await db.continuityThreads.get('resume-original-thread');samples.push({fixtureSha256:fixture.sha256,firstRequestMs,wholeMs,failed:result.failed,error:result.error,replies:result.replies.map(message=>message.content),messages,messagesSha256:await stockHash(messages),auxiliaryLocalCalls:auxiliary.length,thread,reads});}
  finally{window.fetch=savedFetch;for(const reset of restore)reset();}
 }}finally{globalThis.Date=nativeDate;}
 return {samples,apiCalls:0};
};
(window as any).prepareResumeReload=()=>seed();
(window as any).loadResumeTestSession=async()=>{
 useAuthStore.getState().login(owner,'隔离跨会话','synthetic-not-a-credential','');
 useSettingsStore.setState({aiVoiceMode:false,ttsEnabled:false,defaultModel:{provider:'deepseek',model:'deepseek-flash'}});
 const character=(await db.characters.get(actor))!;useChatStore.setState({characters:[character],selectedCharacterId:actor,currentSessionId:sessionId,messages:await db.messages.where('sessionId').equals(sessionId).sortBy('createdAt')});
};
(window as any).resumeTestTurn=async(text:string)=>{calls=[];const result=await turn(text);return {result,calls,conversation:(await db.sessions.get(sessionId))?.conversation};};
(window as any).setResumeTestMutation=(mutation:()=>Promise<void>)=>{mutateDuringReply=mutation;};
(window as any).resumeAfterReload=async()=>{
 await (window as any).loadResumeTestSession();
 const result=await turn('恢复博物馆计划。');
 return {result,thread:await db.continuityThreads.get('resume-original-thread'),calls,originalExists:!!await db.messages.get('resume-original-user')};
};
(window as any).runResumeMigration=async()=>{
 const fixture=await seed();
 const stores=Object.fromEntries(db.tables.map(table=>[table.name,[table.schema.primKey.src,...table.schema.indexes.map(index=>index.src)].join(',')]));
 const before:Record<string,unknown[]>={};for(const table of db.tables)before[table.name]=await table.toArray();
 stores.continuityThreads='id,characterId,userId,[characterId+userId],[characterId+status],status,createdAt';
 await db.delete();
 const legacy=new Dexie(db.name);legacy.version(43).stores(stores);await legacy.open();
 await legacy.transaction('rw',legacy.tables,async()=>{for(const table of legacy.tables)if(before[table.name]?.length)await table.bulkPut(before[table.name]);});
 legacy.close();
 const failed=new Dexie(db.name);failed.version(43).stores(stores);failed.version(44).stores({continuityThreads:stores.continuityThreads+',[userId+characterId+title],[userId+characterId+title+dueAt]'}).upgrade(()=>{throw Error('synthetic-index-upgrade-abort');});
 let rejected=false;try{await failed.open();}catch(error){rejected=String(error).includes('synthetic-index-upgrade-abort');}finally{failed.close();}
 const rollback=new Dexie(db.name);rollback.version(43).stores(stores);await rollback.open();
 const rolledBack=JSON.stringify(await rollback.table('continuityThreads').get(fixture.thread.id))===JSON.stringify(fixture.thread);rollback.close();
 await db.open();
 const after:Record<string,unknown[]>={};for(const table of db.tables)after[table.name]=await table.toArray();
 const found=await db.continuityThreads.where('[userId+characterId+title]').equals([owner,actor,'博物馆计划']).toArray();
 return {failedUpgradeRejected:rejected,failedUpgradePreservedRow:rolledBack,allRowsPreserved:JSON.stringify(before)===JSON.stringify(after),version:db.verno,indexedIds:found.map(thread=>thread.id)};
};
