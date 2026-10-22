import {db, type Message} from '../../src/db';
import {advanceExplicitTopics,renderExplicitTopics,type TopicStateFields,type TopicRecord} from '../../src/lib/chat-topic-outcomes';
import * as replies from '../../src/lib/chat-topic-replies';
import * as controls from '../../src/lib/chat-topic-controls';
import {emptyChatConversationState,type ChatConversationState} from '../../src/lib/chat-conversation-state';
import {readValidatedConversation,updateConversationIfCurrent} from '../../src/db/chat-topic-state-repo';

const principal={userId:'core-topic-owner',characterId:'core-topic-role',sessionId:'core-topic-session'};
const checks:Array<{name:string;ok:boolean;detail?:unknown}>=[];
const check=(name:string,ok:unknown,detail?:unknown)=>checks.push({name,ok:!!ok,...(detail===undefined?{}:{detail})});
let sequence=0;
const row=(content:string,role:'user'|'assistant'='user'):Message=>({id:'core-'+(++sequence),sessionId:principal.sessionId,role,content,createdAt:1780000000000+sequence*1000,isProactive:false,revision:1});
const next=(state:TopicStateFields,message:Message)=>advanceExplicitTopics(state,{message,domain:'user-reality',utcOffsetMinutes:480});
const response=(user:Message,content:string):Message=>({...row(content,'assistant'),replyToUserMessageId:user.id,replyCompletion:'complete'});
const stored=(state:TopicStateFields):ChatConversationState=>({...emptyChatConversationState(),...state});
async function reset(){await db.delete();await db.open();sequence=0;await db.sessions.add({...principal,id:principal.sessionId,title:'隔离连续性',createdAt:1,updatedAt:1,unreadCount:0});}
async function save(state:TopicStateFields,messages:Message[]){await db.messages.bulkPut(messages);const version=(await db.sessions.get(principal.sessionId))?.conversation?.version??0;return updateConversationIfCurrent(principal,version,stored(state));}
const topic=(state:TopicStateFields)=>state.topics?.find(t=>t.id===state.focusTopicId);

