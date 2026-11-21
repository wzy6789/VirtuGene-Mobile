import {db,type ContinuityChatEvidence,type ContinuityThread,type Message,type Session,type WorldEvent} from '../db';
import {memorySourceTombstoneRepo} from '../db/memory-source-tombstone-repo';
import {withMemorySourceSnapshot} from './memory-source-snapshot';
import {isVisibleToCharacter} from './world/visibility';
import {parseContinuityReopenRequest} from './chat-topic-controls';

const MAX_SOURCES=6;
const sameIds=(a:string[],b:string[])=>JSON.stringify([...new Set(a)].sort())===JSON.stringify([...new Set(b)].sort());
const refKey=(ref:ContinuityChatEvidence['sources'][number])=>JSON.stringify([ref.messageId,ref.sessionId,ref.revision,ref.start,ref.end]);
export function continuityEvidenceSources(evidence:ContinuityChatEvidence|undefined,ids:string[]|undefined){
  if(!evidence||evidence.kind!=='private-chat'||evidence.domain!=='unclassified'
    ||!Array.isArray(evidence.sources)||!evidence.sources.length||evidence.sources.length>MAX_SOURCES
    ||!Array.isArray(ids)||!sameIds(ids,evidence.sources.map(ref=>ref?.messageId)))return;
  if(new Set(evidence.sources.map(ref=>ref?.messageId)).size!==evidence.sources.length)return;
  if(evidence.sources.some(ref=>!ref||typeof ref.messageId!=='string'||!ref.messageId||typeof ref.sessionId!=='string'||!ref.sessionId
    ||!Number.isSafeInteger(ref.revision)||ref.revision<1||!Number.isSafeInteger(ref.start)||!Number.isSafeInteger(ref.end)
    ||ref.start!==0||ref.end<=ref.start||ref.end>4000))return;
  return evidence.sources;
}

/** The input is the bounded snapshot actually given to settlement, not a fresh
 * full message or an LLM-supplied source span. Failed transport does not retract
 * a user's direct words. Assistant/composed text never supplies user evidence. */
export function captureContinuityChatEvidence(messages:Message[],ids:string[]):ContinuityChatEvidence|undefined{
  const unique=[...new Set(ids)];if(!unique.length||unique.length>MAX_SOURCES)return;
  const selected=unique.map(id=>messages.find(message=>message.id===id));
  if(selected.some(row=>!row||row.role!=='user'||row.secretaryDispatch?.bodyOrigin==='composed'||!row.content.length||row.content.length>4000))return;
  const evidence:ContinuityChatEvidence={kind:'private-chat',domain:'unclassified',sources:selected.map(row=>({messageId:row!.id,sessionId:row!.sessionId,revision:row!.revision??1,start:0,end:row!.content.length}))};
  return continuityEvidenceSources(evidence,unique)?evidence:undefined;
}

/** A model-selected live sentence is not permission to edit a manual record.
 * Accept a narrow, explicit record-control request; quotes around the title are
 * allowed, but quoted commands, questions, negation and hypothetical text are
 * not promoted into actions. Other meanings remain conversation, not writes. */
export function explicitlyCompletesManualThread(title:string,text:string){
  const compact=(value:string)=>value.replace(/\s/gu,'');
  const name=compact(title);if(!name)return false;
  let command=compact(text);
  for(const [left,right] of [['“','”'],['「','」'],['『','』'],['"','"'],["'","'"]]){
    command=command.split(left+name+right).join(name);
  }
  const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  return new RegExp(`^(?:请帮我|帮我|请)?(?:把|将)${escaped}(?:这(?:条|项)(?:记录|事项|约定|计划))?(?:标记|设置|设|改)(?:为|成)(?:已完成|完成)(?:了)?[。！!]*$`,'u').test(command);
}

/** Never silently discard an old premise or re-certify its new revision. */
export function mergeContinuityChatEvidence(previous:ContinuityThread,incoming:{sourceMessageIds?:string[];sourceEvidence?:ContinuityChatEvidence}){
  const before=continuityEvidenceSources(previous.sourceEvidence,previous.sourceMessageIds),after=continuityEvidenceSources(incoming.sourceEvidence,incoming.sourceMessageIds);
  if(!before||!after||previous.sourceSceneId||previous.sourceWorldEventId)return;
  const sources=[...new Map([...before,...after].map(ref=>[refKey(ref),ref])).values()];
  if(sources.length>MAX_SOURCES||new Set(sources.map(ref=>ref.messageId)).size!==sources.length)return;
  return {kind:'private-chat' as const,domain:'unclassified' as const,sources};
}

export interface VerifiedContinuitySource {
  thread:ContinuityThread;
  kind:'manual'|'private-chat'|'world';
  messages:Message[];
  sessions:Session[];
  dependencies?:Array<{table:string;row:{id:string}}>;
  parents?:VerifiedContinuitySource[];
}

/** One invocation is one fresh selected check. No history scans, source
 * inference for legacy rows, or authorization shared between requests. */
