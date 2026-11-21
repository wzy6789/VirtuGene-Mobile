import {db,type Character,type Message} from '../../db';
import {messageRepo} from '../../db/message-repo';
import {stateRepo} from '../../db/state-repo';
import {memorySourceTombstoneRepo} from '../../db/memory-source-tombstone-repo';
import {useAuthStore} from '../../store/auth-store';
import {deriveProactivity} from '../personality';
import {hasActiveChatRequest,onChatRequestStart} from './request-coordinator';
import {readChatComposerDraft,onChatComposerInput} from '../chat-composer-drafts';
import {isStandaloneClosing,conversationDeparture} from '../chat-turn-cues';
import {buildChatHistoryWindow} from '../chat-history-window';
import {buildCharacterMemoryContext,revalidateCharacterMemoryContext,renderMemoryRetrievalStatus} from '../character-memory';
import {buildCharacterVoiceCard} from '../chat-humanizer';
import {readVoiceSampleCharacter} from './voice-sample-cache';
import {generateProactiveMessage} from '../ai/proactive-chat';
import {canUseAi} from '../ai/availability';
import {readValidatedConversation,validateConversationIfCurrent} from '../../db/chat-topic-state-repo';
import {renderExplicitTopics} from '../chat-topic-outcomes';
import {isIncompleteAssistantReply} from './reply-delivery';
import {selectReplyPlan,recordPublishedDirection} from './topic-candidates';
import {appendReturnVisitCareEvidence} from '../chat-topic-replies';
import {sessionRepo} from '../../db/session-repo';
import {useVoiceCallStore} from '../../store/voice-call-store';

export interface ProactiveVisit {
  userId: string; characterId: string; sessionId: string;
  /** The initiating visit remains selected and visible; never inferred from elapsed time. */
  isCurrent: () => boolean;
  signal?: AbortSignal;
}
const identity = (character: Character) => JSON.stringify([
  character.id, character.createdBy, character.agentProfile, character.sourcePresetId,
  character.isPreset, character.systemPrompt, character.name, character.tags,
  character.catchphrase, character.proactivity, character.chatListHidden,
]);
const proactive = (character: Character) => character.agentProfile !== 'secretary'
  && !character.chatListHidden && (character.proactivity ?? deriveProactivity(character.tags, character.systemPrompt)) > 0;
const sameRow = (a:Message|undefined,b:Message) => !!a && a.sessionId===b.sessionId
  && a.role===b.role && a.content===b.content && a.image===b.image && a.createdAt===b.createdAt
  && (a.revision??1)===(b.revision??1) && a.failed===b.failed && a.isProactive===b.isProactive
  && a.replyCompletion===b.replyCompletion && JSON.stringify(a.secretaryDispatch)===JSON.stringify(b.secretaryDispatch);
class VisitInvalidated extends Error {}

