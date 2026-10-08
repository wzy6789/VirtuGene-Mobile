import type { Character } from '../db/index';
import { detectTopicMove, isTopicRelated } from './chat-conversation-state';
import { assessExpressionSignals, expressionDirection, recentRhythmDirection, type ExpressionSignals } from './chat-expression-guidance';
import { SAMPLE_LINE, validVoiceSamples, VOICE_SAMPLE_MARKER } from './character-voice';
import { directChatGuidance, isDirectAffection, isViewExchange } from './chat-expression-boundary';
import { authoredReactionLines, emotionalExpressionGuidance, selectVoiceExamples, interactionMoment } from './chat-emotional-expression';
import { hasExplicitTopicShift, isStandaloneClosing, isPersonalExperienceQuestion,requestsRepetition } from './chat-turn-cues';
import {authoredVoiceFields,JUDGMENT_FIELDS,ADDRESS_FIELDS} from './character-voice-fields';
import type {PromptSection} from './chat-context-compiler';

/**
 * 只在本地判断这一轮对话的气质，不调用模型，也不写入数据库。
 * 它的作用是把“像真人聊天”变成每一轮都能执行的短指令，避免所有对话
 * 都套同一套热情、解释和追问。
 */
export type HumanTurnMode = 'casual' | 'emotional' | 'question' | 'request' | 'topic-shift';

/** 本地决定这一轮的交流动作；它只是给模型一个方向，不会触发额外请求。 */
export type ConversationAction =
  | 'follow-topic'
  | 'stay-present'
  | 'answer-directly'
  | 'finish-request'
  | 'share-life'
  | 'fresh-angle'
  | 'short-close'
  | 'react';

export interface HumanTurnSignals {
  mode: HumanTurnMode;
  topicShift: boolean;
  userTextLength: number;
  previousUserText?: string;
  expression: ExpressionSignals;
}

export interface HumanConversationOptions {
  /** Effective preference after this turn's topic changes and explicit corrections. */
  adviceStyle?: 'listen' | 'mixed' | 'direct';
  /** 从本地记忆、世界事件和角色兴趣整理出的主动话题候选。 */
  proactiveTopics?: string[];
  /** 角色自己的近期生活线，只允许使用已经存在的本地记录。 */
  lifeHints?: string[];
  /** Persistent conversation turn, so proactive cadence does not reset with the 18-message history window. */
  turnNumber?: number;
  /** Bounded persisted turns, not individual bubbles counted as turns. */
  recentReplyTurns?: string[][];
}

type HumanCharacter = Pick<
  Character,
  'name' | 'tags' | 'proactivity' | 'signature' | 'greeting' | 'catchphrase' | 'boundaries' | 'systemPrompt' | 'voiceSamples'
> & { reviewedVoiceLines?: string[] };

const QUESTION_MARKERS = /[?？]|^(为什么|怎么|怎样|什么|哪儿|哪里|谁|几时|多久|能不能|可以吗|是不是|有没有|要不要)/u;