Object.assign(window,{async runCoreTopics(){
  await reset();
  let state:TopicStateFields={};
  const plan=row('周六14点去博物馆，坐地铁。');state=next(state,plan);
  const pause=row('先别聊考试这类话题了。');state=next(state,pause);
  check('category pause records an exact user source',!!(state as any).topicPauses?.some((p:any)=>p.category==='exam'&&p.source.messageId===pause.id));
  check('category pause does not defer a different focused event',state.topics?.[0].outcome==='pending');
  check('category pause persists through unrelated exchange',!!(next(state,row('今天的云很好看。')) as any).topicPauses?.length);
  check('category pause is in the source-validated projection',renderExplicitTopics(state,undefined,'user-reality',4000).includes('考试'));
  check('category pause stored in actual repository',await save(state,[plan,pause]));
  const loaded=await readValidatedConversation(principal);
  check('category pause survives a fresh database read',!!(loaded?.conversation as any)?.topicPauses?.length);
  const forgedPause=structuredClone(state) as any;forgedPause.topicPauses[0].category='plan';
  check('imported category label cannot contradict its source',!await save(forgedPause,[]));
  await db.messages.update(pause.id,{revision:2,content:'这不是我的意思。'});
  const edited=await readValidatedConversation(principal);
  check('edited pause source stops applying',!(edited?.conversation as any)?.topicPauses?.length);
  check('edited pause does not delete still-valid plan',edited?.conversation?.topics?.[0].label==='博物馆计划');

  const quoted=next({},row('朋友说：“先别聊考试这类话题了。”'));
  check('quoted category pause is not user control',!(quoted as any).topicPauses?.length);
  const hypothetical=next({},row('如果我说先别聊考试这类话题了，你会怎么做？'));
  check('hypothetical category pause is not user control',!(hypothetical as any).topicPauses?.length);
  const noPause=next({},row('不是让你别聊考试这类话题。'));
  check('negated pause is not user control',!(noPause as any).topicPauses?.length);
  const restored=next(state,row('可以继续聊考试这类话题了。'));
  check('explicit category resume clears only that category',!(restored as any).topicPauses?.length);

  await reset();
  const exam=row('英语考试周六。');state=next({},exam);
  const eventPause=row('这场考试先别聊了。');state=next(state,eventPause);
  check('specific event pause defers that event',state.topics?.length===1&&state.topics[0].anchorSource.messageId===exam.id&&state.topics[0].outcome==='deferred',state.topics);
  check('specific event pause does not ban category',(state as any).topicPauses?.length===undefined||(state as any).topicPauses?.length===0);
  const eventContinue=row('继续刚才那个考试。');state=next(state,eventContinue);
  check('specific event explicit resume works',state.topics?.[0].outcome==='pending');
  const categoryStopped=next(state,row('先别聊考试这类话题了。'));
  const categoryContinued=next(categoryStopped,row('可以继续聊考试这类话题了。'));
  check('explicit category resume can focus its one active event',categoryContinued.focusTopicId===state.topics?.[0].id);
  check('short correction after explicit category resume keeps the event',next(categoryContinued,row('不是周六，改到周日。')).topics?.[0].slots.date?.value==='周日');

  const second=row('另外一场英语考试周日。');state=next(state,second);
  check('explicit new same-name event does not overwrite first',state.topics?.filter(t=>t.kind==='exam').length===2,state.topics);
  const done=row('周六的英语考试考完了。');state=next(state,done);
  const exams=state.topics?.filter(t=>t.kind==='exam')??[];
  check('date selects correct same-name event',exams.find(t=>t.slots.date?.value==='周六')?.outcome==='resolved'&&exams.find(t=>t.slots.date?.value==='周日')?.outcome==='pending');
  const ambiguous=next(state,row('英语考试改到周一。'));
  check('same-name change without old date remains ambiguous',!!ambiguous.ambiguousTopic);

  await reset();
  const initial=row('周六14点去博物馆，坐地铁。');state=next({},initial);
  const ask=row('我接下来该怎么准备？');state=next(state,ask);
  const answer=response(ask,'先确认预约，再把证件带上。');state=replies.appendTopicReplyEvidence(state,ask,[answer],'user-reality');
  const guidance=topic(state)?.responses?.flatMap(r=>r.acts).find(a=>a.kind==='gave-guidance' as any);
  check('explicit practical request has source-backed guidance goal',!!guidance);
  check('guidance is speech evidence not event completion',topic(state)?.outcome==='pending');
  check('guidance evidence passes real source transaction',await save(state,[initial,ask,answer]));
  const fresh=await readValidatedConversation(principal);
  check('guidance survives fresh source validation',!!fresh?.conversation?.topics?.[0].responses?.length);
  await db.messages.update(answer.id,{revision:2,content:'这句话改过了。'});
  const withdrawn=await readValidatedConversation(principal);
  check('edited guidance loses only role evidence',withdrawn?.conversation?.topics?.[0].responses?.length===0&&withdrawn.conversation.topics[0].outcome==='pending');
  const corrected=next(state,row('不是周六，改到周日。'));
  check('correction invalidates dependent guidance target',!corrected.topics?.[0].responses?.some(r=>r.acts.some(a=>a.kind==='gave-guidance' as any)));

  await reset();
  const p=row('周六去博物馆。');state=next({},p);
  const q=response(p,'你准备几点去？');state=replies.appendTopicReplyEvidence(state,p,[q],'user-reality');
  const t=row('下午三点。');state=next(state,t);
  const a=response(t,'好，三点。');state=replies.appendTopicReplyEvidence(state,t,[a],'user-reality');
  check('user supplying requested slot closes the explicit question goal',!!topic(state)?.responses?.some(r=>r.acts.some(act=>act.kind==='user-answered-slot' as any)));
  check('user answer source evidence persists',await save(state,[p,q,t,a]));
  const interrupted={...a,id:'unfinished',replyCompletion:'interrupted' as const};
  check('incomplete batch creates no new answered evidence',replies.appendTopicReplyEvidence(next({},p),t,[interrupted],'user-reality').topics?.[0].responses===undefined);
  const inProgress={...a,replyDelivery:'in-progress' as const};
  check('in-progress delivery cannot claim complete answer',!replies.completeReplyBatch(t,[inProgress]));
  const fake=structuredClone(state);const target=fake.topics?.[0].responses?.at(-1)?.acts.find(act=>act.kind==='user-answered-slot' as any) as any;
  if(target)target.value='六点';
  check('tampered answer value is rejected by repository',!!target&&!await save(fake,[]));
  const wrong={...principal,characterId:'different-role'};
  check('same source never crosses role instance',(await readValidatedConversation(wrong))===undefined);

  await reset();await db.sessions.update(principal.sessionId,{conversation:{...emptyChatConversationState(),topicPauses:{broken:true}} as any});
  const malformed=await readValidatedConversation(principal);
  check('malformed imported pause data is projected as bounded unknown',Array.isArray(malformed?.conversation?.topicPauses)&&malformed?.conversation?.topicPausesLimited===true);

  const eligibility=(controls as any).topicFollowUpEligibility;
  check('completed follow-up helper is available',typeof eligibility==='function');
  if(typeof eligibility==='function'){
    const finished:TopicRecord={...state.topics![0],outcome:'resolved',outcomeSource:[{messageId:p.id,revision:1,start:0,end:p.content.length}]};
    check('completed event permits one care, never asks completion',eligibility(finished,{now:Date.now()}).kind==='care');
    check('deferred event cannot be proactively reopened',eligibility({...finished,outcome:'deferred'},{now:Date.now()}).kind==='none');
    check('limited reply coverage never assumes a care was not already sent',eligibility(finished,{now:Date.now(),coverageLimited:true}).kind==='none');
  }
  await reset();
  const dateSource={...row('英语考试明天。'),createdAt:Date.UTC(2026,9,20,15,50)};
  const dateCorrection={...row('不是明天，改到后天。'),createdAt:Date.UTC(2026,9,20,15,55)};
  state=advanceExplicitTopics({}, {message:dateSource,domain:'user-reality',utcOffsetMinutes:-480});
  state=advanceExplicitTopics(state, {message:dateCorrection,domain:'user-reality',utcOffsetMinutes:-480});
  const scheduled=state.topics![0];
  check('a corrected relative date blocks proactive follow-up on the new day',eligibility(scheduled,{now:Date.UTC(2026,9,22,5)}).kind==='none');
  check('follow-up becomes eligible the next local day using the original source clock',eligibility(scheduled,{now:Date.UTC(2026,9,22,16,1)}).kind==='follow-up');
  check('user mentioning the corrected event can receive an immediate answer',eligibility(scheduled,{now:Date.UTC(2026,9,22,5),userInitiated:true}).kind==='follow-up');
  const unknownDate=structuredClone(scheduled);unknownDate.slots.date.value='2月30日';
  check('invalid corrected date cannot silently authorize proactive follow-up',eligibility(unknownDate,{now:Date.UTC(2026,10,8)}).kind==='none');
  check('scheduled facts persist with actual source timestamps',await save(state,[dateSource,dateCorrection]));
  const forgedClock=structuredClone(state);forgedClock.topics![0].slots.date.observedAt+=86400000;
  check('an imported observation clock cannot contradict its source message',!await save(forgedClock,[]));
  await reset();
  const completed=row('英语考试考完了。');state=next({},completed);
  const care=response(completed,'终于结束了，今晚好好放松一下。');state=replies.appendTopicReplyEvidence(state,completed,[care],'user-reality');
  check('published relaxation care is recorded separately from completion',!!state.topics?.[0].responses?.some(record=>record.acts.some(act=>act.kind==='care'))&&state.topics[0].outcome==='resolved');
  check('the same completed event is not offered a second proactive care',eligibility(state.topics![0],{now:Date.now()}).kind==='none');
  check('care receipt passes native source validation',await save(state,[completed,care]));
  const careFresh=await readValidatedConversation(principal);
  check('care usage survives a fresh validated conversation read',!!careFresh?.conversation?.topics?.[0].responses?.some(record=>record.acts.some(act=>act.kind==='care')));
  const quotedCare=response(completed,'这句话是“今晚好好放松一下”。');
  const quoteState=replies.appendTopicReplyEvidence(next({},completed),completed,[quotedCare],'user-reality');
  check('quoted relaxation wording does not consume a care',!quoteState.topics?.[0].responses?.some(record=>record.acts.some(act=>act.kind==='care')));
  const refusedCare=response(completed,'先别休息，先把全部问题复盘完。');
  const refusedState=replies.appendTopicReplyEvidence(next({},completed),completed,[refusedCare],'user-reality');
  check('negated rest does not consume a care',!refusedState.topics?.[0].responses?.some(record=>record.acts.some(act=>act.kind==='care')));
  return {complete:checks.every(c=>c.ok),checks,failures:checks.filter(c=>!c.ok),networkCalls:0};
}});
