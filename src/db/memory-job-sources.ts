import {db,type MemoryJob} from './index';
import {ownsMemoryJobLease} from './memory-job-lease';
import {memorySourceTombstoneId,memorySourceTombstoneRepo} from './memory-source-tombstone-repo';
import {messageRepo} from './message-repo';

export interface MemoryJobSlice {sourceId:string;revision:number;text:string;at:number;start:number;end:number}
export interface MemoryJobSessionSnapshot {id:string;conversationVersion:number;auxiliaryRevision:number;messageCount:number}
/** One fresh batch of selected records, never a per-job archive scan. Caller
 * supplies the transaction so commit can lock validation and writes together. */
export async function inspectMemoryJobSources(userId:string,jobs:MemoryJob[],expectedSessions?:MemoryJobSessionSnapshot[]){
  const ids=[...new Set(jobs.flatMap(job=>job.sourceIds))],actors=[...new Set(jobs.flatMap(job=>job.characterIds))];
  const sessions=[...new Set(jobs.flatMap(job=>job.sessionId?[job.sessionId]:[]))];
  const [currentJobs,messages,characters,sessionRows,tombstones,suppression,counts]=await Promise.all([
    db.memoryJobs.bulkGet(jobs.map(job=>job.id)),db.messages.bulkGet(ids),db.characters.bulkGet(actors),db.sessions.bulkGet(sessions),
    db.memorySourceTombstones.bulkGet(ids.map(id=>memorySourceTombstoneId(userId,'message',id))),
    Promise.all(actors.map(async actor=>[actor,await memorySourceTombstoneRepo.selectedSuppressedMessages(userId,actor,ids)] as const)),
    Promise.all(sessions.map(id=>messageRepo.countBySession(id))),
  ]);
  const sourceMap=new Map(messages.filter(row=>!!row).map(row=>[row.id,row])),actorMap=new Map(characters.filter(row=>!!row).map(row=>[row.id,row]));
  const sessionMap=new Map(sessionRows.filter(row=>!!row).map(row=>[row.id,row])),denied=new Map(suppression);
  const tombMap=new Map(ids.map((id,i)=>[id,tombstones[i]]));
  const snapshots=sessions.map((id,i)=>({id,conversationVersion:sessionMap.get(id)?.conversation?.version??0,auxiliaryRevision:sessionMap.get(id)?.auxiliaryRevision??0,messageCount:counts[i]}));
  const results=jobs.map((job,i)=>{
    const slices:MemoryJobSlice[]=[];
    if(!ownsMemoryJobLease(currentJobs[i],job))return {job,reason:'lease-lost',slices};
    const expected=expectedSessions?.find(snapshot=>snapshot.id===job.sessionId),live=snapshots.find(snapshot=>snapshot.id===job.sessionId);
    if(expectedSessions&&(!expected||!live||live.conversationVersion!==expected.conversationVersion||live.auxiliaryRevision!==expected.auxiliaryRevision||live.messageCount!==expected.messageCount))return {job,reason:'context-changed',slices};
    const session=job.sessionId?sessionMap.get(job.sessionId):undefined;
    if(job.userId!==userId||!session||session.userId!==userId||!job.sourceIds.length||!job.characterIds.length
      ||job.characterIds.some(id=>actorMap.get(id)?.createdBy!==userId||actorMap.get(id)?.agentProfile==='secretary')
      ||(job.sourceType==='chat'&&(session.type==='group'||job.characterIds.length!==1||job.characterIds[0]!==session.characterId))
      ||(job.sourceType==='group'&&session.type!=='group'))return {job,reason:'scope-unavailable',slices};
    if(job.task!=='extract'||!['chat','group'].includes(job.sourceType))return {job,reason:'unsupported-task',slices};
    for(const id of job.sourceIds){
      const message=sourceMap.get(id),revision=job.sourceRevisions?.[id]??1;
      const raw=message?.content??'',coordinateText=job.sourceCoordinateSystem==='original'?raw:raw.trim();
      const base=job.sourceCoordinateSystem==='original'?0:raw.length-raw.trimStart().length;
      const start=job.sourceOffsets?.[id]??0,end=job.sourceEndOffsets?.[id]??coordinateText.length,tomb=tombMap.get(id);
      if(!message||message.role!=='user'||message.secretaryDispatch?.bodyOrigin==='composed'||message.sessionId!==job.sessionId
        ||!Number.isSafeInteger(revision)||revision<1||(message.revision??1)!==revision
        ||!Number.isInteger(start)||!Number.isInteger(end)||start<0||end<=start||end>coordinateText.length
        ||(job.sourceType==='group'&&!job.characterIds.every(actor=>message.witnessedBy?.includes(actor)))
        ||job.characterIds.some(actor=>denied.get(actor)?.has(id))
        ||tomb&&(tomb.status==='deleted'||revision<=tomb.sourceRevision))return {job,reason:'source-unavailable',slices:[] as MemoryJobSlice[]};
      const text=raw.slice(base+start,base+end).trim();
      if(!text)return {job,reason:'empty-source',slices:[] as MemoryJobSlice[]};
      slices.push({sourceId:id,revision,text,at:message.createdAt,start:base+start,end:base+end});
    }
    return {job,reason:undefined,slices};
  });
  return {results,snapshots,slices:results.filter(result=>!result.reason).flatMap(result=>result.slices).sort((a,b)=>a.at-b.at||(a.sourceId<b.sourceId?-1:a.sourceId>b.sourceId?1:0)||a.start-b.start)};
}
