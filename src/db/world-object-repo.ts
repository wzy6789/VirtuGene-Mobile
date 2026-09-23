import { db, type WorldObject, type WorldScene } from './index';

function objectId(sceneId: string, locationId: string, key: string): string {
  return `object:${sceneId}:${locationId}:${key}`;
}

const DEFAULT_OBJECTS: Array<Pick<WorldObject, 'name' | 'description' | 'kind'>> = [
  { name: '窗边的光', description: '光线落在这里，像是有人刚刚离开。', kind: 'prop' },
  { name: '留在桌面的字条', description: '纸面上有一行还没有被读完的话。', kind: 'note' },
  { name: '没有关上的门', description: '门后通向这处地点更深的地方。', kind: 'door' },
];

function objectsForScene(scene: WorldScene): Array<Pick<WorldObject, 'name' | 'description' | 'kind'>> {
  const place = `${scene.place} ${scene.theme ?? ''}`.toLowerCase();
  if (/森林|雨|海|湖|山|庭院|夜/.test(place)) {
    return [
      { name: '潮湿的石阶', description: '水珠沿着石阶边缘慢慢往下落。', kind: 'prop' },
      { name: '被雨打湿的纸页', description: '字迹有些模糊，却还看得出有人写过。', kind: 'note' },
      { name: '通往更深处的小路', description: '树影后面还有一段没有走完的路。', kind: 'door' },
    ];
  }
  if (/车站|码头|街|广场|城市/.test(place)) {
    return [
      { name: '还亮着的指示灯', description: '灯光一闪一闪，指向一个安静的方向。', kind: 'device' },
      { name: '无人取走的票根', description: '背面写着一个没有兑现的时间。', kind: 'note' },
      { name: '通向下一站的入口', description: '那里传来不属于这里的声音。', kind: 'door' },
    ];
  }
  return DEFAULT_OBJECTS;
}

export const worldObjectRepo = {
  async ensureForScene(scene: WorldScene): Promise<WorldObject[]> {
    if (!scene.locationId) return [];
    const existing = await db.worldObjects.where('[worldId+locationId]').equals([scene.worldId, scene.locationId]).toArray();
    const sceneObjects = existing.filter((item) => item.sceneId === scene.id);
    if (sceneObjects.length >= DEFAULT_OBJECTS.length) return sceneObjects.sort((a, b) => a.createdAt - b.createdAt);
    const now = Date.now();
    const created = objectsForScene(scene).map((item, index): WorldObject => ({
      // A scene can travel between locations. Keeping the location in the id
      // prevents a new room from overwriting the state left in the old room.
      id: objectId(scene.id, scene.locationId!, String(index)),
      userId: scene.userId,
      worldId: scene.worldId,
      locationId: scene.locationId!,
      sceneId: scene.id,
      ...item,
      state: 'present',
      sourceType: 'scene',
      sourceId: scene.id,
      createdAt: scene.createdAt,
      updatedAt: now,
    }));
    for (const item of created) {
      if (!existing.some((row) => row.id === item.id)) await db.worldObjects.put(item);
    }
    return db.worldObjects.where('[worldId+locationId]').equals([scene.worldId, scene.locationId]).toArray()
      .then((rows) => rows.filter((row) => row.sceneId === scene.id).sort((a, b) => a.createdAt - b.createdAt));
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
