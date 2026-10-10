/** Bounded attribution check for explicit recurring user behavior. A single
 * choice, the character's earlier reply and a style sample do not establish a
 * user habit. This is deliberately literal, not a semantic memory verifier. */
const FREQUENCY='(?:平时|经常|通常|总是|一向|向来|每次|一直)';
const CLAIM=new RegExp(`你(?:自己)?(?:${FREQUENCY}|又(?=不爱|不喜欢))([^。！？!?，,；;\\n]{2,80})`,'u');
const SOURCE=new RegExp(`^我(?:自己)?(?:${FREQUENCY})?((?:不爱|不喜欢|喜欢|爱)[^。！？!?，,；;\\n]{1,75}|[^。！？!?，,；;\\n]{2,80})$`,'u');
const CONDITIONAL=/(?:如果|假如|假设|要是|比如|例如|的话|的时候|时才|时就|才会)/u;
const normalize=(value:string)=>value.trim().replace(/\s/gu,'').replace(/[的了呀啊呢吧]+$/u,'');
const withoutQuotes=(value:string)=>value.replace(/[“「『"][^”」』"]*[”」』"]/gu,'');

function userAssertions(messages:string[]):Array<{predicate:string;key:string;currentOnly:boolean}> {
  return messages.flatMap(message=>withoutQuotes(message).split(/[。！!，,；;\n]/u).flatMap(clause=>{
    // A directly updated preference supersedes the earlier one. Do not turn
    // a dated action such as “我今天说话很轻” into a standing habit.
    const currentOnly=/^(?:我(?:现在|如今)|(?:现在|如今)我)(?=(?:不爱|不喜欢|喜欢|爱))/u.test(clause.trim());
    const part=clause.trim().replace(/^我(?:现在|如今)(?=(?:不爱|不喜欢|喜欢|爱))/u,'我')
      .replace(/^(?:现在|如今)我(?=(?:不爱|不喜欢|喜欢|爱))/u,'我');
    if(CONDITIONAL.test(part)||/[?？]|(?:不是说|没说|不觉得|不认为)|^(?:我)?(?:今天|现在|刚才|这次|昨天|明天)|^(?:帮我|写|解释)/u.test(part))return [];
    const match=part.match(SOURCE);
    if(!match)return [];
    // A bare current action is not evidence of recurrence. Explicit general
    // likes/dislikes can be restated, frequency claims need an explicit habit.
    if(!new RegExp(`^我(?:自己)?${FREQUENCY}`,'u').test(part)&&!/^我(?:自己)?(?:不爱|不喜欢|喜欢|爱)/u.test(part))return [];
    const predicate=normalize(match[1]);
    return [{predicate,key:predicate.replace(/^不/u,''),currentOnly}];
  }));
}

export function findUserHabitRisk(content:string,actualUserMessages:string[]=[]):string|undefined {
  const sources=userAssertions(actualUserMessages);
  for(const clause of withoutQuotes(content).split(/[。！!，,；;\n]|-{3,}/u)) {
    const part=clause.trim();
    if(!part||/[?？]/u.test(part)||CONDITIONAL.test(part)||/^(?:他|她|朋友|同事)|(?:不是|并非|不觉得|不认为).{0,8}你/u.test(part))continue;
    const match=part.match(CLAIM);
    if(!match)continue;
    const predicate=normalize(match[1]);
    // These report the speaker's response, rather than the user's routine.
    if(/^(?:让|令|叫)我/u.test(predicate))continue;
    // Broad affectionate evaluations and identity statements are not physical
    // or behavioral routines; do not turn compliments into source audits.
    if(/^(?:都)?(?:这么|那么|很|挺|真|特别)?(?:可爱|好看|漂亮|厉害|贴心|温柔|善良|可亲|可靠)$/u.test(predicate)||/^(?:都)?是/u.test(predicate))continue;
    const latest=[...sources].reverse().find(source=>source.key===predicate.replace(/^不/u,''));
    // A directly corrected present preference remains usable, but cannot be
    // restated as an unchanged past or universal routine. Keep the temporal
    // qualifier instead of losing it during first-person normalization.
    const strongScope=/^你(?:自己)?(?:一直|一向|向来|总是|每次)/u.test(match[0]);
    if(latest?.predicate===predicate&&!(latest.currentOnly&&strongScope))continue;
    return part.slice(0,120);
  }
  return undefined;
}

/** After the caller's existing retry only. Remove the unsupported assertion
 * with its same-sentence elaboration; preserve independent reactions exactly. */
export function omitUnsupportedUserHabits(content:string,actualUserMessages:string[]=[]):string {
  let removed=false;
  const safe=content.split(/\s*-{3,}\s*/u).map(bubble=>bubble.split(/(?<=[。！？!?；;\n])/u)
    .filter(sentence=>{if(findUserHabitRisk(sentence,actualUserMessages)){removed=true;return false;}return true;})
    .join('').trim()).filter(Boolean).join('\n---\n');
  return removed?safe:content;
}
