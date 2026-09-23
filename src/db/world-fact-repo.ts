import { db, type WorldFact, type WorldFactCategory } from './index';
import { stableId } from '../lib/world/subjects';
import { memorySourceTombstoneRepo } from './memory-source-tombstone-repo';
import { isVisibleToCharacter } from '../lib/world/visibility';

/**
 * 世界事实仓库（World Facts，5.0.0 Living World §31）
 *
 * 这是"世界设定"的唯一数据源，也是世界空间里自然语言指令
 * （「这里以后一直是秋天」）的落点。
 *
 * 三条纪律：
 * 1. **自然语言优先**：`content` 就是用户看到的那句话，不做结构化表单。
 * 2. **带来源**：每条事实都知道自己从哪来（用户说的 / 结算沉淀的 / 迁移来的），
 *    因此"改一条设定"永远是改那一行，而不是同时留下两条互相冲突的 Canon（§101）。
 * 3. **可见性只走统一闸门**：private 的世界事实永远不会进入任何角色的上下文。
 */
export interface NewWorldFactInput {
  userId: string;
  worldId: string;
  category: WorldFactCategory;
  content: string;
  visibility?: WorldFact['visibility'];
  visibleTo?: string[];
  sourceType: string;
  sourceId?: string;
  priority?: number;
  active?: boolean;
  data?: Record<string, unknown>;
  createdAt?: number;
}

/** 分类的默认重要度：规则 > 地点 > 角色事实 > 氛围 > 历史 > 共识 */
const CATEGORY_PRIORITY: Record<WorldFactCategory, number> = {
  rule: 0.95,
  location: 0.8,
  character_fact: 0.75,
  atmosphere: 0.6,
  history: 0.55,
  shared_knowledge: 0.5,
  custom: 0.5,
};

