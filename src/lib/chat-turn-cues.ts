/** Shared local hints. These never override the original message or authorize actions. */
/** A current request to leave another person's motives unanalysed, rather
 * than a ban on the actor's own feelings or on discussing what happened. */
export function declinesThirdPartyAnalysis(message:string):boolean {
  const text=message.slice(0,4000).replace(/[“「『"][^”」』"]*[”」』"]/gu,'').trim();
  if(/^(?:他|她|朋友|同事|如果|假如|假设|比如|例如|翻译|解释|帮我写|写一段)/u.test(text))return false;
  return [...text.matchAll(/([^。！？!?，,；;\n]+)([。！？!?，,；;\n]|$)/gu)].some(match=>
    !/[?？]/u.test(match[2])&&/^(?:你)?(?:先|现在|暂时|这次)?(?:别|不要|不用|不必|不需要)(?:再)?(?:帮我|替我)?(?:分析|揣测|猜测|猜)(?:他|她|对方|朋友|同事)(?:的(?:心思|想法|原因|动机))?(?:了|吧|呀|啊|呢)?$/u.test(match[1].trim()));
}
/** Explicitly correcting why the speaker is talking, not starting a new topic.
 * Require both the rejected request and its stated replacement. */
export function correctsConversationIntent(message: string): boolean {
  const text = message.slice(0,4000).replace(/[“「『"][^”」』"]*[”」』"]/gu, '').trim();
  if (/^(?:他|她|他们|她们|朋友|同事|如果|假如|假设|比如|例如|翻译|解释|帮我写|写一段)/u.test(text)
    || /(?:什么意思|怎么理解|怎么翻译|怎么表达|怎么说|是不是|是否)/u.test(text)) return false;
  // Keep question turns out: a request for clarification is still a question.
  if (/[?？]/u.test(text)) return false;
  const clauses=text.split(/[。！!，,；;\n]/u).map(clause=>clause.trim());
  const declinedComfort=clauses.some(clause=>/^(?:倒也|其实|真的|真|那)?(?:你)?(?:不用|不必|不需要|别|不要)(?:再)?(?:安慰|鼓励|哄)我(?:了|啦|呀|啊|呢)?$/u.test(clause));
  const sharingIntent=clauses.some(clause=>/^我(?:就|只是|只)(?:想(?:跟你说|和你说|告诉你|说给你听)|喜欢(?:跟你分享|和你分享|告诉你)|(?:想|喜欢)把[^。！？!?]{1,45}(?:告诉你|说给你听|跟你分享))[^。！？!?]{0,60}$/u.test(clause)
    &&!/(?:不是|不想|不喜欢|翻译|改写|解释)/u.test(clause));
  if(declinedComfort&&sharingIntent)return true;
  return /(?:^|[。！!\n])\s*(?:其实|我)?(?:并)?不是(?:(?:想|要)(?:让)?|让)你[^，,。；;！？!?\n]{1,36}[，,。；;]\s*(?:(?:我)?(?:就|只)(?:是|想|要)|而是(?:想|要)?)[^，,。；;！？!?\n]{1,80}/u.test(text);
}

/** Asking the character for a perspective, rather than sharing the user's
 * view. This only selects whose contribution to develop, not factual claims. */
export function requestsCharacterPerspective(message: string): boolean {
  const text = message.slice(0,4000).replace(/[“「『"][^”」』"]*[”」』"]/gu, '').trim();
  if (/^(?:他|她|朋友|同事|如果|假如|假设|比如|例如|翻译|解释|帮我写|写一段)/u.test(text)) return false;
  if (/(?:帮我|替我|给我).{0,12}(?:写|改|整理|安排|查|推荐|总结)/u.test(text)) return false;
  const view = '(?:看法|想法|观点|理由)';
  const ask = new RegExp(`^(?:(?:那|先|请|请你|你先|你)\\s*)?(?:说说|说|讲讲|讲|聊聊|聊|谈谈|谈)(?:一下|两句|几句|一点)?你(?:自己|个人)?的${view}(?:是什么|呢|吧|呀|啊)?$`, 'u');
  const listen = new RegExp(`^我(?:更|就|只是|还是)?想(?:听听|听|知道|了解)你(?:自己|个人)?的${view}(?:是什么|呢|吧|呀|啊)?$`, 'u');
  const question = new RegExp(`^你(?:自己|个人)?的${view}(?:是什么|呢)?$`, 'u');
  const welcome = new RegExp(`^我(?:更|比较|就|还是)?(?:喜欢|愿意听)你(?:说说|说|讲讲|讲|聊聊|聊|谈谈|谈)(?:你)?(?:自己|个人)的${view}(?:呀|啊|吧|呢)?$`, 'u');
  return text.split(/[。！？!?，,；;\n]/u).some(clause => {
    const part=clause.trim();
    if(ask.test(part)||listen.test(part)||question.test(part)||welcome.test(part))return true;
    // Everyday invitations to interpret a situation ask for this person's
    // position. Asking how to understand authored text remains explanation.
    if(/(?:这个词|这句话|这段话|意思|定义|术语|公式|代码|报错|翻译|解题)/u.test(part))return false;
    return /^你(?:自己|个人)?(?:是)?(?:怎么想|怎么看待)(?:的|呢|呀|啊|吧)?$/u.test(part)
      || /^你(?:自己|个人)?(?:是)?(?:怎么|如何)(?:理解|看待)(?:我(?:们)?(?:的|对)|这(?:件|种|个)|那(?:件|种|个))[^？?]{1,60}$/u.test(part);
  });
}

/** A direct denial of the speaker's own feeling, not proof of a different
 * feeling. Preserve the rest of the original message and any actual request. */
export function correctsOwnFeeling(message: string): boolean {
  const text = message.slice(0,4000).replace(/[“「『"][^”」』"]*[”」』"]/gu, '').trim();
  if (/^(?:他|她|他们|她们|朋友|同事|主角|如果|假如|假设|比如|例如|翻译|解释|帮我写|写一段)/u.test(text)) return false;
  const feeling = '(?:累|疲惫|难过|伤心|委屈|生气|担心|焦虑|紧张)';
  // “不是累了就是烦了” describes alternatives, not a correction.
  if (new RegExp(`不是${feeling}.{0,4}就是${feeling}`, 'u').test(text)) return false;
  const direct = new RegExp(`^(?:其实|真的|只是)?(?:我)?(?:并不|没有|不是|不再|不)${feeling}(?:了|啊|呀|呢|的)?$`, 'u');
  return text.split(/([。！？!?，,；;\n])/u).some((clause,index,parts) =>
    index % 2 === 0 && direct.test(clause.trim()) && !/[?？]/u.test(parts[index+1] ?? ''));
}

/** A complete reaction, not a blanket exemption for sentences containing it. */
export function isQuestionReaction(message:string):boolean {
  const core=message.trim().replace(/[。！？!?；;，,\s]/gu,'');
  return /^(?:啊+|嗯+|哈+|哦+|诶+|哎+|真的(?:吗|啊)?|真的吗|真的假的|不会吧|不是吧|是吗)$/u.test(core);
}

/** A stated personal plan, not consent to execute it or proof it happened.
 * Callers must still give explicit questions and requests priority.
 */
export function hasSelfChosenPlan(message:string):boolean {
  const text=message.slice(0,4000).replace(/[“「『"][^”」』"]*[”」』"]/gu,'').trim();
  if(/^(?:他|她|朋友|同事|如果|假如|假设|比如|例如|帮我写|写一句)/u.test(text)
    || /(?:他|她|朋友|同事).{0,12}(?:说|问|告诉)|(?:解释|翻译|复述|是什么意思|怎么理解)/u.test(text))return false;
  return text.split(/[。！？!?，,；;\n]/u).some(clause=>{
    const part=clause.trim();
    if(!/^(?:那|不过|其实|所以)?\s*我(?:已经)?(?:(?:准备|打算|决定)(?:先|就|要)?[^？?]{1,80}|想好了[^？?]{0,80})$/u.test(part)
      || /我(?:还)?(?:没|没有|不|并不|不是|不再)(?:准备|打算|决定)|(?:什么|怎么|哪[个儿里]|谁|吗|么)(?:呀|啊|呢|来着)?$/u.test(part))return false;
    // 准备了/准备好 describes work already done, not an intention to do it.
    // 决定了 can still name a prospective choice, so keep that distinct.
    if(/^.*我(?:已经)?准备(?:了|过|好(?!好)|完|得)/u.test(part)
      || /^.*我(?:已经)?(?:打算|决定)(?:了)?(?:很久|好久|很长时间|[一二三四五六七八九十两\d]+(?:天|年|个月|小时))(?:了)?$/u.test(part))return false;
    return true;
  });
}

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
  return correctsConversationIntent(text)||isSelfViewRevision(text)
    || /^(?:我(?:刚才)?|刚才(?:我)?)(?:说错|看错|记错)了[，,。：:]\s*(?:其实|应该是|准确地说|是)/u.test(text)
    || /^(?:不是.{1,32}[，,]\s*(?:是|而是|改成|改到)|是.{1,32}[，,]\s*(?:不是|而不是)|(?:我(?:刚才)?(?:说错|看错)了|更正一下|不对)[，,：:]\s*(?:是|应该是|改成|改到)|(?:改成|改到).{1,24})/u.test(text);
}

export function isPersonalExperienceQuestion(message: string): boolean {
  const text = message.replace(/[“「『"][^”」』"]*[”」』"]/gu, '').trim();
  return text.split(/[。！？!?，,；;\n]/u).some(clause =>
    /^(?:那|所以|对了|想问问)?\s*你.{0,10}(?:小时候|童年|以前|从前|曾经|过去|刚才|刚刚|最近).{0,24}(?:吗|么|没|过|什么|哪|谁|怎么)/u.test(clause.trim()));
}

/** A declared pause of a named subject, not a question, report or quoted line.
 * This only limits conversation focus; it never changes records or identity. */
export function setsAsideNamedTopic(message:string):boolean {
  const text=message.slice(0,4000).replace(/[“「『"][^”」』"]*[”」』"]/gu,'').trim();
  if(/^(?:他|她|他们|她们|朋友|同事|如果|假如|假设|比如|例如|翻译|解释|帮我写|写一句|写一段)/u.test(text))return false;
  return text.split(/[。！!\n]|(?<=[？?])/u).some(sentence=>{
    if(/^(?:他|她|朋友|同事|如果|假如|假设|比如|例如|我(?:刚|刚才)?听(?:说|到|他|她)|翻译|解释|帮我写|写一句|写一段)/u.test(sentence.trim()))return false;
    return sentence.split(/[，,；;]/u).some(clause=>{
      const match=clause.trim().match(/^(?:我|我们|咱们)?(?:今天|现在|这次|暂时)?(?:先|就)?(?:不再|不)(?:聊|说|提)([^。！？!?，,；;\n]{1,24}?)(?:了|吧)?$/u);
      return !!match&&!/^(?:了|吧|啊|呀|呢)$|^(?:也|就|都)(?:行|可以|好|没关系|罢)|(?:什么|怎么|谁|哪里|哪儿|是否|是不是|为什么|何时|多久)/u.test(match[1]);
    });
  });
}

export function hasExplicitTopicShift(message:string):boolean {
  if(setsAsideNamedTopic(message))return true;
  const text=message.replace(/[“「『"][^”」』"]*[”」』"]/gu,'').trim();
  const clauses=text.split(/[。！？!?，,；;\n]/u).map(part=>part.trim());
  return clauses.some(part=>! /^(?:他|她|朋友|同事|如果|假如|假设|例如|比如)/u.test(part)
    && !/(?:不想|不要|不用|别|不需要).{0,4}(?:换个话题|换个问题|说点别的|聊点别的)/u.test(part)
    && /^(?:我们|咱们)?(?:先聊别的|换个话题|换个问题|说点别的|先不说这个|不说这个了|先不聊这个|这个先不说了|不聊这个了|对了|另外|话说回来|顺便问一下|我突然想起|说到这个|先聊点|聊点别的|说个别的)/u.test(part))
    || /^算了[，,、:：\s]+.{3,}/u.test(text);
}

/** Only a whole turn closing this conversation. A departure inside a question,
 * report or task does not imply that the user has finished talking. */
export function conversationDeparture(message:string):{topicDeferred:boolean}|undefined {
  if(/[?？]/u.test(message))return undefined;
  // Quoted, reported and hypothetical departures are not the speaker leaving.
  if (/[“「『"]/u.test(message) || /^(?:他|她|他们|她们|朋友|同事|如果|假如|假设|比如|例如|翻译|解释|帮我写|写一段)/u.test(message.trim())) return undefined;
  const clauses=message.trim().split(/[。！？!?，,；;\n]/u).map(part=>part.trim()).filter(Boolean);
  if(clauses.length<2||clauses.length>6)return undefined;
  const acknowledgement=/^(?:嗯+|好(?:的|吧|呀|啦|了)?|行|知道了|谢谢(?:你)?|(?:今天|今晚)?聊得(?:挺|很)?(?:开心|舒服)|我(?:很|挺)?喜欢这样(?:随便|安静|轻松)?(?:跟|和)你聊)$/u;
  const understood=/^(?:这次|现在|刚才)?(?:我)?(?:已经)?(?:听明白|听懂|明白|懂)(?:了你的意思|你的意思了|了你(?:刚才)?说的|你(?:刚才)?说的了|了)$/u;
  // A brief feeling about this exchange can precede a terminal goodbye.
  // Do not accept arbitrary preceding content: actual questions/tasks stay open.
  const exchangeFeeling=/^(?:(?:听见|听到|听|听你|听见你|听到你)(?:你)?说[^？?]{0,30}[，,]?)?我(?:也|还|真的|很|挺|有点)?(?:开心|高兴|欢喜|放心|舍不得)(?:的|了|呀|啊)?$/u;
  const exchangeContent=/^(?:听见|听到|听)你说(?:自己的)?(?:心意|想法|看法)$/u;
  const deferred=/^(?:那|这个|这|刚才那个)?(?:话题|话|问题)(?:先)?(?:留着|放一放|放着|不展开)(?:吧|了)?$/u;
  const leaving=/^(?:(?:我(?:现在)?|现在)(?:先|得|要)?|先)(?:去[^“”「」『』"\s]{1,18}|出门|下线|忙)(?:了|啦)?$/u;
  const isLeaving=(part:string)=>leaving.test(part)&&!/(?:吗|么|怎么|如何|哪[个里儿]|还是|要不要|该不该|能不能|是不是)/u.test(part);
  // A return marker already places the conversation later; an extra 再 is
  // optional. Whole-clause matching keeps a future question or task open.
  const returning=/^(?:(?:我)?(?:回来|回头|结束|忙完|下次|明天|改天)(?:后)?(?:再|接着)?(?:来|聊|说|找你|聊这个)|(?:回头|下次|明天|改天)见|(?:我)?(?:先|就)聊到这(?:里)?)(?:吧|了|啦)?$/u;
  if(!clauses.some(isLeaving)||!returning.test(clauses[clauses.length-1]))return undefined;
  if(!clauses.every(part=>acknowledgement.test(part)||understood.test(part)||exchangeFeeling.test(part)||exchangeContent.test(part)||deferred.test(part)||isLeaving(part)||returning.test(part)))return undefined;
  return {topicDeferred:clauses.some(part=>deferred.test(part))};
}

export function isStandaloneClosing(message:string):boolean {
  if(conversationDeparture(message))return true;
  // A brief acknowledgement before an explicit end remains a goodbye.
  // Other facts, questions, quoted ends and requests keep their own intent.
  const clauses=message.trim().split(/[。！？!?，,；;\n]/u).map(part=>part.trim()).filter(Boolean);
  const end=clauses[clauses.length-1]??'';
  if(!/[?？]/u.test(message)&&/^(?:今天|今晚)?(?:(?:就|先)?聊到这(?:里)?|(?:就|先)这样)(?:吧|了|啦)?$/u.test(end)
    &&clauses.slice(0,-1).every(part=>/^(?:嗯+|好(?:的|吧|呀|啦)?|行|谢谢(?:你)?(?:听我说|陪我聊(?:天)?)?|今天聊得(?:挺|很)?(?:开心|舒服)|我(?:就|也|挺|很)?喜欢听你说(?:自己的)?(?:想法|看法))$/u.test(part)))return true;
  const text=message.trim().replace(/^(?:行|好(?:的)?|嗯)[，,\s]+/u,'')
    .replace(/^(?:今(?:天|晚))?(?:就这样|先这样|先聊到这(?:里)?|聊到这(?:里)?)[，,。！!\s]+/u,'')
    .replace(/^(?:明天|改天|下次)(?:再|接着)(?:聊|说|弄|做|处理)(?:吧|了)?[，,。！!\s]+/u,'');
  return /^(?:嗯+|好(?:的|吧|呀|啦)?|行|算了|先这样|晚安|拜拜|明天见|回见|我先下了|我先睡了)(?:[呀啦哦嗯喽吧。！!，,～~\s])*$/u.test(text);
}
