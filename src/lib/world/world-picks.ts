/**
 * 世界页的"挑选"逻辑（纯函数，便于验收）
 *
 * 设计原则：
 * - **不发请求、不调 LLM**：只是把已有数据挑出一条最该被看见的
 * - 判断规则固定且可解释：逾期 > 约定时间临近 > 最近提起
 * - 不制造"待办清单"感：这里只决定"先给用户看哪一件事"，不排序、不打分展示
 */
import type { ContinuityThread } from '../../db/index';

/**
 * 从还挂着的未完成事件里挑出"最该继续的一件事"。
 * 规则（自上而下，第一个命中者胜出）：
 *   1. 已经过了约定时间的（逾期最久的优先）
 *   2. 约定时间最近的
 *   3. 最近被提起/修改的
 * 全都没有就返回 null（世界页据此隐藏这张卡，不做假内容）。
 */
export function pickWaitingStory(threads: ContinuityThread[], now = Date.now()): ContinuityThread | null {
  const open = threads.filter((t) => t.status === 'open');
  if (open.length === 0) return null;

  const overdue = open
    .filter((t) => typeof t.dueAt === 'number' && t.dueAt < now)
    .sort((a, b) => (a.dueAt ?? 0) - (b.dueAt ?? 0));
  if (overdue.length > 0) return overdue[0];

  const upcoming = open
    .filter((t) => typeof t.dueAt === 'number' && t.dueAt >= now)
    .sort((a, b) => (a.dueAt ?? 0) - (b.dueAt ?? 0));
  if (upcoming.length > 0) return upcoming[0];

  return [...open].sort((a, b) => b.updatedAt - a.updatedAt)[0];
}

/** 未完成事件类别 → 用户能读懂的一句话（不暴露任何内部字段） */
export const THREAD_TEASER: Record<ContinuityThread['kind'], string> = {
  promise: 'TA 还记得你答应过的那件事。',
  plan: '你们说好要一起做，但还没有做。',
  topic: '那次谈话，其实还没有说完。',
  conflict: '有些话，你们还没有说开。',
  reminder: '有件事，到了该记得的时候。',
};

/**
 * 相对时间：今天 / 昨天 / N 天前 / M 月 D 日。
 * 世界页讲的是"故事"，所以不直接甩时间戳。
 */
export function relativeDay(ts: number, now = Date.now()): string {
  const then = new Date(ts);
  const today = new Date(now);
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const startOfThen = new Date(then.getFullYear(), then.getMonth(), then.getDate()).getTime();
  const dayDiff = Math.round((startOfToday - startOfThen) / 86_400_000);
  if (dayDiff <= 0) return '今天';
  if (dayDiff === 1) return '昨天';
  if (dayDiff < 7) return `${dayDiff} 天前`;
  return `${then.getMonth() + 1} 月 ${then.getDate()} 日`;
}

/**
 * 把一条被收藏的消息切成「共同记忆」的标题与正文。
 *
 * 规则（纯函数，可验收）：
 * - 空白/换行先归一化（连续空行压成一个换行，首尾去空白）
 * - 标题 = 第一行，超过 titleMax 字截断并加省略号
 * - 正文 = **标题没覆盖到的剩余内容**（不与标题重复；短消息的正文为空）
 * - 空内容返回 { title: '', summary: '' }，由调用方决定占位文案（不在这里编造）
 */
export function splitForMemory(content: string, titleMax = 40): { title: string; summary: string } {
  const normalized = content.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!normalized) return { title: '', summary: '' };
  const firstLine = normalized.split('\n')[0].trim();
  const title = firstLine.length > titleMax ? `${firstLine.slice(0, titleMax)}…` : firstLine;
  const rest = normalized.slice(firstLine.length).replace(/^\n+/, '').trim();
  // 首行很长被截断时，正文要接上被截掉的部分（而不是丢掉）
  const cutTail = firstLine.length > titleMax ? firstLine.slice(titleMax) : '';
  const summary = [cutTail, rest].filter(Boolean).join('\n');
  return { title, summary };
}

/** 事件归属到"哪一天"的人话说法（用于年表/最近发生的时间轴分组） */
export function dayOf(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
