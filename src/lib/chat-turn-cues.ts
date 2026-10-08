/** Shared local hints. These never override the original message or authorize actions. */
export function isDirectTimeAnswer(message:string,previousUserMessage:string):boolean {
  const previous=previousUserMessage.replace(/[“「『"][^”」』"]*[”」』"]/gu,'').trim()
    .replace(/^(?:对了|那|所以)[，,\s]*/u,'');
  if(/^(?:他|她|朋友|同事|如果|假如|假设|比如|例如)/u.test(previous))return false;
  // A mention of time is not automatically a question to be answered.
  if(!/(?:几点|几时|什么时候|何时)/u.test(previous)
    || /(?:不用|不要|别|不必).{0,10}(?:回答|告诉|问|知道|记得)/u.test(previous)
    || !(/[?？]/u.test(previous)
      || /^(?:对了|那|所以)?\s*你(?:还)?(?:知道|记得).{0,24}(?:几点|几时|什么时候|何时)/u.test(previous)
      || /^(?:是|在|到)?(?:几点|几时|什么时候|何时)/u.test(previous)))return false;
  return /^(?:今天|昨天|前天|昨晚|今早|早上|上午|中午|下午|晚上|凌晨)?\s*(?:\d{1,2}|[零一二三四五六七八九十两]{1,3})(?:[:：]\d{2}|点(?:半|整|[一二三四五六七八九十\d]{1,3}分?)?|时)(?=$|[。！？!?，,；;\s])/u.test(message.trim());
}

export function requestsRepetition(message:string):boolean {
  const clauses=message.slice(0,4000).replace(/[“「『"][^”」』"]*[”」』"]/gu,'')
    .split(/[。！？!?，,；;\n]/u).map(clause=>clause.trim());
  return clauses.some(clause=>{
    // A colon introduces the text to read, rather than another instruction.
    const instruction=clause.split(/[：:]/u,1)[0].trim();
    return !/^(?:他|她|朋友|同事|如果|假如|假设|比如|例如)/u.test(instruction)
      && !/(?:别|不要|不用|无需|不需要|不要再).{0,8}(?:重复|再说|再讲|再念|复述|原样|照着)/u.test(instruction)
      && (/(?:再(?:说|讲|念)(?:一遍|一次)|重复(?:一遍|一下|刚才)|复述(?:一下|刚才)|把刚才.{0,12}(?:再说|重复))/u.test(instruction)
        || /^(?:请|麻烦|帮我|请你|你(?:就|只|先)?|就|只)?(?:把.{0,18})?(?:原样|照着|照原文)(?:重复|复述|念|说)(?:这句|这段|出来|一下|一遍)?$/u.test(instruction));
  });
}

/** A user revising their own view, rather than a reported or hypothetical concession. */
export function isSelfViewRevision(message:string):boolean {
  const text=message.replace(/[“「『"][^”」』"]*[”」』"]/gu,'').trim();
  if(/^(?:他|她|朋友|同事|如果|假如|假设|比如|例如|帮我写|写一句)/u.test(text))return false;
  return text.split(/[。！？!?，,；;\n]/u).some(part=>
    /^(?:其实|好像|确实|现在想想|这么一想)?\s*(?:(?:我(?:刚才)?|刚才(?:我)?)(?:说|讲)(?:得|的)?(?:太|有点)?(?:绝对|满|过头)了|我收回刚才那(?:句|个说法))(?:[呀啊吧呢\s]|$)/u.test(part.trim()));
}

export function isTopicClarification(message: string): boolean {
  const text = message.trim();
  // Contrast and correction preserve an antecedent. This is a rhythm hint,
  // not a claim that we know which field or fact the user corrected.
  return isSelfViewRevision(text)||/^(?:不是.{1,32}[，,]\s*(?:是|而是|改成|改到)|是.{1,32}[，,]\s*(?:不是|而不是)|(?:我(?:刚才)?(?:说错|看错)了|更正一下|不对)[，,：:]\s*(?:是|应该是|改成|改到)|(?:改成|改到).{1,24})/u.test(text);
}

export function isPersonalExperienceQuestion(message: string): boolean {
  const text = message.replace(/[“「『"][^”」』"]*[”」』"]/gu, '').trim();
  return text.split(/[。！？!?，,；;\n]/u).some(clause =>
    /^(?:那|所以|对了|想问问)?\s*你.{0,10}(?:小时候|童年|以前|从前|曾经|过去|刚才|刚刚|最近).{0,24}(?:吗|么|没|过|什么|哪|谁|怎么)/u.test(clause.trim()));
}

export function hasExplicitTopicShift(message:string):boolean {
  const text=message.replace(/[“「『"][^”」』"]*[”」』"]/gu,'').trim();
  const clauses=text.split(/[。！？!?，,；;\n]/u).map(part=>part.trim());
  return clauses.some(part=>! /^(?:他|她|朋友|同事|如果|假如|假设|例如|比如)/u.test(part)
    && !/(?:不想|不要|不用|别|不需要).{0,4}(?:换个话题|换个问题|说点别的|聊点别的)/u.test(part)
    && /^(?:我们|咱们)?(?:先聊别的|换个话题|换个问题|说点别的|先不说这个|不聊这个了|对了|另外|话说回来|顺便问一下|我突然想起|说到这个|先聊点|聊点别的|说个别的)/u.test(part))
    || /^算了[，,、:：\s]+.{3,}/u.test(text);
}

export function isStandaloneClosing(message:string):boolean {
  const text=message.trim().replace(/^(?:行|好(?:的)?|嗯)[，,\s]+/u,'')
    .replace(/^(?:今(?:天|晚))?(?:就这样|先这样|先聊到这(?:里)?|聊到这(?:里)?)[，,。！!\s]+/u,'')
    .replace(/^(?:明天|改天|下次)(?:再|接着)(?:聊|说|弄|做|处理)(?:吧|了)?[，,。！!\s]+/u,'');
  return /^(?:嗯+|好(?:的|吧|呀|啦)?|行|算了|先这样|晚安|拜拜|明天见|回见|我先下了|我先睡了)(?:[呀啦哦嗯喽吧。！!，,～~\s])*$/u.test(text);
}
