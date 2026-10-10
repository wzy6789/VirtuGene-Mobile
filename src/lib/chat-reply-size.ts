/** A current reply instruction, never an enduring preference or a text rewrite. */
export function requestsBriefReply(message:string):boolean {
  const text=message.slice(0,4000).replace(/[“「『"][^”」』"]*[”」』"]/gu,'');
  let brief=false;
  for(const sentence of text.split(/[。！!\n]|(?<=[？?])/u)){
    if(/^(?:他|她|朋友|同事|如果|假如|假设|比如|例如|翻译|解释)/u.test(sentence.trim())
      ||/(?:内容是|原文是|台词是|他说|她说)/u.test(sentence))continue;
    for(const part of sentence.split(/[，,；;]/u).map(value=>value.trim())){
      if(/^(?:但|不过|还是)?(?:请|麻烦你|你)?(?:这次|现在|先)?(?:的)?(?:回答|回复|说得|讲得|说|讲)?(?:短(?:一)?点|简单(?:一)?点|简短(?:一)?点|少说(?:一)?点|一句就好|长话短说)(?:就好|就行|吧|好吗|好不好|可以吗|行吗|呀|啊)?[？?]?$/u.test(part))brief=true;
      // Preserve a later change of mind and requests to expand only one part;
      // a short overview plus detailed reasons is not a strict short reply.
      if(/^(?:但|不过|还是)?(?:请|麻烦你|你)?(?:这次|现在|先)?(?:的)?(?:回答|回复|原因|理由|细节)?(?:详细(?:一)?点|展开说|多说(?:一)?点|讲清楚|写长(?:一)?点)(?:吧|好吗|好不好|可以吗)?[？?]?$/u.test(part))brief=false;
    }
  }
  return brief;
}
