import { db, type MemoryItem } from './index';
import { prepareMemoryMetadata } from '../lib/memory-engine';
import { memorySourceTombstoneRepo } from './memory-source-tombstone-repo';

const MAX_MEMORIES_PER_CHAR = 30;

function isProtectedMemory(memory: MemoryItem): boolean {
  if ((memory.status ?? 'active') !== 'active') return false;
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
  let candidate = memory;
  // A deleted/superseded id is never reused. Fresh evidence with identical text
  // may become a new row, but an old backup must not be able to revive the old id.
  if (await memorySourceTombstoneRepo.blocksImport({
    userId: memory.userId,
    sourceType: 'memory',
    sourceId: memory.id,
    sourceRevision: memory.updatedAt ?? memory.createdAt,
  })) {
    candidate = { ...memory, id: crypto.randomUUID() };
  }
  const key = normalizeMemoryKey(candidate.content);
  if (!key) return candidate.id;
  const existing = (await db.memories.where('characterId').equals(candidate.characterId).toArray())
    .find((item) => item.userId === candidate.userId && (item.status ?? 'active') === 'active' && normalizeMemoryKey(item.content) === key);
  if (!existing) {
    const metadata = prepareMemoryMetadata(candidate.content, {
      kind: candidate.memoryKind,
      pinned: candidate.pinned === true,
      stability: candidate.stability,
      confidence: candidate.confidence,
    });
    await db.memories.add({ ...metadata, ...candidate, pinned: candidate.pinned ?? metadata.pinned });
    return candidate.id;
  }

  const sourceMessageIds = Array.from(new Set([
    ...(existing.sourceMessageIds ?? []),
    ...(candidate.sourceMessageIds ?? []),
  ]));
  await db.memories.update(existing.id, {
    sourceSessionId: candidate.sourceSessionId ?? existing.sourceSessionId,
    sourceMessageIds: sourceMessageIds.length > 0 ? sourceMessageIds : undefined,
    confidence: Math.max(existing.confidence ?? 0, candidate.confidence ?? 0),
    pinned: existing.pinned === true || candidate.pinned === true ? true : undefined,
    memoryKind: candidate.memoryKind ?? existing.memoryKind,
    importedFromCharacterId: candidate.importedFromCharacterId ?? existing.importedFromCharacterId,
    importedFromMemoryId: candidate.importedFromMemoryId ?? existing.importedFromMemoryId,
    stability: candidate.stability ?? existing.stability,
    status: existing.status === 'withdrawn' ? 'withdrawn' : (candidate.status ?? existing.status ?? 'active'),
    lastConfirmedAt: Math.max(existing.lastConfirmedAt ?? 0, candidate.lastConfirmedAt ?? 0) || undefined,
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
  for (const memory of excess) {
    await memorySourceTombstoneRepo.record({
      userId,
      sourceType: 'memory',
      sourceId: memory.id,
      sourceRevision: memory.updatedAt ?? memory.createdAt,
      status: 'deleted',
    });
  }
  await db.memories.bulkDelete(excess.map((m) => m.id));
}

/** 删除或撤回原始消息时，失效由其自动归纳出的非固定记忆；用户明确钉住的事实保留。 */
export async function invalidateUnpinnedMemoriesForMessages(userId: string, messageIds: string[]): Promise<number> {
  const ids = new Set(messageIds);
  if (!ids.size) return 0;
  const rows = await db.memories.where('userId').equals(userId).toArray();
  const invalidated = rows.filter((memory) =>
    !memory.pinned && (memory.status ?? 'active') === 'active' && (memory.sourceMessageIds ?? []).some((id) => ids.has(id)),
  );
  if (invalidated.length) {
    const now = Date.now();
    await db.memories.bulkPut(invalidated.map((memory) => ({ ...memory, status: 'superseded' as const, updatedAt: now })));
    for (const memory of invalidated) {
      await memorySourceTombstoneRepo.record({ userId, sourceType: 'memory', sourceId: memory.id, sourceRevision: now, status: 'superseded' });
    }
  }
  return invalidated.length;
}

export const memoryRepo = {
  /** 获取一个用户最近留下的记忆，用于生命回顾等跨角色视图。 */
  async getRecentByUser(userId: string, limit = 60): Promise<MemoryItem[]> {
    return db.memories
      .where('userId')
      .equals(userId)
      .toArray()
      .then((items) => items
        .filter((item) => (item.status ?? 'active') === 'active')
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, limit));
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
      importedFromCharacterId: memory.characterId,
      importedFromMemoryId: memory.id,
      ...prepareMemoryMetadata(memory.content, { kind: 'summary', pinned: memory.pinned === true, stability: 'stable', confidence: memory.confidence ?? 0.75 }),
      createdAt: now,
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

  /** 给运行时用的有效记忆查询；档案页仍可用 getRecentByCharacter 查看已替代记录。 */
  async getRecentActiveByCharacter(characterId: string, userId: string, limit = 15): Promise<MemoryItem[]> {
    const all = await db.memories.where('characterId').equals(characterId).toArray();
    return all
      .filter((memory) => memory.userId === userId && (memory.status ?? 'active') === 'active')
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
      memory.sourceSessionId === input.sessionId &&
      (memory.status ?? 'active') === 'active',
    );
    const now = Date.now();
    if (existing) {
      const sourceMessageIds = Array.from(new Set(input.sourceMessageIds ?? []));
      await db.memories.update(existing.id, {
        content,
        // 当前压缩是对完整 oldMsgs 范围重算的，替换来源而不是累积旧引用；
        // 被编辑/删除的旧消息不能继续挂在新摘要上。
        sourceMessageIds: sourceMessageIds.length > 0 ? sourceMessageIds : undefined,
        confidence: Math.max(existing.confidence ?? 0, 0.75),
        status: 'active',
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
      ...prepareMemoryMetadata(content, { kind: 'summary', stability: 'stable', confidence: 0.75 }),
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

  /** 记录最近一次被召回的记忆；只更新元数据，不改写记忆内容。 */
  async markMentioned(ids: string[]): Promise<void> {
    const unique = [...new Set(ids.filter(Boolean))];
    if (unique.length === 0) return;
    const now = Date.now();
    await db.transaction('rw', db.memories, async () => {
      const rows = await db.memories.bulkGet(unique);
      for (const memory of rows) {
        if (!memory || (memory.status ?? 'active') !== 'active') continue;
        await db.memories.update(memory.id, {
          lastMentionedAt: now,
          mentionCount: (memory.mentionCount ?? 0) + 1,
          updatedAt: Math.max(memory.updatedAt ?? 0, now),
        });
      }
    });
  },

  async setPinned(id: string, pinned: boolean): Promise<void> {
    const current = await db.memories.get(id);
    if (!current) return;
    if (pinned && (current.status ?? 'active') !== 'active') throw new Error('memory:cannot-pin-inactive');
    await db.memories.update(id, {
      pinned: pinned || undefined,
      ...(pinned ? { stability: 'stable' as const, status: 'active' as const } : {}),
      updatedAt: Date.now(),
    });
  },

  /** 用新事实替代旧事实，保留旧记录与来源用于审计，但不再召回。 */
  async supersede(oldId: string, replacementId: string): Promise<void> {
    const old = await db.memories.get(oldId);
    if (!old) return;
    const updatedAt = Date.now();
    await db.memories.update(oldId, {
      status: 'superseded',
      supersededBy: replacementId,
      updatedAt,
    });
    await memorySourceTombstoneRepo.record({ userId: old.userId, sourceType: 'memory', sourceId: old.id, sourceRevision: updatedAt, status: 'superseded' });
  },

  /** 用户明确纠正事实时，停用最可能的旧事实；普通新记忆不会触发。 */
  async supersedeLikelyCorrections(characterId: string, userId: string, replacement: MemoryItem): Promise<void> {
    if (!/其实|不是|不再|已经不|改成|更正|纠正|现在是/u.test(replacement.content)) return;
    const words = Array.from(replacement.content.matchAll(/[\u4e00-\u9fff]{2}/gu)).map(([word]) => word);
    if (words.length === 0) return;
    const candidates = (await db.memories.where('characterId').equals(characterId).toArray())
      .filter((memory) => memory.userId === userId && memory.id !== replacement.id && (memory.status ?? 'active') === 'active')
      .filter((memory) => memory.memoryKind === 'fact' || memory.memoryKind === 'preference');
    const target = candidates.find((memory) => words.filter((word) => memory.content.includes(word)).length >= 2);
    if (target) await this.supersede(target.id, replacement.id);
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
    const memory = await db.memories.get(id);
    if (memory) {
      await memorySourceTombstoneRepo.record({
        userId: memory.userId,
        sourceType: 'memory',
        sourceId: memory.id,
        sourceRevision: memory.updatedAt ?? memory.createdAt,
        status: 'deleted',
      });
    }
    await db.memories.delete(id);
  },

  async deleteOld(characterId: string, userId: string, beforeTs: number): Promise<void> {
    const all = await db.memories.where('characterId').equals(characterId).toArray();
    for (const m of all) {
      if (m.userId === userId && m.createdAt < beforeTs) {
        await memorySourceTombstoneRepo.record({ userId, sourceType: 'memory', sourceId: m.id, sourceRevision: m.updatedAt ?? m.createdAt, status: 'deleted' });
        await db.memories.delete(m.id);
      }
    }
  },

  async clearForCharacter(characterId: string, userId: string): Promise<void> {
    const all = await db.memories.where('characterId').equals(characterId).toArray();
    for (const m of all) {
      if (m.userId === userId) {
        await memorySourceTombstoneRepo.record({ userId, sourceType: 'memory', sourceId: m.id, sourceRevision: m.updatedAt ?? m.createdAt, status: 'deleted' });
        await db.memories.delete(m.id);
      }
    }
  },

  async countByCharacter(characterId: string, userId: string): Promise<number> {
    const all = await db.memories.where('characterId').equals(characterId).toArray();
    return all.filter((m) => m.userId === userId).length;
  },
};
