import {db} from './index';
import type {ChatConversationState} from '../lib/chat-conversation-state';
import type {TopicEvidence} from '../lib/chat-topic-outcomes';
import {memorySourceTombstoneRepo} from './memory-source-tombstone-repo';
import {replyRecordSources,supportsTopicReply,TOPIC_REPLIES_PER_TOPIC,TOPIC_REPLIES_TOTAL,type TopicReplyRecord} from '../lib/chat-topic-replies';
import {supportsScopedFact} from '../lib/chat-scoped-facts';
import {parseContinuityReopenRequest,isContinuityFocusResume,categoryTopicControls} from '../lib/chat-topic-controls';
import {advanceExplicitTopics} from '../lib/chat-topic-outcomes';

export interface ConversationPrincipal {
  sessionId:string;userId:string;characterId:string;
  /** Read the current account identity, never a cached authorization decision. */
  isCurrent?:()=>boolean;
  currentSource?:TopicEvidence;
}
const key=(ref:TopicEvidence)=>JSON.stringify([ref.messageId,ref.revision,ref.start,ref.end]);
function evidence(next:ChatConversationState,extra?:TopicEvidence):TopicEvidence[]|undefined{
  if((next.topics?.length??0)>8)return undefined;
  const refs:TopicEvidence[]=[];
  if(next.ambiguousTopic){
    if(typeof next.ambiguousTopic.reason!=='string'||!next.ambiguousTopic.reason||next.ambiguousTopic.reason.length>160||!next.ambiguousTopic.message)return;
    refs.push(next.ambiguousTopic.message);
  }
  if(next.topicPauses!==undefined){
    if(!Array.isArray(next.topicPauses)||next.topicPauses.length>4)return;
    for(const pause of next.topicPauses){
      if(!pause||!['exam','meal','conflict','plan','preference','residence'].includes(pause.category)
        ||!['user-reality','roleplay','story','character'].includes(pause.domain)||!pause.source)return;
      refs.push(pause.source);
    }
    if(new Set(next.topicPauses.map(pause=>pause.category+'@'+pause.domain)).size!==next.topicPauses.length)return;
  }
  for(const topic of next.topics??[]){
    if(!topic.anchorSource||!Array.isArray(topic.source)||topic.source.length>6||!topic.slots||topic.scope!=='session'
      ||typeof topic.id!=='string'||typeof topic.label!=='string'||topic.label.length>60
      ||!['exam','meal','conflict','plan','preference','residence'].includes(topic.kind)||!['pending','answered','resolved','cancelled','deferred'].includes(topic.outcome)
      ||!Number.isFinite(topic.lastEventOrder)||!Number.isFinite(topic.observedAt)
      ||!['user-reality','roleplay','story','character'].includes(topic.domain)
      ||Object.keys(topic.slots).length>5||(topic.slotHistory?.length??0)>4)return undefined;
    const fields=topic.kind==='preference'?['object','period','stance']:topic.kind==='residence'?['place','period']:['date','time','transport','place','dish'];
    if([...Object.keys(topic.slots),...Object.keys(topic.unresolvedSlots??{}),...topic.slotHistory.map(slot=>slot.field)].some(field=>!fields.includes(field)))return undefined;
    const declared=new Set(topic.source.map(key));
    const required=[topic.anchorSource,...topic.outcomeSource,...Object.values(topic.slots).flatMap(slot=>slot.source),...topic.slotHistory.flatMap(slot=>slot.source),...Object.values(topic.unresolvedSlots??{}).flat(),...(topic.confirmationSource?[topic.confirmationSource]:[])];
    if(required.some(ref=>!declared.has(key(ref))))return undefined;
    refs.push(...required);
  }
  if(next.appliedThrough)refs.push(next.appliedThrough);
  if(next.continuityFocus){
    const focus=next.continuityFocus;
    if(typeof focus.threadId!=='string'||!focus.threadId||focus.threadId.length>160||focus.domain!=='user-reality'
      ||!focus.source||(focus.paused!==undefined&&typeof focus.paused!=='boolean'))return;
    refs.push(focus.source,...(focus.activationSource?[focus.activationSource]:[]));
  }
  if(extra)refs.push(extra);
  const unique=[...new Map(refs.map(ref=>[key(ref),ref])).values()];
  if(unique.length>50||unique.some(ref=>!ref.messageId||!Number.isInteger(ref.revision)||ref.revision<1||!Number.isInteger(ref.start)||!Number.isInteger(ref.end)||ref.start<0||ref.end<=ref.start||ref.end>4000))return undefined;
  return unique;
}
class PrincipalChanged extends Error {}

