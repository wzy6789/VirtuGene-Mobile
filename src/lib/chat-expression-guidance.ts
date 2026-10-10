import {isQuestionReaction} from './chat-turn-cues';
/** Local clues steer expression, never establish feelings, facts or operations. */
export type ChatSituation = 'neutral' | 'distress' | 'tired' | 'celebration' | 'mixed';

/** A stated feeling, not the lost-object sense of 失落 or an inferred cause. */
function statesSetbackFeeling(text:string):boolean {
  return text.split(/[。！!，,；;\n]/u).some(clause=>{
    const value=clause.trim();
    if(/^(?:(?:但是|不过|可是|但)\s*)?(?:我(?:自己)?\s*)?(?:(?:今天|现在|最近|刚才)(?:我)?\s*)?(?:(?:确实|真的|还是|也|还|感觉|觉得)\s*)?(?:挺|很|有点|有一点|有些|有一些|特别|好|真|太)\s*(?:失落|沮丧)(?:的|了|啊|呀|呢|极了)?\s*$/u.test(value))return true;
    // Everyday event frames can omit "我". Require an explicit feeling;
    // the event alone, a lost object, a report or a question is not evidence.
    return /^(?:(?:但是|不过|可是|但)\s*)?(?:我(?:自己)?\s*)?(?:(?:今天|现在|最近|刚才)(?:我)?\s*)?(?:有(?:一|几)?件(?:小)?事(?:让我)?|(?:这|那)(?:件|次)(?:小)?事让我)(?:确实|真的|还是|也|还|感觉|觉得)?(?:挺|很|有点|有一点|有些|有一些|特别|好|真|太)(?:失落|沮丧)(?:的|了|啊|呀|呢|极了)?$/u.test(value);
  });
}

/** A plain degree + feeling is a first-person utterance even when "我" is
 * omitted. Keep the surrounding sentence's reported/hypothetical speaker;
 * don't transfer someone else's trailing feeling clause to this user. */
const DIRECT_FEELING=/^(?:(?:但是|不过|可是|但)\s*)?(?:我(?:自己)?\s*)?(?:确实|真的|还是|也|还|感觉|觉得){0,2}(?:挺|很|有点|有一点|有些|有一些|特别|好|真|太)(?:难过|难受|委屈|失落|沮丧|疲惫|累|开心|高兴|兴奋|焦虑|紧张|担心|烦躁)(?:的|了|啊|呀|呢|极了)?$/u;
function ownFeelingSentences(text:string):string[] {
  return text.split(/[。！!\n]|(?<=[？?])/u).flatMap(sentence=>{
    const value=sentence.trim().replace(/^(?:但是|不过|可是|但)\s*/u,'');
    if(/^(?:如果|假如|假设|比如|例如|他|她|他们|她们|朋友|同事|主角|我(?:的|有(?:一)?个|有一位)?(?:朋友|同事|室友|家人)|(?:这|那)(?:个|位)(?:人|角色|朋友)|(?:书|小说|故事|电影)(?:里|中)(?:的)?(?:人|角色|主角)|我(?:听说|听到|听他|听她)|帮我写|请你写|写一段|写一个|翻译|解释)/u.test(value)
      ||/(?:他|她|朋友|同事)(?:刚才|之前|也|还)?(?:说|告诉我|觉得|感觉)/u.test(value)){
      // An explicit switch back to "我" can state a different own feeling
      // in the same sentence; retain only that fully stated clause.
      return value.split(/[，,；;]/u).map(clause=>clause.trim())
        .filter(clause=>/^(?:但是|不过|可是|但)?我/u.test(clause)&&DIRECT_FEELING.test(clause));
    }
    return [value];
  });
}
function statesDirectFeeling(text:string):boolean {
  return ownFeelingSentences(text).some(sentence=>sentence.split(/[，,；;]/u).some(clause=>DIRECT_FEELING.test(clause.trim())));
}

