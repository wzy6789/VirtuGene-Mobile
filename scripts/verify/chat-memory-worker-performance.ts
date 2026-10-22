import './chat-human-live';
import {db,type MemoryJob} from '../../src/db';
import {messageRepo} from '../../src/db/message-repo';
import {memoryLedgerRepo} from '../../src/db/memory-ledger-repo';
import {memorySourceTombstoneRepo} from '../../src/db/memory-source-tombstone-repo';
import {inspectMemoryJobSources} from '../../src/db/memory-job-sources';
import {processMemoryJobs} from '../../src/lib/memory-jobs';
import {extractMemories} from '../../src/lib/ai/memory-consolidator';

const api=window as any;
const owner='isolated-live-expression-owner',actor='isolated-live-role',sessionId='isolated-live-session';
const sourceId='worker-perf-target';
const tables=[db.memoryJobs,db.messages,db.characters,db.sessions,db.memorySourceTombstones];
type Read={calls:number;returnedBodies:number;requestedKeys:number;cursorVisits:number;indexedCountSum:number;bodyKinds:Record<string,number>;indices:string[];cursorValueTracking?:boolean};
type Reads=Record<string,Read>;

/** Preserve DBCore's native promise and Dexie's transaction zone. In particular,
 * an async wrapper here can make IndexedDB commit before Dexie finishes a job. */
function readProbe(){
 const reads:Reads={},restore:Array<()=>void>=[];
 for(const table of db.tables){
  const core=table.core as any;
  for(const method of ['query','getMany','get','openCursor','count']){
   const original=core[method];if(typeof original!=='function')continue;
   core[method]=function(...args:any[]){
    const item=reads[table.name+'.'+method]??={calls:0,returnedBodies:0,requestedKeys:0,cursorVisits:0,indexedCountSum:0,bodyKinds:{},indices:[]};
    item.calls++;
    const index=args[0]?.query?.index?.name;
    if(typeof index==='string'&&!item.indices.includes(index))item.indices.push(index);
    if(method==='getMany')item.requestedKeys+=args[0]?.keys?.length??0;
    else if(method==='get')item.requestedKeys++;
    const body=(row:any)=>{
     if(row===undefined||row===null)return;
     item.returnedBodies++;
     const id=String(row.id??'');
     const kind=table.name==='memoryJobs'?(id.startsWith('done-')?'done':id==='future-job'?'future':id==='foreign-job'?'foreign':'selected')
      :table.name==='messages'?(id===sourceId?'selected':'history')
       :table.name==='memorySourceTombstones'?(id==='matching-suppression'?'matching':'irrelevant'):'other';
     item.bodyKinds[kind]=(item.bodyKinds[kind]??0)+1;
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
        Object.defineProperty(result,'value',{configurable:true,get(){
         const row=getValue.call(result),key=JSON.stringify([result.key,result.primaryKey]);
         if(!seen.has(key)){seen.add(key);body(row);}return row;
        }});
        item.cursorValueTracking=true;
       }else item.cursorValueTracking=false;
      }
      return result;
     }
     if(method==='query'){
      // An index-key query is not a record-body read.
      if(args[0]?.values!==false)for(const row of result?.result??[])body(row);
     }else if(method==='getMany')for(const row of result??[])body(row);
     else body(result);
     return result;
    });
   };
   restore.push(()=>{core[method]=original;});
  }
 }
 return {reads,restore:()=>restore.reverse().forEach(fn=>fn())};
}
async function measured<T>(run:()=>Promise<T>){
 const probe=readProbe(),started=performance.now();
 try{return {value:await run(),reads:probe.reads,elapsedMs:Math.round((performance.now()-started)*100)/100};}
 finally{probe.restore();}
}
const bodyCount=(reads:Reads,table:string)=>Object.entries(reads).filter(([key])=>key.startsWith(table+'.')).reduce((sum,[,row])=>sum+row.returnedBodies,0);
const kindCount=(reads:Reads,table:string,kind:string)=>Object.entries(reads).filter(([key])=>key.startsWith(table+'.')).reduce((sum,[,row])=>sum+(row.bodyKinds[kind]??0),0);