function replyEntries(next:ChatConversationState){
  const entries:Array<{topic:NonNullable<ChatConversationState['topics']>[number];record:TopicReplyRecord;refs:TopicEvidence[]}>=[];
  for(const topic of next.topics??[]){
    if(topic.responses===undefined)continue;
    if(!Array.isArray(topic.responses)||topic.responses.length>TOPIC_REPLIES_PER_TOPIC)return;
    for(const record of topic.responses){const refs=replyRecordSources(topic,record);if(!refs)return;entries.push({topic,record,refs});}
  }
  return entries.length<=TOPIC_REPLIES_TOTAL&&new Set(entries.map(entry=>entry.record.id)).size===entries.length
    &&new Set(entries.map(entry=>entry.record.userSource.messageId+'@'+entry.record.userSource.revision+':'+(entry.record.origin??'user-reply'))).size===entries.length?entries:undefined;
}
const uniqueRefs=(refs:TopicEvidence[])=>[...new Map(refs.map(ref=>[key(ref),ref])).values()];
function replyUserRefs(record:TopicReplyRecord){
  return [record.userSource,...record.acts.flatMap(act=>act.kind==='answered-slot'?act.slotSource
    :act.kind==='user-answered-slot'?[...act.slotSource,act.questionUserSource]
    :act.kind==='gave-guidance'||act.kind==='care'?act.premise:[])];
}

type SourceRow=import('./index').Message;
async function readSelected(principal:ConversationPrincipal,refs:TopicEvidence[]){
  const ids=[...new Set(refs.map(ref=>ref.messageId))];
  const [sources,suppressed]=await Promise.all([db.messages.bulkGet(ids),memorySourceTombstoneRepo.selectedSuppressedMessages(principal.userId,principal.characterId,ids)]);
  const originals=sources.filter(source=>source!==undefined);
  const withdrawn=await memorySourceTombstoneRepo.blocksImports(originals.map(source=>({userId:principal.userId,sourceType:'message' as const,sourceId:source.id,sourceRevision:source.revision??1})));
  originals.forEach((source,index)=>{if(withdrawn[index])suppressed.add(source.id);});
  return {byId:new Map(sources.filter(source=>source!==undefined).map(source=>[source.id,source])),suppressed};
}
function supported(principal:ConversationPrincipal,next:ChatConversationState,refs:TopicEvidence[],selected:{byId:Map<string,SourceRow>;suppressed:Set<string>}):boolean{
  for(const ref of refs){
    const source=selected.byId.get(ref.messageId);
    if(!source||source.sessionId!==principal.sessionId||source.role!=='user'||source.secretaryDispatch?.bodyOrigin==='composed'||(source.revision??1)!==ref.revision||ref.end>source.content.length||selected.suppressed.has(source.id))return false;
  }
  for(const pause of next.topicPauses??[]){
    const original=selected.byId.get(pause.source.messageId);
    if(!original||!categoryTopicControls(original.content).some(control=>control.category===pause.category&&control.action==='pause'
      &&control.start===pause.source.start&&control.end===pause.source.end))return false;
  }
  if(next.ambiguousTopic){
    const ambiguity=next.ambiguousTopic,source=selected.byId.get(ambiguity.message.messageId);
    if(!source||!([...new Set((next.topics??[]).map(topic=>topic.domain))].some(domain=>{
      const repro=advanceExplicitTopics({...next,ambiguousTopic:undefined,appliedThrough:undefined},{message:source,domain});
      return repro.ambiguousTopic?.reason===ambiguity.reason&&key(repro.ambiguousTopic.message)===key(ambiguity.message);
    })))return false;
  }
  if(next.continuityFocus){
    const focus=next.continuityFocus,original=selected.byId.get(focus.source.messageId);
    if(!original||!parseContinuityReopenRequest(original.content.slice(focus.source.start,focus.source.end)))return false;
    if(focus.activationSource){
      const ref=focus.activationSource,activation=selected.byId.get(ref.messageId);
      if(!activation||!isContinuityFocusResume(activation.content.slice(ref.start,ref.end)))return false;
    }
  }
  for(const topic of next.topics??[])for(const slot of [...Object.values(topic.slots),...topic.slotHistory]){
    if(!Number.isFinite(slot.observedAt)||!Number.isFinite(new Date(slot.observedAt).getTime())||(slot.utcOffsetMinutes!==undefined&&(!Number.isInteger(slot.utcOffsetMinutes)||Math.abs(slot.utcOffsetMinutes)>840)))return false;
    if(!slot.source.some(ref=>selected.byId.get(ref.messageId)?.createdAt===slot.observedAt))return false;
    if(typeof slot.value!=='string'||!slot.value||slot.value.length>160||!slot.source.some(ref=>selected.byId.get(ref.messageId)?.content.slice(ref.start,ref.end).includes(slot.value)))return false;
  }
  if((next.topics??[]).some(topic=>!supportsScopedFact(topic,selected.byId)))return false;
  return true;
}

