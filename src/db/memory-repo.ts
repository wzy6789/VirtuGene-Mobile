import { db, type MemoryItem } from './index';

const MAX_MEMORIES_PER_CHAR = 30;

function isProtectedMemory(memory: MemoryItem): boolean {
  // pinned is the explicit marker. The confidence/source fallback keeps older
  // manually remembered records safe after upgrading from pre-pinned versions.
  return memory.pinned === true || (
    memory.type === 'auto' &&
    (memory.confidence ?? 0) >= 1 &&
    (memory.sourceMessageIds?.length ?? 0) > 0
  );
}

/** 用于记忆去重的稳定键：忽略大小写、空白和常见标点，但不做模糊匹配。 */
export function normalizeMemoryKey(content: string): string {
  return content
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\s\u3000，。！？、,.!?;；:："“”‘’（）()【】[\]{}]/g, '')
    .trim()
    .slice(0, 240);
}

async function upsertMemory(memory: MemoryItem): Promise<string> {
  const key = normalizeMemoryKey(memory.content);
  if (!key) return memory.id;
  const existing = (await db.memories.where('characterId').equals(memory.characterId).toArray())
    .find((item) => item.userId === memory.userId && normalizeMemoryKey(item.content) === key);
  if (!existing) {
    await db.memories.add(memory);
    return memory.id;
  }

  const sourceMessageIds = Array.from(new Set([
    ...(existing.sourceMessageIds ?? []),
    ...(memory.sourceMessageIds ?? []),
  ]));
  await db.memories.update(existing.id, {
    sourceSessionId: memory.sourceSessionId ?? existing.sourceSessionId,
    sourceMessageIds: sourceMessageIds.length > 0 ? sourceMessageIds : undefined,
    confidence: Math.max(existing.confidence ?? 0, memory.confidence ?? 0),
    pinned: existing.pinned === true || memory.pinned === true ? true : undefined,
    updatedAt: Math.max(Date.now(), existing.updatedAt ?? 0),
  });
  return existing.id;
}

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
  const protectedItems = all.filter(isProtectedMemory);
  const candidates = all.filter((memory) => !isProtectedMemory(memory));
  const keepNonProtected = Math.max(0, MAX_MEMORIES_PER_CHAR - protectedItems.length);
  const keep = [...protectedItems, ...candidates.slice(-keepNonProtected)];
  const keepIds = new Set(keep.map((memory) => memory.id));
  const excess = all.filter((memory) => !keepIds.has(memory.id));
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

  /**
   * 创建角色时由用户明确选择的记忆移交。
   * 只复制沉淀后的摘要，绝不复制原始聊天记录、会话 id 或消息 id。
   */
  async importRecentUserMemories(characterId: string, userId: string, limit = 12): Promise<number> {
    const candidates = await this.getRecentByUser(userId, limit * 3);
    const seen = new Set<string>();
    const selected = candidates
      .filter((memory) => memory.content.trim().length > 0)
      .filter((memory) => {
        const key = normalizeMemoryKey(memory.content);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, limit);

    const now = Date.now();
    await this.createMany(selected.map((memory) => ({
      id: crypto.randomUUID(),
      characterId,
      userId,
      content: memory.content,
      // 表示它不是新角色从一段对话中自动提取出的结论。
      type: 'summary' as const,
      pinned: memory.pinned,
      createdAt: now,
      confidence: memory.confidence,
      updatedAt: now,
    })));
    return selected.length;
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
    const id = await upsertMemory(memory);
    // 单条写入同样受上限约束，避免「记住」「教记忆」「发图分享」把条数顶超
    await pruneToLimit(memory.characterId, memory.userId);
    return id;
  },

  /** 将同一会话的压缩结果更新为一条摘要记忆，避免每次压缩都制造重复记忆。 */
  async upsertSessionSummary(input: {
    characterId: string;
    userId: string;
    sessionId: string;
    content: string;
    sourceMessageIds?: string[];
  }): Promise<string> {
    const content = input.content.trim().slice(0, 900);
    if (!content) return '';
    const all = await db.memories.where('characterId').equals(input.characterId).toArray();
    const existing = all.find((memory) =>
      memory.userId === input.userId &&
      memory.type === 'summary' &&
      memory.sourceSessionId === input.sessionId,
    );
    const now = Date.now();
    if (existing) {
      const sourceMessageIds = Array.from(new Set([
        ...(existing.sourceMessageIds ?? []),
        ...(input.sourceMessageIds ?? []),
      ])).slice(-240);
      await db.memories.update(existing.id, {
        content,
        sourceMessageIds: sourceMessageIds.length > 0 ? sourceMessageIds : undefined,
        confidence: Math.max(existing.confidence ?? 0, 0.75),
        updatedAt: now,
      });
      return existing.id;
    }
    const id = crypto.randomUUID();
    await db.memories.add({
      id,
      characterId: input.characterId,
      userId: input.userId,
      content,
      type: 'summary',
      createdAt: now,
      sourceSessionId: input.sessionId,
      sourceMessageIds: input.sourceMessageIds,
      confidence: 0.75,
      updatedAt: now,
    });
    await pruneToLimit(input.characterId, input.userId);
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
      ids.push(await upsertMemory(m));
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
