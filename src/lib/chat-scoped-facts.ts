/** Literal user declarations with an explicit scope. They are bounded session
 * evidence, not permanent preferences, inferred routines or generated facts. */
import type {TopicRecord,TopicSourceContext,TopicEvidence,TopicSlot} from './chat-topic-outcomes';
import {withoutSetAsideTopicClauses} from './chat-turn-cues';
export function scopedFactClauses(content:string):string[]{
 const clean=withoutSetAsideTopicClauses(content).slice(0,4000).replace(/[“「『"][^”」』"]*[”」』"]/gu,quoted=>' '.repeat(quoted.length));
 return (clean.match(/[^。！？!?\n]+[。！？!?]?/gu)??[]).filter(sentence=>!/[？?]/u.test(sentence)
  &&!/^(?:他|她|他们|她们|朋友|同事|如果|假如|假设|比如|例如|翻译|解释|(?:帮我|给我|替我|请你)(?:写|翻译)|写一句|写一段|我(?:刚才)?听说)/u.test(sentence.trim())
  &&!/^[^，,：:]{1,16}(?:说|表示|提到|问)[，,：:]/u.test(sentence.trim()))
  .flatMap(sentence=>sentence.replace(/[。！!]$/u,'').split(/[，,；;]/u)).map(clause=>clause.trim()).filter(Boolean);
}
export interface ScopedDeclaration {
 kind:'preference'|'residence';period:string;object?:string;stance?:string;place?:string;
 explicitSelf:boolean;
}
export function parseScopedDeclaration(clause:string):ScopedDeclaration|undefined{
 const text=clause.normalize('NFKC').trim().replace(/[。！!]+$/u,'');
 if(/[？?吗么]|哪[里儿个]?|什么|怎么|为何|是否|可能|大概|如果|假如|假设|应该|也许|似乎|听说|朋友|同事|的人|的时候|[“”「」『』"']/u.test(text))return;
 const drink=text.match(/^(我)?(?:现在)?(早上|上午|中午|下午|傍晚|晚上|白天|夜里|工作日|周末|今晚|今天)(我)?(?:现在|还是|也|仍然|仍|一直|会|都会|一般|通常)*(不再喝|不会喝|不喝|喝)([\p{L}\p{N}]{0,16}?)(?:了)?$/u);
 if(drink){
  const object=drink[5];if(object&&/的|因为|所以|但是|怎么|为什|时候|或者|还是|不是/u.test(object))return;
  return {kind:'preference',period:drink[2],object:object||undefined,stance:drink[4],explicitSelf:!!(drink[1]||drink[3])};
 }
 const residence=text.match(/^(我)?(以前|过去|曾经|原来|现在|目前)(?:住在|住)([\p{L}\p{N}]{1,30}?)(?:了)?$/u);
 if(residence&&!/的|现在|目前|以前|过去|或者|还是|不是/u.test(residence[3]))return {kind:'residence',period:residence[2],place:residence[3],explicitSelf:!!residence[1]};
}
export const isHistoricalResidence=(period:string)=>['以前','过去','曾经','原来'].includes(period);
const labelFor=(kind:ScopedDeclaration['kind'],period:string,object?:string,place?:string)=>kind==='preference'?object+'·'+period:'居住地·'+(isHistoricalResidence(period)?period+'·'+place:'当前');

/** A whole original may contain both positive and negative clauses. Matching
 * individual words anywhere in it is insufficient proof of the scoped claim. */
export function supportsScopedFact(topic:TopicRecord,byId:Map<string,{content:string}>):boolean{
 if(topic.kind!=='preference'&&topic.kind!=='residence')return true;
 const period=topic.slots.period?.value,object=topic.slots.object?.value,place=topic.slots.place?.value;
 if(!period||topic.outcome!=='answered'||topic.label!==labelFor(topic.kind,period,object,place))return false;
 const claim=topic.kind==='preference'?topic.slots.stance:topic.slots.place;
 if(!claim||topic.kind==='preference'&&!object)return false;
 return claim.source.some(ref=>{
  const source=byId.get(ref.messageId);if(!source)return false;
  return scopedFactClauses(source.content.slice(ref.start,ref.end)).some(clause=>{
   const assertion=parseScopedDeclaration(clause);
   return assertion?.kind===topic.kind&&assertion.period===period
    &&(topic.kind==='preference'?assertion.stance===claim.value&&(!assertion.object||assertion.object===object):assertion.place===place);
  });
 });
}

export function advanceScopedFacts(topics:TopicRecord[],ctx:TopicSourceContext,clauses:string[],order:number){
 const ref:TopicEvidence={messageId:ctx.message.id,revision:ctx.message.revision??1,start:0,end:Math.min(ctx.message.content.length,4000)};
 let last:TopicRecord|undefined,selfInMessage=false,ambiguous:string|undefined;
 for(const clause of clauses){
  const assertion=parseScopedDeclaration(clause);if(!assertion)continue;
  const scoped=topics.filter(topic=>topic.kind===assertion.kind&&topic.domain===ctx.domain);
  // Omitted subjects are accepted only inside an explicit self declaration or
  // while continuing an already sourced declaration, never from third parties.
  if(!assertion.explicitSelf&&!selfInMessage&&!scoped.length)continue;
  selfInMessage||=assertion.explicitSelf;
  let object=assertion.object,objectSlot:TopicSlot|undefined;
  if(assertion.kind==='preference'&&!object){
   const samePeriod=scoped.filter(topic=>topic.slots.period?.value===assertion.period);
   const options=new Map((samePeriod.length?samePeriod:scoped).filter(topic=>topic.slots.object).map(topic=>[topic.slots.object.value,topic.slots.object]));
   if(options.size!==1){if(options.size>1)ambiguous='同一范围有多项饮用习惯，请说明指咖啡、茶或哪一项；未确认前不改原值。';continue;}
   [object,objectSlot]=[...options][0];
  }
  const label=labelFor(assertion.kind,assertion.period,object,assertion.place);
  const matches=scoped.filter(topic=>topic.label===label);
  if(matches.length>1)continue;
  let target=matches[0];
  if(!target){
   target={id:ctx.message.sessionId+':'+ctx.message.id+':'+assertion.kind+':'+label,kind:assertion.kind,label,outcome:'answered',source:[ref],anchorSource:ref,outcomeSource:[ref],slots:{},unresolvedSlots:{},slotHistory:[],lastEventOrder:++order,scope:'session',domain:ctx.domain,observedAt:ctx.message.createdAt};
   topics.push(target);
  }
  const values:Record<string,string>={period:assertion.period,...(assertion.kind==='preference'?{object:object!,stance:assertion.stance!}:{place:assertion.place!})};
  for(const [field,value]of Object.entries(values)){
   const old=target.slots[field];
   if(old&&old.value!==value)target.slotHistory.push({...old,field});
   // A complete same-value reconfirmation still refreshes its evidence. In
   // particular, 现在/目前 and an unchanged place must belong to one assertion.
   target.slots[field]=field==='object'&&objectSlot?objectSlot:{value,source:[ref],observedAt:ctx.message.createdAt,utcOffsetMinutes:ctx.utcOffsetMinutes};
  }
  target.outcomeSource=[ref];target.lastEventOrder=++order;target.observedAt=ctx.message.createdAt;last=target;
 }
 return {order,last,ambiguous};
}
