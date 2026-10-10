import { SAMPLE_LINE, stripVoiceSampleBlock } from './character-voice';

/** A narrow source-risk check, not a semantic truth verdict. It only recognizes
 * first-person recurring concrete actions and explicit completed episodes in
 * the same bounded action domain, plus explicit first-person childhood
 * reminiscences and explicitly dated thoughts of another person. No missing biography is interpreted
 * as proof that an event never happened, and ordinary preferences stay allowed.
 */
export interface SelfReportRisk { quote:string; action:string; kind?:'habit'|'episode' }

const ACTION='(?:盯着(?:锁屏|手机|屏幕)|停留在(?:解锁|锁屏)(?:界面)?|解锁手机|喝(?:咖啡|茶|水|酒)|吃(?:苹果片|瓜子|饭|早餐|早饭|晚饭|午饭)|读书|看书|翻书|看电影)';
const HABIT=new RegExp(`(?:^|[。！？!?，,；;\\n]|-{3,})\\s*(?:其实|说实话)?我(?:自己|也)?(?:一般|经常|通常|平时|每次|总是)(?:也|都|是|会|都会|先|就|还|要|去|在)?\\s*(${ACTION}[^。！？!?，,；;\\n]{0,100})`,'gu');
// Reuse the physical-action domain rather than expanding a list of anecdotes.
// A completed event needs its detail supported, not merely the same activity.
const EPISODE=new RegExp(`(?:^|[。！？!?，,；;\\n]|-{3,})\\s*(?:其实|说实话)?我(?:自己|也)?(?:以前|曾经|曾|有一次|有次|之前)?\\s*(${ACTION}[^。！？!?，,；;\\n]{0,60}过(?!瘾|度|头|于|来|去|关|敏|目|多|少)[^。！？!?，,；;\\n]{0,60})`,'gu');
// A user's childhood is not the character's. These explicit autobiographical
// openings need independent support even without a completed-action “过”.
const CHILDHOOD=/(?:^|[。！？!?，,；;\n]|-{3,})\s*(?:其实|说实话)?我(?:自己|也)?(?:还?记得)?((?:小时候|小的时候|童年时|年幼时)[^。！？!?，,；;\n]{1,100})/gu;
// Present affection is free expression. Dating it before the exchange asserts
// an episode; the user's own thoughts cannot establish the character's thoughts.
// Keep this narrow: newly thinking of an idea or a solution is not autobiography.
const PAST_PERSON_THOUGHT=/(?:^|[。！？!?，,；;\n]|-{3,})\s*((?:(?:刚才|方才|昨晚|昨天|今早|早上|上午|下午|今天早上)我(?:也|就|还|已经)?|我(?:也)?(?:刚才|方才|昨晚|昨天|今早|早上|上午|下午|今天早上)(?:也|就|还|已经)?)(?:想起|想到|想过|惦记过|挂念过|想)(?:你们|你|舞麟|小凡)(?:了|过)?)(?=$|[。！？!?，,；;\n\s]|-{3,})/gu;
// An omitted first-person subject still asserts a dated completed thought.
// Require the completed wording; today's present "想你" stays free expression.
const DATED_COMPLETED_THOUGHT=/(?:^|[。！？!?，,；;\n]|-{3,})\s*((?:我)?(?:今天|今日|刚才|方才|昨晚|昨天)(?:我)?(?:也|就|还|已经)?(?:想起|想到)(?:你们|你|舞麟|小凡)(?:了|过))(?=$|[。！？!?，,；;\n\s]|-{3,})/gu;
// A dated recollection of listening to the other person's performance asserts
// an event, unlike wanting to hear it now or discussing a reported achievement.
const PAST_PERFORMANCE=/(?:^|[。！？!?，,；;\n]|-{3,})\s*((?:我(?:先前|此前|之前|上次|昨天|昨晚)|(?:先前|此前|之前|上次|昨天|昨晚)(?:我)?)(?:也|曾|还)?听(?:过|见|到)?你[^。！？!?，,；;\n]{0,12}(?:弹(?:琴|曲子)?|唱(?:歌)?|演奏)[^。！？!?，,；;\n]{0,60})/gu;
const HYPOTHETICAL=/^(?:如果|假如|假设|比如|例如|要是)|(?:的话|假设|假如|如果|要是)/u;
const FREQUENCY=/(?:一般|经常|通常|平时|每次|总是|每天|每日|每晚|天天|习惯|常常|日常)/u;
// Frequency can follow the activity as well as precede it. "我看书也有这
// 习惯，先…再…" asserts an actual recurring method, not a present preference.
const MANNER_HABIT=new RegExp(`(?:^|[。！？!?，,；;\\n]|-{3,})\\s*(?:其实|说实话)?我(?:自己|也)?\\s*(${ACTION}(?:时|的时候)?(?:也|一直|向来)?(?:有(?:这(?:个|样的)?|那(?:个|样的)?)?习惯|是(?:这(?:个|样的)?|那(?:个|样的)?)?习惯)[^。！？!?；;\\n]{0,120})`,'gu');

