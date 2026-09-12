import { db, type CharacterState, type LifeEvent, type RelationMilestone, type StoryRelation } from './index';
import { RELATION_LEVELS, getRelationLevel } from '../lib/affinity';
import { syncLifeEventToWorld } from '../lib/world/world-writer';

const DEFAULT_AFFINITY = 0;
const DEFAULT_MOOD = 70;

/** 好感度无上限（只保底不为负）；心情仍限 0~100 */
const clampAffinity = (n: number) => Math.max(0, n);
const clampMood = (n: number) => Math.max(0, Math.min(100, n));

/**
 * 已到达的最高境界（由里程碑记录推导）。
 * 好感度数值可以下降，但不会跌破当前境界的门槛——关系只升温、不退阶。
 */
function peakLevelFloor(milestones: RelationMilestone[]): number {
  let idx = 0;
  for (const m of milestones ?? []) {
    const i = RELATION_LEVELS.findIndex((l) => l.name === m.level);
    if (i > idx) idx = i;
  }
  return RELATION_LEVELS[idx].min;
}

/**
 * 好感度/心情的读写必须走事务（'rw' 模式）：
 * 并发结算（每 3 条消息一次、主动消息 bump 等）若各自「读-改-写」，
 * 会互相覆盖导致丢更新；IndexedDB 对同一 store 的读写事务是串行执行的，
 * 事务内 await 保持事务存活，从而保证读到的值是最新的。
 */
