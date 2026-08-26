/**
 * 回复质量自检：在把 AI 回复上屏前检查常见"翻车"情况，
 * 命中则返回修正提示，由调用方静默重试一次。
 */

export type ReplyIssue = 'empty' | 'repeat-user' | 'generic' | 'repeat-own';

export interface ReplyCheck {
  ok: boolean;
  issue?: ReplyIssue;
  retryHint?: string;
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

/** 复述检测只对足够长的文本启用：短句（如"好""嗯"）字符集必然重叠，会误伤 */
const MIN_REPEAT_LENGTH = 8;

const GENERIC_PATTERNS: RegExp[] = [
  /^(你好|您好|嗨|哈喽|在吗|当然可以|没问题|好的呢|好呀|嗯嗯|好的好的|很高兴(认识|见到|为你)|有什么可以帮)/,
  /作为(一个)?(AI|人工智能|语言模型|助手)/,
  /我是(一个)?(人工智能|AI|助手|机器人)/,
  /很(高兴|荣幸)(能|可以)?(为你|帮助)/,
];

const RETRY_HINTS: Record<ReplyIssue, string> = {
  empty: '你刚才的回复是空的。请用你的性格正常回应用户，直接说事，不要长篇大论。',
  'repeat-user': '你刚才完全复述了用户的话。不要复述用户，用你自己的性格、说法和语气回应。',
  generic: '你刚才的回复太像通用客服/机器人腔了。记住你的人设：用大白话、口语、带性格地说话，直接说事，禁止"你好""当然可以""有什么可以帮您"这类套话。',
  'repeat-own': '你刚才重复了自己刚说过的话。换个说法，说点新的内容，不要原地打转。',
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

  // 重复自己刚说的话（仅长文本判定）
  if (lastAssistantContent && lastAssistantContent.trim().length >= MIN_REPEAT_LENGTH && similarity(text, lastAssistantContent) >= 0.9) {
    return { ok: false, issue: 'repeat-own', retryHint: RETRY_HINTS['repeat-own'] };
  }

  return { ok: true };
}
