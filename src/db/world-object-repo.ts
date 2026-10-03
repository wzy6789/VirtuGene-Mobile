import { db, type WorldObject, type WorldScene } from './index';

/** Legacy object records remain readable for save compatibility. Scenes never seed props. */
export const worldObjectRepo = {
  async ensureForScene(_scene: WorldScene): Promise<WorldObject[]> {
    return [];
  },

  async listForLocation(worldId: string, locationId: string, userId?: string): Promise<WorldObject[]> {
    const rows = await db.worldObjects.where('[worldId+locationId]').equals([worldId, locationId]).toArray();
    return rows
      .filter((row) => (userId === undefined || row.userId === userId) && row.state !== 'gone' && row.state !== 'held')
      .sort((a, b) => b.updatedAt - a.updatedAt);
  },

  /** 角色世界内的随身物件；旧版 held 记录默认属于当前用户。 */
  async listCarried(worldId: string, userId: string): Promise<WorldObject[]> {
    const rows = await db.worldObjects.where('worldId').equals(worldId).toArray();
    return rows
      .filter((row) => row.userId === userId && row.state === 'held' && (!row.heldBy || row.heldBy === `u:${userId}`))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  },

  async getById(id: string, userId?: string): Promise<WorldObject | undefined> {
    const row = await db.worldObjects.get(id);
    return row && (userId === undefined || row.userId === userId) ? row : undefined;
  },

  async markInteracted(id: string, userId: string, action: string): Promise<WorldObject | undefined> {
    const row = await this.getById(id, userId);
    if (!row) return undefined;
    const next: WorldObject = { ...row, lastAction: action.trim().slice(0, 160), updatedAt: Date.now() };
    await db.worldObjects.put(next);
    return next;
  },

  async applyAction(
    id: string,
    userId: string,
    action: 'inspect' | 'take' | 'leave' | 'open',
    destination?: { locationId?: string; sceneId?: string },
  ): Promise<WorldObject | undefined> {
    const row = await this.getById(id, userId);
    if (!row) return undefined;
    const labels: Record<typeof action, string> = {
      inspect: '你查看过这里',
      take: '你把它带在身上',
      leave: '你把它留在这里',
      open: '这里已经被打开',
    };
    const next: WorldObject = {
      ...row,
      state: action === 'take' ? 'held' : action === 'leave' ? 'present' : action === 'open' ? 'moved' : row.state,
      ...(action === 'take' ? { heldBy: `u:${userId}` } : action === 'leave' ? {
        heldBy: undefined,
        ...(destination?.locationId ? { locationId: destination.locationId } : {}),
        ...(destination?.sceneId ? { sceneId: destination.sceneId } : {}),
      } : {}),
      lastAction: labels[action],
      updatedAt: Date.now(),
    };
    await db.worldObjects.put(next);
    return next;
  },

  async clearForScene(sceneId: string): Promise<void> {
    const rows = await db.worldObjects.where('sceneId').equals(sceneId).toArray();
    if (rows.length) await db.worldObjects.bulkDelete(rows.map((row) => row.id));
  },

  async clearForWorld(worldId: string): Promise<void> {
    await db.worldObjects.where('worldId').equals(worldId).delete();
  },

  async clearForUser(userId: string): Promise<void> {
    await db.worldObjects.where('userId').equals(userId).delete();
  },
};
