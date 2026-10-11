import {hasExplicitTopicShift,isStandaloneClosing,requestsCharacterPerspective,requestsCharacterWording} from './chat-turn-cues';
import {isTopicRelated} from './chat-conversation-state';
import {isDirectAffection,isTopicInvitation} from './chat-expression-boundary';
import {replyContainsSubstantiveQuestion} from './chat-expression-guidance';
import {conditionalJointWish} from './chat-joint-wish';

/** Derive from recent user originals each turn, rather than storing a fictional
 * event or trusting the character's earlier scene invention as a new fact. */
function traceHypothesis(message:string,recentUsers:string[],preserveAffectionFacts:boolean):string {
  const turns=[...recentUsers.slice(-6),message];
  let premise='';
  for(const raw of turns) {
    const text=raw.replace(/[“「『"][^”」』"]*[”」』"]/gu,'').trim();
    if(isStandaloneClosing(text)){premise='';continue;}
    const clauses=text.split(/[。！？!?，,；;\n]/u).map(part=>part.trim());
    const explicit=!!conditionalJointWish(text)||clauses.some(part=>/^(?:那|我们|咱们)?(?:如果|假如|假设)(?!说这个词|这个词)/u.test(part))
      && /[？?]|(?:会|要|想|该)(?:怎么|选|叫)|哪(?:个|种|一)|叫什么/u.test(text)
      && !/^(?:他|她|朋友|同事|翻译|解释|帮我写)/u.test(text);
    if(explicit){
      // Quotes are excluded from control-intent detection, not from the
      // condition the model is being asked to answer. “If the child says X”
      // needs X; dropping it leaves a different, underspecified question.
      // Bound the original, never a shortened version with quoted content lost.
      premise=raw.trim().length<=240?raw.trim():'';
      continue;
    }
    // Real plans and changes are read from the user, not manufactured from
    // "我会选…" in an imagined choice. This guard is deliberately explicit.
    const actual=clauses.some(part=>/^(?:那|不过|其实)?(?:我|我们|咱们)(?:现在|刚才|已经|今天)?(?:已经|真的|实际)?(?:买了|摆了|放了|去了|决定|准备|打算|要去|订了|拍了|拍好了|拍完了|拿出了)/u.test(part)
      || /^(?:不是假设|不是假如|这是真的|实际(?:上)?(?:是|已经)|真的(?:要|会|已经))/u.test(part));
    if(actual||hasExplicitTopicShift(text)){premise='';continue;}
    // Affection changes the active topic, not whether the preceding imagined
    // event actually happened. Keep that distinction across consecutive turns.
    if(isDirectAffection(text)&&!replyContainsSubstantiveQuestion([text])){if(!preserveAffectionFacts)premise='';continue;}
    const walkContinuation=!!conditionalJointWish(premise)&&/(?:散.{0,3}步|走走|散步)/u.test(premise)
      &&/^(?:那)?你(?:会|更)?想/u.test(text)&&/(?:一路|走着|散步|走走)/u.test(text);
    if(premise&&!walkContinuation&&!isTopicRelated(text,premise.replace(/[“「『"][^”」』"]*[”」』"]/gu,''))
      && !/^(?:我(?:会|想|更|还是)?选|你(?:呢|为什么)|那|这个|这次|刚才|不是|不过)/u.test(text))premise='';
  }
  return premise;
}

export function conversationalHypothesis(message:string,recentUsers:string[]):string {
  return traceHypothesis(message,recentUsers,false);
}

export function buildHypothesisContext(message:string,recentUsers:string[]):string {
  const premise=conversationalHypothesis(message,recentUsers);
  // A present feeling ends the topic focus, not the truth boundary of a recent
  // conditional wish. Retain only the constraint, without asking the model to
  // resume the old activity. Derive it from user originals, never actor claims.
  if(!premise&&isDirectAffection(message)&&!hasExplicitTopicShift(message)&&!isStandaloneClosing(message)) {
    // Trace original user conditions independently of the active topic. Several
    // affectionate turns can move focus without converting an imagined event
    // into evidence. A genuine topic change or actual update still ends it.
    const recent=traceHypothesis(message,recentUsers,true);
    const wish=conditionalJointWish(recent);
    const updated=message.replace(/[“「『"][^”」』"]*[”」』"]/gu,'').split(/[。！？!?，,；;\n]/u)
      .some(clause=>/^(?:那|不过|其实)?(?:我|我们|咱们)(?:现在|今晚|今天)?(?:已经|真的|实际)?(?:决定|准备|打算|要去|订了|买了|去了|有空)/u.test(clause.trim()));
    if(wish&&!updated)return '[最近设想的事实范围]\n现在回应他这次的心意即可，不需要继续聊前一项活动。刚才两人的共同愿望仍有条件：'+JSON.stringify(wish)+'；说想念不代表空闲已确认、已经见面或行程已约好。若顺带说想一起做什么，沿用条件或现在的愿望，不从设想推出一项已定安排。\n[/最近设想的事实范围]';
    if(recent&&!updated)return '[最近设想的事实范围]\n现在回应他这次的心意即可，不需要继续聊前一项活动。此前讨论的条件原话：'+JSON.stringify(recent)+'。它是设想，不是已经发生的事件；先前讨论中的选择和人物回应不证明物品、共同活动或同处一室已经存在。若顺带提及，仍沿用设想的范围；当前明确讲出的真实变化照常以当前原话为准。\n[/最近设想的事实范围]';
  }
  const wording=requestsCharacterWording(message);
  // Interpret the quoted invitation inside the requested hypothetical answer;
  // it never becomes an actual command or a persisted topic preference.
  const invitedSpeech=wording&&premise===message.trim()&&[...message.matchAll(/[“「『"]([^”」』"]*)[”」』"]/gu)].some(match=>isTopicInvitation(match[1]));
  const response=invitedSpeech?'这句设想中的话是在邀请你开口，回应时说一点自己愿意聊的想法或好恶，给听者有内容可接的一句话。不是向你索要当天近况，也不是请你问他想听哪方面；假设中的交流仍不证明今天发生过什么。':wording?'本轮是在问设想中你会说的话，直接给出那句回应，改口沿用最新条件。':'本轮仍在这个假设里交换想法；可以给自己的选择、理由和玩笑，改口沿用最新条件。用设想中的例子说明你会怎样选择；';
  const joint=conditionalJointWish(premise)?'这是有条件的一起相处的愿望。可以亲近地说你也想怎样一起过，不把“如果有空”改成你已有空或已确定行程；两个人的空闲仍是条件。':'';
  return premise?`[正在讨论的假设]\n用户提出的条件：${JSON.stringify(premise)}。${response}${joint}已知背景照常保留，尚未提供的具体物品与活动仍属于设想。各自选一项不表示共同摆放、购买、见面或已经约定行动；真实计划另按用户明确说的内容。\n[/正在讨论的假设]`:'';
}

/** A modal question about this speaker's preference does not put both people
 * into a fictional scene. In particular, retain real user events around it. */
export function buildPreferenceProposalContext(message:string,recentUsers:string[]):string {
  const isChoiceQuestion=(raw:string)=>{
    const text=raw.replace(/[“「『"][^”」』"]*[”」』"]/gu,'').trim();
    if(/^(?:他|她|朋友|同事|如果|假如|假设|翻译|解释|帮我写)/u.test(text))return false;
    return text.split(/[。！？!?，,；;\n]/u).some(part=>
      /^(?:那|不过|所以)?你(?:自己)?(?:会|想|更想|愿意)(?:想)?(?:选|吃|看|去)(?:什么|哪(?:个|里|种)?)(?:呢|呀|啊)?$/u.test(part.trim()));
  };
  if(isStandaloneClosing(message))return '';
  const current=isChoiceQuestion(message);
  const previous=recentUsers[recentUsers.length-1]??'';
  const continuing=!hasExplicitTopicShift(message)&&requestsCharacterPerspective(message)&&isChoiceQuestion(previous);
  if(!current&&!continuing)return '';
  return '[正在交换各自的选择]\n对方在问你想选什么：说自己的偏好与理由就好，用户已讲出的真实情况照常保留。你的选择只是你的想法，不证明用户也选了、正在做、已经邀请你同行，或同意共同安排。可以保留玩笑和亲近，实际行动另按对方明确说的内容。\n[/正在交换各自的选择]';
}