export async function readContinuitySourceBatch(principal:{userId:string;characterId?:string},threads:ContinuityThread[],allowWorldSources=true){
  const result=new Map<string,VerifiedContinuitySource>();
  const scoped=threads.filter(thread=>thread.userId===principal.userId&&(!principal.characterId||thread.characterId===principal.characterId));
  const withdrawn=await memorySourceTombstoneRepo.blocksImports(scoped.map(thread=>({userId:principal.userId,sourceType:'continuityThread' as const,sourceId:thread.id,sourceRevision:thread.updatedAt??thread.createdAt})));
  const candidates=scoped.filter((_,index)=>!withdrawn[index]);
  const privateRows:Array<{thread:ContinuityThread;refs:NonNullable<ReturnType<typeof continuityEvidenceSources>>;kind:'manual'|'private-chat'}>=[];
  const worldRows:ContinuityThread[]=[];
  for(const thread of candidates){
    let controls:NonNullable<ReturnType<typeof continuityEvidenceSources>>=[];
    if(thread.reopenEvidence!==undefined){
      if(!Array.isArray(thread.reopenEvidence?.sources))continue;
      const refs=continuityEvidenceSources(thread.reopenEvidence,thread.reopenEvidence.sources.map(ref=>ref?.messageId));
      if(!refs||refs.length!==1)continue;
      controls=refs;
    }
    if(thread.origin==='user'){
      if(controls.length)privateRows.push({thread,refs:controls,kind:'manual'});
      else result.set(thread.id,{thread,kind:'manual',messages:[],sessions:[]});
    }
    else if(thread.sourceSceneId||thread.sourceWorldEventId){
      // Never relabel these sources as private-chat evidence. Check their
      // existing scene/world visibility independently, including parent events.
      if(!controls.length&&allowWorldSources&&!thread.sourceEvidence&&!thread.sourceMessageIds?.length)worldRows.push(thread);
    }else{
      const refs=continuityEvidenceSources(thread.sourceEvidence,thread.sourceMessageIds);
      if(refs)privateRows.push({thread,refs:[...new Map([...refs,...controls].map(ref=>[refKey(ref),ref])).values()],kind:'private-chat'});
    }
  }
  if(worldRows.length)for(const [id,source] of await readExternalThreadSources(principal.userId,worldRows))result.set(id,source);
  if(!privateRows.length)return result;
  const allRefs=privateRows.flatMap(row=>row.refs),messageIds=[...new Set(allRefs.map(ref=>ref.messageId))],sessionIds=[...new Set(allRefs.map(ref=>ref.sessionId))];
  const characters=[...new Set(privateRows.map(row=>row.thread.characterId))];
  const [messages,sessions,blocked,suppressions]=await Promise.all([
    db.messages.bulkGet(messageIds),db.sessions.bulkGet(sessionIds),
    memorySourceTombstoneRepo.blocksImports(allRefs.map(ref=>({userId:principal.userId,sourceType:'message' as const,sourceId:ref.messageId,sourceRevision:ref.revision}))),
    Promise.all(characters.map(async characterId=>[characterId,await memorySourceTombstoneRepo.selectedSuppressedMessages(principal.userId,characterId,[...new Set(privateRows.filter(row=>row.thread.characterId===characterId).flatMap(row=>row.refs.map(ref=>ref.messageId)))])] as const)),
  ]);
  const byMessage=new Map(messageIds.map((id,index)=>[id,messages[index]])),bySession=new Map(sessionIds.map((id,index)=>[id,sessions[index]]));
  const denied=new Set(allRefs.filter((_,index)=>blocked[index]).map(refKey)),suppressed=new Map(suppressions);
  for(const {thread,refs,kind} of privateRows){
    if(!refs.every(ref=>{
      const message=byMessage.get(ref.messageId),session=bySession.get(ref.sessionId);
      return message&&session&&session.userId===principal.userId&&session.characterId===thread.characterId&&session.type!=='group'
        &&message.sessionId===ref.sessionId&&message.role==='user'&&message.secretaryDispatch?.bodyOrigin!=='composed'
        &&(message.revision??1)===ref.revision&&message.content.length>=ref.end&&!denied.has(refKey(ref))&&!suppressed.get(thread.characterId)?.has(message.id);
    }))continue;
    if(thread.reopenEvidence?.sources.some(ref=>parseContinuityReopenRequest(byMessage.get(ref.messageId)!.content.slice(ref.start,ref.end))?.title!==thread.title))continue;
    result.set(thread.id,{thread,kind,messages:refs.map(ref=>byMessage.get(ref.messageId)!),sessions:[...new Set(refs.map(ref=>bySession.get(ref.sessionId)!))]});
  }
  return result;
}