async function seed(doneJobs:number,irrelevantTombstones:number,matching=false){
 await api.liveExpression.setup({name:'林舟',tags:[],systemPrompt:'你是林舟。',greeting:'你好。',signature:''},.5);
 const now=Date.now()-10_000;
 await db.messages.bulkPut(Array.from({length:511},(_,i)=>({id:'worker-perf-history-'+i,sessionId,role:'assistant' as const,content:'合成存量消息'+i,revision:1,createdAt:now+i,isProactive:false})));
 await messageRepo.create({id:sourceId,sessionId,role:'user',content:'我喜欢薄荷味。',revision:1,createdAt:now+512,isProactive:false});
 const base:MemoryJob={id:'unused',userId:owner,sessionId,characterIds:[actor],sourceType:'chat',sourceIds:[sourceId],sourceRevisions:{[sourceId]:1},sourceOffsets:{[sourceId]:0},sourceEndOffsets:{[sourceId]:7},task:'extract',status:'done',attempts:1,availableAt:now,createdAt:now,updatedAt:now};
 await db.memoryJobs.bulkPut([
  ...Array.from({length:doneJobs},(_,i)=>({...base,id:'done-'+i,sourceIds:['old-done-source-'+i]})),
  {...base,id:'future-job',status:'queued' as const,attempts:0,availableAt:Date.now()+86_400_000},
  {...base,id:'foreign-job',userId:'synthetic-other-owner',status:'queued' as const,attempts:0},
 ]);
 await db.memorySourceTombstones.bulkPut(Array.from({length:irrelevantTombstones},(_,i)=>({id:'irrelevant-tomb-'+i,userId:owner,characterId:i%5===0?actor:'unrelated-role-'+i%5,sourceType:'message' as const,sourceId:'removed-'+i,sourceRevision:1,status:'deleted' as const,updatedAt:now,suppressedMessageIds:['removed-'+i]})));
 if(matching)await db.memorySourceTombstones.put({id:'matching-suppression',userId:owner,characterId:actor,sourceType:'memory',sourceId:'forgotten-synthetic-memory',sourceRevision:1,status:'deleted',updatedAt:now,suppressedMessageIds:[sourceId]});
 return {doneJobs,irrelevantTombstones,currentActorIrrelevantTombstones:Math.ceil(irrelevantTombstones/5),matchingSuppression:matching,messages:512};
}

/** Isolated read-only copy of the before snapshot's selection algorithm.
 * No legacy implementation is installed into production or used to write data. */
async function legacyCandidateIds(now:number){
 const rows=await db.memoryJobs.where('userId').equals(owner).toArray();
 const eligible=rows.filter(job=>(job.status==='queued'||job.status==='retry'||job.status==='running'&&(job.leaseUntil??0)<=now)&&job.availableAt<=now)
  .sort((a,b)=>a.availableAt-b.availableAt||a.createdAt-b.createdAt);
 const first=eligible[0];if(!first)return [];
 const audience=[...first.characterIds].sort().join('\u0000');
 return eligible.filter(job=>job.sessionId===first.sessionId&&job.sourceType===first.sourceType&&[...job.characterIds].sort().join('\u0000')===audience).slice(0,2).map(job=>job.id);
}
/** The before snapshot's jobSourcesAreCurrent, retained for read-cost evidence.
 * Failed user messages are excluded there; this fixture uses a successful user. */
