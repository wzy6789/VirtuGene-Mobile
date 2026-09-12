import { db, type SharedStoryEvent } from './index';

export type SharedEventType = SharedStoryEvent['type'];

export const SHARED_EVENT_TYPES: SharedEventType[] = ['相识', '约定', '分歧', '离别', '重逢', '转折'];

/** 同一对人只用一种键：两个 id 排序后拼接 */
export function pairKey(a: string, b: string): string {
  return [a, b].sort().join('|');
}

function normalizePair(a: string, b: string): [string, string] {
  const sorted = [a, b].sort();
  return [sorted[0], sorted[1]];
}

function similarity(a: string, b: string): number {
  const norm = (s: string) => s.toLowerCase().replace(/[\s，。、！？；：,.!?;:'"“”‘’（）()\[\]【】—\-…~]/g, '');
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const grams = (s: string) => {
    const set = new Set<string>();
    for (let i = 0; i < s.length - 1; i += 1) set.add(s.slice(i, i + 2));
    return set;
  };
  const gx = grams(x);
  const gy = grams(y);
  let hit = 0;
  for (const g of gx) if (gy.has(g)) hit += 1;
  return (2 * hit) / (gx.size + gy.size);
}

export interface NewSharedEventInput {
  userId: string;
  a: string;
  b: string;
  type: SharedEventType;
  title: string;
  detail?: string;
  viewpoints?: Record<string, string>;
  origin?: 'ai' | 'user';
}

/**
 * 人物共同事件仓库。
 * 与群聊完全无关：只描述「角色 ↔ 角色」之间发生过什么，用户可以自由增删改。
 * 不自动修改任何用户设定的故事关系标签。
 */
export const sharedEventRepo = {
  async getById(id: string): Promise<SharedStoryEvent | undefined> {
    return db.sharedStoryEvents.get(id);
  },

  async getByIds(ids: string[]): Promise<SharedStoryEvent[]> {
    if (ids.length === 0) return [];
    const items = await db.sharedStoryEvents.bulkGet(ids);
    return items.filter((item): item is SharedStoryEvent => !!item);
  },

  async getByPair(a: string, b: string, userId: string): Promise<SharedStoryEvent[]> {
    if (!a || !b || a === b) return [];
    const all = await db.sharedStoryEvents.where('characterIds').equals(a).toArray();
    const [x, y] = normalizePair(a, b);
    return all
      .filter((e) => e.userId === userId && e.characterIds[0] === x && e.characterIds[1] === y)
      .sort((m, n) => n.createdAt - m.createdAt);
  },

  async getByCharacter(characterId: string, userId: string): Promise<SharedStoryEvent[]> {
    const all = await db.sharedStoryEvents.where('characterIds').equals(characterId).toArray();
    return all.filter((e) => e.userId === userId).sort((m, n) => n.createdAt - m.createdAt);
  },

  /** 最近 N 条（新→旧），用于注入与 Shared Space 展示 */
  async getRecentByCharacter(characterId: string, userId: string, limit = 3): Promise<SharedStoryEvent[]> {
    return (await this.getByCharacter(characterId, userId)).slice(0, limit);
  },

  async getAllByUser(userId: string): Promise<SharedStoryEvent[]> {
    return db.sharedStoryEvents.where('userId').equals(userId).toArray();
  },

  /** 同一对角色之间，标题高度相似的事件不重复入库（只有 AI 沉淀时才需要去重）。 */
  async create(input: NewSharedEventInput): Promise<string | null> {
    const { userId, a, b } = input;
    if (!a || !b || a === b) return null;
    const title = input.title.trim().slice(0, 60);
    if (!title) return null;
    const existing = await this.getByPair(a, b, userId);
    const duplicate = existing.find((e) => e.type === input.type && similarity(e.title, title) >= 0.7);
    if (duplicate) return duplicate.id;
    const now = Date.now();
    const event: SharedStoryEvent = {
      id: crypto.randomUUID(),
      userId,
      characterIds: normalizePair(a, b),
      type: input.type,
      title,
      ...(input.detail?.trim() ? { detail: input.detail.trim().slice(0, 240) } : {}),
      ...(input.viewpoints && Object.keys(input.viewpoints).length ? { viewpoints: input.viewpoints } : {}),
      origin: input.origin ?? 'user',
      createdAt: now,
      updatedAt: now,
    };
    await db.sharedStoryEvents.put(event);
    return event.id;
  },

  async update(
    id: string,
    patch: Partial<Pick<SharedStoryEvent, 'type' | 'title' | 'detail' | 'viewpoints'>>,
  ): Promise<void> {
    const existing = await db.sharedStoryEvents.get(id);
    if (!existing) return;
    await db.sharedStoryEvents.put({
      ...existing,
      ...patch,
      title: patch.title !== undefined ? patch.title.trim().slice(0, 60) || existing.title : existing.title,
      detail: patch.detail !== undefined ? patch.detail.trim().slice(0, 240) : existing.detail,
      updatedAt: Date.now(),
    });
  },

  async remove(id: string): Promise<void> {
    await db.sharedStoryEvents.delete(id);
  },

  /** 删除角色时同步清掉所有牵涉该角色的共同事件 */
  async deleteByCharacter(characterId: string, userId: string): Promise<void> {
    const all = await db.sharedStoryEvents.where('characterIds').equals(characterId).toArray();
    const ids = all.filter((e) => e.userId === userId).map((e) => e.id);
    if (ids.length) await db.sharedStoryEvents.bulkDelete(ids);
  },

  async clearForUser(userId: string): Promise<void> {
    const all = await db.sharedStoryEvents.where('userId').equals(userId).toArray();
    const ids = all.map((e) => e.id);
    if (ids.length) await db.sharedStoryEvents.bulkDelete(ids);
  },
};
