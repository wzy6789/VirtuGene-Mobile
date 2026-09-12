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
 * 只有内容里本来就分了段（`---`）才分条；否则就是一条——不为了让"像真人"而硬拆句。
 */
export function splitReplyParts(content: string, maxParts = 3): string[] {
  const parts = content
    .split(/\n?-{3,}\n?/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (parts.length <= 1) {
    const single = content.trim();
    return single ? [single] : [];
  }
  if (parts.length <= maxParts) return parts;
  // 超过上限：把多出来的并进最后一条，而不是丢掉
  const head = parts.slice(0, maxParts - 1);
  head.push(parts.slice(maxParts - 1).join('\n'));
  return head;
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
