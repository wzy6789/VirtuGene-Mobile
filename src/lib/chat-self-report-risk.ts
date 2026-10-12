import { SAMPLE_LINE, stripVoiceSampleBlock } from './character-voice-source';

/** A narrow source-risk check, not a semantic truth verdict. It only recognizes
 * first-person recurring concrete actions and explicit completed episodes in
 * the same bounded action domain, plus explicit first-person childhood
 * reminiscences, dated location episodes and explicitly dated thoughts of another person. No missing biography is interpreted
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
// Explicit past time plus a first-person location claims a dated episode,
// independently of the character, place name or action verb. Present wishes
// and undated reasoning are not covered by this deliberately bounded rule.
const PAST_TIME='(?:昨天|昨晚|前[一二三四五六七八九十两\\d]+天|前些天|上周|上星期|上个月)';
const DATED_LOCATION=new RegExp(`(?:^|[。！？!?，,；;\\n]|-{3,})\\s*((?:我(?:也|还)?${PAST_TIME}|${PAST_TIME}我(?:也|还)?)(?:在(?!想|考虑|思考|讨论|琢磨)|从|到)[^。！？!?，,；;\\n]{2,100})`,'gu');
// Present affection is free expression. Dating it before the exchange asserts
// an episode; the user's own thoughts cannot establish the character's thoughts.
// Keep this narrow: newly thinking of an idea or a solution is not autobiography.
const PAST_PERSON_THOUGHT=/(?:^|[。！？!?，,；;\n]|-{3,})\s*((?:(?:刚才|方才|昨晚|昨天|今早|早上|上午|下午|今天早上)我(?:也|就|还|已经)?|我(?:也)?(?:刚才|方才|昨晚|昨天|今早|早上|上午|下午|今天早上)(?:也|就|还|已经)?)(?:想起|想到|想过|惦记过|挂念过|想)(?:你们|你|舞麟|小凡)(?:了|过)?)(?=$|[。！？!?，,；;\n\s]|-{3,})/gu;
// An omitted first-person subject still asserts a dated completed thought.
// Require the completed wording; today's present "想你" stays free expression.
const DATED_COMPLETED_THOUGHT=/(?:^|[。！？!?，,；;\n]|-{3,})\s*((?:我)?(?:今天|今日|刚才|方才|昨晚|昨天)(?:我)?(?:也|就|还|已经)?(?:想起|想到)(?:你们|你|舞麟|小凡)(?:了|过))(?=$|[。！？!?，,；;\n\s]|-{3,})/gu;
// A multi-day mental lead dates a process before this exchange. It is not
// needed to express a current idea, wish or affection. Keep the whole sentence
// source across commas; quoted/reported/conditional speech is not an assertion.
const RECENT_IDEA=/^我(?:最近|近来|这阵子|这段时间|这(?:几|两)天)(?:也|还)?(?:一直|总是?|经常|老是)?(?:在想|在琢磨|在考虑|想着|琢磨着|考虑着)[^。！？!?\n]{0,160}$/u;

function directRecentIdeas(text:string):string[] {
  const plain=text.replace(/[“「『"][^”」』"]*[”」』"]/gu,'');
  return [...plain.matchAll(/([^。！？!?\n]+)([。！？!?\n]|$)/gu)].flatMap(sentence=>{
    const body=sentence[1].trim();
    if(/[?？]/u.test(sentence[2])||/^(?:朋友|同事|他|她|如果|假如|假设|要是|比如|例如|翻译|解释|改写|(?:帮我|替我|给我)(?:写|编))/u.test(body)
      ||/^我.{0,8}(?:听说|听到|听见|听|看到|看见|转述|引用).{0,12}(?:问|说)/u.test(body)
      ||/(?:原文|台词|例子|内容|说法)是/u.test(body))return [];
    return body.split(/[，,：:；;]/u).map(part=>part.trim()).filter(part=>RECENT_IDEA.test(part));
  });
}

function recentIdeaEvidence(persona:string,records:string[]):string[] {
  const authored=stripVoiceSampleBlock(persona).split(/\r?\n/u).filter(line=>!SAMPLE_LINE.test(line));
  return [...authored,...records].flatMap(text=>directRecentIdeas(text.trim().replace(/^(?:独立心理记录|独立经历|角色经历|角色记录)[：:]\s*/u,'')));
}

