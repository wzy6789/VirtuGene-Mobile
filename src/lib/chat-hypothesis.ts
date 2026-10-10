import {hasExplicitTopicShift,isStandaloneClosing,requestsCharacterPerspective} from './chat-turn-cues';
import {isTopicRelated} from './chat-conversation-state';

/** Derive from recent user originals each turn, rather than storing a fictional
 * event or trusting the character's earlier scene invention as a new fact. */
export function conversationalHypothesis(message:string,recentUsers:string[]):string {
  const turns=[...recentUsers.slice(-6),message];
  let premise='';
  for(const raw of turns) {
    const text=raw.replace(/[“「『"][^”」』"]*[”」』"]/gu,'').trim();
    if(isStandaloneClosing(text)){premise='';continue;}
    const clauses=text.split(/[。！？!?，,；;\n]/u).map(part=>part.trim());
    const explicit=clauses.some(part=>/^(?:那|我们|咱们)?(?:如果|假如|假设)(?!说这个词|这个词)/u.test(part))
      && /[？?]|(?:会|要|想|该)(?:怎么|选|叫)|哪(?:个|种|一)|叫什么/u.test(text)
      && !/^(?:他|她|朋友|同事|翻译|解释|帮我写)/u.test(text);
    if(explicit&&text.length<=240){premise=text;continue;}
    // Real plans and changes are read from the user, not manufactured from
    // "我会选…" in an imagined choice. This guard is deliberately explicit.
    const actual=clauses.some(part=>/^(?:那|不过|其实)?我(?:现在|刚才|已经|今天)?(?:已经|真的|实际)?(?:买了|摆了|放了|去了|决定|准备|打算|要去|订了)/u.test(part)
      || /^(?:不是假设|不是假如|这是真的|实际(?:上)?(?:是|已经)|真的(?:要|会|已经))/u.test(part));
    if(actual||hasExplicitTopicShift(text)){premise='';continue;}
    if(premise&&!isTopicRelated(text,premise)
      && !/^(?:我(?:会|想|更|还是)?选|你(?:呢|为什么)|那|这个|这次|刚才|不是|不过)/u.test(text))premise='';
  }
  return premise;
}

export function buildHypothesisContext(message:string,recentUsers:string[]):string {
  const premise=conversationalHypothesis(message,recentUsers);
  return premise?`[正在讨论的假设]\n用户提出的条件：${JSON.stringify(premise)}。本轮仍在这个假设里交换想法；可以给自己的选择、理由和玩笑，改口沿用最新条件。用设想中的例子说明你会怎样选择；已知背景照常保留，尚未提供的具体物品与活动仍属于设想。各自选一项不表示共同摆放、购买、见面或已经约定行动；真实计划另按用户明确说的内容。\n[/正在讨论的假设]`:'';
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
