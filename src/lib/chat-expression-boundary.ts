/** Delivery guidance, never permission for application operations. */
import {requestsRepetition,isDirectTimeAnswer,isTopicClarification,isSelfViewRevision,hasExplicitTopicShift} from './chat-turn-cues';
export function isOpinionInvitation(message:string):boolean {
  const unquoted=message.replace(/[“「『"][^”」』"]*[”」』"]/gu,'');
  return unquoted.split(/[。！？!?，,；;\n]/u).some(part=>
    !/^(?:他|她|朋友|同事|如果|假如|例如|比如)/u.test(part.trim())
    && !/(?:不用|不要|别|不必).{0,8}(?:不同意|反对|直说|说实话)/u.test(part)
    && /(?:你(?:有不同意见|不同意|不赞成|反对).{0,8}(?:也可以|可以|就|尽管).{0,4}(?:直说|说出来|说)|(?:别只顺着我|别一味赞同|不用迎合我|说说你自己的看法))/u.test(part));
}

/** A view is not an instruction to solve the situation. This is only a prompt
 * clue; it never authorizes an operation or overrides the original message. */
function isChoiceInvitation(message:string):boolean {
  // Quoted option names remain options; a wholly quoted request or a third-
  // person report still cannot start with an address to the current character.
  return message.slice(0,4000).replace(/[“「『"][^”」』"]*[”」』"]/gu,'选项')
    .split(/[。！？!?，,；;\n]/u).map(part=>part.trim()).some(part=>
      /^(?:那|所以|对了)?\s*你(?:说|觉得|会选|更喜欢|想选|选)\s*.{1,55}还是.{1,55}$/u.test(part)
      && !/(?:都行|都可以|都好|随便|无所谓)$/u.test(part)
      && !/(?:不用|不要|别|不必|无需|不需要).{0,8}(?:选|说|回答|觉得)/u.test(part));
}

export function isViewExchange(message:string):boolean {
  const clauses=message.slice(0,4000).replace(/[“「『"][^”」』"]*[”」』"]/gu,'')
    .split(/[。！？!?，,；;\n]/u).map(part=>part.trim())
    .filter(part=>!/^(?:他|她|朋友|同事|如果|假如|假设|例如|比如)/u.test(part));
  const asksForHelp=clauses.some(part=>
    !/(?:不用|不要|别|不必|无需|不需要).{0,10}(?:建议|办法|方案|步骤|帮|告诉|教|怎么)/u.test(part)
    && /(?:怎么办|怎么(?:做|处理|回复|拒绝|安排)|有什么(?:建议|办法)|(?:给我|请你|帮我|替我|教我).{0,12}(?:建议|办法|方案|步骤|写|改|整理|安排|看|分析|解释|推荐|查))/u.test(part));
  if(asksForHelp)return false;
  return isChoiceInvitation(message)||isOpinionInvitation(message)||clauses.some(part=>
    !/(?:不用|不要|别|不必).{0,8}(?:看法|观点|怎么看|觉得)/u.test(part)
    && /(?:你怎么看|你觉得呢|你(?:同意|赞成)吗|(?:说说|聊聊|听听|告诉我).{0,6}你(?:自己)?的(?:看法|观点))/u.test(part));
}

export function isDirectAffection(message: string): boolean {
  const text=message.replace(/[“「『"][^”」』"]*[”」』"]/gu,'').trim();
  if(/^(?:如果|假如|假设|比如|例如|帮我写|写一段|写一个|他|她|朋友|同事|主角)/u.test(text))return false;
  return text.split(/[。！？!?，,；;\n]/u).some(part=>/^(?:我(?:真的|好|很|也|还是)?(?:爱你|喜欢你|想你)(?:了)?|想你了|好想你|你对我很重要)[～~\s]*(?:呀|啊|呢|啦|嘛)?[～~\s]*$/u.test(part.trim()));
}

export function allowsDramaticReply(message: string, recentUserMessages: string[] = []): boolean {
  // Only user requests establish this mode; assistant prose and ambient location
  // cards do not turn a messaging conversation into physical co-presence.
  const turns=[...recentUserMessages.slice(-6), message].reverse();
  for (let i=0;i<turns.length;i++) {
    const raw=turns[i];
    const text=raw.replace(/[“「『"][^”」』"]*[”」』"]/gu,'').trim();
    if (/(?:别|不要|不用|停止|退出|不想|不是要).{0,6}(?:演|角色扮演|剧情|写(?:故事|小说|剧情|场景|台词|诗|情书)|诗意|文学)|正常(?:聊天|说话)|像发消息|别写动作|换个话题|说点别的|先不说这个|不聊这个了/u.test(text)) return false;
    if (/(?:陪我|我们|一起|继续|来).{0,6}(?:演一段|演一下|演个|角色扮演|接着演)|继续.{0,6}(?:扮演|剧情)/u.test(text)) return true;
    if (/(?:写|续写|改写|创作|继续).{0,8}(?:故事|小说|剧情|场景|台词|诗|情书|邀请词|文案)|(?:用|按).{0,6}(?:文学|诗意|小说|舞台).{0,4}(?:风格|方式|写法)/u.test(text)) return i===0;
  }
  return false;
}

/** Narrow signal: two physical staging directives, not any mention of a door. */
export function hasUninvitedStaging(content: string): boolean {
  const text=content.replace(/[“「『"][^”」』"]*[”」』"]/gu,'');
  const directives=text.match(/(?:^|[。！？!?，,；;\n]|-{3,}|——)\s*(?:你(?:先|快|就)?\s*)?(?:进来(?:吧|呀|啊)?|坐(?:下|过来)(?:吧|呀|啊)?|人坐下|把门(?:带上|关上)|把(?:手机|杯子)(?:放下|递给我)|靠(?:过来|近一点)|抬(?:起)?头(?:看我)?|看着我(?:说)?|当(?:着我的)?面再说一遍|再当面说一遍)(?=[。！？!?，,；;—\n\s]|$)/gu) ?? [];
  return directives.length>=2;
}

/** Only a short, directly expressed feeling plus several editorial devices. */
export function hasOverwrittenAffection(content: string, userMessage: string): boolean {
  if (!isDirectAffection(userMessage) || content.length<45) return false;
  const receipt=/(?:这句话|这三个字|这份心意|你的心意).{0,18}(?:收下|接住)|(?:我|这句).{0,8}(?:收下了|接住了)/u.test(content);
  const explanation=/不是.{4,40}(?:那种|而是|是那种)/u.test(content);
  const dramatizing=/(?:隔着门板|混着风声|当面说|看着你说|风替你|夜色替你)/u.test(content);
  return Number(receipt)+Number(explanation)+Number(dramatizing)>=2;
}

export function directChatGuidance(userMessage:string, recentUserMessages:string[], recentReplies:string[]):string {
  if (allowsDramaticReply(userMessage,recentUserMessages)) return '本轮用户明确选择了创作或扮演，按其要求接续；不要把虚构场景当成现实经历。';
  const lines:string[]=[];
  const unquoted=userMessage.replace(/[“「『"][^”」』"]*[”」』"]/gu,'');
  const previousUser=recentUserMessages[recentUserMessages.length-1]??'';
  if(isChoiceInvitation(previousUser)&&/^(?:我(?:还是|更|偏)?(?:想|选|决定)|那就|就选).{1,50}(?:就这么定了|就它了|就这样吧|吧|了)[。！!\s]*$/u.test(unquoted.trim()))lines.push('用户已选定一项。顺着选中的内容，说一点你自己的反应就好，不额外评价这次选择。');
  if(isSelfViewRevision(unquoted)&&!hasExplicitTopicShift(unquoted))lines.push('用户在调整刚才的观点，还在聊同一件事。顺着这个新看法，说你自己的具体态度即可；对方的感受和原因以其已经讲明的内容为准。把注意力放在新的观点或事情上，让这次改口自然过去，双方可以继续各有看法。');
  else if(isTopicClarification(unquoted))lines.push('用户在更正刚才的说法，接最新内容即可。更正的是自己的认识还是外部事实，以其原话为准；未说改期、取消或发生新变化，就不替事件补一段变动经过。');
  if(unquoted.split(/[。！？!?，,；;\n]/u).some(part=>
    /^(?:刚才|前面|之前)(?:我|我们)?(?:说|提)(?:过|的|到).{0,24}(?:什么时候|几点|哪天|在哪|哪里|叫什么|是什么|哪个)/u.test(part.trim())))
    lines.push('用户在回查刚才说过的具体内容，按最新原话及更正直接回答。不把告知说成以前问过，不猜用户问了几次、忘性或为什么再问。找不到对应原话才具体补问，不把旧推测当作已知事实。');
  if(isDirectTimeAnswer(userMessage,recentUserMessages[recentUserMessages.length-1]??''))lines.push('这轮的时间在接上一条时间问题，按原问题的事件和时间语境理解。现在说出来不代表事件刚刚发生，也不代表用户醒来或办完后第一件事就来找你；未来安排也不说成已经完成。只用用户讲明的内容接话。');
  if(requestsRepetition(userMessage))lines.push('用户明确要复述：按其指定的对象保留原措辞，不把用户的原话改写成人物自己的事实，不追加点评、解释或询问要不要再念。对象确实不清楚或找不到原文时，具体问是哪一句，不编一个替代版本。');
  if(requestsRepetition(userMessage)&&/我(?:刚才那句|上一句|上一条)/u.test(unquoted)
    && !/(?:更早|之前那句|前面那句|倒数|第[一二三四五六七八九十\d]+句|上一句.{0,8}(?:前半|后半|开头|结尾)|刚才那句.{0,8}(?:前半|后半|开头|结尾))/u.test(unquoted)){
    const source=recentUserMessages[recentUserMessages.length-1];
    if(source)lines.push(`本轮“我刚才那句”已按相邻用户消息定位，原文：${JSON.stringify(source)}。只复述这条，不再列举更早的话让用户选。`);
  }
  if(unquoted.split(/[。！？!?，,；;\n]/u).some(part=>/^(?:对了|那|所以)?\s*你(?:还)?(?:知道|记得)我.{0,18}(?:几点|哪天|什么时候|在哪|哪里|哪儿)/u.test(part.trim())&&!/(?:如果|假如|假设)/u.test(part)))lines.push('用户问自己的具体事实：只依据其原话或可靠记录回答；没有对应内容，就用人物自己的口语坦白不知道，确实想继续聊再具体问。核对依据与推理过程在后台完成，正文只保留接这句话的自然回应。');
  const socialContext=[...recentUserMessages.slice(-2),unquoted].join(' ').replace(/[“「『"][^”」』"]*[”」』"]/gu,'');
  if(/(?:朋友|同事|家人|父母|室友|伴侣|对象)/u.test(socialContext)&&/(?:约|答应|承诺|拒绝|改主意|不想)/u.test(unquoted))
    lines.push('本轮讨论现实相处与选择，只按用户说过的条件表达看法。不能替第三人保证反应或认定对方没有损失，也不把承诺改写成用户没说过的约定。意愿变化本身不是疲惫、状态差或关系出了问题的证据；既可以有自己的主张，也要给未知的原因和他人实际安排留位置，不为劝服用户补写事实。');
  const narrowJudgment=unquoted.split(/[。！？!?，,；;\n]/u).some(part=>
    /^(?:你)?(?:只|就)(?:说|告诉我|回答).{0,18}(?:顺不顺|对不对|能不能用|行不行|好不好)/u.test(part.trim()));
  if(narrowJudgment)lines.push('用户这轮只要一个限定判断，直接给结论，必要时补一句简短依据。不顺势追加整段修改、其他维度的点评、方案或补问；保持人物自己的措辞，不用替用户把这个小问题扩成另一项任务。');
  const singleReply = !/^(?:如果|假如|假设|比如|例如|他|她|朋友|同事)/u.test(unquoted.trim())
    && unquoted.split(/[。！？!?，,；;\n]/u).some(part=>/^(?:现在|这次|先|就|只)?\s*(?:帮我|替我|给我|请你)(?:写|拟)(?:一|1)句(?:回复|回话|回应)/u.test(part.trim()))
    && !/(?:再|也|顺便|同时|然后|并且|并).{0,8}(?:解释|分析|说明|评价|给.{0,4}(?:版本|选项|一句)|写.{0,4}(?:一段|一句))|(?:多个|几种|两种|三个|两个|多种|\d+种|\d+个).{0,4}(?:版本|选项|说法)/u.test(unquoted);
  if(singleReply)lines.push('用户要一句能发给对方的回复：直接给这一句，语气和内容以用户要求为准。不加开场、使用说明、替代版本或挑选问题；不声称已经替用户发送。');
  if(isViewExchange(userMessage)) lines.push(isChoiceInvitation(userMessage)
    ?'用户邀请你说真实看法：两项里可以说自己更喜欢哪项，给一个你自己喜欢的理由，而不是替用户评选正确答案、分析其状态或安排怎么放假。用户最后另选一项也正常，不需要你批准或再判对错；确实想聊那项内容可以接话。'
    :'用户邀请你说真实看法：以这个人物自己的立场回应一处具体观点，同意或不同意都可以。这里是在交流看法，不是让你安排下一步；说清态度和依据即可收住，不固定追加“你觉得呢”。用户说出的原因是事实，历史里你猜过的原因仍是猜测；拿不准时留白或具体问，不替用户补理由。');
  if (isDirectAffection(userMessage)) lines.push('用户直接表达了喜欢，不是在请你分析爱的定义。这轮说你自己的感受、是否愿意靠近或你需要的界限；亲密程度以人物与实际关系为准。态度说清即可，不追加考查心意来历或要求解释的问题；保持发消息的方式，不安排当面重说。明确的心意不需要改成待澄清的问题。');
  if (recentReplies.slice(-3).some(text=>hasUninvitedStaging(text)||hasOverwrittenAffection(text,userMessage))) lines.push('最近回复带出了现场表演或情绪独白。历史里的门、动作和氛围不是现在同处一室的证据；这轮回到发消息，接用户眼前的话，不再续演那个布景。');
  return lines.join('\n');
}
