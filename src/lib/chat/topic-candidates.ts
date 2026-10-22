import type {Character,Message} from '../../db';
import type {TopicEvidence,TopicRecord,TopicStateFields} from '../chat-topic-outcomes';
import type {OutputContract} from './output-contract';
import {topicCategoryPaused,topicFollowUpEligibility} from '../chat-topic-controls';
import {isTopicInvitation} from '../chat-expression-boundary';
import {isStandaloneClosing,hasExplicitTopicShift,conversationDeparture} from '../chat-turn-cues';
import {assessExpressionSignals} from '../chat-expression-guidance';
import {completeReplyBatch} from '../chat-topic-replies';
import {isIncompleteAssistantReply} from './reply-delivery';

type ChoiceKind='discovery'|'care'|'follow-up';
export interface ReplyPlan {
  userId:string;characterId:string;sessionId:string;sourceMessageId?:string;sourceRevision?:number;
  trigger:'user-message'|'return-visit';move:'respond'|'deepen'|'share'|'ask'|'shift'|'close';
  topicId?:string;angleKey?:string;sourceRefs:TopicEvidence[];outputContract:OutputContract;
  kind?:ChoiceKind;direction?:string;
}
export interface TopicCandidate {angleKey:string;kind:ChoiceKind;direction:string;topicId?:string;sourceRefs:TopicEvidence[];score:number}
export interface ReplyDirectionReceipt {angleKey:string;kind:ChoiceKind;topicId?:string;revision:number}
interface Input {
  userId:string;characterId:string;sessionId:string;trigger:ReplyPlan['trigger'];userText:string;
  character:Pick<Character,'name'|'tags'|'systemPrompt'>;recent:Message[];sourceMessage?:Message;composed?:boolean;
  /** Supplied only after the native source validator. This flag is not authorization. */
  topicsValidated:boolean;state?:TopicStateFields;now:number;
}
const angles=[
  {key:'fiction:mutual-choice',traits:/自主|独立|骄傲|双向|银龙王/gu,anchor:/银龙王|龙族|自主选择|双向关系/u,subject:'fiction',
    direction:'聊小说人物相爱后，怎样既珍惜对方也尊重彼此的心愿。说你自己的看法，重要决定中的分工沿用当前关系设定。',matches:/小说|人物|选择|相爱|珍惜|彼此|决定/u},
  {key:'fiction:quiet-care',traits:/清冷|克制|寡言|习剑|责任/gu,anchor:/天琊|小竹峰|青云门|习剑/u,subject:'fiction',
    direction:'聊小说里不善言辞的人如何让关心被看见。先说你更看重的一种表达与理由。',matches:/小说|人物|关心|在意|言辞|表达|陪伴/u},
  {key:'fiction:ending',traits:/阅读|读书|书籍|小说|故事/gu,subject:'fiction',
    direction:'聊一个故事的结尾是否必须圆满。说你此刻的取舍，可以讨论设想，无须编造读过哪本书。',matches:/故事|结尾|结局|圆满|遗憾/u},
  {key:'life:small-delight',traits:/元气|幽默|活泼|开朗|有趣/gu,subject:'life',
    direction:'聊生活里不起眼却能让人开心的小惊喜。说一种你觉得有趣的情形与看法，不写成今天发生过的经历。',matches:/生活|开心|惊喜|小事|有趣/u},
  {key:'life:quiet-moment',traits:/安静|温柔|细腻|茶|体贴/gu,subject:'life',
    direction:'聊热闹与安静各有什么可爱的地方。先说你的偏好与一个具体理由，不替用户判断身体或心情。',matches:/热闹|安静|宁静|独处/u},
  {key:'fiction:choice-cost',traits:/理性|聪慧|逻辑|推理|专业/gu,subject:'fiction',
    direction:'聊故事里做出正确选择是否总要付出代价。给一个清楚的个人判断，让对方有内容可接。',matches:/故事|选择|代价|判断|取舍/u},
  {key:'fiction:ordinary-day',traits:/想象|浪漫|故事|银龙王/gu,anchor:/银龙王|龙族/u,subject:'fiction',
    direction:'设想一个小说人物暂时没有正事的一天，选一件你想让他做的小事，说为什么觉得有趣。明确是设想，不当成已经发生的近况。',matches:/假如|要是|设想|假设/u},
] as const;
const ownText=(text:string)=>text.replace(/[“「『"][^”」』"]*[”」』"]/gu,'');
function matchesAngle(angleKey:string,text:string):boolean {
  const angle=angles.find(item=>item.key===angleKey);
  const own=ownText(text);
  if(!angle||text.trim().length<8||!angle.matches.test(own))return false;
  if(angleKey==='fiction:mutual-choice')return /相爱|彼此|自主|爱情|尊重|心愿/u.test(own)&&/选择|决定|双向|尊重|心愿|珍惜/u.test(own);
  if(angleKey==='fiction:quiet-care')return /关心|在意|表达/u.test(own)&&/话少|不善言辞|言辞|默默|沉默|寡言|克制/u.test(own);
  if(angleKey==='fiction:ending')return /结尾|结局/u.test(own);
  if(angleKey==='fiction:choice-cost')return /代价|取舍/u.test(own)&&/故事|人物|选择/u.test(own);
  if(angleKey==='fiction:ordinary-day')return /假如|要是|设想|假设/u.test(own)&&/我想|想让|可以|会选|想选/u.test(own);
  return true;
}
function publishedAngles(recent:Message[],sessionId:string):Set<string>{
  const found=new Set<string>(),byId=new Map(recent.map(row=>[row.id,row]));
  for(const row of [...recent].reverse()){
    const receipt=row.replyDirection;
    if(!receipt||row.sessionId!==sessionId||receipt.kind!=='discovery'||receipt.revision!==(row.revision??1)||isIncompleteAssistantReply(row))continue;
    const batch=row.replyBatchId?recent.filter(item=>item.replyBatchId===row.replyBatchId).sort((a,b)=>(a.replyBatchIndex??0)-(b.replyBatchIndex??0)):[row];
    const source=row.replyToUserMessageId?byId.get(row.replyToUserMessageId):undefined;
    const complete=row.isProactive?batch.length===1&&row.role==='assistant'&&!row.failed&&row.replyCompletion==='complete'
      :!!source&&completeReplyBatch(source,batch);
    if(complete&&matchesAngle(receipt.angleKey,batch.map(item=>item.content).join(''))){
      found.add(receipt.angleKey);
      // A short cooldown, not a permanent ban that eventually exhausts all subjects.
      if(found.size>=2)break;
    }
  }
  return found;
}
function premise(topic:TopicRecord):TopicEvidence[]{
  return [...new Map([topic.anchorSource,...topic.outcomeSource,...Object.values(topic.slots).flatMap(slot=>slot.source)]
    .map(ref=>[JSON.stringify(ref),ref])).values()];
}

/** A bounded, local choice for one existing main generation. No facts, grants,
 * timers or usage state are created by selection. Callers revalidate originals. */
export function selectReplyPlan(input:Input):{candidates:TopicCandidate[];plan:ReplyPlan}{
  const {userId,characterId,sessionId,trigger,userText,sourceMessage}=input;
  const plan:ReplyPlan={userId,characterId,sessionId,trigger,move:'respond',sourceRefs:[],outputContract:'dialogue-only',
    ...(sourceMessage?{sourceMessageId:sourceMessage.id,sourceRevision:sourceMessage.revision??1}:{})};
  const empty=()=>({candidates:[],plan});
  if(!userId||!characterId||!sessionId||input.composed)return empty();
  if(isStandaloneClosing(userText)||conversationDeparture(userText)){plan.move='close';return empty();}
  const signals=assessExpressionSignals(userText),invited=isTopicInvitation(userText);
  if(trigger==='user-message'&&(!invited||signals.request||signals.situation!=='neutral'&&signals.situation!=='tired'&&!hasExplicitTopicShift(userText)))return empty();
  const recent=input.recent.filter(row=>row.sessionId===sessionId&&!row.failed&&row.secretaryDispatch?.bodyOrigin!=='composed');
  const users=recent.filter(row=>row.role==='user').slice(-2);
  if(trigger==='return-visit'&&users.length===2&&users.every(row=>/^(?:嗯+|哦+|好[的吧]?|行|随便)[。.!！ ]*$/u.test(row.content.trim())))return empty();
  // Choosing a new subject deliberately leaves old unfinished matters alone.
  const candidates:TopicCandidate[]=[];
  if(trigger==='return-visit'&&!hasExplicitTopicShift(userText)&&input.topicsValidated&&input.state
    &&!input.state.ambiguousTopic&&!input.state.topicSourcesInvalidated&&!input.state.topicPausesLimited){
    for(const topic of (input.state.topics??[]).slice(0,8)){
      if(topic.domain!=='user-reality'||topicCategoryPaused(input.state,topic.kind,topic.domain))continue;
      const refs=premise(topic);if(!refs.length||refs.length>6)continue;
      const eligibility=topicFollowUpEligibility(topic,{now:input.now,coverageLimited:input.state.topicRepliesLimited||input.state.topicRepliesInvalidated});
      if(eligibility.kind==='none'||eligibility.kind==='follow-up'&&topic.responses?.some(record=>record.acts.some(act=>act.kind==='asked')))continue;
      const kind=eligibility.kind;
      candidates.push({angleKey:kind+':'+topic.id,topicId:topic.id,kind,sourceRefs:refs,score:kind==='care'?20:10,
        direction:kind==='care'?`这件事已有明确结束结论：${JSON.stringify(topic.label)}。只给一次简短的放松关心，不再问是否完成，不扩大成安慰或安排清单。`
          :`沿用尚未结束的事项：${JSON.stringify(topic.label)}。只问一个尚未说清的近况，不重问已有字段，也不假定结果。`});
    }
  }
  const used=publishedAngles(recent,sessionId),persona=input.character.tags.join(' ')+' '+input.character.systemPrompt;
  const subject=/小说|故事|人物关系|阅读/u.test(userText)?'fiction':/生活小事|日常|生活/u.test(userText)?'life':undefined;
  const light=/轻松|不想说大道理/u.test(userText)||signals.situation==='tired';
  for(const angle of angles){
    if(subject&&angle.subject!==subject||used.has(angle.key))continue;
    if(light&&!['fiction:ordinary-day','life:small-delight','life:quiet-moment'].includes(angle.key))continue;
    const distinct=(text:string)=>new Set([...text.matchAll(new RegExp(angle.traits.source,'gu'))].map(match=>match[0])).size;
    candidates.push({angleKey:angle.key,kind:'discovery',sourceRefs:[],direction:angle.direction,
      score:1+Math.min(3,distinct(persona))+2*distinct(input.character.tags.join(' '))+('anchor'in angle&&angle.anchor.test(persona)?10:0)});
  }
  // Semantic keys are stable concepts, not hashes of newly paraphrased text.
  candidates.sort((a,b)=>b.score-a.score||a.angleKey.localeCompare(b.angleKey));
  const bounded=candidates.slice(0,6),selected=bounded[0];
  if(selected)Object.assign(plan,selected,{move:selected.kind==='follow-up'?'ask':trigger==='user-message'&&hasExplicitTopicShift(userText)?'shift':'share'});
  return {candidates:bounded,plan};
}

export function replyPlanSection(plan:ReplyPlan|undefined):string{
  return plan?.angleKey&&plan.direction?'[本轮选题]\n'+plan.direction+'\n这是本轮唯一内容方向，直接聊内容，不让用户再选题；它不证明任何经历已经发生。\n[/本轮选题]':'';
}
/** Annotate only final, completed matching speech. The caller persists these
 * rows in its existing owned transaction; a prefix or a failed draft earns none. */
export function recordPublishedDirection(plan:ReplyPlan|undefined,rows:Message[]):Message[]{
  if(!plan?.angleKey||!plan.kind||!rows.length||rows.some(row=>row.sessionId!==plan.sessionId||row.role!=='assistant'||row.failed||isIncompleteAssistantReply(row)||row.replyCompletion!=='complete'))return rows;
  if(plan.trigger==='user-message'&&(!plan.sourceMessageId||rows.some(row=>row.isProactive||row.replyToUserMessageId!==plan.sourceMessageId)))return rows;
  if(plan.trigger==='return-visit'&&(rows.length!==1||!rows[0].isProactive))return rows;
  if(plan.kind!=='discovery'||!matchesAngle(plan.angleKey,rows.map(row=>row.content).join('')))return rows;
  return rows.map((row,index)=>index===rows.length-1?{...row,replyDirection:{angleKey:plan.angleKey!,kind:plan.kind!,revision:row.revision??1}}:row);
}
