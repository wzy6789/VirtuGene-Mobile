import {db,type MemoryJob,type MemoryItem} from '../db';
import {memoryLedgerRepo} from '../db/memory-ledger-repo';
import {memoryRepo} from '../db/memory-repo';
import {inspectMemoryJobSources,type MemoryJobSlice,type MemoryJobSessionSnapshot} from '../db/memory-job-sources';
import {ownsMemoryJobLease} from '../db/memory-job-lease';
import {extractMemories,type ConsolidateResult} from './ai/memory-consolidator';
import {canUseAi} from './ai/availability';
import {prepareMemoryMetadata} from './memory-engine';
import {useAuthStore} from '../store/auth-store';

const runningUsers=new Set<string>();
const sourceTables=[db.memoryJobs,db.messages,db.characters,db.sessions,db.memorySourceTombstones];
class WorkerContextChanged extends Error {}

function extractionSources(slices:MemoryJobSlice[]){
  const counts=new Map<string,number>();for(const slice of slices)counts.set(slice.sourceId,(counts.get(slice.sourceId)??0)+1);
  const reserved=new Set(slices.map(slice=>slice.sourceId)),byLabel=new Map<string,MemoryJobSlice>();let sequence=0;
  const history=slices.map(slice=>{
    let label=slice.sourceId;
    if((counts.get(slice.sourceId)??0)>1){do{label='@segment:'+sequence++;}while(reserved.has(label));reserved.add(label);}
    byLabel.set(label,slice);return {role:'user',content:slice.text,sourceId:label};
  });
  return {history,byLabel};
}
function memoryRows(result:ConsolidateResult,labels:Map<string,MemoryJobSlice>,userId:string,characterId:string,sessionId:string|undefined):MemoryItem[]{
  const values=[...new Set((result.memories??[]).filter(value=>typeof value==='string').map(value=>value.trim()).filter(Boolean))].slice(0,20);
  const now=Date.now(),rows:MemoryItem[]=[];
  for(const content of values){
    const ids=result.evidence?.find(item=>item.content===content)?.sourceIds;
    if(!ids?.length||ids.some(id=>!labels.has(id)))continue;
    const support=ids.map(id=>labels.get(id)!),sourceIds=[...new Set(support.map(slice=>slice.sourceId))];
    const revisions:Record<string,number>={},starts:Record<string,number>={},ends:Record<string,number>={};
    for(const sourceId of sourceIds){
      const pieces=support.filter(slice=>slice.sourceId===sourceId).sort((a,b)=>a.start-b.start);
      revisions[sourceId]=pieces[0].revision;starts[sourceId]=pieces[0].start;ends[sourceId]=pieces[0].end;
      // Current provenance stores one interval per message. Reject a gap rather
      // than silently claiming unseen text between two referenced fragments.
      for(const piece of pieces.slice(1)){
        if(piece.start>ends[sourceId])throw Error('memory:noncontiguous_evidence');
        ends[sourceId]=Math.max(ends[sourceId],piece.end);
      }
    }
    rows.push({id:crypto.randomUUID(),characterId,userId,content,type:'auto',...prepareMemoryMetadata(content,{confidence:.9}),createdAt:now+rows.length,updatedAt:now+rows.length,
      sourceSessionId:sessionId,sourceMessageIds:sourceIds,sourceMessageRevisions:revisions,sourceMessageOffsets:starts,sourceMessageEndOffsets:ends,
      sourceEvidenceMode:sourceIds.length===1?'independent':'dependent',confidence:.9});
  }
  if(values.length&&!rows.length)throw Error('memory:unsupported_evidence');
  return rows;
}

/** Durable extraction: lease/source validation, derived memories and completion
 * share a native transaction. A stale writer never cleans up another lease's work. */