function recentIdeaRisk(content:string,sources:string[]):SelfReportRisk|undefined {
  for(const lead of directRecentIdeas(content)) {
    // A separable mental lead before a forward conditional is already removed
    // by the existing local excerpt path. Do not spend a quality retry merely
    // because the same lead follows a conversational connective.
    const at=content.indexOf(lead);
    if(at>=0&&/^[，,：:]\s*(?:要是|如果|假如|假设|等(?:哪天|有空|闲下来|以后|下次))/u.test(content.slice(at+lead.length)))continue;
    if(sources.some(source=>source.replace(/\s/gu,'').startsWith(lead.replace(/\s/gu,''))))continue;
    return {quote:lead,action:lead,kind:'episode'};
  }
  return undefined;
}
// A dated recollection of listening to the other person's performance asserts
// an event, unlike wanting to hear it now or discussing a reported achievement.
const PAST_PERFORMANCE=/(?:^|[。！？!?，,；;\n]|-{3,})\s*((?:我(?:先前|此前|之前|上次|昨天|昨晚)|(?:先前|此前|之前|上次|昨天|昨晚)(?:我)?)(?:也|曾|还)?听(?:过|见|到)?你[^。！？!?，,；;\n]{0,12}(?:弹(?:琴|曲子)?|唱(?:歌)?|演奏)[^。！？!?，,；;\n]{0,60})/gu;
// Dating a judgment of the addressee asserts an earlier observation, not
// merely an opinion now. Do not infer that history from current familiarity.
const PAST_USER_JUDGMENT=/(?:^|[。！？!?，,；;\n]|-{3,})\s*((?:我(?:自己|也)?)?(?:当初|以前|那时|那时候)(?:我)?(?:就|也|还|一直|已经)?(?:觉得|以为|发现|注意到)你[^。！？!?，,；;\n]{1,100})/gu;
const VISIT_EPISODE=/(?:^|[。！？!?，,；;\n]|-{3,})\s*((?:我(?:自己|也|还)?)(?:曾经|以前)?去过[^。！？!?，,；;\n]{1,100})/gu;
const POSTURE_HABIT=/(?:^|[。！？!?，,；;\n]|-{3,})\s*(?:其实|说实话)?我(?:自己|也)?习惯(?:于)?([^。！？!?，,；;\n]{2,100})/gu;
const HYPOTHETICAL=/^(?:如果|假如|假设|比如|例如|要是)|(?:的话|假设|假如|如果|要是)/u;
const FREQUENCY=/(?:一般|经常|通常|平时|每次|总是|每天|每日|每晚|天天|习惯|常常|日常)/u;

/** Keep a forward hypothetical thought intact while omitting only an
 * unsupported retrospective mental lead. No replacement emotion or idea is
 * synthesized. Concrete events after the lead remain subject to other checks. */
