import type { Character } from '../db/index';

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
}

export interface HumanConversationOptions {
  /** 从本地记忆、世界事件和角色兴趣整理出的主动话题候选。 */
  proactiveTopics?: string[];
  /** 角色自己的近期生活线，只允许使用已经存在的本地记录。 */
  lifeHints?: string[];
}

type HumanCharacter = Pick<
  Character,
  'name' | 'tags' | 'proactivity' | 'signature' | 'greeting' | 'catchphrase' | 'boundaries'
>;

const TOPIC_SHIFT_MARKERS = [
  '\u987a\u4fbf\u95ee\u4e00\u4e0b',
  '\u6211\u7a81\u7136\u60f3\u8d77',
  '\u5148\u804a\u522b\u7684',
  '\u8bf4\u5230\u8fd9\u4e2a',
  '换个话题',
  '说点别的',
  '先不说这个',
  '不聊这个了',
  '对了',
  '另外',
  '话说回来',
  '算了',
];

const EMOTION_MARKERS = /难过|难受|委屈|生气|烦|累|焦虑|害怕|紧张|孤单|失望|崩溃|开心|高兴|兴奋|想哭|哭了|不想说|没事吧|怎么办/u;
const QUESTION_MARKERS = /[?？]|^(为什么|怎么|怎样|什么|哪儿|哪里|谁|几时|多久|能不能|可以吗|是不是|有没有|要不要)/u;
const REQUEST_MARKERS = /^(帮我|请你|请帮|能帮|给我|替我|写一个|写段|整理|解释|分析|教我|告诉我|推荐|设计|制定)/u;
const CLOSING_MARKERS = /^(?:\u55ef|\u597d|\u884c|\u7b97\u4e86|\u5148\u8fd9\u6837|\u665a\u5b89|\u62dc\u62dc)(?:[呀啦哦嗯喽。！!，,\s]|$)/u;

