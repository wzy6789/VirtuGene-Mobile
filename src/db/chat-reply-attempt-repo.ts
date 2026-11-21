import {db,type Message} from './index';
import {messageRepo,sameMessageFailureSource} from './message-repo';
import {memorySourceTombstoneRepo} from './memory-source-tombstone-repo';
import {invalidateUnpinnedMemoriesForMessages} from './memory-invalidation';
import {invalidateSessionSummarySources} from './session-summary-repo';
import {hasSettledReplyDelivery} from '../lib/chat/reply-delivery';

/** Idempotence identity, not an authorization cache. Ownership and withdrawals
 * are still read in the current native transaction before any reuse. */
export async function replyInputKey(userId:string,characterId:string,source:Message,apiMessage:string,image?:string){
 const dispatch=source.secretaryDispatch;
 const value=JSON.stringify([userId,characterId,source.id,source.sessionId,source.role,source.revision??1,source.createdAt,source.content,source.image??null,dispatch?[dispatch.taskId,dispatch.assistantName,dispatch.bodyOrigin]:null,apiMessage,image??null]);
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
 return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
}
export function completeReplyAttempt(rows:Message[],key:string):Message[]|undefined{
 const matching=rows.filter(row=>row.replyInputKey===key&&row.role==='assistant'&&hasSettledReplyDelivery(row)&&row.replyCompletion==='complete'&&!row.failed&&!row.interrupted&&!row.stopped);
 if(!matching.length)return;
 const latest=matching.slice().sort((a,b)=>b.createdAt-a.createdAt||b.id.localeCompare(a.id))[0];
 const batch=latest.replyBatchId?matching.filter(row=>row.replyBatchId===latest.replyBatchId).sort((a,b)=>(a.replyBatchIndex??-1)-(b.replyBatchIndex??-1)):[latest];
 if(latest.replyBatchId&&(!Number.isInteger(latest.replyBatchSize)||latest.replyBatchSize!<1||latest.replyBatchSize!>4||batch.length!==latest.replyBatchSize
  ||batch.some((row,index)=>row.replyBatchIndex!==index||row.replyBatchSize!==batch.length)))return;
 return batch;
}
type Principal={userId:string;characterId:string;isCurrent:()=>boolean};
/** Called inside the attempt's native writer transaction. Retire the whole
 * batch together; derived-memory reads must not repeat for every bubble. */
export async function retireReplySources(principal:Principal,sessionId:string,rows:Message[],status:'superseded'|'deleted'){
 if(!rows.length)return;
 const ids=rows.map(row=>row.id),idSet=new Set(ids);
 await invalidateUnpinnedMemoriesForMessages(principal.userId,ids);
 await invalidateSessionSummarySources(sessionId,ids);
 await memorySourceTombstoneRepo.recordMany(rows.map(row=>({userId:principal.userId,characterId:principal.characterId,sourceType:'message' as const,sourceId:row.id,sourceRevision:row.revision??1,status,suppressedMessageIds:[row.id]})));
 await db.memoryJobs.where('userId').equals(principal.userId).filter(job=>job.sourceIds.some(id=>idSet.has(id))&&job.status!=='done').modify({status:'cancelled',leaseUntil:undefined,updatedAt:Date.now()});
 if(status==='deleted'){
  await db.voiceCalls.where('sessionId').equals(sessionId).filter(call=>call.messageIds.some(id=>idSet.has(id))).delete();
  await db.secretaryTasks.where('messageId').anyOf(ids).filter(task=>task.userId===principal.userId).delete();
  await db.messages.bulkDelete(ids);
 }
 if(!principal.isCurrent())throw Error('chat:account_changed');
}
async function readAttempt(principal:Principal,source:Message){
 const [session,actor,current,rows]=await Promise.all([db.sessions.get(source.sessionId),db.characters.get(principal.characterId),db.messages.get(source.id),db.messages.where('replyToUserMessageId').equals(source.id).limit(65).toArray()]);
 if(!principal.isCurrent()||!session||session.userId!==principal.userId||session.characterId!==principal.characterId||session.type==='group'
  ||actor?.createdBy!==principal.userId||actor.agentProfile==='secretary'||!sameMessageFailureSource(current,source))throw Error('chat:source_changed');
 if(rows.length>64||rows.some(row=>row.sessionId!==source.sessionId||row.role!=='assistant'))throw Error('chat:reply_changed');
 const [suppressed,withdrawn]=await Promise.all([
  memorySourceTombstoneRepo.selectedSuppressedMessages(principal.userId,principal.characterId,[source.id,...rows.map(row=>row.id)]),
  memorySourceTombstoneRepo.blocksImports([current!,...rows].map(row=>({userId:principal.userId,sourceType:'message',sourceId:row.id,sourceRevision:row.revision??1}))),
 ]);
 if(withdrawn[0]||suppressed.has(source.id)||!principal.isCurrent())throw Error('chat:source_changed');
 return {rows,live:rows.filter((row,index)=>!withdrawn[index+1]&&!suppressed.has(row.id)),current:current!};
}
/** An explicit resend retires its old attempt before compiling context. Its
 * readable prefix stays stored until a replacement is durably published. */
export async function prepareReplyAttempt(principal:Principal,source:Message,key:string){
 const snapshot=await db.transaction('r',db.sessions,db.characters,db.messages,db.memorySourceTombstones,()=>readAttempt(principal,source));
 if(!snapshot.rows.length&&!snapshot.current.failed)return {prior:[] as Message[],reused:undefined as Message[]|undefined,clearedFailure:false};
 return db.transaction('rw',db.tables,async()=>{
  const current=await readAttempt(principal,source);
  const reused=completeReplyAttempt(current.live,key);
  if(!reused)await retireReplySources(principal,source.sessionId,current.rows,'superseded');
  if(current.current.failed)await messageRepo.markFailed(source.id,false);
  if(!principal.isCurrent())throw Error('chat:account_changed');
  return {prior:reused?[]:current.rows,reused,clearedFailure:!!current.current.failed};
 });
}
