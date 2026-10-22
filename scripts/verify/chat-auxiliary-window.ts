import {db,type Message} from '../../src/db';
import {captureChatAuxiliary,commitChatAuxiliary,validateChatAuxiliary} from '../../src/db/chat-auxiliary-guard';
import {boundAuxiliaryHistory} from '../../src/lib/ai/history-window';
import {memorySourceTombstoneRepo} from '../../src/db/memory-source-tombstone-repo';
import {readRecentChatMessages} from '../../src/db/chat-archive-reader';
import {messageRepo} from '../../src/db/message-repo';

const owner='archive-owner',characterId='archive-role',sessionId='archive-session';
const message=(i:number,extra:Partial<Message>={}):Message=>({id:'archive-'+String(i).padStart(7,'0'),sessionId,role:i%2?'assistant':'user',content:'合成消息'+i,revision:1,createdAt:1000+i,isProactive:false,...extra});
const api=window as any;
api.runAuxiliaryWindow=async()=>{
 const checks:Array<{label:string;pass:boolean}>=[],rows:any[]=[];
 const check=(pass:unknown,label:string)=>checks.push({label,pass:!!pass});
 const setup=async(messages:Message[])=>{
  await db.delete();await db.open();
  await db.characters.add({id:characterId,name:'隔离角色',createdBy:owner,systemPrompt:'本地夹具'} as any);
  await db.sessions.add({id:sessionId,userId:owner,characterId,type:'private',createdAt:1,updatedAt:1} as any);
  await db.messages.bulkAdd(messages);
 };
 const legacy=async(kind:'analysis'|'settlement')=>{
  const all=(await db.messages.where('sessionId').equals(sessionId).toArray()).sort((a,b)=>a.createdAt-b.createdAt||(a.id<b.id?-1:a.id>b.id?1:0));
  const suppressed=await memorySourceTombstoneRepo.selectedSuppressedMessages(owner,characterId,all.map(m=>m.id));
  const eligible=all.filter(m=>(!m.failed||m.role==='user')&&!suppressed.has(m.id)&&m.secretaryDispatch?.bodyOrigin!=='composed');
  return {all,eligible,messages:kind==='settlement'&&eligible.filter(m=>m.role==='user').length<3?[]:boundAuxiliaryHistory(eligible)};
 };
 const probe=async<T>(action:()=>Promise<T>)=>{
  const reads:Record<string,{calls:number;rows:number;keys?:number}>= {},restore:Array<()=>void>=[];
  for(const table of [db.messages,db.memorySourceTombstones])for(const method of ['query','get','getMany','openCursor','count']){
   const core=table.core as any,original=core[method];
   core[method]=function(...args:any[]){return original.apply(this,args).then((result:any)=>{
    const metric=reads[table.name+'.'+method]??={calls:0,rows:0};metric.calls++;
    if(method==='count')metric.keys=(metric.keys??0)+result;
    else if(method==='openCursor'){
     if(result){const cursor=result,next=cursor.start;cursor.start=function(callback:()=>void){return next.call(this,()=>{metric.rows++;callback();});};}
    }else metric.rows+=method==='query'?result.result.length:method==='get'?Number(result!==undefined):result.filter(Boolean).length;
    return result;
   });};
   restore.push(()=>{core[method]=original;});
  }
  const start=performance.now();try{return {value:await action(),elapsedMs:performance.now()-start,reads};}finally{restore.forEach(f=>f());}
 };
 for(const size of [1000,10000,50000]){
  await setup(Array.from({length:size},(_,i)=>message(i)));
  await db.memorySourceTombstones.bulkAdd(Array.from({length:8105},(_,i)=>({id:'unrelated-'+i,userId:owner,characterId,sourceType:'message',sourceId:'absent-'+i,sourceRevision:1,status:'deleted',suppressedMessageIds:['absent-'+i],updatedAt:1})) as any);
  const expected=await legacy('analysis');
  const actual=await probe(()=>captureChatAuxiliary(owner,characterId,sessionId,'analysis',()=>true));
  const bodies=Object.entries(actual.reads).filter(([key])=>key.startsWith('messages.')&&!key.endsWith('.count')).reduce((n,[,value])=>n+value.rows,0);
  check(JSON.stringify(actual.value?.messages)===JSON.stringify(expected.messages),'unchanged exact 48-message model input at '+size);
  check(bodies<=64,'bounded ordinary archive message reads at '+size);
  check(Object.entries(actual.reads).filter(([key])=>key.startsWith('memorySourceTombstones.')).every(([,v])=>v.rows===0),'zero unrelated tombstone bodies at '+size);
  check(actual.value?.sourceMessageCount===size&&actual.value.userMessageCount===Math.ceil(size/2)&&actual.value.messageCount===expected.messages.length,'raw source/checkpoint and selected result counts at '+size);
  rows.push({scenario:'ordinary-stock',size,reads:actual.reads,elapsedMs:actual.elapsedMs,bodies,selected:actual.value?.messages.length});
 }
 for(const scenario of ['same-millisecond','many-ineligible','char-budget','failed-user','old-user-threshold','suppressed-users','all-suppressed','empty-text','empty-archive']){
  const total=scenario==='empty-archive'?0:['old-user-threshold','suppressed-users'].includes(scenario)?220:170;
  const messages=Array.from({length:total},(_,i)=>message(i,scenario==='same-millisecond'?{createdAt:1000}:{}));
  if(scenario==='many-ineligible')for(let i=20;i<total;i++){
   messages[i].failed=i%3===0;
   if(i%3===1)messages[i].secretaryDispatch={taskId:'task',assistantName:'助理',bodyOrigin:'composed'};
  }
  if(scenario==='char-budget')messages.forEach(m=>{m.content='长'.repeat(3000);});
  if(scenario==='failed-user')messages.forEach(m=>{m.failed=true;});
  if(['old-user-threshold','suppressed-users'].includes(scenario))messages.forEach((m,i)=>{m.role=i<3?'user':'assistant';});
  if(scenario==='empty-text')messages.slice(-60).forEach(m=>{m.content='';});
  await setup(messages);
  if(['all-suppressed','many-ineligible','suppressed-users'].includes(scenario))await db.memorySourceTombstones.add({id:'selected-suppressed',userId:owner,characterId,sourceType:'message',sourceId:'prior',sourceRevision:1,status:'withdrawn',suppressedMessageIds:messages.filter((_,i)=>scenario==='all-suppressed'||scenario==='suppressed-users'&&i<3||scenario==='many-ineligible'&&i>=20&&i%3===2).map(m=>m.id),updatedAt:1} as any);
  const expected=await legacy('settlement');
  const actual=await captureChatAuxiliary(owner,characterId,sessionId,'settlement',()=>true);
  check(JSON.stringify(actual?.messages??[])===JSON.stringify(expected.messages),'legacy bounded source parity on '+scenario);
  if(actual)check(actual.messageCount===actual.messages.length&&actual.sourceMessageCount===total,'selected count semantics on '+scenario);
  if(scenario==='old-user-threshold')check(!!actual&&actual.messages.every(m=>m.role==='assistant'),'three eligible old users remain sufficient outside recent 48');
  if(scenario==='suppressed-users')check(!actual,'three raw users cannot replace three eligible users');
  if(scenario==='failed-user')check(actual?.messages.every(m=>m.role==='user'&&m.failed),'failed user facts survive without failed assistant text');
  if(scenario==='char-budget')check(actual?.messages.length===25&&actual.messages.reduce((n,m)=>n+m.content.length,0)===30000,'30k budget preserves newest 25 sources');
  rows.push({scenario,selected:actual?.messages.length??0});
 }
 await setup(Array.from({length:160},(_,i)=>message(i,{createdAt:1000,failed:i%5===0,...(i%5===1?{secretaryDispatch:{taskId:'task',assistantName:'助理',bodyOrigin:'composed' as const}}:{})})));
 await db.memorySourceTombstones.add({id:'mixed-tied-suppression',userId:owner,characterId,sourceType:'message',sourceId:'prior',sourceRevision:1,status:'withdrawn',suppressedMessageIds:Array.from({length:160},(_,i)=>i).filter(i=>i%5===2).map(i=>message(i).id),updatedAt:1} as any);
 const mixedExpected=await legacy('analysis');
 check(JSON.stringify((await captureChatAuxiliary(owner,characterId,sessionId,'analysis',()=>true))?.messages)===JSON.stringify(mixedExpected.messages),'same-millisecond page boundaries survive mixed failures/composed/suppression');
 const allMixed=await db.messages.orderBy('id').toArray();
 const suppressedMixed=await memorySourceTombstoneRepo.selectedSuppressedMessages(owner,characterId,allMixed.map(m=>m.id));
 const summaryExpected=allMixed.filter(m=>!m.failed&&!suppressedMixed.has(m.id)).slice(-18);
 const summarySelection=await readRecentChatMessages(owner,characterId,sessionId,{limit:18,allowFailedUser:false,includeComposed:true});
 check(JSON.stringify(summarySelection)===JSON.stringify(summaryExpected),'shared summary reader keeps composed text while excluding failed user and assistant');
 await db.memorySourceTombstones.bulkAdd(['other-owner','other-role'].map((scope,i)=>({id:'other-scope-'+i,userId:i?owner:scope,characterId:i?scope:characterId,sourceType:'message',sourceId:'prior-'+i,sourceRevision:1,status:'deleted',suppressedMessageIds:summarySelection.map(m=>m.id),updatedAt:1})) as any);
 check(JSON.stringify(await readRecentChatMessages(owner,characterId,sessionId,{limit:18,allowFailedUser:false,includeComposed:true}))===JSON.stringify(summaryExpected),'same message ids under another account/character do not suppress the owned summary');
 await setup(Array.from({length:100},(_,i)=>message(i)));
 let active=true;const snapshot=await captureChatAuxiliary(owner,characterId,sessionId,'analysis',()=>active);
 check(!!snapshot&&await validateChatAuxiliary(snapshot,()=>true),'same transaction captures and validates owned selection');
 await db.messages.update(snapshot!.messages[0].id,{revision:2,content:'更新后的原话'});
 check(!await validateChatAuxiliary(snapshot!,()=>true),'selected source edit rejects old snapshot');
 active=false;check(!await captureChatAuxiliary(owner,characterId,sessionId,'analysis',()=>active),'account switch before read returns no snapshot');
 active=true;const getRangePage=messageRepo.getRangePage,getBySession=messageRepo.getBySession;
 messageRepo.getRangePage=async(...args)=>{const messages=await getRangePage(...args);active=false;return messages;};
 messageRepo.getBySession=async(...args)=>{const messages=await getBySession(...args);active=false;return messages;};
 try{check(!await captureChatAuxiliary(owner,characterId,sessionId,'analysis',()=>active),'account switch during archive read returns no snapshot');}finally{messageRepo.getRangePage=getRangePage;messageRepo.getBySession=getBySession;}
 active=true;
 const current=await captureChatAuxiliary(owner,characterId,sessionId,'analysis',()=>true);
 await db.sessions.update(sessionId,{userId:'other-owner'});
 check(!await commitChatAuxiliary(current!,()=>true,async()=>{throw Error('Must never apply another account context');}),'owner transfer rejects local derivative commit');
 return {complete:checks.every(c=>c.pass),checks,rows,paidCalls:0,model:'未确认',reasoning:'未确认',scope:'Native isolated IndexedDB, no upstream/no microphone/no Android claim'};
};