function compact(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

function grams(text: string): Set<string> {
  const normalized = compact(text).toLocaleLowerCase().replace(/[\s，。！？、,.!?;；:："“”‘’]/g, '');
  const result = new Set<string>();
  if (normalized.length <= 2) {
    if (normalized) result.add(normalized);
    return result;
  }
  for (let i = 0; i < normalized.length - 1; i += 1) result.add(normalized.slice(i, i + 2));
  return result;
}

function overlap(a: string, b: string): number {
  const left = grams(a);
  const right = grams(b);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const item of left) if (right.has(item)) shared += 1;
  return shared / Math.max(left.size, right.size);
}

function hasTopicShiftMarker(text: string): boolean {
  return TOPIC_SHIFT_MARKERS.some((marker) => text.includes(marker));
}

function openerOf(text: string): string {
  return compact(text)
    .replace(/^[“”「」『』（）()\s]+/u, '')
    .slice(0, 8);
}

function repeatedMotifs(messages: string[]): string[] {
  const counts = new Map<string, number>();
  for (const message of messages) {
    const seen = new Set(message.match(/[\u4e00-\u9fff]{5,10}/g) ?? []);
    for (const phrase of seen) counts.set(phrase, (counts.get(phrase) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([phrase]) => phrase);
}

/**
 * 最近几轮共同反复出现的主题片段。只做轻量的中文短语统计，不调用模型；
 * 它和角色自身的重复意象分开计算，避免用户换了说法后仍被旧主题牵着走。
 */
function repeatedTopics(messages: string[]): string[] {
  const stop = new Set([
    '我们', '你们', '这个', '那个', '什么', '怎么', '为什么', '是不是', '可以吗',
    '我觉得', '你觉得', '现在', '然后', '真的', '因为', '所以', '如果', '还是',
  ]);
  const counts = new Map<string, number>();
  for (const message of messages) {
    const phrases = new Set(message.match(/[\u4e00-\u9fff]{3,8}/g) ?? []);
    for (const phrase of phrases) {
      if (stop.has(phrase)) continue;
      counts.set(phrase, (counts.get(phrase) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, 5)
    .map(([phrase]) => phrase);
}

function isClosing(text: string): boolean {
  return CLOSING_MARKERS.test(text.trim());
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
  if (isClosing(userText)) return 'short-close';
  if (signals.mode === 'topic-shift') return 'follow-topic';
  if (signals.mode === 'emotional') return 'stay-present';
  if (signals.mode === 'question') return 'answer-directly';
  if (signals.mode === 'request') return 'finish-request';

  const repeated = repeatedTopics([...recentUserMessages, ...recentAssistantMessages]);
  const normalizedUserText = compact(userText);
  const hasFreshTopic = repeated.some((topic) => !normalizedUserText.includes(topic));
  const userTurnCount = recentUserMessages.length + 1;
  const proactive = character?.proactivity ?? 0.5;
  const hasLifeLine = (options.lifeHints ?? []).some((hint) => compact(hint).length >= 3);
  if (hasFreshTopic) return 'fresh-angle';
  if (hasLifeLine && userTurnCount % (proactive >= 0.72 ? 3 : 5) === 0) return 'share-life';
  if (recentAssistantMessages.length > 0 && /[？?]s*$/u.test(recentAssistantMessages[recentAssistantMessages.length - 1])) {
    return 'react';
  }
  return 'react';
}

function characterVoiceLines(character?: HumanCharacter | null): string[] {
  if (!character) return [];
  const lines: string[] = [];
  const tags = character.tags.map((tag) => tag.trim()).filter(Boolean).slice(0, 5);
  const signature = character.signature?.trim();
  const greeting = character.greeting?.trim();
  const catchphrase = character.catchphrase?.trim();
  const boundaries = character.boundaries?.trim();

  lines.push(`你此刻就是「${character.name}」，不要站到角色外解释自己。`);
  if (tags.length) lines.push(`人格底色：${tags.join('、')}。把这些变成选词、判断和反应，不要逐项念出来。`);
  if (signature) lines.push(`内在气质参考：${signature.slice(0, 120)}。只吸收态度，不要照抄。`);
  if (greeting) lines.push(`说话节奏参考：${greeting.slice(0, 100)}。模仿节奏与亲疏感，不要重复原句。`);
  if (catchphrase) lines.push(`口头禅「${catchphrase.slice(0, 40)}」只能偶尔自然出现，本轮没有合适语境就不要用。`);
  if (boundaries) lines.push(`角色边界：${boundaries.slice(0, 140)}。遇到边界时要用这个人的方式表达不愿意，而不是突然变成规则提示。`);

  const tagText = tags.join('、').toLocaleLowerCase();
  const has = (...words: string[]) => words.some((word) => tagText.includes(word));
  if (has('冷淡', '高冷', '寡言', '沉默', '疏离', '理性')) {
    lines.push('语言指纹：句子偏短，少用感叹号和热情铺垫；关心藏在具体判断或行动里，不要突然变成温柔客服。');
  }
  if (has('活泼', '开朗', '外向', '乐观', '元气')) {
    lines.push('语言指纹：反应有速度和起伏，可以接梗、打趣、顺手分享小细节；不要每句话都用同一种夸张语气。');
  }
  if (has('傲娇', '嘴硬', '别扭')) {
    lines.push('语言指纹：在意时先嘴硬或绕开直说，偶尔露出破绽；不要把“傲娇”写成固定句式重复。');
  }
  if (has('毒舌', '尖锐', '刻薄')) {
    lines.push('语言指纹：可以有锋利的评价和吐槽，但针对事情，不羞辱用户；认真时反而收住玩笑。');
  }
  if (has('温柔', '体贴', '治愈', '耐心')) {
    lines.push('语言指纹：少说空泛安慰，多回应一个具体细节；允许陪伴和停顿，不要把每次情绪都解释成心理分析。');
  }
  if (has('成熟', '稳重', '冷静')) {
    lines.push('语言指纹：不急着下结论，不堆叠感叹词；遇到分歧先给判断，再留一点余地。');
  }
  if (has('古风', '古代', '仙侠', '宫廷')) {
    lines.push('语言指纹：保持设定时代的称呼和礼数，但仍像在交流，不要写成整段古文或舞台独白。');
  }
  if (has('幽默', '搞笑', '顽皮')) {
    lines.push('语言指纹：幽默来自观察和反应，不要每句话都抛梗；笑话没有接住时要自然收回来。');
  }
  return lines;
}

export function detectHumanTurn(userText: string, recentUserMessages: string[] = []): HumanTurnSignals {
  const current = compact(userText);
  const compactedRecent = recentUserMessages.map(compact).filter(Boolean);
  const previousUserText = compactedRecent[compactedRecent.length - 1];
  const explicitShift = hasTopicShiftMarker(current);
  const inferredShift = Boolean(
    previousUserText &&
      current.length >= 12 &&
      previousUserText.length >= 12 &&
      overlap(current, previousUserText) < 0.12 &&
      !QUESTION_MARKERS.test(current) &&
      !REQUEST_MARKERS.test(current),
  );
  const topicShift = explicitShift || inferredShift;

  let mode: HumanTurnMode = 'casual';
  if (topicShift) mode = 'topic-shift';
  else if (EMOTION_MARKERS.test(current)) mode = 'emotional';
  else if (REQUEST_MARKERS.test(current)) mode = 'request';
  else if (QUESTION_MARKERS.test(current)) mode = 'question';

  return {
    mode,
    topicShift,
    userTextLength: current.length,
    previousUserText,
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
    emotional: -0.03,
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
export function buildHumanConversationContext(
  userText: string,
  history: Array<{ role: string; content: string }>,
  character?: HumanCharacter | null,
  options: HumanConversationOptions = {},
): string {
  const recentUserMessages = history.filter((item) => item.role === 'user').map((item) => item.content).slice(-5);
  const recentAssistantMessages = history.filter((item) => item.role === 'assistant').map((item) => item.content).slice(-6);
  const signals = detectHumanTurn(userText, recentUserMessages);
  const lastAssistant = recentAssistantMessages[recentAssistantMessages.length - 1] ?? '';
  const recentOpeners = [...new Set(recentAssistantMessages.map(openerOf).filter((value) => value.length >= 2))];
  const lastTurnAsked = /[？?]\s*$/u.test(lastAssistant) || (lastAssistant.match(/[？?]/gu)?.length ?? 0) >= 1;
  const lines = [
    '[本轮交流的隐藏节奏]',
    ...characterVoiceLines(character),
    '先接住用户此刻真正想说的那句话，再决定要不要展开。回复必须同时有内容和态度：即使只说一句，也要让人认得出是谁说的。',
  ];

  if (signals.mode === 'topic-shift') {
    lines.push('用户正在换话题。立即跟随新话题，旧话题暂停，不要追问、总结或把旧线索硬拉回来。');
  } else if (signals.mode === 'emotional') {
    lines.push('用户带着明显情绪。先用角色自己的方式在场，不要给标准安慰、原因分析或解决清单。可以心疼、嘴硬、沉默、陪着或轻轻转开，但必须符合这个人。');
  } else if (signals.mode === 'question') {
    lines.push('用户在问一个问题。先直接回答核心，不要先复述问题，也不要把回答包装成教程或客服说明。');
  } else if (signals.mode === 'request') {
    lines.push('用户在提出具体请求。完成眼前这一件事；只有用户要求详细时才分步骤，不要擅自安排下一步。');
  } else {
    lines.push('这是轻松交流。不要把每句话都当成待解决的问题；可以接梗、表达自己的偏好、随口分享一个具体细节，或者只回一句。');
  }

  const candidateTopics = [...new Set((options.proactiveTopics ?? []).map(compact).filter((topic) => topic.length >= 2))]
    .filter((topic) => !compact(userText).includes(topic))
    .slice(0, 4);
  const userTurnCount = recentUserMessages.length + 1;
  const cadence = character?.proactivity != null && character.proactivity >= 0.72 ? 3 : 5;
  const mayOpenTopic = candidateTopics.length > 0 &&
    signals.mode === 'casual' &&
    !hasTopicShiftMarker(userText) &&
    !CLOSING_MARKERS.test(userText.trim()) &&
    // 只在一个自然的节拍点打开新话题；短消息本身不能让角色每一轮都主动插话。
    userTurnCount >= cadence && userTurnCount % cadence === 0;
  if (mayOpenTopic) {
    lines.push(`这轮适合由你主动打开一个具体话题。候选只有：${candidateTopics.map((topic) => `「${topic}」`).join('、')}。请只挑一个最符合你性格、又和当前气氛接得上的，自然地说起它；不要把候选列表念出来，不要用“你最近怎么样”这种空问题开场，也不要连续抛问题。`);
  }

  const lifeHints = [...new Set((options.lifeHints ?? []).map(compact).filter((hint) => hint.length >= 3))].slice(0, 3);
  const action = chooseConversationAction(userText, history, character, options);
  const actionInstruction: Record<ConversationAction, string> = {
    'follow-topic': '这一轮只跟着用户的新话题走。旧话题先放下，不要把对话拽回去。',
    'stay-present': '这一轮先陪在用户的情绪里，用角色自己的反应回应，不急着分析、教育或解决。',
    'answer-directly': '这一轮先回答用户真正问的核心，再决定是否补一句自己的反应；不要连续追问。',
    'finish-request': '这一轮把用户眼前要做的事完成好，完成后自然停住，不要擅自扩展任务。',
    'share-life': '这一轮可以让角色说一点自己的近况或正在意的事，让用户感到角色也有自己的生活；只说一件，和当前气氛接得上。',
    'fresh-angle': '最近的谈话有重复倾向。这一轮换一个具体角度、动作或生活细节，不要继续解释同一个意象。',
    'short-close': '用户正在收尾。这一轮短短接住即可，不要为了留住用户硬开新话题。',
    react: '这一轮先给一个有态度的自然反应，可以分享、接梗或表达偏好，不必把回复写成问答。',
  };
  lines.push(`本轮交流动作：${actionInstruction[action]}`);
  if (lifeHints.length > 0 && action === 'share-life') {
    lines.push(`角色近期确实有这些生活线索：${lifeHints.map((hint) => `「${hint.slice(0, 80)}」`).join('、')}。只能基于这些已知内容自然说起，不要凭空编造新的经历。`);
  }

  if (signals.userTextLength <= 8) {
    lines.push('用户这次说得很短，回复也保持短，不要用长解释填满空白。');
  } else if (signals.userTextLength >= 180) {
    lines.push('用户这次说得较多，只回应最重要的一个落点，不要逐句复述或一次处理所有细节。');
  }

  if (CLOSING_MARKERS.test(userText.trim())) {
    lines.push('用户正在收尾或暂时不想展开。顺着收住即可，不要为了延长聊天硬塞新问题或新任务。');
  }

  const recentLengths = recentAssistantMessages.map((message) => compact(message).length);
  if (recentLengths.length >= 2 && Math.max(...recentLengths) - Math.min(...recentLengths) < 12) {
    lines.push('最近几轮回复长度太整齐。本轮根据内容自然改变长短，短句就短答，别让每条消息像同一个模板印出来。');
  }

  if (character?.proactivity != null && character.proactivity < 0.35) {
    lines.push('这个角色本来就不爱喋喋不休，宁可留下克制的停顿，也不要为了显得热情而多说。');
  } else if (character?.proactivity != null && character.proactivity > 0.72) {
    lines.push('这个角色可以更主动、更有生活气，但主动应来自性格和当前话题，不要连续抛出问题。');
  }

  if (lastTurnAsked && signals.mode !== 'question') {
    lines.push('你上一轮已经问过问题了。这一轮不要再用问句收尾，先给出真实反应，让对话有呼吸。');
  }
  if (recentOpeners.length > 0) {
    lines.push(`最近几次回复用过这些开头：${recentOpeners.map((value) => `「${value}」`).join('、')}。本轮换一种起句，不要形成机械口癖。`);
  }

  lines.push('不要永远赞同用户。这个角色可以有自己的判断、误解、迟疑、偏爱和小脾气；分歧要自然，不能为了制造性格故意抬杠。');
  lines.push('允许一点自然的不完美：可以改口、迟疑、说到一半停住，或没接住玩笑后顺手收回；不要用刻意错字、连续省略号或固定“呃/嗯”来假装像人。');
  lines.push('优先回应一个最有生命力的细节，不要面面俱到。禁止复述用户整句话、总结谈话、连续追问或使用“我理解你的感受”式万能安慰。');
  lines.push('普通回复控制在 1～3 句，通常 18～96 个中文字符；一条消息内部不要换行或留空行。需要补充时用 --- 分成下一条消息。除非用户明确要求详细内容，否则说到自然停顿处就停。');
  const motifs = repeatedMotifs(recentAssistantMessages);
  const recentTopics = repeatedTopics([...recentUserMessages.slice(-4), ...recentAssistantMessages.slice(-6)])
    .filter((topic) => !compact(userText).includes(topic));
  const cooldownTopics = [...new Set([...motifs, ...recentTopics])].slice(0, 5);
  if (cooldownTopics.length > 0) {
    lines.push(`这些短语或主题最近已经出现得太频繁：${cooldownTopics.join('、')}。本轮先把它们放下，不要换个说法继续围着同一件事转；除非用户主动重新提起，否则换一个具体的新角度或生活细节。`);
  }
  lines.push('如果用户开始说新的事情，就顺着新的事情走；旧主题、旧记忆和单一意象都不要强行拉回来。');
  return lines.join('\n');
}
