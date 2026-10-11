/** A current reply instruction, never an enduring preference or a text rewrite. */
function requestedReplySize(message:string):'brief'|'one-sentence'|undefined {
  const text=message.slice(0,4000).replace(/[“「『"][^”」』"]*[”」』"]/gu,'');
  let size:'brief'|'one-sentence'|undefined;
  for(const sentence of text.split(/[。！!\n]|(?<=[？?])/u)){
    if(/^(?:他|她|朋友|同事|如果|假如|假设|比如|例如|翻译|解释)/u.test(sentence.trim())
      ||/(?:内容是|原文是|台词是|他说|她说)/u.test(sentence))continue;
    for(const part of sentence.split(/[，,；;]/u).map(value=>value.trim())){
      if(/^(?:但|不过|还是)?(?:请|麻烦你|你)?(?:这次|现在|先)?(?:的)?(?:回答|回复|说得|讲得|说|讲)?(?:短(?:一)?点|简单(?:一)?点|简短(?:一)?点|少说(?:一)?点|一句就好|长话短说)(?:就好|就行|吧|好吗|好不好|可以吗|行吗|呀|啊)?[？?]?$/u.test(part))size=size==='one-sentence'?size:'brief';
      // Exact reply quantity is not an enduring preference or a quoted line.
      if(/^(?:但|不过|还是)?(?:请|麻烦你|你)?(?:这次|现在|先)?(?:就|只|只要|只需)?(?:说|讲|回|回答|回复)一句(?:话)?(?:就好|就行|吧|好吗|好不好|可以吗|行吗|呀|啊)?[？?]?$/u.test(part)
        ||/^(?:我)?(?:这次|现在|先)?(?:就|只)?想(?:听听|听)你(?:说|讲|回|回答|回复)一句(?:(?:你(?:自己)?的|自己的)?(?:心意|想法|看法|感受|态度))?[呀啊吧呢啦\s]*$/u.test(part)
        ||/^一句(?:话)?(?:就好|就行)[呀啊吧呢啦\s]*$/u.test(part))size='one-sentence';
      // Preserve a later change of mind and requests to expand only one part;
      // a short overview plus detailed reasons is not a strict short reply.
      if(/^(?:但|不过|还是)?(?:请|麻烦你|你)?(?:这次|现在|先)?(?:的)?(?:回答|回复|原因|理由|细节)?(?:详细(?:一)?点|展开说|多说(?:一)?点|讲清楚|写长(?:一)?点)(?:吧|好吗|好不好|可以吗)?[？?]?$/u.test(part))size=undefined;
    }
  }
  return size;
}

export function requestsBriefReply(message:string):boolean {return requestedReplySize(message)!==undefined;}
export function requestsSingleSentenceReply(message:string):boolean {return requestedReplySize(message)==='one-sentence';}
