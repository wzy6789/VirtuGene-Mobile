/** Bounded, source-backed conversation facts, not executable tasks or a new
 * long-term memory database. Callers must validate source ownership/liveness
 * before projecting or persisting these records. */
import {withoutSetAsideTopicClauses} from './chat-turn-cues';
import {boundTopicReplies,renderTopicReplies,type TopicReplyRecord} from './chat-topic-replies';
import {advanceScopedFacts,scopedFactClauses,parseScopedDeclaration} from './chat-scoped-facts';
import {explicitTopicRestore,categoryTopicControls} from './chat-topic-controls';
export type TopicOutcome='pending'|'answered'|'resolved'|'cancelled'|'deferred';
export type TopicDomain='user-reality'|'roleplay'|'story'|'character';
export interface TopicEvidence {messageId:string;revision:number;start:number;end:number}
/** A locator, not copied cross-session facts or cached authorization. */
export interface ContinuityFocus {
  threadId:string;source:TopicEvidence;activationSource?:TopicEvidence;
  domain:'user-reality';paused?:boolean;
}
export interface TopicSlot {value:string;source:TopicEvidence[];observedAt:number;utcOffsetMinutes?:number}
export interface TopicRecord {
  id:string;kind:'exam'|'meal'|'conflict'|'plan'|'preference'|'residence';label:string;outcome:TopicOutcome;
  source:TopicEvidence[];outcomeSource:TopicEvidence[];anchorSource:TopicEvidence;
  slots:Record<string,TopicSlot>;slotHistory:Array<TopicSlot&{field:string}>;
  unresolvedSlots:Record<string,TopicEvidence[]>;
  needsConfirmation?:boolean;confirmationSource?:TopicEvidence;
  /** Character speech evidence is separate from user facts and outcomes. */
  responses?:TopicReplyRecord[];
  lastEventOrder:number;conclusion?:string;scope:'session';domain:TopicDomain;
  observedAt:number;effectiveAt?:number;effectiveUntil?:number;
}
export interface TopicStateFields {
  topics?:TopicRecord[];focusTopicId?:string;
  continuityFocus?:ContinuityFocus;
  appliedThrough?:TopicEvidence&{observedAt:number};
  ambiguousTopic?:{message:TopicEvidence;reason:string};
  topicSourcesInvalidated?:boolean;
  topicRepliesLimited?:boolean;
  topicRepliesInvalidated?:boolean;
  topicPauses?:Array<{category:TopicRecord['kind'];domain:TopicDomain;source:TopicEvidence}>;
  topicPausesLimited?:boolean;
}
export interface TopicSourceContext {
  message:{id:string;sessionId:string;role:string;content:string;revision?:number;createdAt:number;secretaryDispatch?:{bodyOrigin?:string}};
  domain:TopicDomain;
  utcOffsetMinutes?:number;
}
const reference=(ctx:TopicSourceContext):TopicEvidence=>({messageId:ctx.message.id,revision:ctx.message.revision??1,start:0,end:Math.min(ctx.message.content.length,4000)});
const identity=(ref:TopicEvidence)=>ref.messageId+'@'+ref.revision;
const unique=(refs:TopicEvidence[])=>[...new Map(refs.map(ref=>[identity(ref),ref])).values()];
function ownClauses(content:string):string[]{
  const clean=withoutSetAsideTopicClauses(content).slice(0,4000).replace(/[“「『"][^”」』"]*[”」』"]/gu,quoted=>' '.repeat(quoted.length));
  return clean.split(/[。！？!?\n]/u).filter(sentence=>! /^(?:他|她|他们|她们|朋友|同事|如果|假如|假设|比如|例如|翻译|解释|(?:帮我|给我|替我|请你)(?:写|翻译)|写一句|写一段|我(?:刚才)?听说)/u.test(sentence.trim())
    && !/^[^，,：:]{1,16}(?:说|表示|提到|问)[，,：:]/u.test(sentence.trim()))
    .flatMap(sentence=>sentence.split(/[，,；;]/u)).map(part=>part.trim()).filter(Boolean);
}
function namedKind(text:string):{kind:TopicRecord['kind'];label:string}|undefined{
  if(/考试|考完/u.test(text)){
    if(/^(?:这场|那场|那个|这次)?考试/u.test(text))return {kind:'exam',label:'考试'};
    const named=text.match(/^(?:这场|那个|这次|另外一场|另一场|又一场)?(?:(?:周[一二三四五六日天]|星期[一二三四五六日天]|\d{1,2}月\d{1,2}日)(?:的|那场|这场)?)?([^，,。]{1,8}?)考试/u)?.[1];
    return {kind:'exam',label:named&&!/已经|明天|今天|昨天|结束/u.test(named)?named+'考试':'考试'};
  }
  if(/早饭|午饭|晚饭|吃过|吃完|吃好了|吃的是|吃了/u.test(text))return {kind:'meal',label:text.match(/早饭|午饭|晚饭/u)?.[0]??'本餐'};
  if(/争执|冲突|和好|说开/u.test(text))return {kind:'conflict',label:'同事冲突'};
  if(/约朋友|邀请朋友|邀约/u.test(text))return {kind:'plan',label:'朋友邀约'};
  if(/博物馆|面试|会议|开会|安排|计划/u.test(text))return {kind:'plan',label:/博物馆/u.test(text)?'博物馆计划':/面试/u.test(text)?'面试安排':/会议|开会/u.test(text)?'会议安排':'安排'};
  return undefined;
}

/** An explicitly enumerated group supplies identities, not one aggregate
 * outcome. Unknown/quoted/hypothetical names remain ordinary source text. */
function enumeratedExams(clauses:string[]):string[]{
  const count=clauses[0]?.match(/^(?:我)?(?:有|还有)([两二三四234])场考试$/u)?.[1];
  if(!count||!clauses[1])return [];
  const expected=({'两':2,'二':2,'三':3,'四':4} as Record<string,number>)[count]??Number(count);
  const names=clauses[1].split(/以及|和|与|及|、/u).map(name=>name.trim());
  if(names.length!==expected||new Set(names).size!==expected||names.some(name=>! /^[\p{L}\p{N}]{1,12}$/u.test(name)))return [];
  return names.map(name=>name.endsWith('考试')?name:name+'考试');
}
function referencedExam(clause:string,topics:TopicRecord[],domain:TopicDomain):{label:string;subject:string}|undefined{
  const matches=topics.filter(topic=>topic.kind==='exam'&&topic.domain===domain&&topic.label.endsWith('考试')).flatMap(topic=>{
    const subject=topic.label.slice(0,-2);if(!subject)return [];
    const tail=clause.startsWith(subject)?clause.slice(subject.length):undefined;
    const focus=clause.replace(/^(?:先)?(?:聊聊|聊一下|聊|说说|谈谈)/u,'').replace(/(?:吧|一下)$/u,'');
    return tail!==undefined&&/^(?:考试|周|星期|明天|后天|今天|\d{1,2}月|考|还没|尚未|已经|不担心|还有)/u.test(tail)||focus===subject||focus===topic.label?[{label:topic.label,subject}]:[];
  });
  // Several same-name dated events still need explicit selection.
  return matches.length===1?matches[0]:undefined;
}
function slotsFrom(text:string):Record<string,string>{
  const values:Record<string,string>={};
  const dates=[...text.matchAll(/周[一二三四五六日天末]|星期[一二三四五六日天]|明天|后天|今天|\d{1,2}月\d{1,2}日/gu)];
  const date=dates[dates.length-1]?.[0];
  const time=text.match(/(?:(?:早上|上午|中午|下午|傍晚|晚上|凌晨)?(?:[0-2]?\d|[一二三四五六七八九十两]{1,3})(?:[:：]\d{2}|点(?:半|[一二三四五六七八九十\d]{1,3}分)?))/u)?.[0]
    ??text.match(/早上|上午|中午|下午|傍晚|晚上|凌晨/u)?.[0];
  if(date)values.date=date;
  if(time)values.time=time;
  if(/坐地铁|乘地铁|地铁去/u.test(text))values.transport='地铁';
  if(/坐公交|乘公交/u.test(text))values.transport='公交';
  if(/博物馆/u.test(text))values.place='博物馆';
  const dish=text.match(/(?:吃的是|吃了)([^，,。！？!?]{1,40})/u)?.[1];
  if(dish)values.dish=dish;
  return values;
}
function slotDeclaration(text:string,values:Record<string,string>):boolean{
  let rest=text;
  for(const value of Object.values(values))rest=rest.split(value).join('');
  return Object.keys(values).length>0&&!rest.replace(/时间|日期|交通|这次|我们|我|还是|那就|就|是|定在|定到|改成|改到|改为|不是|坐|乘|在|到|用|去|吧|了|本来|想|约朋友|邀请朋友|邀约|周末|博物馆|面试|会议|开会|安排|计划|[\s：:]/gu,'');
}
function canEstablish(kind:TopicRecord['kind'],text:string,values:Record<string,string>,control:boolean):boolean{
  if(control)return true;
  if(/这个词|这几个字|没什么安排|没有.{0,10}(?:考试|面试|会议|安排|计划)|不想.{0,12}(?:争执|冲突)/u.test(text))return false;
  if(kind==='exam')return /考完|结束了|已经结束|考过了/u.test(text)||!!values.date||/有.{0,4}考试|还有.{0,4}考试|要考试|准备考试/u.test(text);
  if(kind==='conflict')return /有争执|争执了|吵架了|发生.{0,6}冲突|说开了|和好了|解决了/u.test(text);
  if(/昨天|以前|上次|原先|最初|最开始|曾经/u.test(text))return false;
  if(kind==='meal')return !/喜欢|通常|经常|每天|爱吃|讨厌/u.test(text)&&/吃过|吃完|吃好了|吃了|吃的是|(?:早饭|午饭|晚饭)(?:已经|还没|没|吃|是|想|准备)/u.test(text);
  if(/不(?:想|打算|准备|计划)(?:去|在|到|约|邀请)/u.test(text))return false;
  return slotDeclaration(text,values)||/(?:打算|准备|想|计划)(?:去|在|到|约朋友|邀请朋友)|(?:安排|计划|约)(?:在|好)|定在/u.test(text);
}
function boundedRecord(topic:TopicRecord):TopicRecord{
  const currentRefs=unique([topic.anchorSource,...topic.outcomeSource,...Object.values(topic.slots).flatMap(slot=>slot.source),...Object.values(topic.unresolvedSlots).flat(),...(topic.confirmationSource?[topic.confirmationSource]:[])]);
  let history=topic.slotHistory.slice(-4);
  while(unique([...currentRefs,...history.flatMap(slot=>slot.source)]).length>6&&history.length)history.shift();
  // Four supported plan slots share at most four distinct source messages.
  // If future fields exceed the source bound, fail closed instead of omitting
  // evidence for a value we continue to assert.
  if(currentRefs.length>6)throw Error('topic:source_bound');
  return {...topic,label:topic.label.slice(0,60),conclusion:topic.conclusion?.slice(0,160),slotHistory:history,source:unique([...currentRefs,...history.flatMap(slot=>slot.source)])};
}

/** Only explicit, conservative forms produce events. Unrecognised expressions
 * stay in original history; they do not silently become permanent facts. */
export function advanceExplicitTopics(previous:TopicStateFields,ctx:TopicSourceContext):TopicStateFields{
  const message=ctx.message,ref=reference(ctx);
  if(message.role!=='user'||message.secretaryDispatch?.bodyOrigin==='composed'||!ref.end)return previous;
  const topics=(previous.topics??[]).map(topic=>({...topic,source:[...topic.source],outcomeSource:[...topic.outcomeSource],slots:{...topic.slots},unresolvedSlots:{...topic.unresolvedSlots},slotHistory:[...topic.slotHistory]}));
  const cursor=previous.appliedThrough;
  if(cursor&&(cursor.messageId===ref.messageId&&cursor.revision===ref.revision||message.createdAt<cursor.observedAt))return {
    topics,focusTopicId:previous.focusTopicId,continuityFocus:previous.continuityFocus,appliedThrough:cursor,topicSourcesInvalidated:previous.topicSourcesInvalidated,
    topicRepliesLimited:previous.topicRepliesLimited,topicRepliesInvalidated:previous.topicRepliesInvalidated,
    topicPauses:previous.topicPauses,topicPausesLimited:previous.topicPausesLimited,ambiguousTopic:previous.ambiguousTopic,
  };
  let pauses=[...(previous.topicPauses??[])];
  const categoryControls=categoryTopicControls(message.content);
  for(const control of categoryControls){
    pauses=pauses.filter(pause=>pause.category!==control.category||pause.domain!==ctx.domain);
    if(control.action==='pause')pauses.push({category:control.category,domain:ctx.domain,source:{...ref,start:control.start,end:control.end}});
  }
  const pausesLimited=previous.topicPausesLimited||pauses.length>4;
  pauses=pauses.slice(-4);
  let focus=topics.find(topic=>topic.id===previous.focusTopicId&&topic.domain===ctx.domain);
  const resumeControls=categoryControls.filter(control=>control.action==='resume');
  const resumedCategory=resumeControls[resumeControls.length-1]?.category;
  const resumedCandidates=resumedCategory?topics.filter(topic=>topic.domain===ctx.domain&&topic.kind===resumedCategory&&!topic.needsConfirmation&&!['cancelled','deferred'].includes(topic.outcome)):[];
  const resumedFocus=resumedCandidates.length===1?resumedCandidates[0]:undefined;
  if(resumedFocus)focus=resumedFocus;
  let order=Math.max(0,...topics.map(topic=>topic.lastEventOrder));
  let touched=false,eventTouched=false,ambiguousTopic:TopicStateFields['ambiguousTopic'];
  let clarifiedPrior=false;
  const clarifies=(topic:TopicRecord)=>!!previous.ambiguousTopic&&topics.some(other=>other.id!==topic.id&&other.domain===topic.domain
    &&other.kind===topic.kind&&(/多个同名/u.test(previous.ambiguousTopic!.reason)?other.label===topic.label:true));
  const originalClauses=ownClauses(message.content),examLabels=enumeratedExams(originalClauses);
  const facts=advanceScopedFacts(topics,ctx,scopedFactClauses(message.content),order);order=facts.order;
  if(facts.last)touched=true;
  if(facts.last&&clarifies(facts.last))clarifiedPrior=true;
  if(facts.ambiguous)ambiguousTopic={message:ref,reason:facts.ambiguous};
  const clauses=examLabels.length?[...examLabels,...originalClauses.slice(2)]:originalClauses;
  const historical=/上次|最开始|原先|当时|过去|为什么取消|为何取消/u.test(message.content)&&/[？?]|为什么|为何|哪天|什么时候/u.test(message.content);
  const correcting=/口误|说错|更正|纠正|(?:不是.+[，,]\s*(?:是|而是))|改成|改到|改为/u.test(clauses.join('，'));
  for(const clause of clauses){
    if(historical)break;
    // A scoped habit's 晚上 is not the time of the event corrected elsewhere
    // in this message. Its declaration has already been handled separately.
    if(parseScopedDeclaration(clause))continue;
    if(categoryTopicControls(clause).length)continue;
    if(/(?:两|二|三|四|[234])场考试/u.test(clause))continue;
    const examReference=referencedExam(clause,topics,ctx.domain);
    const named=examReference?{kind:'exam' as const,label:examReference.label}:namedKind(clause);
    const inlineCorrection=clause.match(/^不是.+?(?:而是|是)(.+)$/u)?.[1];
    const values=slotsFrom(inlineCorrection??clause);
    const restore=explicitTopicRestore(clause,message.content,!!named,!!focus);
    const cancel=/取消|不去了|不办了/u.test(clause)&&!/(?:不(?:要|想)|别)取消|还没取消|没有取消/u.test(clause);
    const defer=/先放一放|先放下|先不弄|暂缓|以后再说|(?:这场|这项|这件|这个).{0,16}(?:先别聊|先不聊)|(?:先别聊|先不聊)(?:这场|这项|这件|这个)/u.test(clause);
    const isQuestion=/(?:吗|么|哪天|几点|为什么|为何|是不是|有没有)/u.test(clause);
    if(isQuestion&&!restore)continue;
    let target:TopicRecord|undefined;
    if(named){
      const same=topics.filter(t=>t.domain===ctx.domain&&t.kind===named.kind);
      const exact=same.filter(t=>t.label===named.label);
      const explicitlyNew=/^(?:另外|另有|还有|另一场|又一场|新的一场|另一项|又一项)/u.test(clause)&&!!values.date;
      if(!explicitlyNew&&exact.length===1)target=exact[0];
      else if(!explicitlyNew&&exact.length>1){
        const selectedDate=clause.match(/^(周[一二三四五六日天]|星期[一二三四五六日天]|\d{1,2}月\d{1,2}日)(?:的|那场|这场)?/u)?.[1];
        const locator=selectedDate??(!correcting?values.date:undefined);
        const dated=locator?exact.filter(item=>item.slots.date?.value===locator):[];
        if(dated.length===1)target=dated[0];
        else {ambiguousTopic={message:ref,reason:'存在多个同名事项，请说明具体哪一次；不代选或合并。'};continue;}
      }
      else if(same.length===1&&(/^(?:安排|考试|本餐)$/u.test(named.label)||restore))target=same[0];
      else if(same.length>1&&/^(?:安排|考试|本餐)$/u.test(named.label)){
        ambiguousTopic={message:ref,reason:'存在多个同类事项，请明确哪一个；不代选或合并。'};continue;
      }
      // A newly dated event after completion is not an implicit reopening of
      // the prior event merely because it has the same short label.
      if(target&&['resolved','cancelled'].includes(target.outcome)&&values.date&&!restore&&!cancel&&!defer&&!correcting)target=undefined;
      if(!target){
        if(!canEstablish(named.kind,clause,values,cancel||defer||restore)&&!examLabels.includes(named.label))continue;
        target={id:message.sessionId+':'+message.id+':'+named.kind+':'+named.label,kind:named.kind,label:named.label,outcome:'pending',source:[ref],anchorSource:ref,outcomeSource:[ref],slots:{},unresolvedSlots:{},slotHistory:[],lastEventOrder:++order,scope:'session',domain:ctx.domain,observedAt:message.createdAt};
        topics.push(target);
      }
    }else if(restore){
      const plans=topics.filter(t=>t.domain===ctx.domain&&t.kind==='plan');
      target=focus??(plans.length===1?plans[0]:undefined);
      if(!target&&plans.length>1)ambiguousTopic={message:ref,reason:'有多个可接续安排，需要选择具体事项。'};
    }else if(focus){
      const slotReply=slotDeclaration(clause,values);
      if(correcting||inlineCorrection||slotReply||cancel||defer||/^你(?:刚才|已经|已)?(?:回答|说清楚)(?:了)?/u.test(clause)||/^(?:周末)?(?:这个|这件|刚才)/u.test(clause))target=focus;
    }
    if(!target||target.kind==='preference'||target.kind==='residence')continue;
    focus=target;touched=true;eventTouched=true;
    if(clarifies(target))clarifiedPrior=true;
    if(named&&!cancel&&!defer&&/^(?:(?:我|明天|今天|后天)(?:明天|今天|后天)?)?(?:并|也)?(?:没有|没|并没有).*(?:面试|考试|会议|安排|计划|博物馆)/u.test(clause)){
      target.needsConfirmation=true;target.confirmationSource=ref;target.lastEventOrder=++order;continue;
    }
    if(target.needsConfirmation&&(restore||correcting||slotDeclaration(clause,values))){target.needsConfirmation=false;target.confirmationSource=undefined;}
    if(/^不是/u.test(clause)&&!inlineCorrection){
      for(const [field,value]of Object.entries(values))if(target.slots[field]?.value===value){
        target.slotHistory.push({...target.slots[field],field});delete target.slots[field];target.unresolvedSlots[field]=[ref];
      }
      target.lastEventOrder=++order;continue;
    }
    for(const [field,value]of Object.entries(values)){
      if(target.kind==='exam'&&!['date','time'].includes(field))continue;
      if(target.kind!=='plan'&&target.kind!=='exam'&&field!=='dish')continue;
      if(target.kind==='plan'&&field==='dish')continue;
      if(target.kind==='plan'&&!correcting&&!inlineCorrection&&!slotDeclaration(clause,values))continue;
      if(target.kind==='exam'&&!correcting&&!inlineCorrection&&!slotDeclaration((examReference?clause.slice(examReference.subject.length):clause.replace(target.label,'')).replace(/^(?:另外一场|另一场|又一场|这场)/u,''),values))continue;
      const old=target.slots[field];
      if(old?.value!==value){if(old)target.slotHistory.push({...old,field});target.slots[field]={value,source:[ref],observedAt:message.createdAt,utcOffsetMinutes:ctx.utcOffsetMinutes};}
      delete target.unresolvedSlots[field];
    }
    let outcome:TopicOutcome|undefined;
    if(cancel)outcome='cancelled';
    else if(defer)outcome='deferred';
    else if(restore)outcome='pending';
    else if(target.kind==='exam'&&/考完|结束了|已经结束|考过了/u.test(clause)&&!/还没|没有|尚未|没考完|没结束/u.test(clause))outcome='resolved';
    else if(target.kind==='conflict'&&/和好了|说开了|解决了/u.test(clause)&&!/还没|没有|尚未/u.test(clause))outcome='resolved';
    else if(target.kind==='meal'&&/吃过|吃完|吃好了/u.test(clause)&&!/还没|没有|尚未/u.test(clause))outcome='answered';
    else if(/你(?:刚才|已经|已)?(?:回答|说清楚)(?:了)?/u.test(clause))outcome='answered';
    if(outcome){target.outcome=outcome;target.outcomeSource=[ref];target.conclusion=clause;}
    target.lastEventOrder=++order;target.observedAt=message.createdAt;
  }
  if(!eventTouched&&facts.last)focus=facts.last;
  const replyBound=boundTopicReplies(topics.map(boundedRecord).sort((a,b)=>b.lastEventOrder-a.lastEventOrder).slice(0,8));
  const bounded=replyBound.topics;
  const slotQuestion=/^(?:那|这个|刚才的?|现在)?(?:安排|时间|日期|出发前)?(?:现在)?(?:是|要|在|需要)?(?:几点|哪天|什么时间|准备什么|怎么去)(?:了|呢|吗)?[？?。]*$/u.test(message.content.trim());
  if(!touched&&!resumedFocus&&!historical&&!slotQuestion&&!/先别分析|让我说完|先听我说|先别给建议|(?:接下来|这件事|这个安排).{0,8}(?:怎么准备|怎么办|如何|怎么选)/u.test(message.content))focus=undefined;
  if(!ambiguousTopic&&!clarifiedPrior)ambiguousTopic=previous.ambiguousTopic;
  return {topics:bounded,focusTopicId:focus&&bounded.some(t=>t.id===focus!.id)?focus.id:undefined,continuityFocus:previous.continuityFocus,appliedThrough:{...ref,observedAt:message.createdAt},ambiguousTopic,topicSourcesInvalidated:previous.topicSourcesInvalidated,topicRepliesLimited:previous.topicRepliesLimited||replyBound.limited,topicRepliesInvalidated:previous.topicRepliesInvalidated,topicPauses:pauses,topicPausesLimited:pausesLimited};
}

/** Only caller-validated records may reach this projection. Whole records are
 * omitted when they do not fit; old values stay explicitly historical. */
export function renderExplicitTopics(state:TopicStateFields,current:string|undefined,domain:TopicDomain,budget=1200):string{
  const header='[当前事项与结论]\n';
  const factGuidance=state.topics?.some(topic=>topic.domain===domain&&(topic.kind==='preference'||topic.kind==='residence'))?'偏好只在明确范围适用；白天与晚上分开，过去住址不作现居地；新同范围声明优先，不把建议或角色回复当用户事实。':'';
  const footer='\n同一事项以已确认现值为准，历史值可用于回答原先怎样。'+factGuidance+'相对日期按原话时间与时区解释，不按今天重算；answered不等于resolved，暂放不是取消，回忆过去不恢复行动。\n[/当前事项与结论]';
  if(!Number.isFinite(budget)||budget<header.length+footer.length)return '';
  const lines:string[]=[];
  let used=header.length+footer.length;
  const append=(line:string)=>{const size=line.length+(lines.length?1:0);if(used+size<=budget){lines.push(line);used+=size;}};
  if(state.topicSourcesInvalidated)append('部分旧事项来源已失效；没有用户重新确认的字段须待核，不能自动恢复旧值。');
  const categoryNames:Record<TopicRecord['kind'],string>={exam:'考试',meal:'用餐',conflict:'冲突',plan:'安排',preference:'喜好',residence:'住处'};
  for(const pause of state.topicPauses??[])if(pause.domain===domain)append(JSON.stringify({类别暂停:categoryNames[pause.category],范围:'本会话不主动重提；仅用户明确恢复可解除，不影响其他事项。'}));
  if(state.topicPausesLimited)append('类别控制记录已达容量边界，未列出不代表用户没有暂停；有疑问先核对原话。');
  const named=current===undefined?undefined:namedKind(withoutSetAsideTopicClauses(current));
  const scoped=(state.topics??[]).filter(topic=>topic.domain===domain);
  const namedMatches=named?scoped.filter(topic=>topic.kind===named.kind):[];
  const exactMatches=namedMatches.filter(topic=>topic.label===named?.label);
  const comparing=current!==undefined&&/(?:哪个|哪些|哪一场|哪一项).{0,12}(?:完成|结束|还没)/u.test(current);
  const selected=current===undefined||comparing?scoped:named?(exactMatches.length?exactMatches:namedMatches):scoped.filter(topic=>state.focusTopicId===topic.id);
  const topics=scoped.filter(topic=>selected.includes(topic)||topic.kind==='preference'||topic.kind==='residence');
  if(state.ambiguousTopic)append(state.ambiguousTopic.reason);
  const replies:string[]=[];
  for(const topic of topics){
    if(topic.needsConfirmation){
      append(JSON.stringify({事项:topic.label,状态:'待核',说明:'用户当前否定与旧记录存在歧义；先核对同一事项和时间范围，旧字段不是当前已确认事实。'}));continue;
    }
    const slots=Object.fromEntries(Object.entries(topic.slots).map(([field,slot])=>[field,{value:slot.value,...(field==='date'?{sourceTimeUtc:new Date(slot.observedAt).toISOString(),utcOffsetMinutes:slot.utcOffsetMinutes}: {})}]));
    const line=JSON.stringify({事项:topic.label,状态:topic.outcome,已知字段:slots,待核字段:Object.keys(topic.unresolvedSlots),历史值非现值:topic.slotHistory.map(slot=>({field:slot.field,value:slot.value}))});
    append(line);
    replies.push(...renderTopicReplies(topic));
  }
  // User-confirmed facts keep priority over optional speech annotations.
  if(state.topicRepliesInvalidated)append('部分角色旧回复来源已失效，不再作为已答依据；仍有效的用户事实保留。');
  if(state.topicRepliesLimited)append('这里只保留少量有来源的角色回应；记录缺省不代表从未回答，必要时查看原话。');
  for(const response of replies)append(response);
  if(!lines.length)return '';
  return header+lines.join('\n')+footer;
}