export const stateRepo = {
  async get(characterId: string, userId: string): Promise<CharacterState | undefined> {
    return db.characterStates.get([characterId, userId]);
  },

  async getAllByUser(userId: string): Promise<CharacterState[]> {
    return db.characterStates.where('userId').equals(userId).toArray();
  },

  async getOrCreate(characterId: string, userId: string): Promise<CharacterState> {
    const existing = await db.characterStates.get([characterId, userId]);
    if (existing) return existing;
    const state: CharacterState = {
      characterId,
      userId,
      affinity: DEFAULT_AFFINITY,
      mood: DEFAULT_MOOD,
      milestones: [],
      updatedAt: Date.now(),
    };
    await db.characterStates.put(state);
    return state;
  },

  async adjust(characterId: string, userId: string, dAffinity: number, dMood: number): Promise<CharacterState> {
    return db.transaction('rw', db.characterStates, async () => {
      const existing = await db.characterStates.get([characterId, userId]);
      const state: CharacterState = existing ?? {
        characterId,
        userId,
        affinity: DEFAULT_AFFINITY,
        mood: DEFAULT_MOOD,
        milestones: [],
        updatedAt: Date.now(),
      };
      const next: CharacterState = {
        ...state,
        // 好感度可降，但不会跌破已到达境界的门槛；好感度无上限
        affinity: clampAffinity(Math.max(peakLevelFloor(state.milestones ?? []), state.affinity + dAffinity)),
        mood: clampMood(state.mood + dMood),
        updatedAt: Date.now(),
      };
      await db.characterStates.put(next);
      return next;
    });
  },

  /**
   * 好感度结算：dAffinity 为好感度增量，dMood 为**心情增量**（相对当前心情的波动）。
   * 心情用增量而非绝对值，避免把 bump（如主动消息未被回应导致的心情下滑）整体覆盖掉。
   * 检测等级升级并追加里程碑。
   */
  async settle(
    characterId: string,
    userId: string,
    dAffinity: number,
    dMood: number,
  ): Promise<{ state: CharacterState; upgraded: { level: string; prevLevel: string } | null }> {
    return db.transaction('rw', db.characterStates, async () => {
      const existing = await db.characterStates.get([characterId, userId]);
      const state: CharacterState = existing ?? {
        characterId,
        userId,
        affinity: DEFAULT_AFFINITY,
        mood: DEFAULT_MOOD,
        milestones: [],
        updatedAt: Date.now(),
      };
      const oldLevel = getRelationLevel(state.affinity);
      // 好感度可降，但不会跌破已到达境界的门槛；好感度无上限
      const newAffinity = clampAffinity(Math.max(peakLevelFloor(state.milestones ?? []), state.affinity + dAffinity));
      const newLevel = getRelationLevel(newAffinity);

      let milestones = state.milestones ?? [];
      let upgraded: { level: string; prevLevel: string } | null = null;
      if (newLevel.index > oldLevel.index) {
        const m: RelationMilestone = { level: newLevel.level.name, reachedAt: Date.now() };
        milestones = [...milestones, m];
        upgraded = { level: newLevel.level.name, prevLevel: oldLevel.level.name };
      }

      const next: CharacterState = {
        ...state,
        affinity: newAffinity,
        mood: clampMood(state.mood + dMood),
        milestones,
        updatedAt: Date.now(),
      };
      await db.characterStates.put(next);
      return { state: next, upgraded };
    });
  },

  /** 自定义等阶名（好感度 100+ 后用户可随便改名；key=默认等阶名 → 自定义名） */
  async renameTier(
    characterId: string,
    userId: string,
    defaultName: string,
    customName: string,
  ): Promise<CharacterState | undefined> {
    return db.transaction('rw', db.characterStates, async () => {
      const existing = await db.characterStates.get([characterId, userId]);
      if (!existing) return undefined;
      const tierNames = { ...(existing.tierNames ?? {}) };
      const trimmed = customName.trim().slice(0, 8);
      if (trimmed && trimmed !== defaultName) tierNames[defaultName] = trimmed;
      else delete tierNames[defaultName];
      const next: CharacterState = { ...existing, tierNames, updatedAt: Date.now() };
      await db.characterStates.put(next);
      return next;
    });
  },

  /**
   * 写入一条可回看的共同事件，并把它作为角色当下的关注点。
   * 事件只保留最近 24 条，避免角色生命轨迹无限膨胀。
   *
   * 5.0（Phase 2b-0）：写入成功后把"真正值得留下的事"同步进世界层
   * （关系变化 / 用户显式记住的片段 / 约定；普通互动刻意不写——见 world-writer 的说明）。
   * 同步在事务**之外**执行：世界层是派生数据，写不进去不能影响生命轨迹本身。
   */
  async recordLifeEvent(
    characterId: string,
    userId: string,
    event: Omit<LifeEvent, 'id' | 'createdAt'> & Partial<Pick<LifeEvent, 'id' | 'createdAt'>>,
  ): Promise<CharacterState> {
    const { state, lifeEvent } = await db.transaction('rw', db.characterStates, async () => {
      const existing = await db.characterStates.get([characterId, userId]);
      const current: CharacterState = existing ?? {
        characterId,
        userId,
        affinity: DEFAULT_AFFINITY,
        mood: DEFAULT_MOOD,
        milestones: [],
        updatedAt: Date.now(),
      };
      const nextEvent: LifeEvent = {
        id: event.id ?? crypto.randomUUID(),
        type: event.type,
        title: event.title.slice(0, 48),
        detail: event.detail?.slice(0, 220),
        createdAt: event.createdAt ?? Date.now(),
        // 来源必须一并保留：世界层按来源决定是否派生世界事件（漏掉它会让白名单失效）
        ...(event.source ? { source: event.source } : {}),
      };
      const lifeEvents = [...(current.lifeEvents ?? []), nextEvent]
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 24);
      const next: CharacterState = {
        ...current,
        lifeFocus: nextEvent.title,
        lifeEvents,
        updatedAt: Date.now(),
      };
      await db.characterStates.put(next);
      return { state: next, lifeEvent: nextEvent };
    });

    try {
      await syncLifeEventToWorld({ userId, characterId, lifeEvent });
    } catch (err) {
      console.warn('[world] 生命轨迹同步进世界层失败（不影响记录本身）:', err);
    }
    return state;
  },

  /**
   * 用一次事务重建一个角色的故事关系，并同步写入另一端。
   * 关系是用户主动设定的世界观，不会被群聊或普通对话自动创建。
   */
  async replaceStoryRelations(
    characterId: string,
    userId: string,
    targets: Array<{ characterId: string; label: string; description?: string }>,
  ): Promise<void> {
    await db.transaction('rw', db.characterStates, async () => {
      const all = await db.characterStates.where('userId').equals(userId).toArray();
      const byId = new Map(all.map((state) => [state.characterId, state]));
      const now = Date.now();
      const createBase = (id: string): CharacterState => ({
        characterId: id,
        userId,
        affinity: DEFAULT_AFFINITY,
        mood: DEFAULT_MOOD,
        milestones: [],
        updatedAt: now,
      });
      const source = byId.get(characterId) ?? createBase(characterId);
      byId.set(characterId, source);

      // First remove the old inverse links, leaving every unrelated relation intact.
      for (const [id, state] of byId) {
        if (id === characterId) continue;
        const nextLinks = (state.storyRelations ?? []).filter((link) => link.targetCharacterId !== characterId);
        if (nextLinks.length !== (state.storyRelations ?? []).length) {
          byId.set(id, { ...state, storyRelations: nextLinks, updatedAt: now });
        }
      }

      const unique = new Map<string, { characterId: string; label: string; description?: string }>();
      for (const target of targets) {
        if (target.characterId !== characterId) unique.set(target.characterId, target);
      }
      const oldLinks = new Map((source.storyRelations ?? []).map((link) => [link.targetCharacterId, link]));
      const sourceLinks: StoryRelation[] = [];

      for (const target of unique.values()) {
        const previous = oldLinks.get(target.characterId);
        const link: StoryRelation = {
          targetCharacterId: target.characterId,
          label: target.label.trim().slice(0, 18) || '故事关联',
          ...(target.description?.trim() ? { description: target.description.trim().slice(0, 100) } : {}),
          createdAt: previous?.createdAt ?? now,
        };
        sourceLinks.push(link);
        const targetState = byId.get(target.characterId) ?? createBase(target.characterId);
        const inverse = (targetState.storyRelations ?? []).filter((item) => item.targetCharacterId !== characterId);
        byId.set(target.characterId, {
          ...targetState,
          storyRelations: [...inverse, { ...link, targetCharacterId: characterId }],
          updatedAt: now,
        });
      }

      byId.set(characterId, { ...source, storyRelations: sourceLinks, updatedAt: now });
      await db.characterStates.bulkPut([...byId.values()]);
    });
  },

  async deleteByCharacter(characterId: string, userId: string): Promise<void> {
    await db.transaction('rw', db.characterStates, async () => {
      const all = await db.characterStates.where('userId').equals(userId).toArray();
      await db.characterStates.delete([characterId, userId]);
      const affected = all
        .filter((state) => state.characterId !== characterId && (state.storyRelations ?? []).some((link) => link.targetCharacterId === characterId))
        .map((state) => ({
          ...state,
          storyRelations: (state.storyRelations ?? []).filter((link) => link.targetCharacterId !== characterId),
          updatedAt: Date.now(),
        }));
      if (affected.length) await db.characterStates.bulkPut(affected);
    });
  },
};
