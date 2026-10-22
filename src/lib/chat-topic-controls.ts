import type {TopicRecord,TopicStateFields,TopicDomain} from './chat-topic-outcomes';
const RESTORE_LEAD='(?:(?:现在|那|我们|咱们|请|请你|请帮我|帮我|替我|麻烦你|麻烦帮我)\\s*){0,3}';
const RESTORE_VERB='(?:继续|接着|恢复|重新开始|重新商量)';
const RESTORE_PREFIX=new RegExp('^'+RESTORE_LEAD+RESTORE_VERB,'u');
const RESTORE_POSTFIX=new RegExp('^'+RESTORE_LEAD+'(?:把|将).+?'+RESTORE_VERB+'(?:一下|吧|了)?$','u');
const RESTORE_BARE=new RegExp('^'+RESTORE_LEAD+RESTORE_VERB+'(?:吧|一下)?$','u');

/** A command and a later practical question are distinct clauses. A question
 * about restoring, or continuing an unrelated activity, is not a control act. */
export function explicitTopicRestore(clause:string,original:string,named:boolean,hasFocus:boolean,sourceStart=original.indexOf(clause)):boolean{
  if(!RESTORE_PREFIX.test(clause)&&!RESTORE_POSTFIX.test(clause))return false;
  if(/吗|么|是否|能否|可否|是不是|有没有|不合适|不可能|不需要|不要|不用|不想|不打算|不准备|不能|不该|不应该|先别|先不|再说|算了|这个词|这句话|这几个字|的意思|怎么说|翻译|如果|假如|假设/u.test(clause))return false;
  const at=sourceStart;
  if(at>=0&&/^\s*[？?]/u.test(original.slice(at+clause.length)))return false;
  return named||/刚才|前面|上次|那个|原来|原计划|这件事|这个安排/u.test(clause)||hasFocus&&RESTORE_BARE.test(clause);
}

export interface ContinuityReopenRequest {
  title:string;
  calendar?:{year?:number;month:number;day:number};
}
const PREFIX_OBJECT=new RegExp('^'+RESTORE_LEAD+RESTORE_VERB+'(.+?)(?:一下|吧)?$','u');
const POSTFIX_OBJECT=new RegExp('^'+RESTORE_LEAD+'(?:把|将)(.+?)'+RESTORE_VERB+'(?:一下|吧|了)?$','u');
function controlClauses(text:string){
  const parts:Array<{text:string;start:number}>=[],quotes:string[]=[];
  const pairs:Record<string,string>={'“':'”','「':'」','『':'』','"':'"',"'":"'"};
  let start=0;
  const append=(end:number)=>{const raw=text.slice(start,end),part=raw.trim();if(part)parts.push({text:part,start:start+raw.indexOf(part)});start=end+1;};
  for(let i=0;i<text.length;i++){
    const char=text[i];
    if(quotes[quotes.length-1]===char){quotes.pop();continue;}
    if(pairs[char]){quotes.push(pairs[char]);continue;}
    if(!quotes.length&&/[。！？?!\n，,；;]/u.test(char))append(i);
  }
  append(text.length);return parts;
}
function eligibleControlClause(text:string,part:{text:string;start:number}){
  const preceding=text.slice(0,part.start).split(/[。！？?!\n]/u);
  const prefix=preceding[preceding.length-1]?.trim()??'';
  return !/^(?:朋友|同事|他|她|他们|她们|我朋友|我的朋友)|如果|假如|假设|要是|倘若|引用|原话|翻译/u.test(prefix);
}
const FOCUS_FIELDS=/^(?:(?:那|那个|这个|刚才那个|刚才的|刚才|之前|原来|原先|现在|本来|这件事|这项安排|安排|计划|事项|出发|的|是|要|定在)\s*){0,6}(?:几点|哪天|什么时间|什么时候|怎么去|交通|时间|日期|准备什么)/u;
export function isContinuityFocusQuestion(text:string):boolean{
  if(!text||text.length>4000||/换(?:个|一个)?话题|先别聊|不聊|不想聊|什么意思|这个词|这句话|翻译|如果|假如|假设/u.test(text))return false;
  return controlClauses(text).some(part=>eligibleControlClause(text,part)&&FOCUS_FIELDS.test(part.text));
}
const FOCUS_RESTORE=new RegExp('^'+RESTORE_LEAD+RESTORE_VERB+'(?:刚才那个|刚才的那个|刚才那件事|之前那个|上次那个|那个|这件事|这个安排)(?:安排|计划|事项)?(?:吧|一下)?$','u');
export function isContinuityFocusResume(text:string):boolean{
  if(!text||text.length>4000)return false;
  return controlClauses(text).some(part=>eligibleControlClause(text,part)&&FOCUS_RESTORE.test(part.text)
    &&explicitTopicRestore(part.text,text,false,true,part.start)
    &&(/安排|计划|事项|这件事/u.test(part.text)||isContinuityFocusQuestion(text)));
}
/** Exact names are candidate locators only. Ownership, dates and original
 * evidence are checked in the native mutation; no fuzzy permission inference. */
