/** Delivery guidance, never permission for application operations. */
export function isDirectAffection(message: string): boolean {
  return /^(?:我(?:真的|好|很|也|还是)?(?:爱你|喜欢你|想你)(?:了)?|想你了|好想你|你对我很重要)[。！!～~，,\s]*(?:呀|啊|呢|啦|嘛)?[。！!～~\s]*$/u.test(message.trim());
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
  if (isDirectAffection(userMessage)) lines.push('用户直接表达了心意。先用这个人的方式回应你对这份心意的态度，亲密程度和是否回应爱意由实际关系与人物边界决定；不用分析这句话，不要求当面再说，也不把接收心意写成仪式。');
  if (recentReplies.slice(-3).some(text=>hasUninvitedStaging(text)||hasOverwrittenAffection(text,userMessage))) lines.push('最近回复带出了现场表演或情绪独白。历史里的门、动作和氛围不是现在同处一室的证据；这轮回到发消息，接用户眼前的话，不再续演那个布景。');
  return lines.join('\n');
}