function omitHypotheticalThoughtHistoryLead(sentence:string,persona:string,records:string[]):string {
  const lead=sentence.match(/^(\s*(?:(?:正好|其实|说起来)[，,]\s*)?)(我(?:最近|近来|这阵子|这段时间|这(?:几|两)天|前阵子)(?:总是?|一直|经常|老是)(?:在想|想着|在琢磨|琢磨着|在考虑|考虑着)[，,：:]\s*)((?:要是|如果|假如|假设|等(?:哪天|有空|闲下来|以后|下次))[\s\S]+)/u);
  if(!lead){
    const idea=sentence.match(/^(我(?:最近|近来|这阵子|这段时间|这(?:几|两)天)(?:也|还)?(?:一直|总是?|经常|老是)?(?:在想|在琢磨|在考虑|想着|琢磨着|考虑着)[，,：:]\s*)((?:要不要|要是|如果|假如|假设|等(?:哪天|有空|闲下来|以后|下次))[\s\S]+)/u);
    if(idea&&!recentIdeaEvidence(persona,records).some(source=>source.replace(/\s/gu,'').startsWith(idea[1].trim().replace(/[，,：:]\s*$/u,'').replace(/\s/gu,''))))return idea[2];
    return sentence;
  }
  const independent=[stripVoiceSampleBlock(persona).split(/\r?\n/u).filter(line=>!SAMPLE_LINE.test(line)),...records.map(record=>record.split(/\r?\n/u))].flat()
    .map(line=>line.trim().replace(/^[^：:\n]{1,20}[：:]\s*/u,''));
  const claim=sentence.trim().replace(/[。！？!?；;\n]+$/u,'').replace(/^(?:正好|其实|说起来)[，,]\s*/u,'');
  // Only a direct independent assertion supports the past mental episode;
  // a conditional, reported quotation or instruction containing it does not.
  if(independent.some(source=>source.replace(/\s/gu,'').startsWith(claim.replace(/\s/gu,''))))return sentence;
  return lead[1]+lead[3];
}
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

