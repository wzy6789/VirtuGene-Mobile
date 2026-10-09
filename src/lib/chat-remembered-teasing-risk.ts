/** Narrow attribution warning, not a verdict about all memories. A laugh in a
 * message does not by itself mean the user mocked the character. */
export function findRememberedTeasingRisk(content:string,userMessage='',recentUserMessages:string[]=[]):string|undefined {
  const text=content.replace(/[“「『"][^”」』"]*[”」』"]/gu,'');
  const clauses=text.split(/[。！？!?；;\n]|-{3,}/u);
  const claim=clauses.find(clause=>{
    const part=clause.trim();
    if(!part||/^(?:如果|假如|假设|比如|例如|要是)|(?:的话|如果|假如|要是)|(?:别|不要|不能|不是|没有|没).{0,8}你.{0,8}笑我/u.test(part))return false;
    if(/[?？]/u.test(text.slice(text.indexOf(clause)+clause.length,text.indexOf(clause)+clause.length+1)))return false;
    return /你(?:刚才|之前|上次|以前)笑我/u.test(part)
      || /你笑我[^。！？!?]{1,45}[，,].{0,12}(?:记着|记得|没忘|还记|忘不了)/u.test(part);
  });
  if(!claim)return undefined;
  const event=claim.match(/你(?:刚才|之前|上次|以前)?笑我([^，,。！？!?；;\n]{1,45})/u)?.[1].trim()??'';
  const normalize=(value:string)=>value.replace(/[挑选]/gu,'选').replace(/[\s。！？!?，,；;～~]/gu,'');
  // Only an explicit directed tease in actual user speech suppresses this
  // warning. Assistant prose, a reported speaker and quoted examples do not.
  const directed=[...recentUserMessages,userMessage].some(message=>message
    .replace(/[“「『"][^”」』"]*[”」』"]/gu,'').split(/[。！？!?，,；;\n]/u).some(clause=>{
      const part=clause.trim();
      return !/^(?:他|她|朋友|同事|如果|假如|假设|比如|例如|帮我|写)/u.test(part)
        && !/(?:没|没有|不是|不想|不要|别|不必).{0,6}(?:笑你|嘲笑你|取笑你)/u.test(part)
        && /^(?:我(?:刚才|之前|上次|以前|就是|只是在|是在)?(?:笑你|嘲笑你|取笑你)|(?:笑你|嘲笑你|取笑你))/u.test(part)
        && event.length>=2&&normalize(part).includes(normalize(event));
    }));
  return directed?undefined:claim.trim().slice(0,100);
}
