import {hasExplicitTopicShift,isStandaloneClosing} from './chat-turn-cues';
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
  return premise?`[正在讨论的假设]\n用户提出的条件：${JSON.stringify(premise)}。本轮仍在这个假设里交换想法；可以给自己的选择、理由和玩笑，改口沿用最新条件。各自选一项不表示共同摆放、购买、见面或已经约定行动；真实计划另按用户明确说的内容。\n[/正在讨论的假设]`:'';
}