export const worldFactRepo = {
  /**
   * 幂等写入：给了 sourceType + sourceId 就用确定性 id，
   * 同一来源重复写入只会**更新**同一行（改设定时旧 Canon 被替换，不会并存）。
   */
  async upsert(input: NewWorldFactInput): Promise<string> {
    const now = Date.now();
    const id = input.sourceId
      ? stableId('wfact', input.userId, input.worldId, input.sourceType, input.sourceId)
      : crypto.randomUUID();
    const existing = await db.worldFacts.get(id);
    const row: WorldFact = {
      id,
      userId: input.userId,
      worldId: input.worldId,
      category: input.category,
      content: input.content.trim().slice(0, 400),
      visibility: input.visibility ?? 'world',
      ...(input.visibleTo?.length ? { visibleTo: [...new Set(input.visibleTo)] } : {}),
      sourceType: input.sourceType,
      ...(input.sourceId ? { sourceId: input.sourceId } : {}),
      priority: input.priority ?? CATEGORY_PRIORITY[input.category] ?? 0.5,
      active: input.active ?? true,
      ...(input.data ? { data: input.data } : {}),
      createdAt: existing?.createdAt ?? input.createdAt ?? now,
      updatedAt: now,
    };
    await db.worldFacts.put(row);
    return id;
  },

  async getById(id: string): Promise<WorldFact | undefined> {
    return db.worldFacts.get(id);
  },

  async getByIds(ids: string[]): Promise<WorldFact[]> {
    if (ids.length === 0) return [];
    const rows = await db.worldFacts.bulkGet(ids);
    return rows.filter((row): row is WorldFact => !!row);
  },

  /** 世界设定页：按分类分组展示（返回全部，含已暂停的） */
  async listByWorld(worldId: string, opts: { category?: WorldFactCategory; activeOnly?: boolean; userId?: string } = {}): Promise<WorldFact[]> {
    const all = await db.worldFacts.where('worldId').equals(worldId).toArray();
    return all
      .filter((f) => opts.userId === undefined || f.userId === opts.userId)
      .filter((f) => (opts.category ? f.category === opts.category : true))
      .filter((f) => (opts.activeOnly ? f.active : true))
      .sort((a, b) => b.priority - a.priority || b.updatedAt - a.updatedAt);
  },

  /**
   * 进入**某个角色**上下文的设定：可见性硬过滤（§20 知识隔离），
   * 然后把"全局规则"排在前面（规则永远比氛围重要）。
   */
  async listForCharacter(worldId: string, characterId: string, limit = 12, userId?: string): Promise<WorldFact[]> {
    const all = await db.worldFacts.where('worldId').equals(worldId).toArray();
    return all
      .filter((f) => userId === undefined || f.userId === userId)
      .filter((f) => f.active)
      .filter((f) => isVisibleToCharacter(f, characterId))
      .sort((a, b) => b.priority - a.priority || b.updatedAt - a.updatedAt)
      .slice(0, Math.max(1, limit));
  },

  /** 与角色无关的世界级设定（旁白 / Director 用：它们知道世界全貌，但仍不看 private） */
  async listWorldLevel(worldId: string, limit = 16, userId?: string): Promise<WorldFact[]> {
    const all = await db.worldFacts.where('worldId').equals(worldId).toArray();
    return all
      .filter((f) => userId === undefined || f.userId === userId)
      .filter((f) => f.active && f.visibility === 'world')
      .sort((a, b) => b.priority - a.priority || b.updatedAt - a.updatedAt)
      .slice(0, Math.max(1, limit));
  },

  /** 某条设定当前是否生效（用户可"暂停"而不删除） */
  async setActive(id: string, active: boolean): Promise<void> {
    const existing = await db.worldFacts.get(id);
    if (!existing) return;
    await db.worldFacts.put({ ...existing, active, updatedAt: Date.now() });
  },

  async update(id: string, patch: Partial<Pick<WorldFact, 'content' | 'category' | 'visibility' | 'visibleTo' | 'priority' | 'active'>>): Promise<WorldFact | undefined> {
    const existing = await db.worldFacts.get(id);
    if (!existing) return undefined;
    const next: WorldFact = { ...existing, ...patch, updatedAt: Date.now() };
    await db.worldFacts.put(next);
    return next;
  },

  async remove(id: string): Promise<void> {
    const existing = await db.worldFacts.get(id);
    if (existing) await memorySourceTombstoneRepo.record({
      userId: existing.userId,
      sourceType: 'worldFact',
      sourceId: existing.id,
      sourceRevision: existing.updatedAt ?? existing.createdAt,
      status: 'deleted',
    });
    await db.worldFacts.delete(id);
  },

  async countByWorld(worldId: string): Promise<number> {
    return db.worldFacts.where('worldId').equals(worldId).count();
  },

  /** 同一来源的设定（结算重复写入时用来定位那一行） */
  async findBySource(userId: string, worldId: string, sourceType: string, sourceId: string): Promise<WorldFact | undefined> {
    return db.worldFacts.get(stableId('wfact', userId, worldId, sourceType, sourceId));
  },

  async clearForWorld(worldId: string): Promise<void> {
    await db.worldFacts.where('worldId').equals(worldId).delete();
  },

  async clearForUser(userId: string): Promise<void> {
    await db.worldFacts.where('userId').equals(userId).delete();
  },

  /**
   * 角色被删除：
   * - 属于该角色的「角色事实」随之消失（这条设定讲的就是 TA）
   * - 只给这个角色看的设定：摘掉 TA；摘完没人可见 ⇒ 回到 private（**绝不升级成世界可见**）
   * - 世界级规则保留——这个世界本身没变
   */
  async cleanupForCharacter(userId: string, characterId: string): Promise<number> {
    const rows = (await db.worldFacts.where('userId').equals(userId).toArray())
      .filter((f) => (f.data?.characterId === characterId) || (f.visibleTo ?? []).includes(characterId));
    let touched = 0;
    for (const row of rows) {
      if (row.category === 'character_fact' && row.data?.characterId === characterId) {
        await db.worldFacts.delete(row.id);
        touched += 1;
        continue;
      }
      const visibleTo = (row.visibleTo ?? []).filter((id) => id !== characterId);
      await db.worldFacts.put({
        ...row,
        visibleTo,
        ...(visibleTo.length === 0 && row.visibility === 'selected' ? { visibility: 'private' as const } : {}),
        updatedAt: Date.now(),
      });
      touched += 1;
    }
    return touched;
  },
};
