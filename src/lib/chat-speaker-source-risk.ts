/** A narrow contradiction check: a distinctive phrase actually present only
 * in this speaker's recent replies cannot be quoted as the user's words.
 * Missing history alone is never evidence that the user did not say something. */
const normalize=(text:string)=>text.replace(/[\s，,。！？!?；;：:“”「」『』"']/gu,'');
const asserted=(text:string)=>text.replace(/[“「『"][^”」』"]*[”」』"]/gu,'').split(/[。！？!?\n，,；;]/u)
  .map(part=>part.trim()).filter(part=>part&&!/^(?:你(?:刚才|之前)?说|他|她|朋友|同事|原话|如果|假如|假设|比如|例如)|没说|不是说|并不认为/u.test(part));
export function findSpeakerSourceRisk(content:string,userSources:string[]=[],assistantSources:string[]=[]):string|undefined{
  if(!assistantSources.length)return;
  const users=userSources.flatMap(asserted).map(normalize),own=assistantSources.map(normalize);
  for(const sentence of content.split(/[。！？!?\n]|-{3,}/u)){
    if(/^\s*[“「『"']|^\s*(?:如果|假如|假设|要是|比如|例如|朋友说|他说|她说|引用|原文|翻译)/u.test(sentence))continue;
    const matches=sentence.matchAll(/(?:^|[，,；;])\s*你(?:刚才|先前|以前|上次|之前)?(?:说过?|讲过?|提过?)(?:[：:“「『"])?([^，,；;“”「」『』"]{6,100})/gu);
    for(const match of matches){
      const claim=normalize(match[1]);
      // Slot paraphrases and completion facts belong to the source-backed
      // topic projection, not a literal phrase-origin heuristic.
      if(/\d|[一二三四五六七八九十]+[点时月日号]|周[一二三四五六日天]|改到|安排|完成|考完|结束/u.test(claim)||users.some(source=>source.includes(claim)))continue;
      for(let i=0;i<=claim.length-6;i++){
        const anchor=claim.slice(i,i+6);
        if(own.some(source=>source.includes(anchor))&&!users.some(source=>source.includes(anchor)))return match[0].replace(/^[，,；;\s]+/u,'');
      }
    }
  }
  return undefined;
}
export function omitWrongSpeakerClaims(content:string,userSources:string[]=[],assistantSources:string[]=[]):string{
  let removed=false;
  const safe=content.split(/\s*-{3,}\s*/u).map(bubble=>bubble.split(/(?<=[。！？!?；;\n])/u)
    .filter(sentence=>{if(findSpeakerSourceRisk(sentence,userSources,assistantSources)){removed=true;return false;}return true;}).join('').trim()).filter(Boolean).join('\n---\n');
  return removed?safe:content;
}
