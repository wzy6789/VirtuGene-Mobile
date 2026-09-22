import { db, type World, type WorldAgentState, type WorldClock, type WorldLocation, type WorldPresence, type WorldScene } from '../../db';
import { presenceId, worldAgentRepo } from '../../db/world-agent-repo';
import { worldLocationRepo } from '../../db/world-location-repo';
import { worldSceneRepo } from '../../db/world-scene-repo';

/** 世界内核快照：UI 和后续自主行动只读这份统一状态，不直接拼装多个页面的数据。 */
export interface WorldKernelSnapshot {
  world: World;
  clock: WorldClock;
  currentWorldTime: number;
  reality: WorldLocation;
  locations: WorldLocation[];
  presences: WorldPresence[];
  agents: WorldAgentState[];
  activeScenes: WorldScene[];
}

/** 逻辑时钟只在读取时向前推算；真正写入由 world-pulse 阶段完成。 */
export function currentWorldTime(clock: WorldClock, now = Date.now()): number {
  return clock.worldAt + Math.max(0, now - clock.lastReconciledAt);
}

function initialClock(world: World, now = Date.now()): WorldClock {
  return world.clock ?? { worldAt: world.createdAt, lastReconciledAt: now, pace: 'realtime' };
}

/**
 * 补齐并同步世界内核基础状态。
 *
 * 这一步是幂等的：旧片段只会被投影成地点与当前位置，不会写入新的世界事件，
 * 因而打开世界页面不会悄悄制造情节，也不会触发模型调用。
 */
export async function ensureWorldKernel(params: {
  userId: string;
  worldId: string;
  characterIds?: string[];
  now?: number;
}): Promise<WorldKernelSnapshot> {
  const world = await db.worlds.get(params.worldId);
  if (!world || world.userId !== params.userId) throw new Error('world:not-found');
  const now = params.now ?? Date.now();
  const clock = initialClock(world, now);

  if (!world.clock || world.realityLocationId === undefined) {
    await db.worlds.put({
      ...world,
      clock,
      realityLocationId: world.realityLocationId ?? `reality:${world.id}`,
      updatedAt: world.updatedAt,
    });
  }

  const reality = await worldLocationRepo.ensureReality({ ...world, clock, realityLocationId: world.realityLocationId ?? `reality:${world.id}` });
  const activeScenes = await worldSceneRepo.listScenes(params.worldId, { status: 'active', limit: 500, userId: params.userId });
  const assigned = new Set<string>();
  for (const scene of activeScenes) {
    const location = await worldLocationRepo.ensureFromScene(scene);
    const latestScene = (await worldSceneRepo.getScene(scene.id)) ?? scene;
    if (latestScene.locationId !== location.id || latestScene.startedWorldTime === undefined) {
      await db.worldScenes.update(scene.id, {
        locationId: location.id,
        ...(latestScene.startedWorldTime === undefined ? { startedWorldTime: clock.worldAt } : {}),
        updatedAt: now,
      });
    }
    for (const characterId of scene.characterIds) {
      // 历史数据可能有重复的 active 场景；最新场景优先，旧行不会把角色瞬移回去。
      if (assigned.has(characterId)) continue;
      assigned.add(characterId);
      await worldAgentRepo.moveCharacter({
        userId: params.userId,
        worldId: params.worldId,
        characterId,
        locationId: location.id,
        worldTime: clock.worldAt,
      });
    }
  }

  const characterIds = [...new Set(params.characterIds ?? activeScenes.flatMap((scene) => scene.characterIds))];
  await worldAgentRepo.ensureStates(params.userId, params.worldId, characterIds);
  // 没有进入具体星域场景的角色仍属于这个世界。把他们放在现实锚点，避免“有角色但没有位置”的幽灵状态。
  for (const characterId of characterIds) {
    const presence = await db.worldPresences.get(presenceId(params.worldId, characterId));
    if (!presence || presence.userId !== params.userId) {
      await worldAgentRepo.moveCharacter({
        userId: params.userId,
        worldId: params.worldId,
        characterId,
        locationId: reality.id,
        worldTime: clock.worldAt,
        status: 'present',
        note: '尚未进入具体星域场景',
      });
    }
  }
  const [locations, presences, agents] = await Promise.all([
    worldLocationRepo.listForWorld(params.worldId, params.userId),
    worldAgentRepo.listPresences(params.worldId, params.userId),
    worldAgentRepo.listStates(params.worldId, params.userId),
  ]);
  return {
    world: { ...world, clock, realityLocationId: reality.id },
    clock,
    currentWorldTime: currentWorldTime(clock, now),
    reality,
    locations,
    presences,
    agents,
    activeScenes,
  };
}