/** A derived event cannot substitute its own unchanged row for live evidence. */
export async function readContinuityEventSources(events:WorldEvent[],allowWorldSources=true){
  const selected=events.filter(event=>event.sourceType==='continuity');
  const threads=await db.continuityThreads.bulkGet([...new Set(selected.map(event=>event.sourceId))]);
  const present=threads.filter((thread):thread is ContinuityThread=>!!thread),byThread=new Map(present.map(thread=>[thread.id,thread]));
  const byOwner=await Promise.all([...new Set(selected.map(event=>event.userId))].map(async userId=>[userId,await readContinuitySourceBatch({userId},present.filter(thread=>thread.userId===userId),allowWorldSources)] as const));
  const verified=new Map(byOwner),result=new Map<string,VerifiedContinuitySource>();
  for(const event of selected){
    const thread=byThread.get(event.sourceId),source=thread&&verified.get(event.userId)?.get(thread.id);
    if(!thread||!source||thread.userId!==event.userId||event.title!==thread.title||event.summary!==(thread.detail??'')
      ||event.resolved!==(thread.status==='done')||event.meta?.threadStatus!==thread.status||event.meta?.kind!==thread.kind
      ||(event.meta?.dueAt??undefined)!==(thread.dueAt||undefined))continue;
    result.set(event.id,source);
  }
  return result;
}

async function readExternalThreadSources(userId:string,threads:ContinuityThread[]){
  const sceneIds=[...new Set(threads.flatMap(thread=>thread.sourceSceneId?[thread.sourceSceneId]:[]))],eventIds=[...new Set(threads.flatMap(thread=>thread.sourceWorldEventId?[thread.sourceWorldEventId]:[]))];
  const [scenes,events]=await Promise.all([db.worldScenes.bulkGet(sceneIds),db.worldEvents.bulkGet(eventIds)]);
  const actualScenes=scenes.filter((row):row is NonNullable<typeof row>=>!!row&&row.userId===userId),actualEvents=events.filter((row):row is NonNullable<typeof row>=>!!row&&row.userId===userId);
  const [worlds,knowledge,parents]=await Promise.all([
    db.worlds.bulkGet([...new Set([...actualScenes,...actualEvents].map(row=>row.worldId))]),
    db.characterKnowledge.where('[characterId+eventId]').anyOf(threads.filter(thread=>thread.sourceWorldEventId).map(thread=>[thread.characterId,thread.sourceWorldEventId!])).toArray(),
    // One bounded parent step, private/manual only. Cycles and external chains
    // are not guessed into provenance; retain their UI records instead.
    readContinuityEventSources(actualEvents,false),
  ]);
  const byScene=new Map(actualScenes.map(row=>[row.id,row])),byEvent=new Map(actualEvents.map(row=>[row.id,row])),byWorld=new Map(worlds.filter((row):row is NonNullable<typeof row>=>!!row).map(row=>[row.id,row]));
  const result=new Map<string,VerifiedContinuitySource>();
  for(const thread of threads){
    const scene=thread.sourceSceneId?byScene.get(thread.sourceSceneId):undefined,event=thread.sourceWorldEventId?byEvent.get(thread.sourceWorldEventId):undefined;
    if(thread.sourceSceneId&&(!scene||scene.userId!==userId||!scene.characterIds.includes(thread.characterId)||byWorld.get(scene.worldId)?.userId!==userId))continue;
    const known=event&&knowledge.find(row=>row.userId===userId&&row.worldId===event.worldId&&row.eventId===event.id&&row.characterId===thread.characterId&&row.canMention&&row.knowledgeLevel==='full');
    if(thread.sourceWorldEventId&&(!event||event.userId!==userId||byWorld.get(event.worldId)?.userId!==userId||!isVisibleToCharacter(event,thread.characterId)||!known||scene&&scene.worldId!==event.worldId||event.sourceType==='diary'
      ||event.sourceType==='continuity'&&!parents.has(event.id)))continue;
    result.set(thread.id,{thread,kind:'world',messages:[],sessions:[],parents:event&&parents.has(event.id)?[parents.get(event.id)!]:[],dependencies:[
      ...(scene?[{table:'worldScenes',row:scene},{table:'worlds',row:byWorld.get(scene.worldId)!}]:[]),
      ...(event?[{table:'worldEvents',row:event},{table:'worlds',row:byWorld.get(event.worldId)!},...(known?[{table:'characterKnowledge',row:known}]:[])]:[]),
    ]});
  }
  return result;
}

export function withContinuitySourceSnapshots<T extends object>(value:T,source:VerifiedContinuitySource){
  withMemorySourceSnapshot(value,'continuityThreads',source.thread);
  for(const message of source.messages)withMemorySourceSnapshot(value,'messages',message);
  for(const session of source.sessions)withMemorySourceSnapshot(value,'sessions',session);
  for(const dependency of source.dependencies??[])withMemorySourceSnapshot(value,dependency.table,dependency.row);
  for(const parent of source.parents??[])withContinuitySourceSnapshots(value,parent);
  return value;
}

export function continuityReferenceText(source:VerifiedContinuitySource){
  const prefix=source.kind==='manual'?'用户为你手动记录的事项':source.kind==='private-chat'?'从你们私聊中提取的事项线索（未分类语境，不自动认定现实约定）':'星域中的事项线索';
  const thread=source.thread;
  const status={open:'未完成',done:'已完成',dropped:'暂放',archived:'自动收起'}[thread.status];
  return `${prefix}「${thread.title}」${thread.detail?`：${thread.detail}`:''}；记录状态：${status}。只在相关时承接，不反复追问。`;
}