function compact(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

const GENERIC_PERSONA_TAGS = new Set([
  '温柔', '体贴', '善良', '可爱', '漂亮', '帅气', '聪明', '高冷', '活泼', '开朗',
  '外向', '内向', '理性', '感性', '成熟', '稳重', '冷静', '神秘', '安静', '治愈',
  '浪漫', '幽默', '搞笑', '傲娇', '毒舌', '热情', '主动', '慢热', '敏感', '元气',
]);

/**
 * 把本地已有的生活线索整理成可供角色主动提起的候选。
 * 先放具体事件，再放角色兴趣；性格标签只作为最后的语气参考，避免出现
 * “我们聊聊温柔吧”这种不像真人的主动开场。整个过程只读本地数据。
 */
export function buildProactiveTopicSeeds(input: {
  tags?: string[];
  signature?: string;
  lifeHints?: string[];
  memories?: string[];
  worldEvents?: string[];
}): string[] {
  const clean = (value: string): string => compact(value)
    .replace(/^[-*•\d.、]+\s*/u, '')
    .replace(/[\r\n]+/g, ' ')
    .slice(0, 64);
  const values = [
    ...(input.lifeHints ?? []),
    ...(input.worldEvents ?? []),
    ...(input.memories ?? []),
    ...(input.tags ?? []).filter((tag) => !GENERIC_PERSONA_TAGS.has(clean(tag))),
    ...(input.signature ? [input.signature] : []),
  ];
  const seen = new Set<string>();
  return values
    .map(clean)
    .filter((value) => value.length >= 3 && value.length <= 64)
    .filter((value) => {
      const key = value.toLocaleLowerCase().replace(/[\s，。！？、,.!?;；:：]/g, '');
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 10);
}

function hasTopicShiftMarker(text: string): boolean {
  return hasExplicitTopicShift(text);
}

function repeatedMotifs(messages: string[], catchphrase = ''): string[] {
  const counts = new Map<string, number>();
  for (const message of messages) {
    const seen = new Set(message.split(/[。！？!?，,；;\n]|-{3,}/u).map(s => s.trim()).filter(s => s.length >= 12 && s !== catchphrase.trim()));
    for (const phrase of seen) counts.set(phrase, (counts.get(phrase) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([phrase]) => phrase);
}

function isClosing(text: string): boolean {
  return isStandaloneClosing(text);
}

/** Stable probability, with a one-turn gap; reopening must not reroll this turn. */
function mayShareLife(name: string, turn: number, proactivity: number): boolean {
  if (turn < 2 || !Number.isFinite(turn)) return false;
  const threshold = Math.max(0, Math.min(1, proactivity)) * 0.45;
  const draw = (n: number) => {
    let hash = 2166136261;
    for (const char of `${name}:${n}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    hash = Math.imul(hash ^ hash >>> 16, 0x85ebca6b);
    hash = Math.imul(hash ^ hash >>> 13, 0xc2b2ae35);
    return ((hash ^ hash >>> 16) >>> 0) / 4294967296;
  };
  return draw(turn) < threshold && draw(turn - 1) >= threshold;
}

/**
 * 选择一轮对话的动作。所有判断都在本地完成，避免为了“像真人”再增加一次模型调用。
 */
export function chooseConversationAction(
  userText: string,
  history: Array<{ role: string; content: string }>,
  character?: HumanCharacter | null,
  options: HumanConversationOptions = {},
): ConversationAction {
  const recentUserMessages = history.filter((item) => item.role === 'user').map((item) => item.content).slice(-5);
  const recentAssistantMessages = history.filter((item) => item.role === 'assistant').map((item) => item.content).slice(-6);
  const signals = detectHumanTurn(userText, recentUserMessages);
  if (signals.mode === 'topic-shift') return 'follow-topic';
  if (isClosing(userText)) return 'short-close';
  if (signals.mode === 'emotional') return 'stay-present';
  if (signals.mode === 'question') return 'answer-directly';
  if (signals.mode === 'request') return 'finish-request';
  if (options.adviceStyle === 'listen') return 'stay-present';

  // A user repeating a subject is a request to stay with it. Only the
  // character's own repetition should trigger a fresh angle.
  const repeated = repeatedMotifs(recentAssistantMessages, character?.catchphrase);
  const normalizedUserText = compact(userText);
  const hasFreshTopic = repeated.some((topic) => !isTopicRelated(normalizedUserText, topic));
  const userTurnCount = options.turnNumber ?? recentUserMessages.length + 1;
  const proactive = character?.proactivity ?? 0.5;
  const hasLifeLine = (options.lifeHints ?? []).some((hint) => compact(hint).length >= 3);
  if (hasFreshTopic) return 'fresh-angle';
  if (hasLifeLine && mayShareLife(character?.name ?? '', userTurnCount, proactive)) return 'share-life';
  if (recentAssistantMessages.length > 0 && /[？?]\s*$/u.test(recentAssistantMessages[recentAssistantMessages.length - 1])) {
    return 'react';
  }
  return 'react';
}

function characterVoiceLines(character?: HumanCharacter | null, userText?:string): string[] {
  if (!character) return [];
  const lines: string[] = [];
  const tags = character.tags.map((tag) => tag.trim()).filter(Boolean).slice(0, 5);
  const signature = character.signature?.trim();
  const greeting = character.greeting?.trim();
  const catchphrase = character.catchphrase?.trim();
  const boundaries = character.boundaries?.trim();
  const persona = character.systemPrompt?.slice(0, 2_400) ?? '';
  const cache=validVoiceSamples(character);
  const authoredJudgments=authoredVoiceFields(character.systemPrompt??'',JUDGMENT_FIELDS);
  const hasConcreteJudgment=authoredJudgments.length>0||!!cache;

  lines.push(`你此刻就是「${character.name}」，不要站到角色外解释自己。`);
  // A complete authored voice already has its personality in the base persona.
  // Repeating marketing labels, a motto and an opening at the tail encourages
  // the character to perform those labels on unrelated turns.
  if (!hasConcreteJudgment&&tags.length) lines.push(`人格底色：${tags.join('、')}。把这些变成选词、判断和反应，不要逐项念出来。`);
  if (!hasConcreteJudgment&&signature) lines.push(`内在气质参考：${signature.slice(0, 120)}。只吸收态度，不要照抄。`);
  if (!hasConcreteJudgment&&greeting) lines.push(`说话节奏参考：${greeting.slice(0, 100)}。保留惯用措辞与亲疏感，不必每轮复述整段。`);
  if (catchphrase) lines.push(`稳定口癖「${catchphrase.slice(0, 80)}」：合适时可以反复自然出现，不是必须每条都说，也不因用过就强制换掉。`);
  if (boundaries) lines.push(`角色边界：${boundaries.slice(0, 140)}。遇到边界时要用这个人的方式表达不愿意，而不是突然变成规则提示。`);

  const tagText = tags.join('、').toLocaleLowerCase();
  const authoredAddresses=authoredVoiceFields(character.systemPrompt??'',ADDRESS_FIELDS);
  const reactions=authoredReactionLines(character.systemPrompt??'',userText);
  const specific = authoredJudgments.length>0 || authoredVoiceFields(character.systemPrompt??'', ['情境反应']).length>0
    || userText!==undefined&&reactions.length>0 || !!cache;
  let fallbackCount = 0;
  const has = (...words: string[]) => {
    if (specific || fallbackCount >= 2 || !words.some(word => tagText.includes(word))) return false;
    fallbackCount++;
    return true;
  };
  if (has('冷淡', '高冷', '寡言', '沉默', '疏离', '理性')) {
    lines.push('语言指纹与判断：句子偏短，先分清事实与猜测，注意用户被什么具体事情卡住；关心落在一个准确判断里，少感叹号，不突然变成温柔客服。');
  }
  if (has('活泼', '开朗', '外向', '乐观', '元气')) {
    lines.push('语言指纹与判断：反应快，先注意值得一起开心的突破或有趣细节；疲惫和受挫时降低音量，给用户喘气余地，不把活泼演成强迫振作。');
  }
  if (has('傲娇', '嘴硬', '别扭')) {
    lines.push('语言指纹与判断：在意时表达别扭，仍认真记住用户说的细节；明显委屈时先表明站在用户身边，不挖苦脆弱，不把嘴硬写成固定句式。');
  }
  if (has('毒舌', '尖锐', '刻薄')) {
    lines.push('语言指纹与判断：先看事情哪里荒唐或不公平，吐槽针对麻烦，不把失误等同于用户没能力；认真时收住玩笑，可以明确不同意但不羞辱用户。');
  }
  if (has('温柔', '体贴', '治愈', '耐心')) {
    lines.push('语言指纹与判断：先注意用户哪一句没被听懂、哪一处付出被忽略，回应那个具体落差；允许沉默与拒绝，不忙着解释心理，不用空泛安慰替代听见。');
  }
  if (has('成熟', '稳重', '冷静')) {
    lines.push('语言指纹与判断：先看实际约束和用户尚有的选择，分清可改变与暂时不可改变的部分；分歧给出理由但留余地，不把成熟演成教训。');
  }
  if (has('古风', '古代', '仙侠', '宫廷')) {
    lines.push('语言指纹：保持设定时代的称呼和礼数，但仍像在交流，不要写成整段古文或舞台独白。');
  }
  if (has('幽默', '搞笑', '顽皮')) {
    lines.push('语言指纹与判断：幽默来自共同注意到的反差，笑点放在麻烦和自己的反应上；用户没有接梗就自然收住，失落、隐私和失败不拿来逗笑。');
  }
  // 人设正文里常有比标签更具体的约束；只提取语言行为，不把整段设定重复塞进本轮提示。
  if (!specific && /少说|惜字如金|寡言|简短|不爱解释/u.test(persona)) {
    lines.push('额外语言指纹：倾向短句和留白，重要的话说清就停，不用解释自己的沉默。');
  }
  if (!specific && /反问|吐槽|调侃|挖苦/u.test(persona)) {
    lines.push('额外语言指纹：可以用反问或轻微吐槽表达态度，不拿反问挤掉实际回应，认真情绪出现时先收住锋芒。');
  }
  if (!specific && /温吞|慢热|犹豫|含蓄|不善表达/u.test(persona)) {
    lines.push('额外语言指纹：情绪不必一次说满，可以用语气词、标点、emoji 或半句补充表达，不写动作和心理报告。');
  }
  if (!specific && /直来直去|坦率|直接|不拐弯/u.test(persona)) {
    lines.push('额外语言指纹：少绕圈，先说清自己的判断；关心用户时也保持这个人的直接。');
  }
  if(reactions.length) lines.push(`人物情境反应（具体设定优先，仅影响表达）：${reactions.join(' / ')}`);
  const authoredExamples=(character.systemPrompt ?? '').split(/\r?\n/u).filter(line => SAMPLE_LINE.test(line));
  const examples = selectVoiceExamples([...new Set([...(character.reviewedVoiceLines ?? []), ...authoredExamples,
    ...(authoredExamples.length?[]:cache?.lines.slice(2)??[])])],userText,{allowUnrelatedNeutral:!specific});
  if(cache) {
    const metadata=cache.lines.slice(0,2).filter(line=>!(line.startsWith('称呼：')?authoredAddresses.length:authoredJudgments.length));
    if(metadata.length) lines.push(`${VOICE_SAMPLE_MARKER}\n仅补全原人设缺少的表达习惯，不代表真实经历：\n${metadata.join('\n')}\n[/角色声音样本]`);
  }
  if (examples.length) lines.push(`声音样本（只学说法，不当作真实经历）：${examples.map(line => line.slice(0, 180)).join(' / ')}`);
  const address = authoredAddresses.slice(0,2).map(row=>row.line);
  if (address.length) lines.push(`称呼习惯：${address.map(line => line.slice(0, 100)).join(' / ')}`);
  const values = authoredJudgments.slice(0,2).map(row=>row.line);
  if (values.length) lines.push(`人物判断依据（具体设定优先于通用标签）：${values.map(line => line.slice(0, 150)).join(' / ')}`);
  lines.push('称呼、立场与边界继续依据这张卡和当前人设；历史回复只用于接续内容，不能因为聊久了就改成通用助理，也不把历史措辞当作新的人设要求。');
  return lines;
}

/** Shared by private replies, proactive messages and individual group actors. */
export function buildCharacterVoiceCard(character: HumanCharacter, userText = ''): string {
  return ['[人物声音卡]',...characterVoiceLines(character,userText),'[/人物声音卡]'].join('\n');
}

export function detectHumanTurn(userText: string, recentUserMessages: string[] = []): HumanTurnSignals {
  const current = compact(userText);
  const compactedRecent = recentUserMessages.map(compact).filter(Boolean);
  const previousUserText = compactedRecent[compactedRecent.length - 1];
  const explicitShift = hasTopicShiftMarker(current);
  const inferredShift = Boolean(
    previousUserText &&
      current.length >= 12 &&
      detectTopicMove(current, previousUserText),
  );
  const topicShift = explicitShift || inferredShift;
  const expression = assessExpressionSignals(current);

  let mode: HumanTurnMode = 'casual';
  if (isViewExchange(current)) mode = 'question';
  else if (expression.request||requestsRepetition(current)) mode = 'request';
  else if (topicShift) mode = 'topic-shift';
  else if (isDirectAffection(current) || expression.emotionConfidence >= .8 || /不想说|没事吧|怎么办/u.test(current)) mode = 'emotional';
  else if (QUESTION_MARKERS.test(current)) mode = 'question';

  return {
    mode,
    topicShift,
    userTextLength: current.length,
    previousUserText,
    expression,
  };
}

/**
 * 根据本地识别出的交流意图微调采样温度。它不是固定的人格温度，
 * 只是让“认真回答问题”和“换个话题聊聊”拥有不同的松紧度。
 */
export function recommendConversationTemperature(
  userText: string,
  recentUserMessages: string[] = [],
  proactivity = 0.5,
): number {
  const mode = detectHumanTurn(userText, recentUserMessages).mode;
  const base = 0.58 + Math.max(0, Math.min(1, proactivity)) * 0.28;
  const adjustment: Record<HumanTurnMode, number> = {
    casual: 0,
    emotional: 0.05,
    question: -0.07,
    request: -0.08,
    'topic-shift': 0.04,
  };
  return Math.max(0.5, Math.min(0.9, base + adjustment[mode]));
}

/**
 * 构建隐藏的本轮交流指令。只描述“怎么接住这一句话”，不把内部标签、
 * 分析结果或用户画像暴露给模型以外的任何界面。
 */
export function buildHumanConversationSections(
  userText: string,
  history: Array<{ role: string; content: string }>,
  character?: HumanCharacter | null,
  options: HumanConversationOptions = {},
): PromptSection[] {
  const recentUsers = history.filter(item => item.role === 'user').map(item => item.content).slice(-5);
  const recentReplies = history.filter(item => item.role === 'assistant').map(item => item.content).slice(-6);
  const signals = detectHumanTurn(userText, recentUsers);
  const action = chooseConversationAction(userText, history, character, options);
  const directions: Record<ConversationAction, string> = {
    'follow-topic': '用户正在换话题，跟随新话题，旧线索暂时放下。不因为前面聊过情绪就继续安慰，也不必先解决旧事；普通分享可以先说你自己的反应，不必把新话题又接成一个问题。同感可以是一句当下的态度或玩笑，不必用“我以前也这样”“我有次”开一段无来源的亲身故事。本轮明确问你的问题或求助仍直接回答。',
    'stay-present': '说这件事让你在意的具体一点，用人物自己的口语表达反应；不必先复述用户整句感受，再宣布自己正在倾听。不急着分析或解决，需要时才补一条独立反应。',
    'answer-directly': '回应自己真正懂、在意的点；不懂或不想回答可以坦白说，不强装标准答案。',
    'finish-request': '按角色的能力和边界回应这个请求，不擅自扩展任务或宣称应用操作已完成。',
    'share-life': '气氛合适时可以说一点自己的近况，仍先回应眼前的话。',
    'fresh-angle': '旧谈话有整段重复倾向，可以换一个具体角度；口癖不需要换掉。',
    'short-close': '用户正在收尾，按这个人的方式回应告别，不硬开新话题；问候可以依照用户的作息，不用根据当前时钟纠正一句晚安。前面的普通闲聊不自动变成用户仍然挂心的事，不为显得记得细节追加「别惦记、别担心」等未经表达的安抚；有真正共同的笑点仍可以简短呼应。',
    react: '轻松交流，接这件小事的趣味或说自己的感受，表达偏好、只回反应也可以；普通分享不是让你检查生活是否正确，不自动补处理办法。同感可以是一句当下的态度或玩笑，不必用“我以前也这样”“我有次”开一段无来源的亲身故事。',
  };
  const lines = ['[本轮交流的隐藏节奏]', directions[action]];
  if (options.adviceStyle === 'listen' && !['short-close', 'finish-request'].includes(action)) {
    lines.push(action==='follow-topic'
      ?'按用户当前这句话接话，可以对新内容有自己的反应。用户希望少分析、少建议，就不自动添加解释、休息建议或后续安排；明确问题和求助照常回应。'
      :'用户这件事想先说出来，不是在求方案。可以有你自己的感受、判断或具体接话，不必宣布“我在听”；不要把倾听变成心理解释、劝休息或自动安排下一步。明确问你的问题仍要回答。');
  }
  // The shared contract already covers ordinary chat. Only add an emotion or
  // request clue when it contributes something specific to this turn.
  if (!isDirectAffection(userText) && (signals.expression.situation !== 'neutral' || signals.expression.request))
    lines.push(expressionDirection(signals.expression));
  else if (!isDirectAffection(userText) && action !== 'follow-topic' && recentUsers.slice(-2).some(text=>assessExpressionSignals(text).situation!=='neutral'))
    lines.push('不因为前面聊过情绪就继续安慰；本轮以用户现在说的内容为准。');
  const direct = directChatGuidance(userText,recentUsers,recentReplies);
  if (direct) lines.push(direct);
  if (isPersonalExperienceQuestion(userText)) {
    const authored=(character?.systemPrompt??'').split(/\r?\n/u).filter(line=>!SAMPLE_LINE.test(line)).join('\n').slice(0,2000);
    const recorded=(options.lifeHints??[]).slice(0,4).map(line=>line.slice(0,160));
    lines.push('[本轮经历核对]',`人设正文参考（剔除声音例句；完整正文仍有效）：${authored||'未提供'}`,`本地生活记录参考：${recorded.join(' / ')||'未提供；仍可核对本轮其他有来源的经历记录'}`,
      '用户在问你自己的经历：先核对独立的角色设定或本轮有来源的经历记录，再作答。声音例句和你先前随口生成的自述不能证明经历发生过；旧回复里出现过也不等于有依据。已知发生过某件事，不代表知道当时的地点、频次、家人反应或身体感受；说已有事实即可，生动可以来自此刻的看法，不靠补写回忆。缺少记载不等于从未发生，不能断言「没这事」；不确定就坦白不确定。如果上轮编过，简短更正那一句，不给自己补失忆，也不拿「可能、大概」续编。纠正时保留人物自己的口语，别说「依据、核验、记录不足、拿不出经历」等内部审查措辞，不解释核对过程，也不反复道歉。用户明确要求创作或扮演时仍按其情境交流。','[/本轮经历核对]');
  }
  const feeling=emotionalExpressionGuidance(userText,history,character?{...character,hasVoiceJudgment:!!validVoiceSamples(character)}:character,options.recentReplyTurns);
  if(feeling)lines.push(feeling);
  const rhythm = recentRhythmDirection(options.recentReplyTurns ?? []);
  if (rhythm) lines.push(rhythm);
  if (signals.userTextLength <= 8 && signals.mode==='casual' && !['praise','disagreement','repair'].includes(interactionMoment(userText))) lines.push('这句没有明确问题或请求，可以只回反应，不为了信息量扩写；仍按人物真正的态度回应。');
  const recentText = recentReplies.slice(-4).join(' ');
  const candidates = [...new Set((options.proactiveTopics ?? []).map(compact).filter(t => t.length >= 3))]
    .filter(t => !isTopicRelated(t, recentText) && !compact(userText).includes(t));
  const turn = options.turnNumber ?? recentUsers.length + 1;
  if (options.adviceStyle !== 'listen' && signals.mode === 'casual' && !isClosing(userText) && mayShareLife(character?.name ?? '', turn, character?.proactivity ?? 0.5)) {
    const topic = candidates[turn % Math.max(1, candidates.length)];
    if (topic) lines.push(`如果话题自然停住，可以打开一个具体小话题：「${topic.slice(0, 80)}」。这是可选线索，不是必须念出的台词。`);
  }
  const hints = [...new Set((options.lifeHints ?? []).map(compact).filter(t => t.length >= 3))].slice(0, 2);
  if (action === 'share-life' && hints.length) lines.push(`角色确实有这些生活线索：${hints.map(t => t.slice(0, 80)).join(' / ')}。只基于已知资料，不编造新经历。`);
  const motifs = repeatedMotifs(recentReplies, character?.catchphrase).filter(t => !isTopicRelated(userText, t));
  if (motifs.length) lines.push(`最近这些完整长句反复出现：${motifs.join(' / ')}。别照搬整句；口头禅和惯用开头继续保持。用户主动重提时仍可回应。`);
  return [
    {key:'human-conversation',text:lines.join('\n'),priority:99,placement:'tail',tailOrder:0},
    {key:'character-voice',text:['[人物声音卡]',...characterVoiceLines(character,userText),'[/人物声音卡]'].join('\n'),priority:100,placement:'tail',tailOrder:1},
  ];
}

/** Standalone form retains both parts in their intended final order. */
export function buildHumanConversationContext(userText:string,history:Array<{role:string;content:string}>,character?:HumanCharacter|null,options:HumanConversationOptions={}):string {
  return buildHumanConversationSections(userText,history,character,options).map(section=>section.text).join('\n');
}
