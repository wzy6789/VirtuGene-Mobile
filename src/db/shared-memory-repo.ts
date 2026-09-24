import { db, type SharedMemory, type WorldVisibility } from './index';
import { characterIdsOf, characterRef, stableId } from '../lib/world/subjects';
import { isVisibleToCharacter, isVisibleToEveryCharacter } from '../lib/world/visibility';
import { memorySourceTombstoneRepo } from './memory-source-tombstone-repo';

/**
 * 共同记忆仓库：用户与角色**真正共同经历**的重要片段。
 *
 * 与 `memories`（关于用户的长期事实，"用户喜欢猫"）严格分工：
 * 两者互不替代、互不迁移；注入 Prompt 时也是两个不同的区块。
 *
 * 可见性三态（§24）：
 * - private  只有用户
 * - selected 只有 visibleTo 里的角色知道
 * - world    世界内角色可以知道
 *
 * 注意 participants（谁经历了）与 visibleTo（谁被允许知道）是两个维度，不要混用。
 * 可见性判断统一走 `lib/world/visibility.ts`：**可见性是过滤条件，不是评分项**。
 */
export interface NewSharedMemoryInput {
  userId: string;
  worldId: string;
  title: string;
  summary: string;
  /** SubjectRef 列表 */
  participants: string[];
  sourceType: string;
  sourceId: string;
  importance?: number;
  visibility?: WorldVisibility;
  visibleTo?: string[];
  relatedCharacters?: string[];
  relatedRelationships?: string[];
  emotion?: string;
  tags?: string[];
  createdAt?: number;
}