async function legacySourcesCurrent(job:MemoryJob){
 const current=await db.memoryJobs.get(job.id);if(current?.status!=='running')return false;
 if((await db.characters.bulkGet(job.characterIds)).some(character=>character?.agentProfile==='secretary'))return false;
 const suppressed=await Promise.all(job.characterIds.map(id=>memorySourceTombstoneRepo.suppressedMessages(owner,id)));
 for(const id of job.sourceIds){
  const source=await db.messages.get(id),revision=job.sourceRevisions?.[id]??1;
  const session=source?await db.sessions.get(source.sessionId):undefined;
  if(suppressed.some(ids=>ids.has(id))||!source||!session||session.userId!==owner||source.sessionId!==job.sessionId||source.role!=='user'||source.failed||(source.revision??1)!==revision
   ||job.sourceType==='group'&&!job.characterIds.every(actorId=>source.witnessedBy?.includes(actorId))
   ||await memorySourceTombstoneRepo.blocksImport({userId:owner,sourceType:'message',sourceId:id,sourceRevision:revision}))return false;
 }
 return true;
}

api.runMemoryWorkerPerformance=async()=>{
 const checks:string[]=[],samples:any[]=[],workerSamples:any[]=[];
 let unexpectedFetches=0;
 window.fetch=async()=>{unexpectedFetches++;throw Error('No network allowed in memory-worker performance fixture');};
 const check=(ok:unknown,label:string)=>{if(!ok)throw Error(label);checks.push(label);};
 api.memoryWorkerPerfProgress={checks,samples,workerSamples};
 for(const [doneJobs,tombstones] of [[0,0],[10_000,0],[0,8105],[10_000,8105]]){
  const fixture=await seed(doneJobs,tombstones),now=Date.now();
  const legacyLease=await measured(()=>legacyCandidateIds(now));
  const currentLease=await measured(()=>memoryLedgerRepo.leaseNextBatch(owner,2,now,90_000));
  const jobs=currentLease.value;
  check(jobs.length===1&&jobs[0].sourceIds.join(',')===sourceId,'only selected job leased with stock '+doneJobs+'/'+tombstones);
  check(legacyLease.value.join(',')===jobs.map(job=>job.id).join(','),'same candidate result in before algorithm with stock '+doneJobs+'/'+tombstones);
  check(bodyCount(currentLease.reads,'memoryJobs')===1,'leasing reads only due selected job body with stock '+doneJobs+'/'+tombstones);
  check(kindCount(currentLease.reads,'memoryJobs','done')===0&&kindCount(currentLease.reads,'memoryJobs','future')===0&&kindCount(currentLease.reads,'memoryJobs','foreign')===0,'leasing excludes completed/future/foreign rows with stock '+doneJobs+'/'+tombstones);
  check(bodyCount(legacyLease.reads,'memoryJobs')===doneJobs+2,'before algorithm deserializes all own completed jobs with stock '+doneJobs+'/'+tombstones);
  const legacyInspect=await measured(()=>db.transaction('r',tables,()=>legacySourcesCurrent(jobs[0])));
  const currentInspect=await measured(()=>db.transaction('r',tables,()=>inspectMemoryJobSources(owner,jobs)));
  check(legacyInspect.value&&currentInspect.value.results.every(row=>!row.reason),'both source checks accept same selected source with stock '+doneJobs+'/'+tombstones);
  check(bodyCount(currentInspect.reads,'messages')===1&&currentInspect.reads['messages.getMany']?.requestedKeys===1,'current inspection reads one selected message body with stock '+doneJobs+'/'+tombstones);
  check(!currentInspect.reads['messages.query']&&!currentInspect.reads['messages.openCursor'],'inspection never scans historical message bodies with stock '+doneJobs+'/'+tombstones);
  check(currentInspect.reads['messages.count']?.calls===1&&currentInspect.reads['messages.count'].indexedCountSum===512&&currentInspect.reads['messages.count'].returnedBodies===0,'message count separates 512 matching index keys from body reads with stock '+doneJobs+'/'+tombstones);
  check(bodyCount(currentInspect.reads,'memorySourceTombstones')===0,'8105 unrelated tombstones do not deserialize during selected inspection with stock '+doneJobs+'/'+tombstones);
  check(bodyCount(legacyInspect.reads,'memorySourceTombstones')===fixture.currentActorIrrelevantTombstones,'before source check reads full actor tombstone scope with stock '+doneJobs+'/'+tombstones);
  samples.push({fixture,legacyLease:{elapsedMs:legacyLease.elapsedMs,reads:legacyLease.reads,candidateIds:legacyLease.value},currentLease:{elapsedMs:currentLease.elapsedMs,reads:currentLease.reads,leasedIds:jobs.map(job=>job.id)},legacyInspect:{elapsedMs:legacyInspect.elapsedMs,reads:legacyInspect.reads,accepted:legacyInspect.value},currentInspect:{elapsedMs:currentInspect.elapsedMs,reads:currentInspect.reads,accepted:currentInspect.value.results.every(row=>!row.reason),slices:currentInspect.value.slices}});
 }
 for(const matching of [false,true]){
  const fixture=await seed(10_000,8105,matching);let transportCalls=0;
  const worker=await measured(()=>processMemoryJobs(owner,'synthetic-not-a-credential',1,{signal:new AbortController().signal,scope:{sessionId,sourcePrefix:'worker-perf-',characterId:actor},extract:params=>extractMemories({...params,transport:async()=>{
   transportCalls++;return JSON.stringify([{content:'用户喜欢薄荷味。',sourceIds:[sourceId]}]);
  }})}));
  const memories=await db.memories.toArray();
  check(matching?worker.value===0&&transportCalls===0&&memories.length===0:worker.value===1&&transportCalls===1&&memories.length===1,'actual local worker '+(matching?'blocks suppressed source before transport':'commits exactly once under stock'));
  check(kindCount(worker.reads,'memoryJobs','done')===0&&kindCount(worker.reads,'memoryJobs','future')===0&&kindCount(worker.reads,'memoryJobs','foreign')===0,'whole worker excludes irrelevant completed/future/foreign job bodies '+matching);
  check(kindCount(worker.reads,'memorySourceTombstones','irrelevant')===0,'whole worker reads no irrelevant tombstone bodies '+matching);
  check(kindCount(worker.reads,'messages','history')===0,'whole worker reads no historical message bodies '+matching);
  check(matching?kindCount(worker.reads,'memorySourceTombstones','matching')>0:bodyCount(worker.reads,'memorySourceTombstones')===0,'matching suppression cursor/body tracking is observable '+matching);
  if(matching)check(worker.reads['memorySourceTombstones.openCursor']?.cursorValueTracking===true,'nonempty suppression cursor exposes verified value tracking');
  workerSamples.push({fixture,elapsedMs:worker.elapsedMs,completed:worker.value,transportCalls,memories:memories.map(row=>({content:row.content,sourceMessageIds:row.sourceMessageIds})),reads:worker.reads});
 }
 check(unexpectedFetches===0,'no fetch attempted outside local synthetic transport');
 return {complete:true,checks,samples,workerSamples,paidCalls:0,unexpectedFetches,
  scope:'Desktop Chromium, isolated synthetic IndexedDB; native lease and worker, local extraction transport only; not Android, real model or foreground-chat latency.',
  legacyScope:'Read-only copies of before/memory-ledger-repo.ts selection and before/memory-jobs.ts jobSourcesAreCurrent; current common repositories/schema; not a full old worker replay.',
  limitations:['Sequential single samples with JIT/order noise; durations are diagnostic, not speed guarantees.','Due-job selection still materializes all due queued/retry and available running rows before applying batch limit; completed-job fixture does not prove bounded pending-backlog cost.','Indexed count reports matching keys separately; it does not deserialize 512 message bodies.','Full worker includes repeated guards and memory-upsert operations; these costs are retained and reported, not removed for the benchmark.']};
};
