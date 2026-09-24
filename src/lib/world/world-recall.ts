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
import { knowledgeRepo } from '../../db/knowledge-repo';

export interface HistoryHit {
  /** 人话日期（用于"那是很久以前"这种自然表达） */
  date: string;
  /** 原始时间戳，用于调用方记录准确的记忆来源时间。 */
  timestamp: number;
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
  userId?: string;
  worldId: string;
  query: string;
  limit?: number;
  characterId?: string;
  /** 多人场景只有所有当前听众都可见的记录才可进入公共历史。 */
  audienceCharacterIds?: string[];
}): Promise<HistoryHit[]> {
  if (params.audienceCharacterIds && params.audienceCharacterIds.length === 0) return [];
  const terms = queryTerms(params.query);
  if (terms.length === 0) return [];
  const limit = Math.max(1, params.limit ?? 5);

  const [events, memories] = await Promise.all([
    // Explicit recall is rare and the repositories already read the world's
    // rows before slicing. A recency cap here permanently hides an older
    // event even when the user's query exactly names it.
    worldEventRepo.listTimeline(params.worldId, { limit: Number.MAX_SAFE_INTEGER, userId: params.userId }),
    sharedMemoryRepo.listByWorld(params.worldId, Number.MAX_SAFE_INTEGER, params.userId),
  ]);

  // 已指定角色时，受限事件必须同时满足「可见」与「角色确实知道且可提起」。
  // world 可见事件属于公开世界知识；private 永远不会越过可见性闸门。
  const characterIds = [...new Set([
    ...(params.characterId ? [params.characterId] : []),
    ...(params.audienceCharacterIds ?? []),
  ])];
  const mentionableByCharacter = new Map<string, Set<string>>();
  await Promise.all(characterIds.map(async (characterId) => {
    const known = await knowledgeRepo.listKnownBy(characterId, params.worldId, {
      minLevel: 'full', limit: Number.MAX_SAFE_INTEGER, userId: params.userId,
    });
    mentionableByCharacter.set(characterId, new Set(known
      .filter((row) => row.canMention && row.knowledgeLevel === 'full')
      .map((row) => row.eventId)));
  }));
  const audienceCanMentionEvent = (event: WorldEvent) => characterIds.every((characterId) =>
    isVisibleToCharacter(event, characterId)
    && (event.visibility === 'world' || mentionableByCharacter.get(characterId)?.has(event.id) === true),
  );
  const allowedMemoryIdsByCharacter = new Map<string, Set<string>>();
  for (const characterId of characterIds) {
    const ids = new Set<string>();
    for (const event of events) {
      if (event.type === 'shared_memory' && event.memoryIds.length > 0 && audienceCanMentionSingle(event, characterId, mentionableByCharacter)) {
        for (const id of event.memoryIds) ids.add(id);
      }
    }
    allowedMemoryIdsByCharacter.set(characterId, ids);
  }

  const hits: HistoryHit[] = [];
  const push = (row: WorldEvent | SharedMemory, kind: HistoryHit['kind']) => {
    if (params.characterId && !isVisibleToCharacter(row, params.characterId)) return;
    if (params.audienceCharacterIds?.some((id) => !isVisibleToCharacter(row, id))) return;
    if (kind === 'event' && characterIds.length > 0 && !audienceCanMentionEvent(row as WorldEvent)) return;
    if (kind === 'memory' && characterIds.some((id) => !isVisibleToCharacter(row, id)
      || (row.visibility !== 'world' && !allowedMemoryIdsByCharacter.get(id)?.has(row.id)))) return;
    const text = kind === 'event'
      ? `${(row as WorldEvent).title}${(row as WorldEvent).summary ? `：${(row as WorldEvent).summary}` : ''}`
      : `${(row as SharedMemory).title}${(row as SharedMemory).summary ? `：${(row as SharedMemory).summary}` : ''}`;
    const score = hitCount(text, terms) * 2 + (row.importance ?? 0.5);
    if (score < 2) return;
    const ts = kind === 'event' ? (row as WorldEvent).timestamp : (row as SharedMemory).createdAt;
    hits.push({ date: formatDate(ts), timestamp: ts, text, kind, id: row.id, score });
  };

  for (const event of events) push(event, 'event');
  for (const memory of memories) push(memory, 'memory');

  return hits
    .sort((a, b) => b.score - a.score || (a.date < b.date ? 1 : -1))
    .slice(0, limit);
}

function audienceCanMentionSingle(
  event: WorldEvent,
  characterId: string,
  mentionableByCharacter: Map<string, Set<string>>,
): boolean {
  return isVisibleToCharacter(event, characterId)
    && (event.visibility === 'world' || mentionableByCharacter.get(characterId)?.has(event.id) === true);
}