function clamp01(n: number | undefined): number {
  if (typeof n !== 'number' || Number.isNaN(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}

/**
 * 这段记忆对该角色是否可见。
 * 实现统一收敛在 `lib/world/visibility.ts`（隐私边界只有一份实现，避免各处走样）。
 */
function isVisibleTo(memory: SharedMemory, characterId: string): boolean {
  return isVisibleToCharacter(memory, characterId);
}

export const sharedMemoryRepo = {
  /** 幂等写入（同一来源只产生一条；重复调用返回原 id） */
  async create(input: NewSharedMemoryInput): Promise<string> {
    const id = stableId('smem', input.userId, input.worldId, input.sourceType, input.sourceId);
    const existing = await db.sharedMemories.get(id);
    if (existing) return id;
    const now = Date.now();
    const participants = [...new Set(input.participants)];
    const memory: SharedMemory = {
      id,
      userId: input.userId,
      worldId: input.worldId,
      title: input.title.trim().slice(0, 120),
      summary: input.summary.trim().slice(0, 600),
      participants,
      characterIds: characterIdsOf(participants),
      createdAt: input.createdAt ?? now,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      importance: clamp01(input.importance),
      visibility: input.visibility ?? 'private',
      ...(input.visibleTo?.length ? { visibleTo: [...new Set(input.visibleTo)] } : {}),
      relatedCharacters: input.relatedCharacters ?? characterIdsOf(participants),
      relatedRelationships: input.relatedRelationships ?? [],
      ...(input.emotion ? { emotion: input.emotion } : {}),
      tags: input.tags ?? [],
      updatedAt: now,
    };
    await db.sharedMemories.put(memory);
    return id;
  },

  async getById(id: string): Promise<SharedMemory | undefined> {
    return db.sharedMemories.get(id);
  },

  /**
   * 按来源查（同一来源只可能有一条：id 由 userId+worldId+sourceType+sourceId 确定性生成）。
   * 用于"这条消息是否已经被收藏成共同记忆"。
   */
  async getBySource(userId: string, worldId: string, sourceType: string, sourceId: string): Promise<SharedMemory | undefined> {
    return db.sharedMemories.get(stableId('smem', userId, worldId, sourceType, sourceId));
  },

  /** 某一类来源里已经被收藏的 sourceId 列表（聊天页据此显示"已收藏"态；一次查询，不逐条查） */
  async listSourceIds(userId: string, worldId: string, sourceType: string): Promise<string[]> {
    const all = await db.sharedMemories.where('worldId').equals(worldId).toArray();
    return all
      .filter((m) => m.userId === userId && m.sourceType === sourceType)
      .map((m) => m.sourceId);
  },

  async getByIds(ids: string[]): Promise<SharedMemory[]> {
    if (ids.length === 0) return [];
    const items = await db.sharedMemories.bulkGet(ids);
    return items.filter((item): item is SharedMemory => !!item);
  },

  async listByWorld(worldId: string, limit = 100, userId?: string): Promise<SharedMemory[]> {
    const all = await db.sharedMemories.where('worldId').equals(worldId).toArray();
    return all
      .filter((m) => userId === undefined || m.userId === userId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  },

  /**
   * 某个角色**被允许知道**的共同记忆（验收 #12：selected 必须靠 visibleTo 正确限制）。
   * private 的记忆永远不返回给任何角色。
   */
  async listVisibleFor(characterId: string, worldId: string, limit = 50): Promise<SharedMemory[]> {
    const all = await db.sharedMemories.where('worldId').equals(worldId).toArray();
    return all
      .filter((m) => isVisibleTo(m, characterId))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  },

  /**
   * 与某些角色**真正共同经历**的记忆（不看可见性，看参与者）。
   *
   * ⚠️ 这是"叙事关系"视角（谁和谁一起经历过），**不是**"谁被允许知道"。
   * 需要给角色注入上下文时请用 `listRelevant` / `listVisibleFor`（它们过可见性闸门），
   * 不要把本函数的结果直接送进 Prompt。
   */
  async listExperiencedWith(characterId: string, worldId: string, limit = 50, userId?: string): Promise<SharedMemory[]> {
    const all = await db.sharedMemories.where('worldId').equals(worldId).toArray();
    const ref = characterRef(characterId);
    return all
      .filter((m) => userId === undefined || m.userId === userId)
      .filter((m) => m.participants.includes(ref))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  },

  /**
   * §39 Relevant Memory：按参与角色 + 重要度 + 新鲜度挑（不是"全部记忆"）。
   *
   * **隐私契约（2b-2 审核修复）**：返回的每一条都**保证对传入的每个角色都可见**。
   * 可见性是**过滤条件**，不是排序加分项——之前把它算进 score 会导致
   * "对这个角色不可见"的记忆照样被召回（一旦上下文编译器使用就会泄漏给角色）。
   * 另外 `characterIds` 为空时返回空数组（`every` 对空数组恒真，不能当闸门）。
   */
  async listRelevant(worldId: string, characterIds: string[], limit = 6, userId?: string): Promise<SharedMemory[]> {
    const empty: SharedMemory[] = [];
    if (characterIds.length === 0) return empty;
    const all = await db.sharedMemories.where('worldId').equals(worldId).toArray();
    const now = Date.now();
    return all
      // ① 先过隐私闸门：不在场/不被允许知道的，直接不参与排序
      .filter((m) => userId === undefined || m.userId === userId)
      .filter((m) => isVisibleToEveryCharacter(m, characterIds))
      // ② 再按"和在场角色的相关度 + 重要度 + 新鲜度"排序
      .map((m) => {
        const overlap = characterIds.filter((id) => m.characterIds.includes(id)).length;
        const ageDays = Math.max(0, (now - m.createdAt) / 86_400_000);
        const recency = Math.max(0, 1 - ageDays / 180);
        return { m, score: overlap * 2 + m.importance * 3 + recency };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(1, limit))
      .map((item) => item.m);
  },

  async listByImportance(worldId: string, limit = 20): Promise<SharedMemory[]> {
    const all = await db.sharedMemories.where('worldId').equals(worldId).toArray();
    return all.sort((a, b) => b.importance - a.importance || b.createdAt - a.createdAt).slice(0, limit);
  },

  async countByWorld(worldId: string): Promise<number> {
    return db.sharedMemories.where('worldId').equals(worldId).count();
  },

  async update(
    id: string,
    patch: Partial<Pick<SharedMemory, 'title' | 'summary' | 'importance' | 'visibility' | 'visibleTo' | 'tags' | 'emotion' | 'relatedRelationships'>>,
  ): Promise<void> {
    const existing = await db.sharedMemories.get(id);
    if (!existing) return;
    const changedKnowledge = ['title', 'summary', 'visibility', 'visibleTo'].some((key) => key in patch && patch[key as keyof typeof patch] !== existing[key as keyof SharedMemory]);
    await db.transaction('rw', [db.sharedMemories, db.memorySourceTombstones], async () => {
      if (changedKnowledge) await memorySourceTombstoneRepo.record({
        userId: existing.userId,
        sourceType: 'sharedMemory',
        sourceId: existing.id,
        sourceRevision: existing.updatedAt,
        status: 'superseded',
      });
      await db.sharedMemories.put({ ...existing, ...patch, updatedAt: Math.max(Date.now(), existing.updatedAt + 1) });
    });
  },

  async remove(id: string): Promise<void> {
    const existing = await db.sharedMemories.get(id);
    if (existing) await memorySourceTombstoneRepo.record({
      userId: existing.userId,
      sourceType: 'sharedMemory',
      sourceId: existing.id,
      sourceRevision: existing.updatedAt ?? existing.createdAt,
      status: 'superseded',
    });
    await db.sharedMemories.delete(id);
  },

  async clearForWorld(worldId: string): Promise<void> {
    await db.transaction('rw', [db.sharedMemories, db.memorySourceTombstones], async () => {
      const rows = await db.sharedMemories.where('worldId').equals(worldId).toArray();
      for (const row of rows) await memorySourceTombstoneRepo.record({ userId: row.userId, sourceType: 'sharedMemory', sourceId: row.id, sourceRevision: row.updatedAt, status: 'deleted' });
      await db.sharedMemories.where('worldId').equals(worldId).delete();
    });
  },

  async clearForUser(userId: string): Promise<void> {
    await db.transaction('rw', [db.sharedMemories, db.memorySourceTombstones], async () => {
      const rows = await db.sharedMemories.where('userId').equals(userId).toArray();
      for (const row of rows) await memorySourceTombstoneRepo.record({ userId, sourceType: 'sharedMemory', sourceId: row.id, sourceRevision: row.updatedAt, status: 'deleted' });
      await db.sharedMemories.where('userId').equals(userId).delete();
    });
  },

  /** 角色被删除：保留这段记忆（事情真的发生过），只把 TA 从参与者与可见名单里摘掉 */
  async cleanupForCharacter(userId: string, characterId: string): Promise<number> {
    const ref = characterRef(characterId);
    const rows = (await db.sharedMemories.where('userId').equals(userId).toArray())
      .filter((m) => m.participants.includes(ref) || m.characterIds.includes(characterId) || (m.visibleTo ?? []).includes(characterId));
    const next = rows.map((m) => {
      const participants = m.participants.filter((p) => p !== ref);
      return {
        ...m,
        participants,
        characterIds: characterIdsOf(participants),
        relatedCharacters: m.relatedCharacters.filter((id) => id !== characterId),
        ...(m.visibleTo ? { visibleTo: m.visibleTo.filter((id) => id !== characterId) } : {}),
        updatedAt: Date.now(),
      };
    });
    if (next.length) await db.sharedMemories.bulkPut(next);
    return next.length;
  },
};
