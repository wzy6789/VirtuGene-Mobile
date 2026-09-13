/**
 * 相关性召回（5.0.0 Living World §60 / §62）
 *
 * "你还记得我们第一次看海吗？" —— 即使那件事发生在三个月前，也必须优先召回。
 * 因此世界层的召回复习**不能**只是"最近 N 条"，而要有一次基于关键词的相关性检索。
 *
 * 这里刻意**不引入向量检索**：
 * - 移动端本地跑不了 embedding，也不该为此多花一次调用
 * - 共同记忆 / 世界事件的标题本身就是人写的短句，词面匹配的召回率足够
 *
 * 排序 = 命中词数 → 重要度 → 新鲜度。宁可少召回，也不把整个数据库塞进 Prompt。
 */
import type { SharedMemory, WorldEvent } from '../../db/index';
import { worldEventRepo } from '../../db/world-event-repo';
import { sharedMemoryRepo } from '../../db/shared-memory-repo';
import { isVisibleToCharacter } from './visibility';

export interface HistoryHit {
  /** 人话日期（用于"那是很久以前"这种自然表达） */
  date: string;
  text: string;
  kind: 'event' | 'memory';
  id: string;
  score: number;
}

/** 从中文/英文查询里取"实词"：去掉语气词与常见疑问词，取 2 字以上的片段 */
export function queryTerms(query: string): string[] {
  const cleaned = (query ?? '')
    .replace(/[，。！？、；：""''《》（）()\[\]{}?!.,;:"']/g, ' ')
    .replace(/你还?记得|吗|呢|吧|的是|那次|那个|那件|第一次|我们|你们|他们|一起|以前|上次|当时|怎么|什么|为什么|有没有/g, ' ')
    .trim();
  const parts = cleaned.split(/\s+/).filter((p) => p.length >= 2);
  const terms = new Set<string>();
  for (const part of parts) {
    terms.add(part);
    // 中文长句：额外切 2 字滑窗，提升"海边/看海"这类短词的命中率
    if (part.length >= 4) {
      for (let i = 0; i + 2 <= part.length; i += 2) terms.add(part.slice(i, i + 2));
    }
  }
  return [...terms].filter((t) => t.length >= 2).slice(0, 12);
}

function hitCount(text: string, terms: string[]): number {
  let n = 0;
  for (const term of terms) if (text.includes(term)) n += 1;
  return n;
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  const days = Math.floor((Date.now() - ts) / 86_400_000);
  const label = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (days <= 0) return `${label}（今天）`;
  if (days === 1) return `${label}（昨天）`;
  if (days < 30) return `${label}（${days} 天前）`;
  return `${label}（${Math.floor(days / 30)} 个月前）`;
}

/**
 * 检索"和这句话有关的历史"。
 * `characterId` 传了就只返回该角色被允许知道的内容（可见性闸门）。
 */
export async function findRelevantHistory(params: {
  worldId: string;
  query: string;
  limit?: number;
  characterId?: string;
}): Promise<HistoryHit[]> {
  const terms = queryTerms(params.query);
  if (terms.length === 0) return [];
  const limit = Math.max(1, params.limit ?? 5);

  const [events, memories] = await Promise.all([
    worldEventRepo.getRecent(params.worldId, 200),
    sharedMemoryRepo.listByWorld(params.worldId, 200),
  ]);

  const hits: HistoryHit[] = [];
  const push = (row: WorldEvent | SharedMemory, kind: HistoryHit['kind']) => {
    if (params.characterId && !isVisibleToCharacter(row, params.characterId)) return;
    const text = kind === 'event'
      ? `${(row as WorldEvent).title}${(row as WorldEvent).summary ? `：${(row as WorldEvent).summary}` : ''}`
      : `${(row as SharedMemory).title}${(row as SharedMemory).summary ? `：${(row as SharedMemory).summary}` : ''}`;
    const score = hitCount(text, terms) * 2 + (row.importance ?? 0.5);
    if (score < 2) return;
    const ts = kind === 'event' ? (row as WorldEvent).timestamp : (row as SharedMemory).createdAt;
    hits.push({ date: formatDate(ts), text, kind, id: row.id, score });
  };

  for (const event of events) push(event, 'event');
  for (const memory of memories) push(memory, 'memory');

  return hits
    .sort((a, b) => b.score - a.score || (a.date < b.date ? 1 : -1))
    .slice(0, limit);
}
