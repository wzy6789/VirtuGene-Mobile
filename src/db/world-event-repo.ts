import { db, type WorldEvent, type WorldEventType, type WorldVisibility } from './index';
import { characterRef, derivedWorldEventId } from '../lib/world/subjects';
import { isVisibleToCharacter } from '../lib/world/visibility';

/**
 * 世界事件仓库（年表 / 最近发生 / Life Trace 的唯一数据源）。
 *
 * 约定：
 * - 提供 sourceType + sourceId 时使用**确定性 id**（userId+worldId+sourceType+sourceId），
 *   同一来源重复写入只会覆盖同一行 ⇒ 幂等；不提供时用随机 id。
 * - 一切查询都带 worldId（验收 #8：World 之间不能串数据）。
 */
export interface NewWorldEventInput {
  userId: string;
  worldId: string;
  type: WorldEventType;
  title: string;
  summary?: string;
  /** SubjectRef 列表（'u:<userId>' / 'c:<characterId>'） */
  participants: string[];
  timestamp?: number;
  importance?: number;
  sourceType: string;
  sourceId: string;
  locationId?: string;
  worldTime?: number;
  causeEventIds?: string[];
  visibility?: WorldVisibility;
  visibleTo?: string[];
  resolved?: boolean;
  relatedEventIds?: string[];
  memoryIds?: string[];
  tags?: string[];
  emotion?: string;
  meta?: Record<string, unknown>;
}