/** Batch revalidate stored topics before showing them to a model. Invalid
 * records are omitted individually; surviving records are not re-inferred
 * from older text or treated as newly confirmed after a source disappears. */
export async function readValidatedConversation(principal:ConversationPrincipal){
  return db.transaction('r',db.sessions,db.messages,db.memorySourceTombstones,async()=>{
    if(principal.isCurrent?.()===false)return undefined;
    const session=await db.sessions.get(principal.sessionId);
    if(!session||session.userId!==principal.userId||session.characterId!==principal.characterId||session.type==='group')return undefined;
    const previous=session.conversation;
    if(!previous)return {conversation:previous,version:0,invalidatedIds:[] as string[]};
    if(!previous.ambiguousTopic&&!previous.continuityFocus&&(previous.topicPauses===undefined||Array.isArray(previous.topicPauses)&&!previous.topicPauses.length)
      &&(previous.topics===undefined||Array.isArray(previous.topics)&&!previous.topics.length))return {conversation:previous,version:previous.version??0,invalidatedIds:[] as string[]};
    const candidates=Array.isArray(previous.topics)?previous.topics.slice(0,8):[];
    const records=candidates.map(topic=>{
      let refs:TopicEvidence[]|undefined;
      try{refs=evidence({...previous,topics:[topic],topicPauses:[],appliedThrough:undefined,continuityFocus:undefined,ambiguousTopic:undefined});}catch{}
      return {topic,refs};
    });
    const replies=replyEntries({...previous,topics:candidates})??[];
    let focusRefs:TopicEvidence[]|undefined;
    try{focusRefs=previous.continuityFocus?evidence({...previous,topics:[],topicPauses:[],appliedThrough:undefined,ambiguousTopic:undefined}):[];}catch{}
    const pauses=(Array.isArray(previous.topicPauses)?previous.topicPauses.slice(-4):[]).map(pause=>{
      let refs:TopicEvidence[]|undefined;
      try{refs=evidence({...previous,topics:[],topicPauses:[pause],appliedThrough:undefined,continuityFocus:undefined,ambiguousTopic:undefined});}catch{}
      return {pause,refs};
    });
    let ambiguityRefs:TopicEvidence[]|undefined;
    try{ambiguityRefs=previous.ambiguousTopic?evidence({...previous,topics:[],topicPauses:[],appliedThrough:undefined,continuityFocus:undefined}):[];}catch{}
    const all=uniqueRefs([...records.flatMap(record=>record.refs??[]),...replies.flatMap(entry=>entry.refs),...(focusRefs??[]),...pauses.flatMap(entry=>entry.refs??[]),...(ambiguityRefs??[])]);
    if(new Set(all.map(ref=>ref.messageId)).size>72)return undefined;
    const selected=await readSelected(principal,all);
    const invalidatedReplyIds:string[]=[];
    const topics=records.filter(record=>record.refs&&supported(principal,{...previous,topics:[record.topic],topicPauses:[],continuityFocus:undefined,ambiguousTopic:undefined},record.refs,selected)).map(({topic})=>{
      const responses=(Array.isArray(topic.responses)?topic.responses:[]).filter(record=>{
        const entry=replies.find(entry=>entry.topic===topic&&entry.record===record);
        const valid=!!entry&&supported(principal,{...previous,topics:[],topicPauses:[],continuityFocus:undefined,ambiguousTopic:undefined},replyUserRefs(record),selected)&&supportsTopicReply(topic,record,selected.byId,selected.suppressed);
        if(!valid)invalidatedReplyIds.push(typeof record?.id==='string'?record.id:'malformed');
        return valid;
      });
      return {...topic,...(topic.responses!==undefined?{responses}:{})};
    });
    const invalidatedIds=candidates.filter(topic=>!topics.some(valid=>valid.id===topic.id)).map(topic=>topic.id);
    const continuityFocus=focusRefs&&supported(principal,{...previous,topics:[],topicPauses:[],ambiguousTopic:undefined},focusRefs,selected)?previous.continuityFocus:undefined;
    const topicPauses=pauses.filter(entry=>entry.refs&&supported(principal,{...previous,topics:[],topicPauses:[entry.pause],continuityFocus:undefined,ambiguousTopic:undefined},entry.refs,selected)).map(entry=>entry.pause);
    const ambiguousTopic=ambiguityRefs&&supported(principal,{...previous,topics,topicPauses:[],continuityFocus:undefined},ambiguityRefs,selected)?previous.ambiguousTopic:undefined;
    if(principal.isCurrent?.()===false)return undefined;
    return {conversation:{...previous,topics,topicPauses,topicPausesLimited:previous.topicPausesLimited
      ||previous.topicPauses!==undefined&&(!Array.isArray(previous.topicPauses)||previous.topicPauses.length>4),continuityFocus,focusTopicId:topics.some(topic=>topic.id===previous.focusTopicId)?previous.focusTopicId:undefined,ambiguousTopic,
      ...(invalidatedIds.length||previous.topics!==undefined&&!Array.isArray(previous.topics)?{currentTopic:undefined,pausedTopics:[],topicSourcesInvalidated:true}:{}),
      ...(invalidatedReplyIds.length?{topicRepliesInvalidated:true}:{}),
    },version:previous.version??0,invalidatedIds,invalidatedReplyIds};
  });
}

