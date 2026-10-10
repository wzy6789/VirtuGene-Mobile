import {SAMPLE_LINE,stripVoiceSampleBlock} from './character-voice';
import {isDirectAffection,isAffectionQuestion} from './chat-expression-boundary';

// This only checks a narrow historical claim about the other person's
// expression. It does not judge personality, forbid teasing, or infer a habit
// from a few replies. Questions and fictional scenes are handled separately.
const CLAIM=/(?:你(?:倒是|倒|也|还)?(?:难得|很少|不常|平时不|一向不|从来不)[^。！？!?，,；;\n]{0,24}(?:直白|坦率|主动(?:说|讲)|说(?:这些|这种|这句|喜欢|爱)|讲(?:这些|这种|这句)|表达(?:喜欢|心意|爱))|(?:难得|很少|不常)(?:(?:听见|听到|听|见到|见)[^。！？!?，,；;\n]{0,8})?你[^。！？!?，,；;\n]{0,20}(?:直白|坦率|说|讲|表达))/u;
const USER_SOURCE=/^(?:我(?:自己|以前|平时)?)(?:很少|不常|难得|从来不|一向不|平时不)[^。！？!?，,；;\n]{0,16}(?:直白|坦率|主动(?:说|讲)|说(?:这些|这种|这句|喜欢|爱)|讲(?:这些|这种|这句)|表达(?:喜欢|心意|爱))/u;
const NAMED_SOURCE=/(?:唐舞麟|舞麟)(?:平时)?(?:很少|不常|难得|从来不|一向不|平时不)[^。！？!?，,；;\n]{0,16}(?:直白|坦率|主动(?:说|讲)|说(?:这些|这种|这句|喜欢|爱)|讲(?:这些|这种|这句)|表达(?:喜欢|心意|爱))/u;
// A contrast with the person's "usual self" is also a historical claim.
// Only apply this short wording pattern in a direct affection exchange;
// a comparison of a cup or a style is not evidence about affection habits.
const USUAL_EXPRESSION=/^(?:(?:这句(?:话)?|这样(?:说|讲)|这么(?:说|讲))(?:倒|反倒|却|还|也)?|(?:倒|反倒|却|还|也|只是)?)(?:不太像|不像)你(?:平时|平常|往常|一贯|一向)(?:的样子|的说法|的语气|那样|这样|这么)/u;
const OWN_USUAL_EXPRESSION=/^我(?:平时|平常|往常|一贯|一向)(?:很少|不常|不太|不)(?:这样|这么)(?:说|讲)(?:话)?[呀啊呢啦\s]*$/u;

export function findAffectionHistoryRisk(content:string,currentUserMessage='',recentUserMessages:string[]=[],persona=''):string|undefined {
  const unquoted=content.replace(/[“「『"][^”」』"]*[”」』"]/gu,'');
  const directAffection=isDirectAffection(currentUserMessage)||isAffectionQuestion(currentUserMessage);
  const claim=[...unquoted.matchAll(/([^。！？!?，,；;\n]+)([。！？!?，,；;\n]|$)/gu)].find(match=>{
    const clause=match[1].trim();
    const start=Math.max(...['。','！','？','!','?',';','；','\n'].map(mark=>unquoted.lastIndexOf(mark,match.index!)))+1;
    const prefix=unquoted.slice(start,match.index!);
    if(/[?？]/u.test(match[2])||/^(?:如果|假如|假设|比如|例如|要是)|(?:别|不要|不能).{0,12}(?:难得|很少|平时不)|(?:不是|并非|不觉得|不认为).{0,10}(?:你(?:倒是|倒|也|还)?(?:难得|很少|不常|平时不)|(?:难得|很少|不常)(?:听见|听到|听|见到|见)?你)/u.test(clause))return false;
    if(/(?:如果|假如|假设|比如|例如|要是)|^(?:他|她|朋友|同事).{0,12}(?:说|问)/u.test(prefix))return false;
    return CLAIM.test(clause)||directAffection&&USUAL_EXPRESSION.test(clause);
  })?.[1];
  if(!claim)return undefined;
  const userSources=[...recentUserMessages,currentUserMessage].flatMap(text=>text.replace(/[“「『"][^”」』"]*[”」』"]/gu,'').split(/[。！？!?，,；;\n]/u).map(s=>s.trim()));
  if(userSources.some(source=>USER_SOURCE.test(source)||OWN_USUAL_EXPRESSION.test(source)))return undefined;
  // A named fictional spouse's trait can support the claim only after the
  // current interlocutor actually identifies themselves. A conditional line
  // in the persona is not evidence that the speaker has that identity.
  const identity=[...userSources].reverse().find(source=>/^我(?:就是|是|不是).{1,20}$/u.test(source));
  const isWulin=!!identity&&/^我(?:就是|是)(?:唐舞麟|舞麟)[。！!\s]*$/u.test(identity);
  const authored=stripVoiceSampleBlock(persona).split(/\r?\n/u).filter(line=>!SAMPLE_LINE.test(line)&&!/(?:不要|不必|不能|不准|如果|若|假如)/u.test(line));
  if(isWulin&&authored.some(line=>NAMED_SOURCE.test(line)))return undefined;
  return claim.trim().slice(0,100);
}

/** Remove entire unsupported frequency sentences after the existing retry.
 * Independent present reactions survive; no invented replacement line. */
export function omitUnsupportedAffectionHistory(content:string,currentUserMessage='',recentUserMessages:string[]=[],persona=''):string {
  return content.split(/\s*-{3,}\s*/u).map(bubble=>bubble.split(/(?<=[。！？!?；;\n])/u)
    .filter(sentence=>!findAffectionHistoryRisk(sentence,currentUserMessage,recentUserMessages,persona)).join('').trim())
    .filter(Boolean).join('\n---\n');
}
