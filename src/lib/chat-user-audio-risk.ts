/** The chat transport supplies text and optionally an image, not the user's
 * audio waveform. Conventional "听你这么说" remains a normal text response. */
export function findUserAudioRisk(content:string):string|undefined {
  const text=content.replace(/[“「『"][^”」』"]*[”」』"]/gu,'');
  const audio=/(?:(?:你(?:的)?|你(?:开心|高兴|难过|伤心|生气|笑)(?:的时候|时|了)?[，,]?\s*)(?:声音|嗓音|语调|笑声)(?:里|中|听起来|听着|带着|满是|都带|有些|有点)[^。！？!?，,；;\n]{1,24}|(?:听见|听到|听得出(?:来)?)[^。！？!?，,；;\n]{0,16}你(?:的)?(?:笑声|呼吸|叹气|在笑|笑了|声音|嗓音))/u;
  const clause=text.split(/[。！!；;\n]|-{3,}/u).find(part=>
    !/[?？]|^(?:如果|假如|假设|要是|比如|例如)|(?:上次|昨天|以前|过去|曾经|从前)|(?:没|没有|并未|不是|并非|不曾).{0,10}(?:听|声音|嗓音)/u.test(part.trim())&&audio.test(part));
  return clause?.trim().slice(0,100);
}

/** Keep independent sentences; do not invent replacement sensory details. */
export function omitUnsupportedUserAudio(content:string):string {
  return content.split(/\n?-{3,}\n?/u).map(bubble=>bubble.split(/(?<=[。！？!?])/u)
    .filter(sentence=>!findUserAudioRisk(sentence)).join('').trim()).filter(Boolean).join('\n---\n');
}