export function parseContinuityReopenRequest(text:string):ContinuityReopenRequest|undefined{
  if(!text||text.length>4000)return;
  for(const part of controlClauses(text)){
    const clause=part.text;
    if(!eligibleControlClause(text,part))continue;
    if(!explicitTopicRestore(clause,text,true,false,part.start))continue;
    let title=(clause.match(POSTFIX_OBJECT)??clause.match(PREFIX_OBJECT))?.[1]?.trim();
    if(!title)continue;
    title=title.replace(/^(?:(?:刚才|之前|前面|上次|原来|那个|这个|那项|这项|那场|这场|的))+/u,'').trim();
    const date=title.match(/^(?:(\d{4})年)?(\d{1,2})月(\d{1,2})(?:日|号)(?:那场|这场|的)?/u);
    let calendar:ContinuityReopenRequest['calendar'];
    if(date){
      calendar={...(date[1]?{year:Number(date[1])}:{}),month:Number(date[2]),day:Number(date[3])};
      const checked=new Date(calendar.year??2000,calendar.month-1,calendar.day);
      if(checked.getMonth()+1!==calendar.month||checked.getDate()!==calendar.day)continue;
      title=title.slice(date[0].length).trim();
    }
    for(const [left,right]of [['“','”'],['「','」'],['『','』'],['"','"'],["'","'"]])if(title.startsWith(left)&&title.endsWith(right))title=title.slice(left.length,-right.length).trim();
    if(title&&title.length<=60)return {title,...(calendar?{calendar}:{})};
  }
}

/** Category-wide control is explicit. An individual event stays in its own
 * deferred state; quotations, questions and hypothetical instructions do not
 * become a ban on future content. Offsets are relative to the original text. */
export function categoryTopicControls(text:string):Array<{category:TopicRecord['kind'];action:'pause'|'resume';start:number;end:number}>{
  const categories:Record<string,TopicRecord['kind']>={考试:'exam',吃饭:'meal',用餐:'meal',冲突:'conflict',争执:'conflict',安排:'plan',计划:'plan',喜好:'preference',住处:'residence'};
  const result:Array<{category:TopicRecord['kind'];action:'pause'|'resume';start:number;end:number}>=[];
  if(!text||text.length>4000)return result;
  for(const part of controlClauses(text)){
    if(!eligibleControlClause(text,part)||/[？?“”「」『』"]|不是让|不用停止|不需要停止/u.test(part.text))continue;
    const paused=part.text.match(/^(?:我们|咱们)?(?:现在|今天)?(?:先|暂时)?(?:别|不要|不想)(?:再)?(?:聊|提|说|谈)(考试|吃饭|用餐|冲突|争执|安排|计划|喜好|住处)(?:这类|这一类|类)(?:话题|事情|内容)?(?:了|吧)?$/u);
    const resumed=part.text.match(/^(?:我们|咱们)?(?:现在|今天)?(?:可以)?(?:继续|恢复)(?:聊|提|说|谈)(考试|吃饭|用餐|冲突|争执|安排|计划|喜好|住处)(?:这类|这一类|类)(?:话题|事情|内容)?(?:了|吧)?$/u);
    const name=(paused??resumed)?.[1];
    if(name)result.push({category:categories[name],action:paused?'pause':'resume',start:part.start,end:part.start+part.text.length});
  }
  return result;
}

export function topicCategoryPaused(state:TopicStateFields,category:TopicRecord['kind'],domain:TopicDomain):boolean{
  return !!state.topicPauses?.some(pause=>pause.category===category&&pause.domain===domain);
}
/** A read-only eligibility projection. Publication must persist the actual
 * source-backed care act; selecting a candidate does not consume it. */
function scheduledLocalDay(topic:TopicRecord):number|undefined{
  const slot=topic.slots.date,offset=slot?.utcOffsetMinutes;
  if(!slot||!Number.isInteger(offset)||Math.abs(offset!)>840||!Number.isFinite(slot.observedAt))return;
  // Offset follows Date.getTimezoneOffset(), captured with the source message.
  // Reopening tomorrow never reinterprets the original 明天/后天 against now.
  const source=new Date(slot.observedAt-offset!*60000);
  const year=source.getUTCFullYear(),month=source.getUTCMonth(),day=source.getUTCDate();
  const base=Date.UTC(year,month,day),relative:Record<string,number>={今天:0,明天:1,后天:2};
  let local:number|undefined;
  if(Object.prototype.hasOwnProperty.call(relative,slot.value))local=base+relative[slot.value]*86400000;
  const weekday=slot.value.match(/^(?:周|星期)([一二三四五六日天])$/u)?.[1];
  if(weekday){const wanted='日一二三四五六'.indexOf(weekday==='天'?'日':weekday);local=base+(wanted-source.getUTCDay()+7)%7*86400000;}
  const calendar=slot.value.match(/^(\d{1,2})月(\d{1,2})日$/u);
  if(calendar){
    const candidate=(y:number)=>Date.UTC(y,Number(calendar[1])-1,Number(calendar[2]));
    local=candidate(year);if(local<base)local=candidate(year+1);
    const parsed=new Date(local);
    if(parsed.getUTCMonth()!==Number(calendar[1])-1||parsed.getUTCDate()!==Number(calendar[2]))return;
  }
  return local===undefined?undefined:local+offset!*60000;
}
export function topicFollowUpEligibility(topic:TopicRecord,options:{now:number;userInitiated?:boolean;coverageLimited?:boolean}):{kind:'none'|'care'|'follow-up'}{
  if(options.coverageLimited||topic.needsConfirmation||['cancelled','deferred'].includes(topic.outcome))return {kind:'none'};
  if(!options.userInitiated&&topic.slotHistory.some(slot=>slot.field==='date')){
    const scheduled=scheduledLocalDay(topic);
    if(scheduled===undefined||!Number.isFinite(options.now)||options.now<scheduled+86400000)return {kind:'none'};
  }
  if(topic.outcome==='resolved'||topic.outcome==='answered')return {kind:topic.responses?.some(record=>record.acts.some(act=>act.kind==='care'))?'none':'care'};
  return {kind:'follow-up'};
}
