import {db,type Message,type ContinuityThread} from './index';
import {readContinuitySourceBatch,type VerifiedContinuitySource} from '../lib/continuity-sources';
import {messageRepo} from './message-repo';
import {memorySourceTombstoneRepo} from './memory-source-tombstone-repo';
import {boundAuxiliaryHistory,MAX_AUXILIARY_MESSAGES} from '../lib/ai/history-window';
import {readRecentChatMessages,hasEligibleChatUsers} from './chat-archive-reader';

export interface ChatAuxiliarySnapshot {
  userId:string;characterId:string;sessionId:string;kind:'analysis'|'settlement';
  conversationVersion:number;auxiliaryRevision:number;checkpoint?:number;
  continuityRevision:number;
  continuity?:ContinuityThread[];
  continuitySources?:VerifiedContinuitySource[];
  /** Raw user count preserves the existing settlement checkpoint. */
  userMessageCount:number;
  /** Actual bounded source count sent to analysis, not the whole archive. */
  messageCount:number;
  /** Raw session count is an independent stale-write guard. */
  sourceMessageCount:number;messages:Message[];
}
class AuxiliaryContextChanged extends Error {}
const owned=(session:import('./index').Session|undefined,userId:string,characterId:string)=>
  !!session&&session.userId===userId&&session.characterId===characterId&&session.type!=='group';

/** One job-local snapshot, not a cached authorization decision. Candidate
 * loading pages backwards; commit checks the actual bounded source set. */
export async function captureChatAuxiliary(userId:string,characterId:string,sessionId:string,kind:ChatAuxiliarySnapshot['kind'],isCurrent:()=>boolean):Promise<ChatAuxiliarySnapshot|undefined>{
  return db.transaction('r',[db.sessions,db.characters,db.characterStates,db.messages,db.memorySourceTombstones,db.continuityThreads],async()=>{
    if(!userId||!isCurrent())return;
    const [session,character,state]=await Promise.all([db.sessions.get(sessionId),db.characters.get(characterId),db.characterStates.get([characterId,userId])]);
    if(!owned(session,userId,characterId)||character?.createdBy!==userId||character.agentProfile==='secretary')return;
    if([session!.conversation?.version??0,session!.auxiliaryRevision??0,state?.continuityRevision??0].some(version=>!Number.isSafeInteger(version)||version<0))return;
    const [eligible,userMessageCount,sourceMessageCount]=await Promise.all([
      readRecentChatMessages(userId,characterId,sessionId,{limit:MAX_AUXILIARY_MESSAGES,allowFailedUser:true,includeComposed:false}),
      messageRepo.countUserBySession(sessionId),messageRepo.countBySession(sessionId),
    ]);
    if(kind==='settlement'){
      if((session!.lastSettledUserMessageCount??-1)>=userMessageCount)return;
      const recentUsers=eligible.filter(message=>message.role==='user').length;
      // A short result already exhausted the archive; do not scan its users
      // again merely to rediscover that fewer than three were eligible.
      if(recentUsers<3&&(eligible.length<MAX_AUXILIARY_MESSAGES||!await hasEligibleChatUsers(userId,characterId,sessionId,eligible,3)))return;
    }
    const messages=boundAuxiliaryHistory(eligible);
    if(!messages.length||!isCurrent())return;
    let continuity:ContinuityThread[]|undefined,continuitySources:VerifiedContinuitySource[]|undefined;
    if(kind==='settlement'){
      const candidates=(await db.continuityThreads.where('[characterId+status]').equals([characterId,'open']).limit(8).toArray()).filter(thread=>thread.userId===userId);
      const verified=await readContinuitySourceBatch({userId,characterId},candidates,false);
      continuity=candidates.filter(thread=>verified.has(thread.id));continuitySources=[...verified.values()];
    }
    return {userId,characterId,sessionId,kind,conversationVersion:session!.conversation?.version??0,auxiliaryRevision:session!.auxiliaryRevision??0,continuityRevision:state?.continuityRevision??0,checkpoint:session!.lastSettledUserMessageCount,userMessageCount,messageCount:messages.length,sourceMessageCount,messages,continuity,continuitySources};
  });
}

