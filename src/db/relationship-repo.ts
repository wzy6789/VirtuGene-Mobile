import { db, type RelationshipEvent, type RelationshipFacet, type RelationshipState, RELATIONSHIP_FACETS } from './index';
import { characterRef, stableId, subjectPair, subjectPairKey } from '../lib/world/subjects';
import { memorySourceTombstoneRepo } from './memory-source-tombstone-repo';

/**
 * 关系仓库：**当前状态**与**变化历史**严格分开。
 *
 * - relationshipStates = A ↔ B 现在是什么关系（关系页只读这张表，禁止现场累加历史）
 * - relationshipEvents = 为什么会变成这样（可解释关系）
 *
 * 同时支持：
 * - 用户 ↔ 角色（**好感度不在这里**：唯一来源是 4.x `CharacterState.affinity`，见 R7 裁定）
 * - 角色 ↔ 角色（5.0 的核心要求：角色之间也会因为 World Stage 发生变化）
 */

/** 分面取值范围：全部 0~100（`affinity` 已从世界层移除，因此没有"无上限"这个特例了） */
function clampFacet(_facet: RelationshipFacet, value: number): number {
  return Math.max(0, Math.min(100, value));
}

export interface RelationshipEventInput {
  userId: string;
  worldId: string;
  /** 两个主体（SubjectRef）；顺序无所谓，内部会排序 */
  a: string;
  b: string;
  facets?: Partial<Record<RelationshipFacet, number>>;
  reason: string;
  sourceEventId?: string;
  sourceType: string;
  /** 幂等键：同一次来源只写一条关系变化（不传则用随机 id，允许同一来源多次变化） */
  idempotencyKey?: string;
  createdAt?: number;
}