export async function processMemoryJobs(userId:string,apiKey:string|null,maxBatches=2,
  options?:{extract:typeof extractMemories;scope:{sessionId:string;sourcePrefix:string;characterId?:string};signal:AbortSignal;maxJobs?:number}):Promise<number>{
  let accountChanged=false;
  const accountCurrent=()=>!accountChanged&&useAuthStore.getState().userId===userId;
  const mayWork=()=>accountCurrent()&&!options?.signal.aborted;
  if(!userId||!mayWork()||(!options&&!canUseAi())||runningUsers.has(userId))return 0;
  // Returning to A after switching A -> B -> A does not revive A's old work.
  const unsubscribe=useAuthStore.subscribe((state,previous)=>{if(state.userId!==previous.userId)accountChanged=true;});
  runningUsers.add(userId);let completed=0;
  const inspect=(jobs:MemoryJob[],expected?:MemoryJobSessionSnapshot[])=>db.transaction('r',sourceTables,()=>inspectMemoryJobSources(userId,jobs,expected));
  const cancelInvalid=async(jobs:MemoryJob[])=>db.transaction('rw',sourceTables,async()=>{
    if(!accountCurrent())return;
    const current=await inspectMemoryJobSources(userId,jobs);
    for(const item of current.results)if(item.reason&&item.reason!=='lease-lost')await memoryLedgerRepo.cancelJob(item.job.id,{reason:item.reason},item.job);
    if(!accountCurrent())throw new WorkerContextChanged();
  });
  try{
    for(let batch=0;batch<Math.max(1,maxBatches)&&mayWork();batch++){
      const jobs=await memoryLedgerRepo.leaseNextBatch(userId,Math.max(1,Math.min(8,options?.maxJobs??8)),Date.now(),90000,options?.scope);
      if(!jobs.length)break;
      try{
        const prepared=await inspect(jobs);
        await cancelInvalid(jobs);
        const validJobs=prepared.results.filter(item=>!item.reason).map(item=>item.job);
        if(!validJobs.length||!mayWork())continue;
        const sources=extractionSources(prepared.slices);
        const beforeRequest=async()=>{
          if(!mayWork())throw Error('memory:context_changed');
          const live=await inspect(validJobs,prepared.snapshots);
          if(live.results.some(item=>item.reason)||!mayWork())throw Error('memory:context_changed');
        };
        await beforeRequest();
        const result=await(options?.extract??extractMemories)({apiKey:apiKey??'',history:sources.history,beforeRequest});
        if(result.error)throw Error(result.error);
        const rows=validJobs[0].characterIds.flatMap(characterId=>memoryRows(result,sources.byLabel,userId,characterId,validJobs[0].sessionId));
        const committed=await db.transaction('rw',db.tables,async()=>{
          if(!mayWork())throw new WorkerContextChanged();
          const live=await inspectMemoryJobSources(userId,validJobs,prepared.snapshots);
          if(live.results.some(item=>item.reason))throw new WorkerContextChanged();
          await memoryRepo.createMany(rows);
          if(!mayWork())throw new WorkerContextChanged();
          const after=await inspectMemoryJobSources(userId,validJobs,prepared.snapshots);
          if(after.results.some(item=>item.reason))throw new WorkerContextChanged();
          for(const job of validJobs)if(!await memoryLedgerRepo.finishJob(job.id,{memoryCount:rows.filter(row=>row.characterId===validJobs[0].characterIds[0]).length,evidenceIds:job.sourceIds,evidenceRevisions:job.sourceRevisions},job))throw new WorkerContextChanged();
          if(!mayWork())throw new WorkerContextChanged();
          return validJobs.length;
        });
        completed+=committed;
      }catch(error){
        if(!accountCurrent())break;
        const reason=error instanceof Error?error.message:'memory-extraction-failed';
        await db.transaction('rw',sourceTables,async()=>{
          if(!accountCurrent())return;
          const current=await inspectMemoryJobSources(userId,jobs);
          for(const item of current.results){
            if(!ownsMemoryJobLease(await db.memoryJobs.get(item.job.id),item.job))continue;
            if(item.reason&&item.reason!=='lease-lost')await memoryLedgerRepo.cancelJob(item.job.id,{reason:item.reason},item.job);
            else await memoryLedgerRepo.retryJob(item.job.id,reason,item.job);
          }
          if(!accountCurrent())throw new WorkerContextChanged();
        });
        // Source/lease conflicts never buy another generation in this invocation.
        break;
      }
    }
  }catch(error){if(!(error instanceof WorkerContextChanged))throw error;}
  finally{unsubscribe();runningUsers.delete(userId);}
  return completed;
}