function findPostureHabitRisk(content:string,sources:string[]):SelfReportRisk|undefined {
  const text=content.replace(/[“「『"][^”」』"]*[”」』"]/gu,'');
  for(const match of text.matchAll(POSTURE_HABIT)) {
    const start=Math.max(...['。','！','？','!','?','\n'].map(mark=>text.lastIndexOf(mark,match.index!)))+1;
    const prefix=text.slice(start,match.index!);
    const action=match[1].trim();
    // Concrete posture methods only; stylistic habits and siding with someone
    // are not physical routines. Other habits still need semantic evaluation.
    if(!/(?:坐(?:着|下|到|进|在)|站(?:着|起|到|在))/u.test(action)
      ||/站在.{0,12}(?:这边|那边|立场|角度)/u.test(action)
      ||HYPOTHETICAL.test(prefix)||HYPOTHETICAL.test(action)||/(?:这个词|这句话|这个说法|什么意思|翻译)/u.test(action)||/(?:朋友说|他说|她说|举例|例如|比如)/u.test(prefix)
      ||/^(?:的话|吗|么|[?？])/u.test(text.slice(match.index!+match[0].length)))continue;
    if(sources.some(source=>FREQUENCY.test(source)&&source.replace(/\s/gu,'').includes(action.replace(/\s/gu,''))))continue;
    return {quote:match[0].replace(/^[。！？!?，,；;\n\s-]+/u,'').trim(),action,kind:'habit'};
  }
  return undefined;
}

/** A past-time clause can govern the following first-person observation.
 * A familiar activity does not establish what the speaker physically watched,
 * counted or heard beside it. Require that time scope and concrete position;
 * ordinary present opinions and wishes are outside this check. */
function pastLocatedObservationRisk(content:string,sources:string[]):SelfReportRisk|undefined {
  const plain=content.replace(/[“「『"][^”」』"]*[”」』"]/gu,'');
  for(const sentence of plain.matchAll(/([^。！？!?\n]+)([。！？!?\n]|$)/gu)) {
    const text=sentence[1].trim();
    if(!/^(?:以前|那时(?:候)?|当时|从前|过去)/u.test(text)||/[?？]/u.test(sentence[2])
      ||HYPOTHETICAL.test(text))continue;
    for(const part of text.split(/[，,；;]/u).map(clause=>clause.trim())) {
      if(!/^我(?:也|还|就)?(?:在|跟在)[^。！？!?，,；;\n]{1,18}?(?:替你|给你|帮你)?(?:看(?:着|过|了)?|盯着|数(?:着|过|了)?|听(?:着|过|了)?)[^。！？!?，,；;\n]{1,65}$/u.test(part))continue;
      if(sources.some(source=>source.trim().replace(/^(?:独立经历|角色经历|经历)[：:]\s*/u,'').replace(/\s/gu,'').startsWith(text.replace(/\s/gu,''))))continue;
      return {quote:part,action:part,kind:'episode'};
    }
  }
  return undefined;
}

function findEpisodeRisk(content:string,sources:string[],ideaSources:string[]=sources,observationSources:string[]=sources):SelfReportRisk|undefined {
  const observation=pastLocatedObservationRisk(content,observationSources);
  if(observation)return observation;
  const recent=recentIdeaRisk(content,ideaSources);
  if(recent)return recent;
  const text=content.replace(/[“「『"][^”」』"]*[”」』"]/gu,'');
  for(const match of text.matchAll(PAST_PERFORMANCE)){
    const start=Math.max(...['。','！','？','!','?','\n'].map(mark=>text.lastIndexOf(mark,match.index!)))+1;
    const prefix=text.slice(start,match.index!);
    const quote=match[1].trim();
    if(HYPOTHETICAL.test(prefix)||/^(?:如果|假如|假设|比如|例如|要是)|(?:的话|吗|么)|(?:没|没有|不曾|未曾).{0,6}听|听(?:过|见|到)?你(?:说|讲|谈|聊|提)/u.test(quote)||/^[?？]/u.test(text.slice(match.index!+match[0].length))||/(?:朋友说|他说|她说|举例|例如|比如)/u.test(prefix))continue;
    if(sources.some(source=>source.replace(/\s/gu,'').includes(quote.replace(/\s/gu,''))))continue;
    return {quote,action:quote,kind:'episode'};
  }
  for(const match of [PAST_PERSON_THOUGHT,DATED_COMPLETED_THOUGHT,PAST_USER_JUDGMENT,VISIT_EPISODE,DATED_LOCATION].flatMap(pattern=>[...text.matchAll(pattern)])) {
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

/** Excerpt an unpublished draft: remove whole unsupported episode sentences,
 * or a separable retrospective thought lead before a forward hypothetical.
 * Includes explicit concrete posture methods. Keep independent reactions,
 * preferences and sourced events. No canned reply or synthesized emotion.
 * Caller owns the fictional-mode exemption and existing retry budget. */
export function omitUnsupportedSelfReportEpisodes(content:string,persona='',records:string[]=[]):string {
  const sources=evidenceClauses(persona,records);
  let removed=false;
  const safe=content.split(/\s*-{3,}\s*/u).map(bubble=>{
    let afterUnsupportedVisit=false;
    return bubble.split(/(?<=[。！？!?；;\n])/u).map(sentence=>{
      const excerpt=omitHypotheticalThoughtHistoryLead(sentence,persona,records);
      if(excerpt!==sentence)removed=true;
      return excerpt;
    }).filter(sentence=>{
      // Details following an unsupported visit or dated location in this
      // same bubble belong to that anecdote; dropping only its opening would
      // launder the dependent observation or promised trip.
      if(afterUnsupportedVisit){removed=true;return false;}
      const risk=findEpisodeRisk(sentence,sources,recentIdeaEvidence(persona,records),mannerHabitSources(persona,records))??findPostureHabitRisk(sentence,sources);
      if(risk){
        removed=true;
        const plain=sentence.replace(/[“「『"][^”」』"]*[”」』"]/gu,'');
        afterUnsupportedVisit=[VISIT_EPISODE,DATED_LOCATION].flatMap(pattern=>[...plain.matchAll(pattern)]).some(match=>match[1].trim()===risk.quote);
      }
      return !risk;
    }).join('').trim();
  })
    .filter(Boolean).join('\n---\n');
  return removed?safe:content;
}

export function findSelfReportRisk(content:string,persona='',independentCharacterRecords:string[]=[]):SelfReportRisk|undefined {
  const sources=evidenceClauses(persona,independentCharacterRecords);
  const posture=findPostureHabitRisk(content,sources);
  if(posture)return posture;
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
  return findEpisodeRisk(content,sources,recentIdeaEvidence(persona,independentCharacterRecords),mannerHabitSources(persona,independentCharacterRecords));
}
