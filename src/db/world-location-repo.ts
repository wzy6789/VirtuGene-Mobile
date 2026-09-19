import { db, type World, type WorldLocation, type WorldScene } from './index';

/** 把地点名变成稳定、可重复计算的本地 id。无需把中文编码进 url，也不会依赖随机值。 */
function shortHash(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function realityLocationId(worldId: string): string {
  return `reality:${worldId}`;
}

export function sceneLocationId(worldId: string, name: string): string {
  const normalized = name.trim().replace(/\s+/g, ' ').slice(0, 80) || '未命名地点';
  return `place:${worldId}:${shortHash(normalized)}`;
}

export const worldLocationRepo = {
  async ensureReality(world: World): Promise<WorldLocation> {
    const id = world.realityLocationId ?? realityLocationId(world.id);
    const existing = await db.worldLocations.get(id);
    if (existing) {
      if (world.realityLocationId !== id) {
        await db.worlds.update(world.id, { realityLocationId: id });
      }
      return existing;
    }
    const now = Date.now();
    const location: WorldLocation = {
      id,
      userId: world.userId,
      worldId: world.id,
      name: '我的生活',
      type: 'reality',
      description: '现实生活的锚点，所有共同世界从这里获得方向。',
      active: true,
      sourceType: 'system',
      sourceId: world.id,
      createdAt: world.createdAt,
      updatedAt: now,
    };
    await db.worldLocations.put(location);
    await db.worlds.update(world.id, { realityLocationId: id, updatedAt: now });
    return location;
  },

  async ensureFromScene(scene: WorldScene): Promise<WorldLocation> {
    // `place` is the user-facing source of truth for a move. Preserve a
    // selected custom location when its name still matches, but discard an
    // old locationId after a natural-language place change.
    const normalizedPlace = scene.place.trim().replace(/\s+/g, ' ').slice(0, 80);
    const current = scene.locationId ? await db.worldLocations.get(scene.locationId) : undefined;
    const canReuseCurrent = Boolean(
      current
      && current.userId === scene.userId
      && current.worldId === scene.worldId
      && current.type !== 'reality'
      && current.name.trim() === normalizedPlace,
    );
    const id = canReuseCurrent ? current!.id : sceneLocationId(scene.worldId, scene.place);
    const existing = await db.worldLocations.get(id);
    if (existing) {
      if (scene.locationId !== id) await db.worldScenes.update(scene.id, { locationId: id });
      return existing;
    }
    const now = Date.now();
    const location: WorldLocation = {
      id,
      userId: scene.userId,
      worldId: scene.worldId,
      name: scene.place.trim().slice(0, 80) || '未命名地点',
      type: 'place',
      active: true,
      sourceType: 'scene',
      sourceId: scene.id,
      createdAt: scene.createdAt,
      updatedAt: now,
    };
    await db.worldLocations.put(location);
    await db.worldScenes.update(scene.id, { locationId: id, updatedAt: now });
    return location;
  },

  async listForWorld(worldId: string, userId?: string): Promise<WorldLocation[]> {
    const rows = await db.worldLocations.where('worldId').equals(worldId).toArray();
    return rows
      .filter((row) => userId === undefined || row.userId === userId)
      .filter((row) => row.active)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  },

  async update(id: string, patch: Partial<Pick<WorldLocation, 'name' | 'description' | 'active'>>): Promise<void> {
    const existing = await db.worldLocations.get(id);
    if (!existing) return;
    await db.worldLocations.put({
      ...existing,
      ...patch,
      ...(patch.name !== undefined ? { name: patch.name.trim().slice(0, 80) || existing.name } : {}),
      updatedAt: Date.now(),
    });
  },

  async clearForWorld(worldId: string): Promise<void> {
    await db.worldLocations.where('worldId').equals(worldId).delete();
  },

  async clearForUser(userId: string): Promise<void> {
    await db.worldLocations.where('userId').equals(userId).delete();
  },
};
