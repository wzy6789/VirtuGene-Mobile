import { db, type CharacterState, type RelationMilestone } from './index';
import { RELATION_LEVELS, getRelationLevel } from '../lib/affinity';

const DEFAULT_AFFINITY = 0;
const DEFAULT_MOOD = 70;

const clamp = (n: number) => Math.max(0, Math.min(100, n));

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
        // 好感度可降，但不会跌破已到达境界的门槛
        affinity: clamp(Math.max(peakLevelFloor(state.milestones ?? []), state.affinity + dAffinity)),
        mood: clamp(state.mood + dMood),
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
      // 好感度可降，但不会跌破已到达境界的门槛
      const newAffinity = clamp(Math.max(peakLevelFloor(state.milestones ?? []), state.affinity + dAffinity));
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
        mood: clamp(state.mood + dMood),
        milestones,
        updatedAt: Date.now(),
      };
      await db.characterStates.put(next);
      return { state: next, upgraded };
    });
  },

  async deleteByCharacter(characterId: string, userId: string): Promise<void> {
    await db.characterStates.delete([characterId, userId]);
  },
};