function clampImportance(n: number | undefined): number {
  if (typeof n !== 'number' || Number.isNaN(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}

export const worldEventRepo = {
  async create(input: NewWorldEventInput): Promise<string> {
    const now = Date.now();
    const id = derivedWorldEventId(input.userId, input.worldId, input.sourceType, input.sourceId);
    const event: WorldEvent = {
      id,
      userId: input.userId,
      worldId: input.worldId,
      type: input.type,
      title: input.title.trim().slice(0, 120),
      summary: (input.summary ?? '').trim().slice(0, 600),
      participants: [...new Set(input.participants)],
      timestamp: input.timestamp ?? now,
      importance: clampImportance(input.importance),
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      ...(input.locationId ? { locationId: input.locationId } : {}),
      ...(input.worldTime !== undefined ? { worldTime: input.worldTime } : {}),
      ...(input.causeEventIds?.length ? { causeEventIds: [...new Set(input.causeEventIds)] } : {}),
      visibility: input.visibility ?? 'private',
      ...(input.visibleTo?.length ? { visibleTo: [...new Set(input.visibleTo)] } : {}),
      resolved: input.resolved ?? true,
      relatedEventIds: input.relatedEventIds ?? [],
      memoryIds: input.memoryIds ?? [],
      tags: input.tags ?? [],
      ...(input.emotion ? { emotion: input.emotion } : {}),
      ...(input.meta ? { meta: input.meta } : {}),
      createdAt: now,
      updatedAt: now,
    };
    await db.worldEvents.put(event);
    return id;
  },

  /** 幂等写入：已存在同一来源的事件则返回原 id，不覆盖（保护运行期的新数据） */
  async createIfAbsent(input: NewWorldEventInput): Promise<{ id: string; created: boolean }> {
    const id = derivedWorldEventId(input.userId, input.worldId, input.sourceType, input.sourceId);
    const existing = await db.worldEvents.get(id);
    if (existing) return { id, created: false };
    await this.create(input);
    return { id, created: true };
  },

  /**
   * 按来源查（id 由 userId+worldId+sourceType+sourceId 确定性生成 ⇒ 一次 get 即可）。
   * 用于"这件事是不是已经写进世界层了"这类判断，**不产生任何写入**。
   */
  async getBySource(userId: string, worldId: string, sourceType: string, sourceId: string): Promise<WorldEvent | undefined> {
    return db.worldEvents.get(derivedWorldEventId(userId, worldId, sourceType, sourceId));
  },

  async getById(id: string): Promise<WorldEvent | undefined> {
    return db.worldEvents.get(id);
  },

  async getByIds(ids: string[]): Promise<WorldEvent[]> {
    if (ids.length === 0) return [];
    const items = await db.worldEvents.bulkGet(ids);
    return items.filter((item): item is WorldEvent => !!item);
  },

  /** 年表：新 → 旧，可按时间游标翻页、按类型过滤 */
  async listTimeline(
    worldId: string,
    opts: { limit?: number; before?: number; types?: WorldEventType[]; userId?: string } = {},
  ): Promise<WorldEvent[]> {
    const limit = Math.max(1, opts.limit ?? 50);
    const all = await db.worldEvents.where('worldId').equals(worldId).toArray();
    return all
      .filter((e) => (opts.userId === undefined || e.userId === opts.userId))
      .filter((e) => (opts.types?.length ? opts.types.includes(e.type) : true))
      .filter((e) => (opts.before != null ? e.timestamp < opts.before : true))
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  },

  async getRecent(worldId: string, limit = 5, userId?: string): Promise<WorldEvent[]> {
    return this.listTimeline(worldId, { limit, userId });
  },

  /** 按来源类型读取世界事件（例如只看用户离开时发生的自主行动）。 */
  async listBySourceType(worldId: string, sourceType: string, limit = 50, userId?: string): Promise<WorldEvent[]> {
    const rows = await db.worldEvents.where('worldId').equals(worldId).toArray();
    return rows
      .filter((event) => event.sourceType === sourceType)
      .filter((event) => userId === undefined || event.userId === userId)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, Math.max(1, limit));
  },

  /** 还没解决的事（世界首页「未完成的故事」） */
  async listUnresolved(worldId: string, limit = 20): Promise<WorldEvent[]> {
    const all = await db.worldEvents.where('worldId').equals(worldId).toArray();
    return all
      .filter((e) => !e.resolved)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  },

  async listByType(worldId: string, type: WorldEventType, limit = 50): Promise<WorldEvent[]> {
    return this.listTimeline(worldId, { limit, types: [type] });
  },

  /** 与某个角色相关的世界事件（TA 是参与者） */
  async listForCharacter(worldId: string, characterId: string, limit = 50): Promise<WorldEvent[]> {
    const ref = characterRef(characterId);
    const all = await db.worldEvents.where('worldId').equals(worldId).toArray();
    return all
      .filter((e) => e.participants.includes(ref))
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  },

  /** 某个角色被允许知道的世界事件（visibility 三态；供认知边界与记忆召回使用） */
  async listVisibleToCharacter(worldId: string, characterId: string, limit = 50, userId?: string): Promise<WorldEvent[]> {
    const all = await db.worldEvents.where('worldId').equals(worldId).toArray();
    return all
      // 可见性闸门只有一份实现（lib/world/visibility.ts）：private 一律不返回
      .filter((e) => userId === undefined || e.userId === userId)
      .filter((e) => isVisibleToCharacter(e, characterId))
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  },

  async countByWorld(worldId: string): Promise<number> {
    return db.worldEvents.where('worldId').equals(worldId).count();
  },

  async countByType(worldId: string): Promise<Record<string, number>> {
    const all = await db.worldEvents.where('worldId').equals(worldId).toArray();
    const out: Record<string, number> = {};
    for (const e of all) out[e.type] = (out[e.type] ?? 0) + 1;
    return out;
  },

  async update(
    id: string,
    patch: Partial<Pick<WorldEvent, 'title' | 'summary' | 'importance' | 'visibility' | 'visibleTo' | 'resolved' | 'relatedEventIds' | 'memoryIds' | 'tags' | 'emotion' | 'meta'>>,
  ): Promise<void> {
    const existing = await db.worldEvents.get(id);
    if (!existing) return;
    await db.worldEvents.put({ ...existing, ...patch, updatedAt: Date.now() });
  },

  async remove(id: string): Promise<void> {
    await db.worldEvents.delete(id);
  },

  async clearForWorld(worldId: string): Promise<void> {
    await db.worldEvents.where('worldId').equals(worldId).delete();
  },

  async clearForUser(userId: string): Promise<void> {
    await db.worldEvents.where('userId').equals(userId).delete();
  },

  /**
   * 角色被删除时：**保留历史**，只把该角色从参与者和可见名单里摘掉。
   * 世界仍然记得"那件事发生过"，但不会再指向一个不存在的角色。
   */
  async cleanupForCharacter(userId: string, characterId: string): Promise<number> {
    const ref = characterRef(characterId);
    const rows = (await db.worldEvents.where('userId').equals(userId).toArray())
      .filter((e) => e.participants.includes(ref) || (e.visibleTo ?? []).includes(characterId));
    const next = rows.map((e) => ({
      ...e,
      participants: e.participants.filter((p) => p !== ref),
      ...(e.visibleTo ? { visibleTo: e.visibleTo.filter((id) => id !== characterId) } : {}),
      updatedAt: Date.now(),
    }));
    if (next.length) await db.worldEvents.bulkPut(next);
    return next.length;
  },
};