async function liveSnapshot(snapshot:ChatAuxiliarySnapshot,isCurrent:()=>boolean):Promise<boolean>{
  if(!isCurrent())return false;
  const [session,character,state,sources,suppressed,messageCount]=await Promise.all([
    db.sessions.get(snapshot.sessionId),db.characters.get(snapshot.characterId),db.characterStates.get([snapshot.characterId,snapshot.userId]),db.messages.bulkGet(snapshot.messages.map(message=>message.id)),
    memorySourceTombstoneRepo.selectedSuppressedMessages(snapshot.userId,snapshot.characterId,snapshot.messages.map(message=>message.id)),
    messageRepo.countBySession(snapshot.sessionId),
  ]);
  if(!owned(session,snapshot.userId,snapshot.characterId)||character?.createdBy!==snapshot.userId||character.agentProfile==='secretary'
    ||(session!.conversation?.version??0)!==snapshot.conversationVersion||(session!.auxiliaryRevision??0)!==snapshot.auxiliaryRevision
    ||session!.lastSettledUserMessageCount!==snapshot.checkpoint||(state?.continuityRevision??0)!==snapshot.continuityRevision||messageCount!==snapshot.sourceMessageCount)return false;
  if(sources.some((source,i)=>{const expected=snapshot.messages[i];return !source||source.sessionId!==snapshot.sessionId||source.role!==expected.role||(source.failed&&source.role!=='user')||source.secretaryDispatch?.bodyOrigin==='composed'||(source.revision??1)!==(expected.revision??1)||!source.content.startsWith(expected.content)||suppressed.has(source.id);}))return false;
  if(snapshot.continuity?.length){
    const [current,verified]=await Promise.all([db.continuityThreads.bulkGet(snapshot.continuity.map(thread=>thread.id)),readContinuitySourceBatch({userId:snapshot.userId,characterId:snapshot.characterId},snapshot.continuity,false)]);
    if(current.some((thread,index)=>JSON.stringify(thread)!==JSON.stringify(snapshot.continuity![index]))
      ||snapshot.continuity.some(thread=>!verified.has(thread.id))
      ||(snapshot.continuitySources??[]).some(source=>{
        const fresh=verified.get(source.thread.id);
        return !fresh||JSON.stringify(fresh.messages)!==JSON.stringify(source.messages)||JSON.stringify(fresh.sessions)!==JSON.stringify(source.sessions);
      }))return false;
  }
  return isCurrent();
}

/** Fresh read before spending a generation; guards are repeated at commit. */
export async function validateChatAuxiliary(snapshot:ChatAuxiliarySnapshot,isCurrent:()=>boolean){
  return db.transaction('r',[db.sessions,db.characters,db.characterStates,db.messages,db.memorySourceTombstones,db.continuityThreads],()=>liveSnapshot(snapshot,isCurrent));
}

/** All local derivatives (including nested world/ledger writes) either commit
 * with the checkpoint/version or roll back. No network work belongs in apply. */
export async function commitChatAuxiliary<T>(snapshot:ChatAuxiliarySnapshot,isCurrent:()=>boolean,apply:()=>Promise<T>):Promise<{value:T}|undefined>{
  try{return await db.transaction('rw',db.tables,async()=>{
    if(!await liveSnapshot(snapshot,isCurrent))return;
    if(!Number.isSafeInteger(snapshot.auxiliaryRevision)||snapshot.auxiliaryRevision<0||snapshot.auxiliaryRevision>=Number.MAX_SAFE_INTEGER)return;
    const value=await apply();
    if(!isCurrent())throw new AuxiliaryContextChanged();
    await db.sessions.update(snapshot.sessionId,{auxiliaryRevision:snapshot.auxiliaryRevision+1,
      ...(snapshot.kind==='settlement'?{lastSettledUserMessageCount:snapshot.userMessageCount}:{})});
    if(!isCurrent())throw new AuxiliaryContextChanged();
    return {value};
  });}catch(error){if(error instanceof AuxiliaryContextChanged)return;throw error;}
}