/** A visit has one bounded attempt. No timers, relationship penalties, push or image tasks. */
export async function runProactiveVisit(visit:ProactiveVisit):Promise<Message|undefined> {
  const {userId,characterId,sessionId}=visit;
  const controller=new AbortController();
  const cancel=()=>controller.abort();
  const callIdle=()=>{const call=useVoiceCallStore.getState();return !call.busy&&!call.saving&&!call.finishing;};
  const live=()=>!!userId&&!controller.signal.aborted&&!visit.signal?.aborted
    &&useAuthStore.getState().userId===userId&&visit.isCurrent()&&!hasActiveChatRequest()&&callIdle()
    &&!readChatComposerDraft(userId,sessionId).trim()&&document.visibilityState!=='hidden';
  if(!canUseAi()||!live())return;
  // Account switch and back, short-lived typing, foreground sends all invalidate this generation.
  const dispose=[onChatRequestStart(cancel),onChatComposerInput((owner,id)=>{if(owner===userId&&id===sessionId)cancel();}),
    useAuthStore.subscribe((next,previous)=>{if(next.userId!==previous.userId)cancel();}),
    useVoiceCallStore.subscribe(()=>{if(!callIdle())cancel();})];
  const visibility=()=>{if(document.visibilityState==='hidden')cancel();};
  document.addEventListener('visibilitychange',visibility);
  document.addEventListener('beforeinput',cancel,true);
  document.addEventListener('compositionstart',cancel,true);
  visit.signal?.addEventListener('abort',cancel,{once:true});
  try {
    const [character,session,rows]=await Promise.all([db.characters.get(characterId),db.sessions.get(sessionId),messageRepo.getPage(sessionId,{limit:40})]);
    if(!live()||!character||character.createdBy!==userId||!proactive(character)
      ||!session||session.userId!==userId||session.characterId!==characterId||session.type==='group')return;
    const last=rows[rows.length-1],users=rows.filter(row=>row.role==='user'&&!row.failed&&row.secretaryDispatch?.bodyOrigin!=='composed');
    const user=users[users.length-1];
    if(!last||last.role!=='assistant'||last.isProactive||last.failed||isIncompleteAssistantReply(last)
      ||last.replyCompletion&&last.replyCompletion!=='complete'||!user
      ||Date.now()-last.createdAt<10*60_000||isStandaloneClosing(user.content)||conversationDeparture(user.content))return;
    const eligible=rows.filter(row=>!row.failed&&row.role!=='system'&&row.secretaryDispatch?.bodyOrigin!=='composed');
    const history=buildChatHistoryWindow(eligible,'',10,1200);
    if(!history.some(row=>row.role==='user'))return;
    const characterKey=identity(character),attemptId=crypto.randomUUID();
    let expectedConversationVersion:number|undefined;
    const selectedIds=[...new Set([...history.flatMap(row=>row.sourceMessageIds),last.id,user.id])];
    const selected=eligible.filter(row=>selectedIds.includes(row.id));
    async function sourcesLive() {
      if(!live())return false;
      const [actor,scope,current,tail,blocked,withdrawn]=await Promise.all([
        db.characters.get(characterId),db.sessions.get(sessionId),db.messages.bulkGet(selectedIds),messageRepo.getPage(sessionId,{limit:1}),
        memorySourceTombstoneRepo.selectedSuppressedMessages(userId,characterId,selectedIds),
        memorySourceTombstoneRepo.blocksImports(selected.map(row=>({userId,sourceType:'message' as const,sourceId:row.id,sourceRevision:row.revision??1}))),
      ]);
      const byId=new Map(current.filter((row):row is Message=>!!row).map(row=>[row.id,row]));
      return live()&&!!actor&&identity(actor)===characterKey&&actor.createdBy===userId&&proactive(actor)
        &&scope?.userId===userId&&scope.characterId===characterId&&scope.type!=='group'
        &&(expectedConversationVersion===undefined||(scope.conversation?.version??0)===expectedConversationVersion)
        &&sameRow(tail[0],last!)&&selected.every(row=>sameRow(byId.get(row.id),row)&&!blocked.has(row.id))&&!withdrawn.some(Boolean);
    }
    const claimed=await db.transaction('rw',db.sessions,db.characters,db.messages,db.memorySourceTombstones,async()=>{
      if(!await sourcesLive())return false;
      const scope=(await db.sessions.get(sessionId))!;
      if(scope.proactiveVisit?.anchorId===last.id&&scope.proactiveVisit?.anchorRevision===(last.revision??1))return false;
      await db.sessions.update(sessionId,{proactiveVisit:{anchorId:last.id,anchorRevision:last.revision??1,attemptId,attemptedAt:Date.now()}});
      if(!live())throw new VisitInvalidated();
      return true;
    });
    if(!claimed)return;
    const memoryRequest={userId,characterId,mode:'proactive-chat' as const,topic:user.content,
      recentConversation:history.map(row=>({kind:row.role==='user'?'user_input' as const:'dialogue' as const,content:row.content})),
      excludeSessionId:sessionId,includePrivateCharacterLifeEvents:false,budget:1600};
    const principal={userId,characterId,sessionId,isCurrent:live};
    const [memory,state,voiced,conversation]=await Promise.all([buildCharacterMemoryContext(memoryRequest),stateRepo.get(characterId,userId),readVoiceSampleCharacter(character,userId),readValidatedConversation(principal)]);
    expectedConversationVersion=conversation?.version??0;
    const replyPlan=selectReplyPlan({userId,characterId,sessionId,trigger:'return-visit',userText:'',character:voiced,recent:eligible,
      state:conversation?.conversation,topicsValidated:!!conversation,now:Date.now()}).plan;
    if(!replyPlan.angleKey)return;
    const validate=async()=>{
      if(!await sourcesLive())throw new VisitInvalidated();
      const fresh=await revalidateCharacterMemoryContext(memoryRequest,memory);
      if(fresh.references.length!==memory.references.length||fresh.text!==memory.text||!live())throw new VisitInvalidated();
      if(conversation?.conversation&&!await validateConversationIfCurrent(principal,conversation.version,conversation.conversation))throw new VisitInvalidated();
    };
    await validate();
    const content=await generateProactiveMessage({apiKey:useAuthStore.getState().apiKey??'',systemPrompt:character.systemPrompt,
      characterName:character.name,relationshipSource:character,voiceCard:buildCharacterVoiceCard(voiced),catchphrase:character.catchphrase,
      lastMessages:history.map(row=>({role:row.role,content:row.content})),lastMessageAt:last.createdAt,
      affinity:state?.affinity,mood:state?.mood,memoryContext:[renderMemoryRetrievalStatus(memory),memory.text,
        conversation?.conversation?renderExplicitTopics(conversation.conversation,undefined,'user-reality',1200):''].filter(Boolean).join('\n\n'),
      trigger:'return-visit',signal:controller.signal,beforeRequest:validate,replyPlan});
    if(!content||!live())return;
    return await db.transaction('rw',db.tables,async()=>{
      await validate();
      const scope=await db.sessions.get(sessionId);
      if(scope?.proactiveVisit?.attemptId!==attemptId||scope.proactiveVisit.deliveredMessageId)throw new VisitInvalidated();
      let message:Message={id:crypto.randomUUID(),sessionId,role:'assistant',content,createdAt:Date.now(),isProactive:true,revision:1,
        replyDelivery:'settled',replyCompletion:'complete'};
      message=recordPublishedDirection(replyPlan,[message])[0];
      await messageRepo.create(message);
      if(replyPlan.kind==='care'&&replyPlan.topicId&&conversation?.conversation){
        const topic=conversation.conversation.topics?.find(item=>item.id===replyPlan.topicId);
        const outcomeIds=[...new Set(topic?.outcomeSource.map(ref=>ref.messageId)??[])];
        const originals=await db.messages.bulkGet(outcomeIds);
        const outcome=originals.find(row=>row?.role==='user');
        if(outcome){
          const next=appendReturnVisitCareEvidence(conversation.conversation,replyPlan.topicId,outcome,message);
          if(next!==conversation.conversation&&!await sessionRepo.updateConversationIfCurrent(principal,conversation.version,next))throw new VisitInvalidated();
        }
      }
      await db.sessions.update(sessionId,{updatedAt:message.createdAt,proactiveVisit:{...scope.proactiveVisit,deliveredMessageId:message.id}});
      if(!live())throw new VisitInvalidated();
      return message;
    });
  } catch(error) {
    if(error instanceof VisitInvalidated||controller.signal.aborted)return;
    throw error;
  } finally {
    dispose.forEach(fn=>fn());document.removeEventListener('visibilitychange',visibility);
    document.removeEventListener('beforeinput',cancel,true);document.removeEventListener('compositionstart',cancel,true);
    visit.signal?.removeEventListener('abort',cancel);
  }
}
