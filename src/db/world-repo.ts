import { db, type World } from './index';
import { defaultWorldId, defaultWorldName } from '../lib/world/subjects';
import { runWorldMigration, type MigrationCounts } from '../lib/world/migrate-4x';
import { worldEventRepo } from './world-event-repo';
import { worldSceneRepo } from './world-scene-repo';
import { knowledgeRepo } from './knowledge-repo';
import { sharedMemoryRepo } from './shared-memory-repo';
import { relationshipRepo } from './relationship-repo';
import { worldFactRepo } from './world-fact-repo';
import { worldTurnRepo } from './world-turn-repo';
import { worldLocationRepo } from './world-location-repo';
import { worldAgentRepo } from './world-agent-repo';
import { worldPulseRepo } from './world-pulse-repo';
import { worldObjectRepo } from './world-object-repo';

/**
 * 世界仓库（Living World 的门面）。
 *
 * 5.0.0 每名用户恰好拥有一个默认世界，用户暂时不需要在 UI 里管理多个世界；
 * 但数据层已经是"多世界就绪"的：所有世界层主表都带 worldId，
 * 将来要支持多世界 / 平行世界线 / 世界模板 / 世界导入复制时不需要整层重迁移。
 */

export interface WorldStats {
  worldId: string;
  name: string;
  /** 世界创建至今的天数（世界首页"43 天"） */
  daysSinceCreated: number;
  createdAt: number;
  eventCount: number;
  /** 各类型世界事件数量（世界首页弱化展示 / 年表筛选用） */
  eventCountByType: Record<string, number>;
  sharedMemoryCount: number;
  openContinuityCount: number;
  sceneCount: number;
  relationshipStateCount: number;
  knowledgeCount: number;
  /** 5.0.0 Living World：世界设定条数（世界首页弱化统计用） */
  worldFactCount: number;
}

/** 世界层清理结果（角色删除 / 注销账号时使用） */
export interface WorldCleanupResult {
  events: number;
  sharedMemories: number;
  knowledge: number;
  relationshipStates: number;
  relationshipEvents: number;
  scenes: number;
}

