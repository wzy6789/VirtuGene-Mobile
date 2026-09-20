/**
 * 回复质量自检：在把 AI 回复上屏前检查常见"翻车"情况，
 * 命中则返回修正提示，由调用方静默重试一次。
 */

export type ReplyIssue =
  | 'empty'
  | 'repeat-user'
  | 'generic'
  | 'repeat-own'
  | 'too-long'
  | 'over-structured'
  | 'question-barrage';

export interface ReplyCheck {
  ok: boolean;
  issue?: ReplyIssue;
  retryHint?: string;
}

/**
 * 把模型偶尔带出的“内部格式”收束成手机聊天文本。
 * 这里只做确定安全的本地清理，不改写角色观点，也不额外调用模型。
 */
export function polishChatResponse(
  content: string,
  options: { longForm?: boolean } = {},
): string {
  let text = content
    .replace(/\r\n?/g, '\n')
    .replace(/```(?:text|markdown|json)?\s*/gi, '')
    .replace(/```/g, '')
    .replace(/^\s*(?:回复|回答|角色回复|assistant)\s*[：:]+\s*/i, '')
    .replace(/^\s*[【\[](?:回复|回答|assistant)[】\]]\s*/i, '')
    .replace(/\n{2,}/g, '\n')
    .trim();

  // 普通聊天不应该把内部分析词带到用户面前；整句移除比留下半句更自然。
  if (!options.longForm) {
    text = text
      .split('\n')
      .filter((line) => !/(?:作为(?:一个)?(?:AI|人工智能|语言模型)|系统提示|内部指令|记忆库|人物心意|对话导演)/u.test(line))
      .join('\n')
      .trim();
  }

  // 不让模型用连续多个问号把聊天变成采访；只保留第一个真正的问题。
  if (!options.longForm) {
    let seenQuestion = false;
    text = text.replace(/[？?]/gu, (mark) => {
      if (seenQuestion) return '。';
      seenQuestion = true;
      return mark;
    });
  }

  return text.replace(/[ \t]*\n+[ \t]*/g, ' ').replace(/[ \t]{2,}/g, ' ').trim();
}

/**
 * 字符集合重叠度（用于复述检测）：0-1，越接近 1 越相似。
 * 注意：短文本（如"好"vs"好的"）字符集必然高度重叠，因此调用方应对短消息跳过复述检测。
 */