/** Atomic version/source validation. It does not generate, retry, scan a
 * history archive, or trust cross-round cached permissions. */
async function guardConversation(principal:ConversationPrincipal,expectedVersion:number,next:ChatConversationState,commit:boolean):Promise<boolean>{
  let refs:TopicEvidence[]|undefined;
  try{refs=evidence(next,principal.currentSource);}catch{return false;}
  const replies=replyEntries(next);
  if(!refs||!replies||!Number.isInteger(expectedVersion)||expectedVersion<0)return false;
  const all=uniqueRefs([...refs,...replies.flatMap(entry=>entry.refs)]);
  if(new Set(all.map(ref=>ref.messageId)).size>72)return false;
  const allowed=()=>principal.isCurrent?.()!==false;
  try{
    return await db.transaction(commit?'rw':'r',db.sessions,db.messages,db.memorySourceTombstones,async()=>{
      if(!allowed())return false;
      const session=await db.sessions.get(principal.sessionId);
      if(!session||session.userId!==principal.userId||session.characterId!==principal.characterId||session.type==='group'||(session.conversation?.version??0)!==expectedVersion)return false;
      const selected=await readSelected(principal,all);
      if(!supported(principal,next,refs,selected))return false;
      if(replies.some(({topic,record})=>!supported(principal,{...next,topics:[],ambiguousTopic:undefined},replyUserRefs(record),selected)
        ||!supportsTopicReply(topic,record,selected.byId,selected.suppressed)))return false;
      if(!allowed())return false;
      if(!commit)return true;
      await db.sessions.update(session.id,{conversation:{...next,version:expectedVersion+1}});
      if(!allowed())throw new PrincipalChanged();
      return true;
    });
  }catch(error){if(error instanceof PrincipalChanged)return false;throw error;}
}

export const updateConversationIfCurrent=(principal:ConversationPrincipal,expectedVersion:number,next:ChatConversationState)=>guardConversation(principal,expectedVersion,next,true);
export const validateConversationIfCurrent=(principal:ConversationPrincipal,expectedVersion:number,next:ChatConversationState)=>guardConversation(principal,expectedVersion,next,false);
