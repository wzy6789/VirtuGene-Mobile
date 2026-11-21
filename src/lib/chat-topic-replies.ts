/** Literal, source-backed speech acts. These never create user facts or close
 * an event; semantic answers outside the small known-slot set remain replies. */
import type {Message} from '../db';
import type {TopicEvidence,TopicRecord,TopicStateFields,TopicDomain} from './chat-topic-outcomes';
import {replyContainsSubstantiveQuestion} from './chat-expression-guidance';
import {hasSettledReplyDelivery} from './chat/reply-delivery';

export const TOPIC_REPLIES_PER_TOPIC=2;
export const TOPIC_REPLIES_TOTAL=4;
const fields=['date','time','transport','place','dish'];
export interface TopicReplyRecord {
  /** A return visit has no new user turn and can prove only actual care speech. */
  origin?:'return-visit';
  id:string;userSource:TopicEvidence;replyTurnId:string;replySources:TopicEvidence[];
  acts:Array<{kind:'responded'|'asked';source:TopicEvidence[]}|{
    kind:'answered-slot';field:string;value:string;slotSource:TopicEvidence[];source:TopicEvidence[];
  }|{
    kind:'gave-guidance';purpose:'preparation'|'explanation'|'choice';premise:TopicEvidence[];source:TopicEvidence[];
  }|{
    kind:'user-answered-slot';field:string;value:string;slotSource:TopicEvidence[];source:TopicEvidence[];
    questionSource:TopicEvidence;questionUserSource:TopicEvidence;questionReplySources:TopicEvidence[];questionTurnId:string;
  }|{
    kind:'care';premise:TopicEvidence[];source:TopicEvidence[];
  }>;
  excerpt:{text:string;source:TopicEvidence};observedAt:number;
}
const refKey=(ref:TopicEvidence)=>JSON.stringify([ref.messageId,ref.revision,ref.start,ref.end]);
const sameRefs=(left:TopicEvidence[],right:TopicEvidence[])=>JSON.stringify(left.map(refKey).sort())===JSON.stringify(right.map(refKey).sort());
const whole=(row:Message):TopicEvidence=>({messageId:row.id,revision:row.revision??1,start:0,end:Math.min(row.content.length,4000)});
const inside=(ref:TopicEvidence,container:TopicEvidence)=>ref.messageId===container.messageId&&ref.revision===container.revision&&ref.start>=container.start&&ref.end<=container.end;
function validRef(ref:TopicEvidence){
  return !!ref&&typeof ref.messageId==='string'&&!!ref.messageId&&Number.isSafeInteger(ref.revision)&&ref.revision>0
    &&Number.isSafeInteger(ref.start)&&Number.isSafeInteger(ref.end)&&ref.start>=0&&ref.end>ref.start&&ref.end<=4000;
}
function topicPremise(topic:TopicRecord):TopicEvidence[]{
  return [...new Map([topic.anchorSource,...topic.outcomeSource,...Object.values(topic.slots).flatMap(slot=>slot.source)].map(ref=>[refKey(ref),ref])).values()];
}
function premiseMatches(topic:TopicRecord,record:TopicReplyRecord){
  return record.acts.every(act=>act.kind==='gave-guidance'||act.kind==='care'?sameRefs(act.premise,topicPremise(topic))
    :act.kind!=='answered-slot'&&act.kind!=='user-answered-slot'||!!topic.slots[act.field]
      &&topic.slots[act.field].value===act.value&&sameRefs(topic.slots[act.field].source,act.slotSource));
}
export function boundTopicReplies(topics:TopicRecord[]){
  let limited=false;
  const bounded=topics.map(topic=>{
    const current=(topic.responses??[]).filter(record=>premiseMatches(topic,record));
    const responses=current.slice(-TOPIC_REPLIES_PER_TOPIC);
    if(responses.length<current.length)limited=true;
    return {...topic,...(topic.responses?{responses}:{})};
  });
  const ordered=bounded.flatMap(topic=>topic.responses??[]).sort((a,b)=>b.observedAt-a.observedAt||a.id.localeCompare(b.id));
  const retained=new Set(ordered.slice(0,TOPIC_REPLIES_TOTAL));
  if(ordered.length>retained.size)limited=true;
  return {topics:bounded.map(topic=>({...topic,...(topic.responses?{responses:topic.responses.filter(record=>retained.has(record))}:{})})),limited};
}

