import './chat-human-live';
import {db,type Message} from '../../src/db';
import {captureChatAuxiliary} from '../../src/db/chat-auxiliary-guard';
import {summarizeRoleChat} from '../../src/lib/chat/send-service';
import {webApi} from '../../src/lib/web-api';

const api=window as any;
const owner='isolated-live-expression-owner',sessionId='isolated-live-session';
interface ReadMetric {calls:number;bodyRows:number;cursorVisits?:number;indexedCount?:number;indexNames?:string[]}

/** Measure the candidate stage itself, rather than only its bounded commit guards.
 * Preserve native promise scheduling: an async DBCore wrapper can manufacture
 * transaction failures that do not occur in the product. */
function recordCandidateReads(){
 const reads:Record<string,ReadMetric>={},restore:Array<()=>void>=[];
 for(const table of [db.messages,db.memorySourceTombstones])for(const method of ['query','get','getMany','openCursor','count']){
  const core=table.core as any,original=core[method];
  core[method]=function(...args:any[]){return original.apply(this,args).then((result:any)=>{
   const metric=reads[table.name+'.'+method]??={calls:0,bodyRows:0};metric.calls++;
   const indexName=args[0]?.query?.index?.name;
   if(indexName){metric.indexNames??=[];if(!metric.indexNames.includes(indexName))metric.indexNames.push(indexName);}
   if(method==='query')metric.bodyRows+=args[0]?.values===false?0:result.result.length;
   if(method==='get')metric.bodyRows+=Number(result!==undefined);
   if(method==='getMany')metric.bodyRows+=result.filter(Boolean).length;
   if(method==='count')metric.indexedCount=(metric.indexedCount??0)+result;
   if(method==='openCursor'&&result){
    const start=result.start;result.start=function(callback:()=>void){return start.call(this,()=>{metric.cursorVisits=(metric.cursorVisits??0)+1;callback();});};
    const getter=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(result),'value')?.get;
    if(getter){const seen=new Set<string>();Object.defineProperty(result,'value',{configurable:true,get(){const id=JSON.stringify([result.key,result.primaryKey]);if(!seen.has(id)){seen.add(id);metric.bodyRows++;}return getter.call(result);}});}
   }
   return result;
  });};
  restore.push(()=>{core[method]=original;});
 }
 return {reads,restore:()=>restore.forEach(fn=>fn())};
}

api.auditArchiveBaseline=async()=>{
 const checks:string[]=[],rows:any[]=[];
 const check=(ok:unknown,label:string)=>{if(!ok)throw Error(label);checks.push(label);};
 for(const size of [1000,10000,50000]){
  const actor=await api.liveExpression.setup({name:'合成资料角色',tags:[],systemPrompt:'仅用于隔离存量读取验证。',greeting:'合成问候。',signature:''},.5);
  const messages=Array.from({length:size},(_,i)=>({id:'archive-'+String(i).padStart(6,'0'),sessionId,role:i%2?'assistant':'user',content:'synthetic original '+i,revision:1,createdAt:1000+i,isProactive:false})) as Message[];
  await db.messages.bulkAdd(messages);
  await db.memorySourceTombstones.bulkPut(Array.from({length:8105},(_,i)=>({id:'unused-suppression-'+i,userId:owner,characterId:actor.id,sourceType:'message',sourceId:'unrelated-'+i,status:'deleted',sourceRevision:1,updatedAt:1,suppressedMessageIds:['unrelated-'+i]})) as any);
  for(const operation of ['auxiliary','summary']){
   const probe=recordCandidateReads();let selected=0,modelSubstituteCalls=0;
   const started=performance.now();
   try{
    if(operation==='auxiliary')selected=(await captureChatAuxiliary(owner,actor.id,sessionId,'analysis',()=>true))?.messages.length??0;
    else{
     webApi.context.summarize=async params=>{modelSubstituteCalls++;selected=params.history.length;return {complete:false};};
     await summarizeRoleChat(sessionId,owner,actor,'synthetic-not-a-credential');
    }
   }finally{probe.restore();}
   const elapsedMs=performance.now()-started;
   check(selected===(operation==='auxiliary'?48:12),size+' '+operation+' selects the existing bounded payload');
   check(probe.reads['messages.query']?.bodyRows===size,size+' '+operation+' reproduces full original body selection before bounding');
   if(operation==='summary')check(modelSubstituteCalls===1&&probe.reads['memorySourceTombstones.query']?.bodyRows===8105,size+' summary reproduces unrelated actor tombstone body selection');
   rows.push({size,operation,selected,modelSubstituteCalls,elapsedMs,fixture:{messages:size,shortSyntheticBodies:true,tombstones:8105,matchingTombstones:0},reads:probe.reads});
  }
 }
 return {complete:true,checks,rows,paidCalls:0,realModelCalls:0,scope:'Current production summary/auxiliary candidate selection in isolated native desktop IndexedDB; not commit guards, foreground preparation, Android, first-visible latency, or model quality'};
};