function mannerHabitSources(persona:string,records:string[]):string[]{
  const authored=stripVoiceSampleBlock(persona).split(/\r?\n/u).filter(line=>!SAMPLE_LINE.test(line)).join('\n');
  // Preserve comma-separated methods together. Knowing an activity alone
  // does not establish its newly claimed order or other specific details.
  return [authored,...records].flatMap(text=>text.replace(/[“「『"][^”」』"]*[”」』"]/gu,'')
    .split(/[。！？!?；;\n]/u).map(sentence=>sentence.trim())
    .filter(sentence=>sentence&&!/(?:不要|不能|不准|禁止|不必|没有|从不|不会|不曾|未曾|不经常|不喜欢)/u.test(sentence)
      &&!/^(?:用户|TA|他|她|朋友|同事)/u.test(sentence)));
}

function evidenceClauses(persona:string,records:string[]):string[] {
  // Cache/style examples, negative instructions and quoted speech are not
  // independent evidence for a character's recurring physical activity.
  const authored=stripVoiceSampleBlock(persona).split(/\r?\n/u).filter(line=>!SAMPLE_LINE.test(line)).join('\n');
  return [authored,...records].flatMap(text=>text.replace(/[“「『"][^”」』"]*[”」』"]/gu,'')
    .split(/[。！？!?，,；;\n]/u).map(clause=>clause.trim())
    .filter(clause=>clause&&!/(?:不要|不能|不准|禁止|不必|没有|从不|不会|不曾|未曾|不经常|不喜欢)/u.test(clause)
      &&!/^(?:用户|TA|他|她|朋友|同事)/u.test(clause)));
}

function findEpisodeRisk(content:string,sources:string[]):SelfReportRisk|undefined {
  const text=content.replace(/[“「『"][^”」』"]*[”」』"]/gu,'');
  for(const match of text.matchAll(PAST_PERFORMANCE)){
    const start=Math.max(...['。','！','？','!','?','\n'].map(mark=>text.lastIndexOf(mark,match.index!)))+1;
    const prefix=text.slice(start,match.index!);
    const quote=match[1].trim();
    if(HYPOTHETICAL.test(prefix)||/^(?:如果|假如|假设|比如|例如|要是)|(?:的话|吗|么)|(?:没|没有|不曾|未曾).{0,6}听|听(?:过|见|到)?你(?:说|讲|谈|聊|提)/u.test(quote)||/^[?？]/u.test(text.slice(match.index!+match[0].length))||/(?:朋友说|他说|她说|举例|例如|比如)/u.test(prefix))continue;
    if(sources.some(source=>source.replace(/\s/gu,'').includes(quote.replace(/\s/gu,''))))continue;
    return {quote,action:quote,kind:'episode'};
  }
  for(const match of [PAST_PERSON_THOUGHT,DATED_COMPLETED_THOUGHT].flatMap(pattern=>[...text.matchAll(pattern)])) {
    const start=Math.max(...['。','！','？','!','?','\n'].map(mark=>text.lastIndexOf(mark,match.index!)))+1;
    const prefix=text.slice(start,match.index!);
    const following=text.slice(match.index!+match[0].length);
    if(HYPOTHETICAL.test(prefix)||/(?:他说|她说|朋友说|举例|例如|比如|这句话|这个说法)/u.test(prefix)||/^[?？]/u.test(following))continue;
    const quote=match[1].trim();
    // Require the time and subject too, not just a preference or undated thought.
    if(sources.some(source=>source.replace(/\s/gu,'').includes(quote.replace(/\s/gu,''))))continue;
    return {quote,action:quote,kind:'episode'};
  }
  for(const match of text.matchAll(CHILDHOOD)) {
    const sentenceStart=Math.max(...['。','！','？','!','?','\n'].map(mark=>text.lastIndexOf(mark,match.index!)))+1;
    const prefix=text.slice(sentenceStart,match.index!);
    const action=match[1].trim();
    if(HYPOTHETICAL.test(prefix)||/^[?？]/u.test(text.slice(match.index!+match[0].length))
      ||/(?:没|没有|不曾|未曾|从未|从没|不记得|记不清|不清楚|不知道|这个词|这句话|这个说法|这几个字|怎么说|什么意思|吗|么)/u.test(action))continue;
    if(sources.some(source=>source.replace(/\s/gu,'').includes(action.replace(/\s/gu,''))))continue;
    return {quote:match[0].replace(/^[。！？!?，,；;\n\s-]+/u,'').trim(),action,kind:'episode'};
  }
  for(const match of text.matchAll(EPISODE)) {
    const sentenceStart=Math.max(...['。','！','？','!','?','\n'].map(mark=>text.lastIndexOf(mark,match.index!)))+1;
    const prefix=text.slice(sentenceStart,match.index!);
    const action=match[1].trim();
    if(HYPOTHETICAL.test(prefix)||/^[?？]/u.test(text.slice(match.index!+match[0].length))
      ||/(?:没|没有|从不|不会|不曾|未曾|从未|从没|喜欢|偏爱|讨厌|想|认为|觉得|考虑|说过|讲过|聊过)/u.test(action))continue;
    // This is intentionally literal. A record of reading does not validate an
    // invented reversed page; paraphrase support requires semantic review.
    if(sources.some(source=>source.replace(/\s/gu,'').includes(action.replace(/\s/gu,''))))continue;
    return {quote:match[0].replace(/^[。！？!?，,；;\n\s-]+/u,'').trim(),action,kind:'episode'};
  }
  return undefined;
}

/** Only remove whole unsupported episode sentences from an unpublished draft.
 * Keep independent reactions, preferences and sourced events. No canned reply.
 * Caller owns the fictional-mode exemption and existing retry budget. */
export function omitUnsupportedSelfReportEpisodes(content:string,persona='',records:string[]=[]):string {
  const sources=evidenceClauses(persona,records);
  let removed=false;
  const safe=content.split(/\s*-{3,}\s*/u).map(bubble=>bubble
    .split(/(?<=[。！？!?；;\n])/u)
    .filter(sentence=>{const risk=findEpisodeRisk(sentence,sources);if(risk)removed=true;return !risk;}).join('').trim())
    .filter(Boolean).join('\n---\n');
  return removed?safe:content;
}

export function findSelfReportRisk(content:string,persona='',independentCharacterRecords:string[]=[]):SelfReportRisk|undefined {
  const sources=evidenceClauses(persona,independentCharacterRecords);
  // Quoted reports, questions and hypothetical jokes are not declarations.
  const text=content.replace(/[“「『"][^”」』"]*[”」』"]/gu,'');
  for(const match of text.matchAll(MANNER_HABIT)){
    const sentenceStart=Math.max(...['。','！','？','!','?','\n'].map(mark=>text.lastIndexOf(mark,match.index!)))+1;
    if(HYPOTHETICAL.test(text.slice(sentenceStart,match.index!))||/[?？]/u.test(text.slice(match.index!+match[0].length,match.index!+match[0].length+1)))continue;
    const action=match[1].trim();
    const supported=mannerHabitSources(persona,independentCharacterRecords).some(source=>source.replace(/\s/gu,'').includes(action.replace(/\s/gu,'')));
    if(!supported)return {quote:match[0].replace(/^[。！？!?，,；;\n\s-]+/u,'').trim(),action,kind:'habit'};
  }
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
    return {quote:match[0].replace(/^[。！？!?，,；;\n\s-]+/u,'').trim(),action,kind:'habit'};
  }
  return findEpisodeRisk(content,sources);
}