export const relationshipRepo = {
  async getState(worldId: string, pairKeyValue: string): Promise<RelationshipState | undefined> {
    const rows = await db.relationshipStates.where('pairKey').equals(pairKeyValue).toArray();
    return rows.find((r) => r.worldId === worldId);
  },

  async getStateFor(a: string, b: string, worldId: string): Promise<RelationshipState | undefined> {
    return this.getState(worldId, subjectPairKey(a, b));
  },

  /** 建立（或取回）当前状态行；已存在则原样返回，不重置数值 */
  async ensureState(userId: string, worldId: string, a: string, b: string): Promise<RelationshipState> {
    const [subjectA, subjectB] = subjectPair(a, b);
    const pairKeyValue = subjectPairKey(a, b);
    const existing = await this.getState(worldId, pairKeyValue);
    if (existing) return existing;
    const now = Date.now();
    const state: RelationshipState = {
      id: stableId('rel', userId, worldId, pairKeyValue),
      userId,
      worldId,
      pairKey: pairKeyValue,
      subjectA,
      subjectB,
      subjects: [subjectA, subjectB],
      trust: 0,
      dependency: 0,
      conflict: 0,
      familiarity: 0,
      updatedAt: now,
    };
    await db.relationshipStates.put(state);
    return state;
  },

  /** 某个主体（用户或角色）的全部关系 */
  async listStatesForSubject(worldId: string, subject: string): Promise<RelationshipState[]> {
    const rows = await db.relationshipStates.where('subjects').equals(subject).toArray();
    return rows.filter((r) => r.worldId === worldId).sort((a, b) => b.updatedAt - a.updatedAt);
  },

  async listStatesForCharacter(worldId: string, characterId: string): Promise<RelationshipState[]> {
    return this.listStatesForSubject(worldId, characterRef(characterId));
  },

  /** 这个世界里的全部关系状态（关系网络页一次读回，按最近变化排序） */
  async listStatesByWorld(worldId: string, limit = 200, userId?: string): Promise<RelationshipState[]> {
    const rows = await db.relationshipStates.where('worldId').equals(worldId).toArray();
    return rows
      .filter((r) => userId === undefined || r.userId === userId)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, Math.max(1, limit));
  },

  /** 这个世界里的全部关系变化（关系网络页一次读回，再按 pairKey 分组；不逐对查询） */
  async listEventsByWorld(worldId: string, limit = 300, userId?: string): Promise<RelationshipEvent[]> {
    const rows = await db.relationshipEvents.where('worldId').equals(worldId).toArray();
    return rows
      .filter((r) => userId === undefined || r.userId === userId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, Math.max(1, limit));
  },

  /**
   * 直接覆盖分面数值（夹到 0~100）。
   *
   * ⚠️ R7 裁定后**推荐一律用 `applyEvent`**：关系数值的变化必须带一条可读原因，
   * 否则关系网络就解释不了"为什么会变成这样"。
   * 本方法仍然保留（迁移/修复场景需要），但**未知分面会直接抛错**——
   * 例如试图写 `affinity`（好感度）会被挡住，因为它的唯一来源是 4.x `CharacterState`。
   */
  async overrideFacets(worldId: string, pairKeyValue: string, values: Partial<Record<RelationshipFacet, number>>): Promise<RelationshipState | undefined> {
    for (const [facet, value] of Object.entries(values)) {
      if (!RELATIONSHIP_FACETS.includes(facet as RelationshipFacet)) throw new Error(`relationship:unknown_facet:${facet}`);
      if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`relationship:invalid_facet:${facet}`);
    }
    return db.transaction('rw', db.relationshipStates, async () => {
      const rows = await db.relationshipStates.where('pairKey').equals(pairKeyValue).toArray();
      const existing = rows.find((r) => r.worldId === worldId);
      if (!existing) return undefined;
      const next: RelationshipState = { ...existing, updatedAt: Date.now() };
      for (const facet of RELATIONSHIP_FACETS) {
        const value = values[facet];
        if (typeof value === 'number') next[facet] = clampFacet(facet, value);
      }
      await db.relationshipStates.put(next);
      return next;
    });
  },

  /**
   * 写入一次关系变化，并在**同一事务**里更新当前状态（验收 #10）。
   * - facets 为空对象 = 只记录"发生过这件事"，不改数值（旧数据迁移就走这条）
   * - 状态行不存在时会先建立，保证"事件 → 状态"永远成立
   * - 传 idempotencyKey 时**重复调用不会重复施加数值**（重放/重试安全）：
   *   同一来源只落一条事件、只改一次状态
   * - 校验在写库之前完成：非法输入直接抛错，事务不留下半成品
   */
  async applyEvent(input: RelationshipEventInput): Promise<{ event: RelationshipEvent; state: RelationshipState; applied: boolean }> {
    // 写前校验（在任何 put 之前抛错 ⇒ 事务回滚，状态保持不变）
    const reason = (input.reason ?? '').trim();
    if (!reason) throw new Error('relationship:reason_required');
    for (const [facet, value] of Object.entries(input.facets ?? {})) {
      if (!RELATIONSHIP_FACETS.includes(facet as RelationshipFacet)) throw new Error(`relationship:unknown_facet:${facet}`);
      if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`relationship:invalid_facet:${facet}`);
    }

    const [subjectA, subjectB] = subjectPair(input.a, input.b);
    const pairKeyValue = subjectPairKey(input.a, input.b);
    const now = Date.now();
    const eventId = input.idempotencyKey
      ? stableId('relev', input.userId, input.worldId, input.sourceType, input.idempotencyKey)
      : crypto.randomUUID();

    return db.transaction('rw', db.relationshipStates, db.relationshipEvents, async () => {
      // 1) 当前状态（不存在则先建立）
      const rows = await db.relationshipStates.where('pairKey').equals(pairKeyValue).toArray();
      let state = rows.find((r) => r.worldId === input.worldId);
      if (!state) {
        state = {
          id: stableId('rel', input.userId, input.worldId, pairKeyValue),
          userId: input.userId,
          worldId: input.worldId,
          pairKey: pairKeyValue,
          subjectA,
          subjectB,
          subjects: [subjectA, subjectB],
          trust: 0,
          dependency: 0,
          conflict: 0,
          familiarity: 0,
          updatedAt: now,
        };
      }

      const facets: Partial<Record<RelationshipFacet, number>> = {};
      for (const facet of RELATIONSHIP_FACETS) {
        const delta = input.facets?.[facet];
        if (typeof delta === 'number' && delta !== 0) facets[facet] = delta;
      }

      // 2) 幂等：同一来源已经记过 → 原样返回，不重复施加
      const existing = await db.relationshipEvents.get(eventId);
      if (existing) {
        await db.relationshipStates.put(state);
        return { event: existing, state, applied: false };
      }

      const nextState: RelationshipState = { ...state, updatedAt: now };
      for (const facet of Object.keys(facets) as RelationshipFacet[]) {
        nextState[facet] = clampFacet(facet, state[facet] + (facets[facet] ?? 0));
      }
      await db.relationshipStates.put(nextState);

      const event: RelationshipEvent = {
        id: eventId,
        userId: input.userId,
        worldId: input.worldId,
        pairKey: pairKeyValue,
        subjectA,
        subjectB,
        subjects: [subjectA, subjectB],
        facets,
        reason: reason.slice(0, 240),
        ...(input.sourceEventId ? { sourceEventId: input.sourceEventId } : {}),
        sourceType: input.sourceType,
        createdAt: input.createdAt ?? now,
      };
      await db.relationshipEvents.put(event);
      return { event, state: nextState, applied: true };
    });
  },

  /** 关系变化史（新 → 旧）：回答"为什么变成现在这样" */
  async listEvents(worldId: string, pairKeyValue: string, limit = 50): Promise<RelationshipEvent[]> {
    const rows = await db.relationshipEvents.where('pairKey').equals(pairKeyValue).toArray();
    return rows
      .filter((r) => r.worldId === worldId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  },

  async listEventsForSubject(worldId: string, subject: string, limit = 50): Promise<RelationshipEvent[]> {
    const rows = await db.relationshipEvents.where('subjects').equals(subject).toArray();
    return rows
      .filter((r) => r.worldId === worldId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  },

  async countStates(worldId: string): Promise<number> {
    return db.relationshipStates.where('worldId').equals(worldId).count();
  },

  /**
   * 读取一条关系变化（撤销一轮时要按它记录的分面增量做**反向回退**）。
   * 撤销永远不改写历史：回退完成后再把这一行删掉。
   */
  async getEvent(eventId: string): Promise<RelationshipEvent | undefined> {
    return db.relationshipEvents.get(eventId);
  },

  async removeEvent(eventId: string): Promise<void> {
    const existing = await db.relationshipEvents.get(eventId);
    if (existing) await memorySourceTombstoneRepo.record({
      userId: existing.userId,
      sourceType: 'relationshipEvent',
      sourceId: existing.id,
      sourceRevision: existing.createdAt,
      status: 'superseded',
    });
    await db.relationshipEvents.delete(eventId);
  },

  async countEvents(worldId: string): Promise<number> {
    return db.relationshipEvents.where('worldId').equals(worldId).count();
  },

  async clearForWorld(worldId: string): Promise<void> {
    await db.relationshipStates.where('worldId').equals(worldId).delete();
    await db.relationshipEvents.where('worldId').equals(worldId).delete();
  },

  async clearForUser(userId: string): Promise<void> {
    await db.relationshipStates.where('userId').equals(userId).delete();
    await db.relationshipEvents.where('userId').equals(userId).delete();
  },

  /** 角色被删除：TA 参与的关系状态与关系史一并移除（关系依附于两个人） */
  async cleanupForCharacter(worldId: string, characterId: string): Promise<{ states: number; events: number }> {
    const ref = characterRef(characterId);
    const states = (await db.relationshipStates.where('worldId').equals(worldId).toArray())
      .filter((r) => r.subjects.includes(ref));
    const events = (await db.relationshipEvents.where('worldId').equals(worldId).toArray())
      .filter((r) => r.subjects.includes(ref));
    if (states.length) await db.relationshipStates.bulkDelete(states.map((r) => r.id));
    if (events.length) await db.relationshipEvents.bulkDelete(events.map((r) => r.id));
    return { states: states.length, events: events.length };
  },
};
