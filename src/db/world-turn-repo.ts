import { db, type WorldTurn, type WorldTurnStatus } from './index';
import type { WorldAction } from '../lib/world/world-actions';
import { memorySourceTombstoneRepo } from './memory-source-tombstone-repo';

/**
 * 世界轮次仓库（World Turn，5.0.0 Living World §52 / §53 / §58）
 *
 * 一次用户输入 = 一行，先落库再谈生成。
 * 这条纪律的意义只有一个：**用户永远不会因为 API 失败丢掉自己刚才做的事。**
 * 失败时 status='failed'，用户原话与已经产生的正文都还在，重试复用同一行。
 */
export interface NewWorldTurnInput {
  userId: string;
  worldId: string;
  sceneId: string;
  input: string;
  origin: WorldTurn['origin'];
  characterIds: string[];
  before?: WorldTurn['before'];
}

export const worldTurnRepo = {
  async create(input: NewWorldTurnInput): Promise<WorldTurn> {
    const now = Date.now();
    const row: WorldTurn = {
      id: crypto.randomUUID(),
      userId: input.userId,
      worldId: input.worldId,
      sceneId: input.sceneId,
      input: input.input.slice(0, 1200),
      origin: input.origin,
      status: 'pending',
      entryIds: [],
      settledEventIds: [],
      settledMemoryIds: [],
      settledRelationshipEventIds: [],
      settledThreadIds: [],
      settledFactIds: [],
      deactivatedFactIds: [],
      settledLifeEventIds: [],
      stateDeltas: [],
      characterIds: [...new Set(input.characterIds)],
      ...(input.before ? { before: input.before } : {}),
      settled: false,
      llmCalls: 0,
      retries: 0,
      createdAt: now,
      updatedAt: now,
    };
    await db.worldTurns.put(row);
    return row;
  },

  async getById(id: string): Promise<WorldTurn | undefined> {
    return db.worldTurns.get(id);
  },

  /** 最近若干轮（新 → 旧）：Undo 取第一条未撤销的、报告取计数 */
  async listRecent(worldId: string, limit = 20): Promise<WorldTurn[]> {
    const all = await db.worldTurns.where('worldId').equals(worldId).toArray();
    return all.sort((a, b) => b.createdAt - a.createdAt).slice(0, Math.max(1, limit));
  },

  /** 可以撤销的那一轮：最近一次真正完成过（或失败但已写过正文）的轮次 */
  async lastUndoable(worldId: string): Promise<WorldTurn | undefined> {
    const recent = await this.listRecent(worldId, 40);
    return recent.find((t) => t.status === 'completed' || t.status === 'failed' || t.status === 'settling' || t.status === 'responding');
  },

  /** 最近一次**已经结算完成**的轮次（下一轮读取状态时的安全边界，§58） */
  async lastSettled(worldId: string): Promise<WorldTurn | undefined> {
    const recent = await this.listRecent(worldId, 40);
    return recent.find((t) => t.status === 'completed' && t.settled);
  },

  async setStatus(id: string, status: WorldTurnStatus, patch: Partial<WorldTurn> = {}): Promise<void> {
    const existing = await db.worldTurns.get(id);
    if (!existing) return;
    await db.worldTurns.put({ ...existing, ...patch, status, updatedAt: Date.now() });
  },

  async patch(id: string, patch: Partial<WorldTurn>): Promise<void> {
    const existing = await db.worldTurns.get(id);
    if (!existing) return;
    await db.worldTurns.put({ ...existing, ...patch, updatedAt: Date.now() });
  },

  async setAction(id: string, action: WorldAction): Promise<void> {
    await this.patch(id, { action });
  },

  /** 追加本轮产生的正文 id（顺序即产生顺序，撤销时按序回收） */
  async addEntryIds(id: string, entryIds: string[]): Promise<void> {
    if (entryIds.length === 0) return;
    const existing = await db.worldTurns.get(id);
    if (!existing) return;
    // 去重：用户输入那条在创建时就记过一次，这里再补一次不能变成"回收两条"
    const merged = [...new Set([...existing.entryIds, ...entryIds])];
    await db.worldTurns.put({ ...existing, entryIds: merged, updatedAt: Date.now() });
  },

  /** 记录本轮写入/停用的世界设定（撤销时分别删除 / 恢复） */
  async addFactIds(id: string, factIds: string[], kind: 'created' | 'deactivated'): Promise<void> {
    if (factIds.length === 0) return;
    const existing = await db.worldTurns.get(id);
    if (!existing) return;
    const field = kind === 'created' ? 'settledFactIds' : 'deactivatedFactIds';
    await db.worldTurns.put({
      ...existing,
      [field]: [...new Set([...(existing[field] ?? []), ...factIds])],
      updatedAt: Date.now(),
    });
  },

  /** 记录本轮 AI 调用次数（成本可核对：验收直接断言） */
  async addCalls(id: string, calls: number): Promise<void> {
    if (calls <= 0) return;
    const existing = await db.worldTurns.get(id);
    if (!existing) return;
    await db.worldTurns.put({ ...existing, llmCalls: existing.llmCalls + calls, updatedAt: Date.now() });
  },

  async markFailed(id: string, stage: WorldTurnStatus, message: string): Promise<void> {
    const existing = await db.worldTurns.get(id);
    if (!existing) return;
    await db.worldTurns.put({
      ...existing,
      status: 'failed',
      failure: { stage, message },
      updatedAt: Date.now(),
    });
  },

  /** 重试：**只加计数，绝不新增用户输入**（§53） */
  async markRetrying(id: string): Promise<WorldTurn | undefined> {
    const existing = await db.worldTurns.get(id);
    if (!existing) return undefined;
    const next: WorldTurn = {
      ...existing,
      status: 'pending',
      retries: existing.retries + 1,
      updatedAt: Date.now(),
    };
    delete next.failure;
    await db.worldTurns.put(next);
    return next;
  },

  async markUndone(id: string): Promise<void> {
    const existing = await db.worldTurns.get(id);
    if (!existing) return;
    const next: WorldTurn = {
      ...existing,
      status: 'undone',
      entryIds: [],
      settledEventIds: [],
      settledMemoryIds: [],
      settledRelationshipEventIds: [],
      settledThreadIds: [],
      settledFactIds: [],
      deactivatedFactIds: [],
      settledLifeEventIds: [],
      stateDeltas: [],
      settled: true,
      updatedAt: Date.now(),
    };
    delete next.failure;
    await db.transaction('rw', [db.worldTurns, db.memorySourceTombstones], async () => {
      await memorySourceTombstoneRepo.record({ userId: existing.userId, sourceType: 'worldTurn', sourceId: id, sourceRevision: existing.updatedAt, status: 'superseded' });
      await db.worldTurns.put(next);
    });
  },

  async countByWorld(worldId: string): Promise<number> {
    return db.worldTurns.where('worldId').equals(worldId).count();
  },

  async clearForWorld(worldId: string): Promise<void> {
    await db.worldTurns.where('worldId').equals(worldId).delete();
  },

  async clearForUser(userId: string): Promise<void> {
    await db.worldTurns.where('userId').equals(userId).delete();
  },

  /** 角色被删除：轮次记录保留（它记录的是"当时发生了什么"，历史不能因为删角色被改写） */
  async cleanupForCharacter(): Promise<number> {
    return 0;
  },
};
