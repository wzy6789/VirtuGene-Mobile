import type {MemoryJob} from './index';
const entries=(record?:Record<string,number>)=>Object.entries(record??{}).sort(([a],[b])=>a<b?-1:a>b?1:0);
const workKey=(job:MemoryJob)=>JSON.stringify([job.userId,job.sessionId,job.task,job.sourceType,job.sourceCoordinateSystem,[...job.characterIds].sort(),[...job.sourceIds].sort(),entries(job.sourceRevisions),entries(job.sourceOffsets),entries(job.sourceEndOffsets)]);

/** A running flag alone does not identify the worker that owns the work. */
export function ownsMemoryJobLease(current:MemoryJob|undefined,leased:MemoryJob,now=Date.now()):boolean{
  return !!current&&current.id===leased.id&&current.status==='running'&&!!leased.leaseToken&&current.leaseToken===leased.leaseToken
    &&current.attempts===leased.attempts&&current.leaseUntil===leased.leaseUntil&&(current.leaseUntil??0)>now&&workKey(current)===workKey(leased);
}
