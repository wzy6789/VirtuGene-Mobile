import { db, type MemoryItem } from './index';

const MAX_MEMORIES_PER_CHAR = 30;

/**
 * 把某个角色 + 用户的记忆修剪到上限，保留最新的 N 条（按 createdAt，同刻按 id 稳定排序）。
 * 只读「当前实际存在的条数」再算要删多少，因此无论一次写入多少条、
 * 或写入前已经超过上限，最终条数都精确等于 MAX_MEMORIES_PER_CHAR。
 */
async function pruneToLimit(characterId: string, userId: string): Promise<void> {
  const all = (await db.memories.where('characterId').equals(characterId).toArray())
    .filter((m) => m.userId === userId)
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  if (all.length <= MAX_MEMORIES_PER_CHAR) return;
  const excess = all.slice(0, all.length - MAX_MEMORIES_PER_CHAR);
  await db.memories.bulkDelete(excess.map((m) => m.id));
}

export const memoryRepo = {
  /** 获取一个用户最近留下的记忆，用于生命回顾等跨角色视图。 */
  async getRecentByUser(userId: string, limit = 60): Promise<MemoryItem[]> {
    return db.memories
      .where('userId')
      .equals(userId)
      .toArray()
      .then((items) => items.sort((a, b) => b.createdAt - a.createdAt).slice(0, limit));
  },

  async getByCharacter(characterId: string, userId: string): Promise<MemoryItem[]> {
    const all = await db.memories.where('characterId').equals(characterId).toArray();
    return all.filter((m) => m.userId === userId).sort((a, b) => a.createdAt - b.createdAt);
  },

  /** 取最近 limit 条记忆（新→旧），用于注入回复上下文，避免全量记忆撑爆 token */
  async getRecentByCharacter(characterId: string, userId: string, limit = 15): Promise<MemoryItem[]> {
    const all = await db.memories.where('characterId').equals(characterId).toArray();
    return all
      .filter((m) => m.userId === userId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  },

  async create(memory: MemoryItem): Promise<string> {
    const id = await db.memories.add(memory);
    // 单条写入同样受上限约束，避免「记住」「教记忆」「发图分享」把条数顶超
    await pruneToLimit(memory.characterId, memory.userId);
    return id;
  },

  /** 按 id 取记忆，用于「记忆依据」溯源（已删除的条目会被跳过） */
  async getByIds(ids: string[]): Promise<MemoryItem[]> {
    if (ids.length === 0) return [];
    const items = await db.memories.bulkGet(ids);
    return items.filter((item): item is MemoryItem => !!item);
  },

  async createMany(memories: MemoryItem[]): Promise<string[]> {
    if (memories.length === 0) return [];
    // 先全部写入，再按 (characterId+userId) 分组修剪：
    // 旧实现是「每插一条前删一条」，一批写 20 条时最多只能删掉 1 条，条数会涨到上限 + 批量 - 1。
    const ids: string[] = [];
    for (const m of memories) {
      ids.push(await db.memories.add(m));
    }
    const touched = new Map<string, { characterId: string; userId: string }>();
    for (const m of memories) {
      touched.set(`${m.characterId}|${m.userId}`, { characterId: m.characterId, userId: m.userId });
    }
    for (const { characterId, userId } of touched.values()) {
      await pruneToLimit(characterId, userId);
    }
    return ids;
  },

  /** 删除一条记忆（记忆档案里用户主动删除；删除后角色不会再想起来） */
  async deleteById(id: string): Promise<void> {
    await db.memories.delete(id);
  },

  async deleteOld(characterId: string, userId: string, beforeTs: number): Promise<void> {
    const all = await db.memories.where('characterId').equals(characterId).toArray();
    for (const m of all) {
      if (m.userId === userId && m.createdAt < beforeTs) {
        await db.memories.delete(m.id);
      }
    }
  },

  async clearForCharacter(characterId: string, userId: string): Promise<void> {
    const all = await db.memories.where('characterId').equals(characterId).toArray();
    for (const m of all) {
      if (m.userId === userId) {
        await db.memories.delete(m.id);
      }
    }
  },

  async countByCharacter(characterId: string, userId: string): Promise<number> {
    const all = await db.memories.where('characterId').equals(characterId).toArray();
    return all.filter((m) => m.userId === userId).length;
  },
};