export function assessChatSituation(userText: string): ChatSituation {
  // These messages discuss an imagined feeling or ask for written material.
  // The model still reads the original; do not label them as lived emotions.
  if (/^(?:如果|假如|假设|比如|例如|怎么安慰|如何安慰|帮我写|写一段|写一个)/u.test(userText.trim())) return 'neutral';
  let clauses = userText.slice(0, 4000)
    .replace(/[“「『"][^”」』"]*[”」』"]/gu, '')
    .split(/[。！!，,；;\n]|(?<=[？?])|(?=(?:但|不过|可是)(?:我)?(?:现在|今天|已经|还是))/u)
    .map(s => s.trim())
    .filter(s => !/^(?:(?:但是|不过|可是|但)\s*)?(?:如果|假如|假设|比如|例如|怎么安慰|如何安慰|解释|什么是|帮我写|写一段|写一个|他|她|他们|她们|朋友|同事|主角)/u.test(s));
  // Explicit recovery is the user's update, not an inference that an old
  // feeling disappeared. Keep later clauses: "好了，但还是累" stays tired.
  const recovery = /^(?:(?:但是|不过|可是|但)\s*)?(?:我\s*)?(?:现在|今天|已经)(?:我)?(?:已经|真的|都|完全)?(?:好了|没事了|缓过来了|恢复了|不难过了|不累了|不生气了|不担心了|不紧张了|不焦虑了|不委屈了|不失落了|不沮丧了)(?:[啊呀啦呢了\s]*)$/u;
  let recoveredAt=-1;
  clauses.forEach((clause,index)=>{if(recovery.test(clause))recoveredAt=index;});
  if(recoveredAt>=0)clauses=clauses.slice(recoveredAt+1);
  // A stated present feeling supersedes a separately dated past feeling.
  // Undated feelings remain, so simultaneous joy and fatigue are not erased.
  const presentEmotion=clauses.findIndex(clause=>/^(?:(?:但是|不过|可是|但)\s*)?(?:我)?(?:现在|今天)/u.test(clause)&&/(?:开心|高兴|兴奋|难过|委屈|生气|焦虑|担心|失落|沮丧|疲惫|累|没精神)/u.test(clause));
  if(presentEmotion>0)clauses=clauses.filter((clause,index)=>index>=presentEmotion||!/^(?:我)?(?:昨天|前天|之前|以前|刚才|前几天|上周)/u.test(clause));
  const current = clauses.join(' ').replace(/(?:并没有|没有|并不|不是)(?:不开心|不高兴)/gu, '');
  const unhappy = /不开心|开心不起来|高兴不起来|笑不出来/u.test(current);
  const expressed = current.replace(/(?:并不|不是|不再|不怎么|不太|不那么|不很|不|没有)(?:难过|难受|委屈|生气|焦虑|害怕|紧张|担心|烦|孤单|失望|崩溃|开心|高兴|兴奋|得意|累|疲惫)/gu, '');
  const distress = unhappy || /难过|难受|委屈|生气|焦虑|害怕|紧张|担心|烦|孤单|失望|崩溃|想哭|哭了|失恋|去世/u.test(expressed) || clauses.some(statesSetbackFeeling);
  const tired = /累(?:了|死|坏|得|到|啊|呀|哦|$)|(?:很|好|太|真|有点|特别|挺|已经|觉得)累|疲惫|没精神|没力气|精疲力尽|撑不住/u.test(expressed);
  const joy = /开心|高兴|兴奋|好耶|太棒了|终于.{0,16}(?:做完|搞定|通过|考过|交上|交了|完成)/u.test(expressed.replace(/不开心|开心不起来|高兴不起来/gu, ''))
    || clauses.some(clause=>/^(?:但|不过)?(?:我)?(?:还|也|现在|今天)?(?:挺|很|有点|有一点|有些|有一些|真|特别)(?:小小的?|小)?得意(?:的|了|啊|呀|呢)?$/u.test(clause));
  if (joy && (distress || tired)) return 'mixed';
  if (distress) return 'distress';
  if (tired) return 'tired';
  if (joy) return 'celebration';
  return 'neutral';
}

export interface ExpressionSignals {
  situation: ChatSituation;
  emotionConfidence: number;
  request: boolean;
  requestConfidence: number;
  quoted: boolean;
  hypothetical: boolean;
}

/** Multiple independent clues, never an authorization decision or user diagnosis. */
export function assessExpressionSignals(userText: string): ExpressionSignals {
  const text = userText.slice(0, 4000).trim();
  const quoted = /[“「『"]/u.test(text);
  const unquoted = text.replace(/[“「『"][^”」』"]*[”」』"]/gu, '');
  const hypothetical = /^(?:如果|假如|假设|比如|例如)/u.test(unquoted);
  const affirmative = unquoted.split(/[。！？!?，,；;\n]/u).filter(c => !/(?:不用|不要|别|无需|不需要).{0,8}(?:帮|替我|给我|请你|教我|告诉我|分析|解释|整理|写|推荐|想|设计|制定)/u.test(c));
  const request = !hypothetical && affirmative.some(c => /(?:帮我|请你|请帮|能帮|替我|给我)(?:.{0,12})(?:看|写|整理|分析|解释|推荐|想|设计|制定|读|查|改|说)|^(?:帮我|请你|请帮|能帮|给我|替我|写一个|写段|整理|解释|分析|教我|告诉我|推荐|设计|制定)/u.test(c.trim()));
  const situation = assessChatSituation(text);
  const ownText=ownFeelingSentences(unquoted).join('。');
  const self = /我(?:今天|现在|最近|真的|已经|好|很|有点|特别|挺|感觉|觉得|太|不|没|失恋)|今天|现在|终于|累死|好累|好开心|好难过|好委屈/u.test(ownText)
    || statesSetbackFeeling(ownText)
    || statesDirectFeeling(unquoted)
    || /(?:^|[。！？!?，,；;\n])\s*(?:但|不过)?我(?:还|也|现在|今天)?(?:挺|很|有点|有一点|有些|有一些|真|特别)得意(?:的|了|啊|呀|呢)?(?:$|[。！？!?，,；;\n])/u.test(ownText);
  return { situation, emotionConfidence:situation === 'neutral' ? 0 : self ? .9 : .55,
    request, requestConfidence:request ? .9 : 0, quoted, hypothetical };
}

export function expressionDirection(signals: ExpressionSignals): string {
  const emotion = signals.emotionConfidence >= .8 || signals.situation === 'neutral'
    ? situationDirection(signals.situation)
    : situationDirection('neutral')+' 情绪线索不足，不猜测用户心情。';
  return signals.request && signals.requestConfidence >= .8
    ? `${emotion}\n本轮也有明确请求，先处理具体要求，体谅保持简短；不能用安慰替代回答。`
    : emotion;
}

export function situationDirection(situation: ChatSituation): string {
  const clues: Record<ChatSituation, string> = {
    neutral: '根据这句话真正说的内容回应，不因为前面聊过情绪就继续安慰，也不从短句猜测心情。',
    distress: '当前话里有难受或受挫的线索，就用户已经讲明的遭遇表达你自己的反应，收住玩笑和庆祝表情；具体感受和原因由用户自己说明，不替用户诊断、不猜第三方动机。',
    tired: '当前话里有疲惫的线索，先少说一点，就已讲明的负担表达你自己的反应，让用户保留解释感受与原因的余地；不替任何一方断定表达或理解能力。不催振作、不连问、不自动列任务，也不把少说话自动变成劝休息，用户明确要办法时再给一个实际落点。',
    celebration: '当前话里有开心或进展的线索，回应眼前的结果和喜悦，可以一起高兴。开心本身就值得接话，不需要先补辛苦、焦虑或休息的理由；用户没讲的过程与代价仍留白。分享本身已经是一次相处，不必要求展示成果或再为你做一遍来完成这次回应；可以自然好奇，但是否展示、邀约或继续做由对方选择，不把自己的兴趣说成先前一直在等的约定。不立刻布置下一项，也不把用户口述当作应用已完成操作的证据。',
    mixed: '当前话里的感受不止一种，开心和疲惫或难受都要留位置；不强行归成积极或消极，别替用户解释眼泪或替用户宣布已经释怀。',
  };
  return `表达线索仅作参考，原话与用户当前要求优先：${clues[situation]}`;
}

/** Adjacent saved bubbles sharing a source are one turn. Legacy rows stay separate. */
export function collectRecentReplyTurns(messages: Array<{ role: string; content: string; replyToUserMessageId?: string }>): string[][] {
  const turns: string[][] = [];
  let source: string | undefined;
  for (const message of messages.slice(-40)) {
    if (message.role !== 'assistant') { source = undefined; continue; }
    const text = message.content.trim();
    if (!text) continue;
    if (message.replyToUserMessageId && message.replyToUserMessageId === source) turns[turns.length - 1].push(text.slice(0, 1200));
    else { turns.push([text.slice(0, 1200)]); source = message.replyToUserMessageId; }
  }
  return turns.slice(-4);
}

/** A soft clue, never a forced rotation or an automatic model retry. */
export function recentRhythmDirection(turns: string[][]): string {
  const recent = turns.slice(-3);
  const shortReceipt = (parts: string[]) => parts.length === 2
    && /^(?:嗯+|啊+|哦+|好|好的|确实|听见了)[。！!，,～~\s]*$/u.test(parts[0].trim())
    && parts[1].trim().length >= 4;
  if (recent.length === 3 && recent.every(shortReceipt)) {
    return '最近三轮都是短回执后接一句判断。这轮可以直接说自己注意到的具体一点，不必给每件小事判好坏、能不能吃或该怎么处理；按人物态度交流。真正只想回应一个“嗯”仍可以，具体问题也照常回答，不强制增加字数或换口癖。';
  }
  const reactionThenContent = (parts: string[]) => parts.length === 2 && parts[0].trim().length <= 10 && parts[1].trim().length >= 12;
  if (recent.length === 3 && recent.every(reactionThenContent)) {
    return '最近三轮都先短后长。如果这次没有独立的情绪反应，可以直接说重点，或在真正补充时再分条；不机械补一个“啊？”来凑两条，有真实反应仍可以连发。';
  }
  return '';
}

/** Recognize a question across one reply's bubbles without counting punctuation reactions. */
export function replyContainsSubstantiveQuestion(parts:string[]):boolean {
    const text=parts.join('\n').replace(/[“「『"][^”」』"]*[”」』"]/gu,'').trim();
    const marked=(text.match(/[^。！？!?；;\n]+[?？]+/gu)??[]).some(sentence=>{
      if(isQuestionReaction(sentence))return false;
      if(/^(?:他|她|朋友|同事)(?:刚才|之前|也|还|又)?(?:说|问|想知道)/u.test(sentence.trim()))return false;
      const question=sentence.replace(/[?？\s]/gu,'');
      return question.length>=4||/(?:什么|哪|谁|怎么|几|吗|么)/u.test(question);
    });
    if(marked)return true;
    // Generated questions sometimes end in a period. Recognize only clear
    // interrogative forms, not any mention of curiosity or reported speech.
    return text.split(/[。！？!?，,；;\n]/u).some(clause=>{
      const value=clause.trim();
      if(isQuestionReaction(value))return false;
      if(/^(?:其实|我)?(?:并)?不是(?:(?:想|要)(?:让)?|让)你/u.test(value)&&!/(?:吗|(?<![什怎])么)[呀啊呢\s]*$/u.test(value))return false;
      if(/^(?:我(?:不(?:知|确|清)|知道|想知道|问|说)|他|她|朋友|同事|如果|假如|比如|例如|不管|无论|随便)|(?:别|不必|不要|不用).{0,6}(?:问|回答)/u.test(value))return false;
      if(/^.{0,12}(?:什么|啥|哪[儿里]).{0,8}(?:都(?:可以|行|能|愿意)|就(?:聊|说|选|去))/u.test(value)&&!value.includes('还是'))return false;
      return /(?:有没有|是不是|会不会|要不要|能不能|想不想|愿不愿意)/u.test(value)
        || value.length>=4&&/(?:吗|么)(?:[呀啊呢\s]*)$/u.test(value)
        || /(?:是什么|叫什么|(?:在|去|到|从)哪[儿里]|选哪(?:个|部|种)|几点|多少|怎么样)(?:[呀啊呢啦哦\s]*)$/u.test(value)
        || /^(?:你(?:刚才|本来|现在|今天|接下来)?)?(?:是)?(?:想|打算|准备)(?:先|接着|继续|随便)?(?:说|聊|谈)(?:点|些)?(?:什么|啥)(?:[呀啊呢啦哦\s]*)$/u.test(value)
        || /^你(?:现在|接下来)?(?:想|打算|准备)从哪(?:里|儿)?(?:开始|聊起|说起)(?:[呀啊呢啦哦\s]*)$/u.test(value)
        || /(?:想|打算|准备)(?:去|在)?(?:哪[儿里]|什么|怎么).{0,40}还是/u.test(value);
    });
}

/** Soft guidance for interview-like endings, never a question ban or retry. */
export function recentQuestionDirection(turns:string[][]):string {
  const recent=turns.slice(-2);
  return recent.length===2&&recent.every(replyContainsSubstantiveQuestion)
    ?'普通分享时，接趣味或说一个自己的想法就足够了，让一段话自然结束。用户问你的看法，就说清自己的态度；明确的问题要回答，真正缺少信息或有具体好奇时仍可问。'
    :'';
}
