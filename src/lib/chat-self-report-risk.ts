import { SAMPLE_LINE, stripVoiceSampleBlock } from './character-voice';

/** A narrow source-risk check, not a semantic truth verdict. It only recognizes
 * first-person recurring concrete actions. No missing biography is interpreted
 * as proof that an event never happened, and ordinary preferences stay allowed.
 */
export interface SelfReportRisk { quote:string; action:string }

const ACTION='(?:盯着(?:锁屏|手机|屏幕)|停留在(?:解锁|锁屏)(?:界面)?|解锁手机|喝(?:咖啡|茶|水|酒)|吃(?:苹果片|瓜子|饭|早餐|早饭|晚饭|午饭)|读书|看书|翻书|看电影)';
const HABIT=new RegExp(`(?:^|[。！？!?，,；;\\n]|-{3,})\\s*(?:其实|说实话)?我(?:自己|也)?(?:一般|经常|通常|平时|每次|总是)(?:也|都|是|会|都会|先|就|还|要|去|在)?\\s*(${ACTION}[^。！？!?，,；;\\n]{0,100})`,'gu');
const HYPOTHETICAL=/^(?:如果|假如|假设|比如|例如|要是)|(?:的话|假设|假如|如果|要是)/u;
const FREQUENCY=/(?:一般|经常|通常|平时|每次|总是|每天|每日|每晚|天天|习惯|常常|日常)/u;

function evidenceClauses(persona:string,records:string[]):string[] {
  // Cache/style examples, negative instructions and quoted speech are not
  // independent evidence for a character's recurring physical activity.
  const authored=stripVoiceSampleBlock(persona).split(/\r?\n/u).filter(line=>!SAMPLE_LINE.test(line)).join('\n');
  return [authored,...records].flatMap(text=>text.replace(/[“「『"][^”」』"]*[”」』"]/gu,'')
    .split(/[。！？!?，,；;\n]/u).map(clause=>clause.trim())
    .filter(clause=>clause&&!/(?:不要|不能|不准|禁止|不必|没有|从不|不会|不曾|未曾|不经常|不喜欢)/u.test(clause)
      &&!/^(?:用户|TA|他|她|朋友|同事)/u.test(clause)));
}

export function findSelfReportRisk(content:string,persona='',independentCharacterRecords:string[]=[]):SelfReportRisk|undefined {
  const sources=evidenceClauses(persona,independentCharacterRecords);
  // Quoted reports, questions and hypothetical jokes are not declarations.
  const text=content.replace(/[“「『"][^”」』"]*[”」』"]/gu,'');
  for(const match of text.matchAll(HABIT)) {
    const sentenceStart=Math.max(...['。','！','？','!','?','\n'].map(mark=>text.lastIndexOf(mark,match.index!)))+1;
    const prefix=text.slice(sentenceStart,match.index!);
    const end=match.index!+match[0].length;
    const following=text.slice(end).match(/^[?？]/u);
    if(following||HYPOTHETICAL.test(prefix))continue;
    const action=match[1].trim();
    // A comparison to an activity is not a claim that it is regularly done.
    if(/(?:喜欢|偏爱|更喜欢|讨厌|不喜欢)/u.test(action))continue;
    const anchor=action.slice(0,Math.min(4,action.length)).replace(/\s/gu,'');
    if(anchor.length<4)continue; // An underspecified "我经常吃" needs semantic context.
    if(sources.some(source=>FREQUENCY.test(source)&&source.replace(/\s/gu,'').includes(anchor)))continue;
    return {quote:match[0].replace(/^[。！？!?，,；;\n\s-]+/u,'').trim(),action};
  }
  return undefined;
}
