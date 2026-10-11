/** A current wish for doing something together, not a completed event or
 * permission to schedule it. Keep report and condition scope across commas. */
export function currentJointWish(message:string):string|undefined {
  const text=message.slice(0,4000).replace(/[“「『"][^”」』"]*[”」』"]/gu,'');
  for(const sentence of text.matchAll(/([^。！？!?\n]+)([。！？!?\n]|$)/gu)) {
    const body=sentence[1].trim();
    if(/[?？]/u.test(sentence[2])||/^(?:朋友|同事|他|她|如果|假如|假设|要是|比如|例如|翻译|解释|(?:帮我|替我|给我)(?:写|编))/u.test(body)
      ||/^我.{0,8}(?:听说|听到|听见|听|看到|看见|转述|引用).{0,12}(?:问|说)/u.test(body))continue;
    for(const clause of body.split(/[，,；;]/u).map(part=>part.trim())) {
      if(/^(?:那|不过|其实|倒)?(?:我(?:今天|现在)?|今天|现在)?(?:倒|也|还|就|挺|有点|有一点)?想(?:再)?(?:和你|跟你|与你|陪你)(?:一起|再)?[^。！？!?，,；;\n]{1,70}$/u.test(clause)
        &&!/(?:帮我|替我|给我)|(?:添加|删除|发布|完成)(?:待办|任务|日记|动态)|(?:要不要|该不该)/u.test(clause))return clause;
    }
  }
  return undefined;
}

/** Preserve the condition when a speaker expresses a shared wish under it.
 * This is neither a current availability record nor a completed plan. */
export function conditionalJointWish(message:string):string|undefined {
  const plain=message.slice(0,4000).replace(/[“「『"][^”」』"]*[”」』"]/gu,'');
  for(const sentence of plain.matchAll(/([^。！？!?\n]+)([。！？!?\n]|$)/gu)) {
    const body=sentence[1].trim();
    if(!/^(?:如果|假如|要是)[^，,；;]{1,70}[，,]/u.test(body)||/[?？]/u.test(sentence[2]))continue;
    const after=body.slice(body.search(/[，,]/u)+1);
    if(currentJointWish(after))return body;
  }
  return undefined;
}
