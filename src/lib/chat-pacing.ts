/**
 * 自然聊天节奏：真人不会一次把三句话同时甩出来，也不会每条都等一样久。
 *
 * 规则（与产品约定一致）：
 * - 默认只发 1 条；只有内容本身自然分成 2~3 段时才分条，最多 3 条
 * - 第一条 350~900ms 出现，后续短句 450~1100ms，长句最多 1800ms
 * - 一轮总等待不超过 3500ms
 * - 用户开启「减少动态效果」时整体压缩，不做长时间等待
 */

export const MIN_FIRST_DELAY = 350;
export const MAX_FIRST_DELAY = 900;
export const MIN_FOLLOW_DELAY = 450;
export const MAX_FOLLOW_DELAY = 1800;
export const MAX_TOTAL_DELAY = 3500;
/** 一条消息超过这个字数就算"长句"，等待上限放宽到 1800ms */
const LONG_MESSAGE_CHARS = 60;
/** 普通私聊超过这个长度时，优先在自然标点处分成多个气泡，避免一整块文字压满手机屏幕。 */
const NATURAL_SPLIT_CHARS = 104;

/**
 * 单个聊天气泡的最终排版协议。
 *
 * 模型偶尔会把手机消息写成文章段落（换行、空行、Markdown），这一步在
 * 落库前统一收束。真正需要分开发送的内容应该由 `---` 表达，而不是把
 * 空行藏在同一个气泡里。
 */
export function normalizeBubbleText(content: string): string {
  return content
    .replace(/\r\n?/g, '\n')
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```(?:\w+)?/g, ''))
    .replace(/[ \t]*\n+[ \t]*/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/^[ \t]+|[ \t]+$/g, '')
    .trim();
}

/** 模型若按 JSON 协议返回多条消息，兼容解析；解析失败仍按普通文本处理。 */
export function normalizeChatResponse(content: string): string {
  const raw = content.trim();
  if (!raw) return '';
  try {
    const candidate = JSON.parse(raw) as unknown;
    if (candidate && typeof candidate === 'object' && Array.isArray((candidate as { messages?: unknown }).messages)) {
      const messages = (candidate as { messages: unknown[] }).messages
        .filter((item): item is string => typeof item === 'string')
        .map(normalizeBubbleText)
        .filter(Boolean)
        .slice(0, 3);
      if (messages.length > 0) return messages.join('\n---\n');
    }
  } catch {
    // 绝大多数回复仍是纯文本；不把普通文本当成错误。
  }
  return raw;
}

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** 第一条消息的相对延迟：短句快、长句慢，但落在 350~900ms */
export function firstMessageDelay(first: string): number {
  return clamp(MIN_FIRST_DELAY + first.trim().length * 7, MIN_FIRST_DELAY, MAX_FIRST_DELAY);
}

/** 后续消息的相对延迟：短句 450~1100ms，长句最多 1800ms */
export function followUpDelay(part: string): number {
  const len = part.trim().length;
  const cap = len > LONG_MESSAGE_CHARS ? MAX_FOLLOW_DELAY : 1100;
  return clamp(MIN_FOLLOW_DELAY + len * 7, MIN_FOLLOW_DELAY, cap);
}

/**
 * 把一段模型回复切成要发出的分条（最多 3 条）。
 * 内容里有 `---` 时尊重模型分段；普通闲聊偶尔过长，则只在自然标点处补分段，避免一整面文字挤在一个气泡里。
 */
export function splitReplyParts(content: string, maxParts = 3, options: { longForm?: boolean } = {}): string[] {
  const normalized = normalizeChatResponse(content);
  const parts = normalized
    .split(/\n?-{3,}\n?/)
    .map(normalizeBubbleText)
    .filter((p) => p.length > 0);
  if (parts.length <= 1) {
    const single = normalizeBubbleText(normalized);
    if (!single) return [];
    // 模型偶尔会忽略短回复协议。普通聊天在自然标点处拆开，
    // 让手机端保留“说一句、停一下”的节奏；明确要长文时保留原段落。
    if (!options.longForm && single.length > NATURAL_SPLIT_CHARS) {
      const sentences = single.match(/[^。！？!?；;]+[。！？!?；;]?/g)?.map((p) => p.trim()).filter(Boolean) ?? [single];
      if (sentences.length > 1) {
        const chunks: string[] = [];
        let current = '';
        // 让超长回复尽量平均落在最多三个气泡里，避免前两句很短、最后一段又变成半篇文章。
        const targetChunkLength = Math.max(58, Math.ceil(single.length / maxParts));
        for (const sentence of sentences) {
          const next = current ? `${current}${sentence}` : sentence;
          if (current && next.length > targetChunkLength && chunks.length < maxParts - 1) {
            chunks.push(current);
            current = sentence;
          } else {
            current = next;
          }
        }
        if (current) chunks.push(current);
        if (chunks.length > 1) {
          const head = chunks.slice(0, maxParts - 1);
          head.push(chunks.slice(maxParts - 1).join(''));
          return head.map(normalizeBubbleText).filter(Boolean);
        }
      }
    }
    return [single];
  }
  if (parts.length <= maxParts) return parts;
  // 超过上限：把多出来的并进最后一条，而不是丢掉
  const head = parts.slice(0, maxParts - 1);
  head.push(parts.slice(maxParts - 1).join(' '));
  return head.map(normalizeBubbleText).filter(Boolean);
}

/** 保留 API 兼容名；现在单气泡内部不插入空行，停顿由多条消息承担。 */
export function formatSpokenParagraphs(content: string, options: { longForm?: boolean } = {}): string {
  void options;
  return normalizeBubbleText(content);
}

/**
 * 计算每条消息「出现前」需要等待的毫秒数（相对本轮开始）。
 * reducedMotion 时整体压缩到约 30%，并且总时长不超过 1s。
 */
export function computeMessageDelays(
  parts: string[],
  options: { reducedMotion?: boolean; alreadyElapsedMs?: number } = {},
): number[] {
  const reduced = options.reducedMotion ?? prefersReducedMotion();
  const elapsed = Math.max(0, options.alreadyElapsedMs ?? 0);
  const raw: number[] = [];
  parts.forEach((part, index) => {
    raw.push(index === 0 ? firstMessageDelay(part) : followUpDelay(part));
  });

  let scale = 1;
  const total = raw.reduce((sum, n) => sum + n, 0);
  if (total > MAX_TOTAL_DELAY) scale = MAX_TOTAL_DELAY / total;
  if (reduced) scale = Math.min(scale, 0.3);

  // 第一条只等「剩余时间」：网络本身已经花掉的时间也算在内，避免又多等一轮
  return raw.map((base, index) => {
    const target = Math.round(base * scale);
    if (index === 0) return Math.max(0, target - elapsed);
    return target;
  });
}
