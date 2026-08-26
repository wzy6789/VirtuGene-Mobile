import { db, type MemoryItem } from './index';

const MAX_MEMORIES_PER_CHAR = 30;

export const memoryRepo = {
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
    return db.memories.add(memory);
  },

  async createMany(memories: MemoryItem[]): Promise<string[]> {
    // Trim oldest if exceeding limit (per character + user)
    for (const m of memories) {
      const existing = (await db.memories.where('characterId').equals(m.characterId).toArray())
        .filter((x) => x.userId === m.userId)
        .sort((a, b) => a.createdAt - b.createdAt);
      if (existing.length >= MAX_MEMORIES_PER_CHAR) {
        const toDelete = existing.slice(0, existing.length - MAX_MEMORIES_PER_CHAR + 1);
        for (const d of toDelete) {
          await db.memories.delete(d.id);
        }
      }
    }
    const ids: string[] = [];
    for (const m of memories) {
      ids.push(await db.memories.add(m));
    }
    return ids;
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