export const worldRepo = {
  async getById(id: string): Promise<World | undefined> {
    return db.worlds.get(id);
  },

  async listByUser(userId: string): Promise<World[]> {
    const all = await db.worlds.where('userId').equals(userId).toArray();
    return all.sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.createdAt - b.createdAt);
  },

  /**
   * 取回该用户的默认世界；不存在则创建（确定性 id ⇒ 并发/重复调用只会有一个世界）。
   * 5.0.0 的入口（世界页、场景、共同记忆）都应先经过这里。
   */
  async ensureDefaultWorld(userId: string, username?: string): Promise<World> {
    const id = defaultWorldId(userId);
    const existing = await db.worlds.get(id);
    if (existing) return existing;
    const now = Date.now();
    const world: World = {
      id,
      userId,
      name: defaultWorldName(username),
      createdAt: now,
      updatedAt: now,
      isDefault: true,
      clock: { worldAt: now, lastReconciledAt: now, pace: 'realtime' },
      realityLocationId: `reality:${id}`,
      lastPulseAt: now,
    };
    await db.worlds.put(world);
    return world;
  },

  /** 显式新建世界（5.0.0 没有 UI 入口；预留给多世界/世界模板） */
  async create(input: { userId: string; name: string; description?: string; theme?: string; isDefault?: boolean }): Promise<World> {
    const now = Date.now();
    const id = crypto.randomUUID();
    const world: World = {
      id,
      userId: input.userId,
      name: input.name.trim().slice(0, 60) || '未命名世界',
      createdAt: now,
      updatedAt: now,
      isDefault: input.isDefault ?? false,
      clock: { worldAt: now, lastReconciledAt: now, pace: 'realtime' },
      realityLocationId: `reality:${id}`,
      lastPulseAt: now,
      ...(input.description ? { description: input.description.slice(0, 200) } : {}),
      ...(input.theme ? { theme: input.theme.slice(0, 60) } : {}),
    };
    await db.worlds.put(world);
    return world;
  },

  async update(id: string, patch: Partial<Pick<World, 'name' | 'description' | 'theme' | 'isDefault'>>): Promise<void> {
    const existing = await db.worlds.get(id);
    if (!existing) return;
    await db.worlds.put({ ...existing, ...patch, updatedAt: Date.now() });
  },

  /** 世界首页统计（只读，不产生副作用：**不调用 getOrCreate**） */
  async stats(worldId: string): Promise<WorldStats | null> {
    const world = await db.worlds.get(worldId);
    if (!world) return null;
    const [eventCount, counts, sceneCount, sharedMemoryCount, knowledgeCount] = await Promise.all([
      worldEventRepo.countByWorld(worldId),
      worldEventRepo.countByType(worldId),
      worldSceneRepo.countByWorld(worldId),
      sharedMemoryRepo.countByWorld(worldId),
      knowledgeRepo.countByWorld(worldId),
    ]);
    const unresolved = await worldEventRepo.listUnresolved(worldId, 1000);
    return {
      worldId,
      name: world.name,
      createdAt: world.createdAt,
      daysSinceCreated: Math.max(1, Math.floor((Date.now() - world.createdAt) / 86_400_000) + 1),
      eventCount,
      eventCountByType: counts,
      sharedMemoryCount,
      openContinuityCount: unresolved.filter((e) => e.type === 'continuity').length,
      sceneCount,
      relationshipStateCount: await relationshipRepo.countStates(worldId),
      knowledgeCount,
      worldFactCount: await worldFactRepo.countByWorld(worldId),
    };
  },

  /** 清空某个世界的全部世界层数据（保留世界本身） */
  async clearWorld(worldId: string): Promise<void> {
    await db.transaction(
      'rw',
      [db.worldEvents, db.worldScenes, db.worldSceneEntries, db.characterKnowledge, db.sharedMemories, db.relationshipStates, db.relationshipEvents, db.worldFacts, db.worldTurns, db.worldLocations, db.worldPresences, db.worldAgentStates, db.worldPulses, db.worldObjects],
      async () => {
        await worldEventRepo.clearForWorld(worldId);
        await worldSceneRepo.clearForWorld(worldId);
        await knowledgeRepo.clearForWorld(worldId);
        await sharedMemoryRepo.clearForWorld(worldId);
        await relationshipRepo.clearForWorld(worldId);
        await worldFactRepo.clearForWorld(worldId);
        await worldTurnRepo.clearForWorld(worldId);
        await worldLocationRepo.clearForWorld(worldId);
        await worldAgentRepo.clearForWorld(worldId);
        await worldPulseRepo.clearForWorld(worldId);
        await worldObjectRepo.clearForWorld(worldId);
      },
    );
  },

  /**
   * 角色被删除时的世界层清理（数据完整性，不改变任何 UI 行为）：
   * - 认知与关系：随角色消失（依附于角色本身）
   * - 世界事件与共同记忆：**保留历史**，只摘掉对该角色的引用
   * - 场景：draft 删除；已发生的保留正文，摘掉该角色
   * - 日记授权：把该角色从 visibleTo 摘掉（授权给别的角色的部分保持不变）
   */
  async cleanupCharacter(userId: string, characterId: string): Promise<WorldCleanupResult> {
    const worlds = await this.listByUser(userId);
    const result: WorldCleanupResult = {
      events: 0,
      sharedMemories: 0,
      knowledge: 0,
      relationshipStates: 0,
      relationshipEvents: 0,
      scenes: 0,
    };
    for (const world of worlds) {
      result.events += await worldEventRepo.cleanupForCharacter(userId, characterId);
      result.sharedMemories += await sharedMemoryRepo.cleanupForCharacter(userId, characterId);
      result.knowledge += await knowledgeRepo.cleanupForCharacter(characterId);
      const rel = await relationshipRepo.cleanupForCharacter(world.id, characterId);
      result.relationshipStates += rel.states;
      result.relationshipEvents += rel.events;
      result.scenes += await worldSceneRepo.cleanupForCharacter(userId, characterId);
      await worldFactRepo.cleanupForCharacter(userId, characterId);
      await worldAgentRepo.removeCharacter(userId, world.id, characterId);
    }
    // 日记的逐条授权里也要摘掉这个角色（否则会留下"只告诉了已删除角色"的孤儿授权）
    const authorized = (await db.diaries.where('userId').equals(userId).toArray())
      .filter((d) => (d.visibleTo ?? []).includes(characterId));
    for (const diary of authorized) {
      const visibleTo = (diary.visibleTo ?? []).filter((id) => id !== characterId);
      await db.diaries.update(diary.id, {
        visibleTo,
        // 摘掉后没人可见 ⇒ 回到"仅自己"（不留一个半开的口子）
        ...(visibleTo.length === 0 ? { visibility: 'private' as const } : {}),
        updatedAt: Date.now(),
      });
    }
    return result;
  },

  /** 注销账号：删除该用户的世界层全部数据（含世界本身） */
  async clearForUser(userId: string): Promise<void> {
    await db.transaction(
      'rw',
      [db.worlds, db.worldEvents, db.worldScenes, db.worldSceneEntries, db.characterKnowledge, db.sharedMemories, db.relationshipStates, db.relationshipEvents, db.worldFacts, db.worldTurns, db.worldLocations, db.worldPresences, db.worldAgentStates, db.worldPulses, db.worldObjects],
      async () => {
        await worldEventRepo.clearForUser(userId);
        await worldSceneRepo.clearForUser(userId);
        await knowledgeRepo.clearForUser(userId);
        await sharedMemoryRepo.clearForUser(userId);
        await relationshipRepo.clearForUser(userId);
        await worldFactRepo.clearForUser(userId);
        await worldTurnRepo.clearForUser(userId);
        await worldLocationRepo.clearForUser(userId);
        await worldAgentRepo.clearForUser(userId);
        await worldPulseRepo.clearForUser(userId);
        await worldObjectRepo.clearForUser(userId);
        await db.worlds.where('userId').equals(userId).delete();
      },
    );
  },

  /**
   * 补偿重建：在数据库已经升到 v17 之后**再次**运行迁移。
   * 因为迁移整体幂等（确定性 id + 存在即跳过），重复执行不会产生重复行；
   * 用于"升级回调中断后补齐"或用户手动修复。
   */
  async rerunMigration(): Promise<MigrationCounts> {
    return db.transaction(
      'rw',
      [
        db.worlds,
        db.worldEvents,
        db.worldScenes,
        db.worldSceneEntries,
        db.characterKnowledge,
        db.sharedMemories,
        db.relationshipStates,
        db.relationshipEvents,
        db.characterStates,
        db.continuityThreads,
        db.sharedStoryEvents,
        db.diaries,
        db.users,
      ],
      async (tx) => runWorldMigration(tx),
    );
  },
};
