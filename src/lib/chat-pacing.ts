/**
 * 自然聊天节奏：真人不会一次把三句话同时甩出来，也不会每条都等一样久。
 *
 * 规则（与产品约定一致）：
 * - 尊重反应条与内容条，最多 4 条；短反应不补长、不强制拼回完整句
 * - 首条不追加分条等待，后续按上一条长度停顿 380~850ms
 * - 最多四条，一轮额外停顿不超过 2550ms；不模拟逐字打字耗时
 * - 减少动效只关闭视觉运动，保留消息之间的交流节奏
 */

import { collapseChatNewlines } from './ai/text';

export const MIN_FIRST_DELAY = 0;
export const MAX_FIRST_DELAY = 0;
export const MIN_FOLLOW_DELAY = 380;
export const MAX_FOLLOW_DELAY = 850;
export const MAX_TOTAL_DELAY = 2550;
/** 普通私聊超过这个长度时，优先在自然标点处分成多个气泡，避免一整块文字压满手机屏幕。 */
const NATURAL_SPLIT_CHARS = 60;
export const MAX_REPLY_PARTS = 4;
export interface ChatTextOptions { longForm?:boolean; preserveEscapes?:boolean }

export function shouldPreserveChatEscapes(message:string):boolean {
  return /[\\`]|转义|反斜杠|正则|代码|字符|\b(?:JSON|JavaScript|TypeScript|Python|SQL)\b/iu.test(message);
}

/** Repair only short quoted Chinese prose, never arbitrary backslashes or JSON
 * escapes. Technical content and explicit literal requests stay untouched. */
export function normalizeChatQuotationEscapes(content:string,options:ChatTextOptions={},final=true):string {
  const probe=content.replace(/\\["']/gu,'');
  if(options.preserveEscapes||shouldPreserveChatEscapes(final?probe:probe.replace(/\\$/u,'')))return content;
  let text=content.replace(/(?<!\\)\\(["'])([^\\\n]{1,120})\\\1/gu,(whole,quote:string,body:string)=>
    /\p{Script=Han}/u.test(body)&&!/[{}\[\]<>:=/]/u.test(body)?quote+body+quote:whole);
  if(!final){
    // Do not flash a slash while the next frame can complete a prose quote.
    const pending=text.match(/(?<!\\)\\(["'])[^\\\n]{0,120}(?:\\)?$/u);
    if(pending)text=text.slice(0,pending.index);
    else text=text.replace(/(?<!\\)\\$/u,'');
  }
  return text;
}

/** Fallback for a model using blank paragraphs instead of explicit transport separators. */
export function normalizeChatParagraphBoundaries(content:string,options:{longForm?:boolean}={}):string {
  // Code and explicitly requested long prose retain their content structure.
  // A single newline is never interpreted as another message.
  if(options.longForm)return content;
  return content.replace(/\r\n?/gu,'\n').split(/(```[\s\S]*?(?:```|$))/gu)
    .map(part=>part.startsWith('```')?part:part.replace(/\n[ \t]*\n(?:[ \t]*\n)*/gu,'\n---\n')).join('');
}

export function joinReplyText(left: string, right: string): string {
  return /[A-Za-z0-9]$/u.test(left) && /^[A-Za-z0-9]/u.test(right) ? `${left} ${right}` : left + right;
}
/** Preserve order; smallest adjacent sum wins, with earliest pair breaking ties. */
export function mergeReplyParts(parts: string[], maxParts = MAX_REPLY_PARTS): string[] {
  const merged = [...parts];
  const limit = Math.max(1, Math.floor(maxParts));
  while (merged.length > limit) {
    let best = 0;
    for (let i = 1; i < merged.length - 1; i++) {
      if (merged[i].length + merged[i + 1].length < merged[best].length + merged[best + 1].length) best = i;
    }
    merged.splice(best, 2, joinReplyText(merged[best], merged[best + 1]));
  }
  return merged;
}

/**
 * 单个聊天气泡的最终排版协议。
 *
 * 模型偶尔会把手机消息写成文章段落（换行、空行、Markdown），这一步在
 * 落库前统一收束。真正需要分开发送的内容应该由 `---` 表达，而不是把
 * 空行藏在同一个气泡里。
 */
export function normalizeBubbleText(content: string): string {
  return collapseChatNewlines(content
    .replace(/\r\n?/g, '\n')
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```(?:\w+)?/g, '')))
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/^[ \t]+|[ \t]+$/g, '')
    .trim();
}

/** 模型若按 JSON 协议返回多条消息，兼容解析；解析失败仍按普通文本处理。 */
export function normalizeChatResponse(content: string,options:ChatTextOptions={}): string {
  const raw = content.trim();
  if (!raw) return '';
  try {
    const candidate = JSON.parse(raw) as unknown;
    if (candidate && typeof candidate === 'object' && Array.isArray((candidate as { messages?: unknown }).messages)) {
      const messages = (candidate as { messages: unknown[] }).messages
        .filter((item): item is string => typeof item === 'string')
        .map(item=>normalizeBubbleText(normalizeChatQuotationEscapes(item,options)))
        .filter(Boolean);
      if (messages.length > 0) return messages.join('\n---\n');
    }
  } catch {
    // 绝大多数回复仍是纯文本；不把普通文本当成错误。
  }
  return normalizeChatQuotationEscapes(raw,options);
}

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return document.documentElement.dataset.vgReducedMotion === 'true' || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** Do not hold ready text behind another artificial first-bubble delay. */
export function firstMessageDelay(first: string): number {
  void first;
  return 0;
}

/** Give the preceding bubble a brief reading beat, without a typing simulation. */
export function followUpDelay(part: string): number {
  const len = Array.from(part.trim()).length;
  return clamp(MIN_FOLLOW_DELAY + len * 6, MIN_FOLLOW_DELAY, MAX_FOLLOW_DELAY);
}

/**
 * 把一段模型回复切成要发出的分条（最多 4 条）。
 * 内容里有 `---` 时尊重模型分段；普通闲聊偶尔过长，则只在自然标点处补分段，避免一整面文字挤在一个气泡里。
 */
export function splitReplyParts(content: string, maxParts = MAX_REPLY_PARTS, options: ChatTextOptions = {}): string[] {
  const normalized = normalizeChatParagraphBoundaries(normalizeChatResponse(content,options),options);
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
      const sentences = single.match(/[^。！？!?；;]+[。！？!?；;]*|[。！？!?；;]+/g)?.map((p) => p.trim()).filter(Boolean) ?? [single];
      if (sentences.length > 1) {
        const chunks: string[] = [];
        let current = '';
        // 让超长回复尽量平均落在最多四个气泡里。
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
  return mergeReplyParts(parts, maxParts);
}

/** 保留 API 兼容名；现在单气泡内部不插入空行，停顿由多条消息承担。 */
export function formatSpokenParagraphs(content: string, options: { longForm?: boolean } = {}): string {
  void options;
  return normalizeBubbleText(content);
}

/**
 * Relative inter-bubble delays, shared by buffered and streamed delivery.
 * Generation time is credited by the streaming queue, rather than added twice.
 */
export function computeMessageDelays(
  parts: string[],
  options: { reducedMotion?: boolean; alreadyElapsedMs?: number } = {},
): number[] {
  void options; // Compatibility with callers that supply motion/network options.
  return parts.map((_, index) => index === 0 ? 0 : followUpDelay(parts[index - 1]));
}