function similarity(a: string, b: string): number {
  const norm = (s: string) => new Set(s.replace(/\s+/g, ''));
  const setA = norm(a);
  const setB = norm(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let inter = 0;
  for (const c of setA) {
    if (setB.has(c)) inter += 1;
  }
  return inter / Math.min(setA.size, setB.size);
}

/** Detect a phrase that has already appeared in at least two recent replies. */
function repeatedMotif(text: string, previous: string[]): string | undefined {
  if (text.length < 24 || previous.length < 2) return undefined;
  const phrases = text.match(/[\u4e00-\u9fff]{6,10}/g) ?? [];
  for (const phrase of phrases) {
    const count = previous.filter((item) => item.includes(phrase)).length;
    if (count >= 2) return phrase;
  }
  return undefined;
}

/** 复述检测只对足够长的文本启用：短句（如"好""嗯"）字符集必然重叠，会误伤 */
const MIN_REPEAT_LENGTH = 8;

const GENERIC_PATTERNS: RegExp[] = [
  /^(你好|您好|嗨|哈喽|在吗|当然可以|没问题|好的呢|好呀|嗯嗯|好的好的|很高兴(认识|见到|为你)|有什么可以帮)/,
  /作为(一个)?(AI|人工智能|语言模型|助手)/,
  /我是(一个)?(人工智能|AI|助手|机器人)/,
  /很(高兴|荣幸)(能|可以)?(为你|帮助)/,
  /^(我能理解你的感受|我理解你的心情|听起来你|感谢你愿意分享)/,
];

const OVER_STRUCTURED_PATTERNS: RegExp[] = [
  /首先[，,].{0,120}(其次|然后)[，,]/s,
  /(第一[，,：:]|第二[，,：:]|第三[，,：:])/s,
  /(总的来说|综上所述|总结一下|以下是)/,
  /(^|\n)\s*[-*•]\s+/m,
];

/** 明确要长内容时不限制；普通闲聊超过这个长度先让模型收束一次。 */
const LONG_FORM_REQUEST = /详细|解释|分析|教程|步骤|整理|总结|长一点|展开|写一篇|创作/;
const MAX_CONVERSATIONAL_REPLY_CHARS = 128;

export function isLongFormRequest(message: string): boolean {
  return LONG_FORM_REQUEST.test(message);
}

const RETRY_HINTS: Record<ReplyIssue, string> = {
  empty: '你刚才的回复是空的。请用你的性格正常回应用户，直接说事，不要长篇大论。',
  'repeat-user': '你刚才完全复述了用户的话。不要复述用户，用你自己的性格、说法和语气回应。',
  generic: '你刚才的回复太像通用客服/机器人腔了。记住你的人设：用大白话、口语、带性格地说话，直接说事，禁止"你好""当然可以""有什么可以帮您"这类套话。',
  'repeat-own': '你刚才重复了自己刚说过的话。换个说法，说点新的内容，不要原地打转。',
  'too-long': '你刚才说得太满了。普通手机聊天只保留最重要的一两个意思，控制在三句以内，像真人一样说完就停，把话题留给对方。',
  'over-structured': '你刚才像在写说明或报告。去掉分点、总结和“首先其次”，只留下这个角色此刻最想说的一两句话，用自然口语重新回答。',
  'question-barrage': '你刚才连续追问，让聊天像采访。最多保留一个真正必要的问题；更优先给出角色自己的反应、看法或一个具体细节。',
};

/**
 * @param content  模型回复
 * @param userMessage 用户本次发的消息
 * @param lastAssistantContent 上一条 AI 消息（用于自重复检测）
 */
export function checkReplyQuality(
  content: string,
  userMessage: string,
  lastAssistantContent?: string,
  recentAssistantContents: string[] = [],
): ReplyCheck {
  const text = content.trim();
  if (text.length === 0) {
    return { ok: false, issue: 'empty', retryHint: RETRY_HINTS.empty };
  }

  // 复述用户消息：整段相似度过高（仅长文本判定，短句字符集必然重叠会误伤）
  if (userMessage.trim().length >= MIN_REPEAT_LENGTH && similarity(text, userMessage) >= 0.85) {
    return { ok: false, issue: 'repeat-user', retryHint: RETRY_HINTS['repeat-user'] };
  }

  // 通用机器人腔
  for (const re of GENERIC_PATTERNS) {
    if (re.test(text)) {
      return { ok: false, issue: 'generic', retryHint: RETRY_HINTS.generic };
    }
  }

  for (const re of OVER_STRUCTURED_PATTERNS) {
    if (re.test(text)) {
      return { ok: false, issue: 'over-structured', retryHint: RETRY_HINTS['over-structured'] };
    }
  }

  const questionCount = (text.match(/[？?]/gu) ?? []).length;
  if (!isLongFormRequest(userMessage) && questionCount >= 2) {
    return { ok: false, issue: 'question-barrage', retryHint: RETRY_HINTS['question-barrage'] };
  }

  // 重复自己刚说的话（仅长文本判定）
  if (lastAssistantContent && lastAssistantContent.trim().length >= MIN_REPEAT_LENGTH && similarity(text, lastAssistantContent) >= 0.9) {
    return { ok: false, issue: 'repeat-own', retryHint: RETRY_HINTS['repeat-own'] };
  }

  const motif = repeatedMotif(text, recentAssistantContents);
  if (motif) {
    return {
      ok: false,
      issue: 'repeat-own',
      retryHint: `不要继续重复最近几轮已经用过的“${motif}”。换一个具体动作、观点或生活细节，让对话往前走。`,
    };
  }

  // 模型已经用 --- 明确分成多条短消息时，不能按总字数判定成长文；
  // 否则自然分条会被误触发重试，反而增加延迟并破坏聊天节奏。
  const bubbles = text
    .split(/\n?-{3,}\n?/u)
    .map((part) => part.trim())
    .filter(Boolean);
  const longestBubble = bubbles.reduce((max, bubble) => Math.max(max, bubble.length), 0);
  if (!isLongFormRequest(userMessage) && longestBubble > MAX_CONVERSATIONAL_REPLY_CHARS) {
    return { ok: false, issue: 'too-long', retryHint: RETRY_HINTS['too-long'] };
  }

  return { ok: true };
}