/** Shape/declared sources only; actual roles, ownership and batch state must
 * still be checked against freshly read originals below. */
export function replyRecordSources(topic:TopicRecord,record:TopicReplyRecord):TopicEvidence[]|undefined{
  try{
    if(!record||(record.origin!==undefined&&record.origin!=='return-visit')||typeof record.id!=='string'||typeof record.replyTurnId!=='string'||!record.replyTurnId
      ||!validRef(record.userSource)||!Array.isArray(record.replySources)||!record.replySources.length||record.replySources.length>4
      ||new Set(record.replySources.map(ref=>ref.messageId)).size!==record.replySources.length
      ||!record.replySources.every(validRef)||!Array.isArray(record.acts)||!record.acts.length||record.acts.length>3
      ||!Number.isFinite(record.observedAt)||!Number.isFinite(new Date(record.observedAt).getTime())
      ||!record.excerpt||typeof record.excerpt.text!=='string'||!record.excerpt.text||record.excerpt.text.length>160
      ||!validRef(record.excerpt.source)||!record.replySources.some(ref=>inside(record.excerpt.source,ref)))return;
    const refs=[record.userSource,...record.replySources,record.excerpt.source];
    const kinds=new Set<string>();
    for(const act of record.acts){
      if(!['responded','asked','answered-slot','gave-guidance','user-answered-slot','care'].includes(act.kind)||kinds.has(act.kind)||!Array.isArray(act.source)
        ||!act.source.length||act.source.length>4||!act.source.every(ref=>validRef(ref)&&record.replySources.some(parent=>inside(ref,parent))))return;
      kinds.add(act.kind);refs.push(...act.source);
      if(act.kind==='answered-slot'||act.kind==='user-answered-slot'){
        if(!fields.includes(act.field)||typeof act.value!=='string'||!act.value||act.value.length>160
          ||!Array.isArray(act.slotSource)||!act.slotSource.length||act.slotSource.length>6||!act.slotSource.every(validRef))return;
        refs.push(...act.slotSource);
      }
      if(act.kind==='gave-guidance'||act.kind==='care'){
        if(!Array.isArray(act.premise)||act.premise.length>6||!act.premise.length||!act.premise.every(validRef))return;
        if(act.kind==='gave-guidance'&&!['preparation','explanation','choice'].includes(act.purpose))return;
        refs.push(...act.premise);
      }
      if(act.kind==='user-answered-slot'){
        if(!validRef(act.questionSource)||!validRef(act.questionUserSource)||!Array.isArray(act.questionReplySources)
          ||!act.questionReplySources.length||act.questionReplySources.length>4||!act.questionReplySources.every(validRef)
          ||!act.questionReplySources.some(parent=>inside(act.questionSource,parent))||!act.questionTurnId)return;
        refs.push(act.questionSource,act.questionUserSource,...act.questionReplySources);
      }
    }
    if((record.origin==='return-visit'?kinds.size!==1||!kinds.has('care'):!kinds.has('responded'))||!premiseMatches(topic,record))return;
    return refs;
  }catch{return;}
}

function requestedField(text:string):string|undefined{
  if(/[“”「」『』"']|不是问|不问|不用回答|不需要|没问|不是让|假设|如果|引用|翻译|他说|她说/u.test(text))return;
  if(!/[？?]|几点|哪天|什么时候|怎么去|吃的什么|是什么|在哪/u.test(text))return;
  if(/几点|什么时间/u.test(text))return 'time';
  if(/哪天|什么日期|几月几日/u.test(text))return 'date';
  if(/怎么去|坐什么|乘什么/u.test(text))return 'transport';
  if(/去哪|哪里|在哪/u.test(text))return 'place';
  if(/吃的什么|吃了什么/u.test(text))return 'dish';
}
function requestedGuidance(text:string):'preparation'|'explanation'|'choice'|undefined{
  if(/[“”「」『』"']|如果|假设|翻译|他说|她说|不用|不需要|不要|先别/u.test(text))return;
  if(/(?:接下来|这件事|这个安排).{0,8}(?:怎么准备|怎么办|如何准备)|(?:帮我|给我).{0,4}(?:准备建议|建议)/u.test(text))return 'preparation';
  if(/(?:这件事|这个安排|刚才那点).{0,8}(?:为什么|怎么理解)|(?:帮我|给我|请你).{0,4}解释/u.test(text))return 'explanation';
  if(/(?:这件事|这个安排|接下来).{0,8}(?:怎么选|如何选)|(?:帮我|替我).{0,4}(?:选一个|做选择)/u.test(text))return 'choice';
}
function hasGuidanceContent(rows:Message[]):boolean{
  const text=rows.map(row=>row.content).join('');
  return text.trim().length>=8&&!replyContainsSubstantiveQuestion([text])&&!/^(?:不知道|我不知道|不清楚|我也没办法|我不想说)/u.test(text.trim());
}
function relaxationCare(text:string):boolean{
  const own=text.replace(/[“「『"][^”」』"]*[”」』"]/gu,'');
  return own.split(/[。！？!?；;\n]/u).some(clause=>/歇一会|休息|放松|缓一缓/u.test(clause)
    &&!/(?:不要|不用|别|不必|不能|不想|不该|不适合|没时间|没有时间|先不|不)(?:再|去|先|好好|着急|急着)?(?:休息|放松|歇|缓)/u.test(clause));
}
function isCompletionResponse(topic:TopicRecord,user:Message):boolean{
  return ['resolved','answered'].includes(topic.outcome)&&topic.outcomeSource.some(ref=>ref.messageId===user.id&&ref.revision===(user.revision??1));
}
function affirmative(text:string,value:string,field:string){
  // A substring does not answer a value: 14点半/114点/14点前 are different.
  // Only small, affirmative whole-sentence forms qualify; richer wording is
  // still retained as responded, never treated as a new current user fact.
  const prefixes:Record<string,string>={time:'是|就是|还是|仍是|时间是|时间定在|定在',date:'是|就是|还是|仍是|日期是|日期定在|定在',
    transport:'坐|乘|搭|是|就是|还是坐|还是乘',place:'在|去|是|就是|还是去|还是在',dish:'吃的是|是|就是|还是'};
  const prefix=prefixes[field];if(prefix===undefined)return false;
  const escaped=value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const sentence=text.trim().replace(/[。！!]+$/u,'').trim();
  return new RegExp('^(?:'+prefix+')?'+escaped+'(?:啊|呀|哦|哟|的)?$','u').test(sentence);
}
function affirmativeSources(row:Message,value:string,field:string):TopicEvidence[]{
  return [...row.content.slice(0,4000).matchAll(/[^。！？!?\n]+[。！？!?]?/gu)]
    .filter(match=>affirmative(match[0],value,field)).map(match=>({...whole(row),start:match.index!,end:match.index!+match[0].length}));
}
function questionSource(row:Message):TopicEvidence|undefined{
  for(const match of row.content.slice(0,4000).matchAll(/[^。！？!?\n]+[？?]+/gu)){
    if(!/[“”「」『』"']|^(?:如果|假设|假如|他|她|朋友|原话|用户说)/u.test(match[0].trim())
      &&replyContainsSubstantiveQuestion([match[0]]))return {...whole(row),start:match.index!,end:match.index!+match[0].length};
  }
}
export function completeReplyBatch(user:Message,rows:Message[],turnId?:string){
  if(user.role!=='user'||user.failed||user.secretaryDispatch?.bodyOrigin==='composed'||!rows.length||rows.length>4)return false;
  const turn=rows[0].replyBatchId??rows[0].id;
  if(turnId!==undefined&&turnId!==turn)return false;
  return rows.every((row,index)=>row.sessionId===user.sessionId&&row.role==='assistant'&&!row.failed&&!row.isProactive
    &&!row.interrupted&&!row.stopped&&hasSettledReplyDelivery(row)&&row.replyCompletion==='complete'&&row.replyToUserMessageId===user.id
    &&Number.isFinite(row.createdAt)&&row.createdAt>user.createdAt&&(index===0||row.createdAt>rows[index-1].createdAt)
    &&(row.replyBatchId??row.id)===turn&&(rows.length===1&&!row.replyBatchId
      ?row.replyBatchIndex===undefined&&row.replyBatchSize===undefined
      :!!row.replyBatchId&&row.replyBatchIndex===index&&row.replyBatchSize===rows.length));
}

function completeVisitCare(topic:TopicRecord,user:Message,message:Message):boolean{
  return user.role==='user'&&!user.failed&&user.secretaryDispatch?.bodyOrigin!=='composed'&&isCompletionResponse(topic,user)
    &&message.sessionId===user.sessionId&&message.role==='assistant'&&message.isProactive&&!message.failed
    &&!message.interrupted&&!message.stopped&&hasSettledReplyDelivery(message)&&message.replyCompletion==='complete'
    &&!message.replyToUserMessageId&&!message.replyBatchId&&Number.isFinite(message.createdAt)&&message.createdAt>user.createdAt
    &&relaxationCare(message.content)&&!replyContainsSubstantiveQuestion([message.content]);
}
/** Called inside the existing publication transaction after selected originals
 * have been reread. No synthetic user message, answered slot or outcome change. */
export function appendReturnVisitCareEvidence<T extends TopicStateFields>(state:T,topicId:string,user:Message,message:Message):T{
  const topic=state.topics?.find(item=>item.id===topicId&&!item.needsConfirmation);
  if(!topic||state.ambiguousTopic||state.topicRepliesLimited||topic.responses?.some(record=>record.acts.some(act=>act.kind==='care'))
    ||!completeVisitCare(topic,user,message))return state;
  const userSource=whole(user),replySources=[whole(message)],premise=topicPremise(topic);
  if(premise.length>6||!validRef(userSource)||!replySources.every(validRef))return state;
  const record:TopicReplyRecord={id:user.id+'@'+(user.revision??1)+':visit:'+message.id,origin:'return-visit',userSource,
    replyTurnId:message.id,replySources,acts:[{kind:'care',premise,source:replySources}],
    excerpt:{text:message.content.slice(0,160),source:{...whole(message),end:Math.min(160,message.content.length)}},observedAt:message.createdAt};
  const bounded=boundTopicReplies(state.topics!.map(item=>item===topic?{...item,responses:[...(item.responses??[]),record]}:item));
  return {...state,topics:bounded.topics,topicRepliesLimited:state.topicRepliesLimited||bounded.limited};
}

/** Complete, selected messages must already be durable within the caller's
 * transaction. Never pass raw model text or a preview-only draft here. */
export function appendTopicReplyEvidence<T extends TopicStateFields>(state:T,user:Message,rows:Message[],domain:TopicDomain):T{
  if(!completeReplyBatch(user,rows)||state.ambiguousTopic)return state;
  const topic=state.topics?.find(item=>item.id===state.focusTopicId&&item.domain===domain&&!item.needsConfirmation);
  if(!topic)return state;
  const userSource=whole(user),replySources=rows.map(whole);
  if(!validRef(userSource)||replySources.some(ref=>!validRef(ref)))return state;
  const replyTurnId=rows[0].replyBatchId??rows[0].id;
  const acts:TopicReplyRecord['acts']=[{kind:'responded',source:replySources}];
  const field=requestedField(user.content.slice(userSource.start,userSource.end)),slot=field?topic.slots[field]:undefined;
  if(field&&slot){
    for(const row of rows){
      const source=affirmativeSources(row,slot.value,field)[0];
      if(source){acts.push({kind:'answered-slot',field,value:slot.value,slotSource:slot.source,source:[source]});break;}
    }
  }
  const question=rows.map(questionSource).find(ref=>ref!==undefined);
  if(question)acts.push({kind:'asked',source:[question]});
  if(!acts.some(act=>act.kind==='answered-slot')){
    const purpose=requestedGuidance(user.content);
    if(purpose&&hasGuidanceContent(rows))acts.push({kind:'gave-guidance',purpose,premise:topicPremise(topic),source:replySources});
    else if(!question){
      for(const prior of [...(topic.responses??[])].reverse()){
        const asked=prior.acts.find(act=>act.kind==='asked');
        if(!asked)continue;
        const field=asked.source.map(ref=>prior.excerpt.source.messageId===ref.messageId?requestedField(prior.excerpt.text.slice(Math.max(0,ref.start-prior.excerpt.source.start),ref.end-prior.excerpt.source.start)):undefined).find(Boolean);
        const slot=field?topic.slots[field]:undefined;
        if(field&&slot&&slot.source.some(ref=>ref.messageId===user.id&&ref.revision===userSource.revision)
          &&user.content.includes(slot.value)){
          acts.push({kind:'user-answered-slot',field,value:slot.value,slotSource:slot.source,source:replySources,
            questionSource:asked.source[0],questionUserSource:prior.userSource,questionReplySources:prior.replySources,questionTurnId:prior.replyTurnId});
          break;
        }
      }
    }
  }
  const careSources=isCompletionResponse(topic,user)?rows.filter(row=>relaxationCare(row.content)).map(whole):[];
  const careOverflow=careSources.length>0&&acts.length>=3;
  if(careSources.length&&!careOverflow)acts.push({kind:'care',premise:topicPremise(topic),source:careSources});
  const excerptRow=rows.find(row=>row.content.trim().length>8)??rows[0];
  const excerpt={source:{...whole(excerptRow),end:Math.min(excerptRow.content.length,160)},text:excerptRow.content.slice(0,160)};
  const record:TopicReplyRecord={id:user.id+'@'+(user.revision??1)+':'+replyTurnId,userSource,replyTurnId,replySources,acts,excerpt,observedAt:rows[rows.length-1].createdAt};
  const responses=[...(topic.responses??[]).filter(prior=>prior.userSource.messageId!==user.id||prior.userSource.revision!==userSource.revision),record];
  const bounded=boundTopicReplies(state.topics!.map(item=>item===topic?{...item,responses}:item));
  return {...state,topics:bounded.topics,topicRepliesLimited:state.topicRepliesLimited||bounded.limited||careOverflow};
}

/** An invalid role reply is removed independently of still-valid user facts. */
export function supportsTopicReply(topic:TopicRecord,record:TopicReplyRecord,byId:ReadonlyMap<string,Message>,suppressed:ReadonlySet<string>):boolean{
  const refs=replyRecordSources(topic,record);if(!refs)return false;
  for(const ref of refs){const row=byId.get(ref.messageId);if(!row||(row.revision??1)!==ref.revision||ref.end>row.content.length||suppressed.has(row.id))return false;}
  const user=byId.get(record.userSource.messageId)!,rows=record.replySources.map(ref=>byId.get(ref.messageId)!);
  if(refKey(record.userSource)!==refKey(whole(user)))return false;
  if(record.origin==='return-visit'){
    if(rows.length!==1||record.replyTurnId!==rows[0].id||!completeVisitCare(topic,user,rows[0])
      ||record.id!==user.id+'@'+(user.revision??1)+':visit:'+rows[0].id)return false;
  }else if(!completeReplyBatch(user,rows,record.replyTurnId)||record.id!==user.id+'@'+(user.revision??1)+':'+record.replyTurnId)return false;
  if(record.observedAt!==rows[rows.length-1].createdAt)return false;
  if(record.replySources.some((ref,i)=>refKey(ref)!==refKey(whole(rows[i]))))return false;
  const excerpt=byId.get(record.excerpt.source.messageId)!;
  if(excerpt.content.slice(record.excerpt.source.start,record.excerpt.source.end)!==record.excerpt.text)return false;
  for(const act of record.acts){
    if(act.kind==='responded'&&!sameRefs(act.source,record.replySources))return false;
    if(act.kind==='asked'&&!act.source.every(ref=>{const expected=questionSource(byId.get(ref.messageId)!);return expected&&refKey(ref)===refKey(expected);}))return false;
    if(act.kind==='answered-slot'){
      if(requestedField(user.content.slice(record.userSource.start,record.userSource.end))!==act.field)return false;
      if(!act.slotSource.every(ref=>{const row=byId.get(ref.messageId)!;return row.role==='user'&&row.sessionId===user.sessionId&&row.secretaryDispatch?.bodyOrigin!=='composed'&&row.content.slice(ref.start,ref.end).includes(act.value);}))return false;
      if(!act.source.every(ref=>affirmativeSources(byId.get(ref.messageId)!,act.value,act.field).some(expected=>refKey(expected)===refKey(ref))))return false;
    }
    if(act.kind==='gave-guidance'){
      if(requestedGuidance(user.content)!==act.purpose||!hasGuidanceContent(rows)||!sameRefs(act.source,record.replySources))return false;
    }
    if(act.kind==='care'){
      if(!isCompletionResponse(topic,user)||!act.source.every(ref=>relaxationCare(byId.get(ref.messageId)!.content.slice(ref.start,ref.end))))return false;
    }
    if(act.kind==='user-answered-slot'){
      const questionUser=byId.get(act.questionUserSource.messageId)!,questionRows=act.questionReplySources.map(ref=>byId.get(ref.messageId)!);
      if(!completeReplyBatch(questionUser,questionRows,act.questionTurnId)||refKey(act.questionUserSource)!==refKey(whole(questionUser))
        ||!act.questionReplySources.every((ref,index)=>refKey(ref)===refKey(whole(questionRows[index])))
        ||questionRows[questionRows.length-1].createdAt>=user.createdAt)return false;
      const questionRow=byId.get(act.questionSource.messageId)!;
      const expected=questionSource(questionRow);
      if(!expected||refKey(expected)!==refKey(act.questionSource)||requestedField(questionRow.content.slice(expected.start,expected.end))!==act.field
        ||!user.content.includes(act.value)||!act.slotSource.some(ref=>ref.messageId===user.id&&ref.revision===record.userSource.revision))return false;
    }
  }
  return true;
}

export function renderTopicReplies(topic:TopicRecord):string[]{
  return (topic.responses??[]).map(record=>JSON.stringify({角色回应记录:{
    已答槽位:record.acts.filter(act=>act.kind==='answered-slot').map(act=>act.kind==='answered-slot'?{字段:act.field,值:act.value}:{}),
    曾追问:record.acts.some(act=>act.kind==='asked'),内容摘录:record.excerpt.text,
    用户已补字段:record.acts.filter(act=>act.kind==='user-answered-slot').map(act=>act.kind==='user-answered-slot'?{字段:act.field,值:act.value}:{}),
    已回应建议目标:record.acts.filter(act=>act.kind==='gave-guidance').map(act=>act.kind==='gave-guidance'?act.purpose:undefined),
    已放松关怀:record.acts.some(act=>act.kind==='care'),
    边界:'仅证明角色这批实际说过的话，不是用户确认或事项完成；用户新提问和更正优先。',
  }}));
}
