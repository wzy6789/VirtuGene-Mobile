import { db, type MemoryEvidenceSource, type MemoryItem } from './index';
import { normalizeMemoryContent, prepareMemoryMetadata } from '../lib/memory-engine';
import { memorySourceTombstoneRepo } from './memory-source-tombstone-repo';
import { memoryLedgerRepo } from './memory-ledger-repo';

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
  const sourceMessageRevisions = { ...(existing.sourceMessageRevisions ?? {}), ...(candidate.sourceMessageRevisions ?? {}) };
  const sourceMessageOffsets = { ...(existing.sourceMessageOffsets ?? {}), ...(candidate.sourceMessageOffsets ?? {}) };
  const sourceMessageEndOffsets = { ...(existing.sourceMessageEndOffsets ?? {}), ...(candidate.sourceMessageEndOffsets ?? {}) };
  await db.memories.update(existing.id, {
    sourceSessionId: candidate.sourceSessionId ?? existing.sourceSessionId,
    sourceMessageIds: sourceMessageIds.length > 0 ? sourceMessageIds : undefined,
    sourceMessageRevisions: Object.keys(sourceMessageRevisions).length ? sourceMessageRevisions : undefined,
    sourceMessageOffsets: Object.keys(sourceMessageOffsets).length ? sourceMessageOffsets : undefined,
    sourceMessageEndOffsets: Object.keys(sourceMessageEndOffsets).length ? sourceMessageEndOffsets : undefined,
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

function isSessionAggregateSummary(memory: MemoryItem): boolean {
  return memory.type === 'summary' && Boolean(memory.sourceSessionId);
}

async function revokeMemoryEvidence(
  memory: MemoryItem,
  sourceIds: string[],
  exhaustedStatus: 'withdrawn' | 'superseded' = 'superseded',
): Promise<void> {
  const sourceSession = memory.sourceSessionId ? await db.sessions.get(memory.sourceSessionId) : undefined;
  const sourceType: MemoryEvidenceSource = memory.importedFromMemoryId
    ? 'legacy'
    : sourceSession?.type === 'group' ? 'group'
      : memory.sourceMessageIds?.length ? 'chat' : 'legacy';
  const claim = await memoryLedgerRepo.findClaim(memory.userId, memory.memoryKind ?? 'fact', memory.content);
  if (!claim) return;
  for (const sourceId of sourceIds) {
    await memoryLedgerRepo.revokeClaimSource(memory.userId, claim.id, sourceType, sourceId, exhaustedStatus);
  }
}

/** A corrected/deleted durable fact must not remain baked into any summary that cited its source turn. */
async function invalidateSessionSummariesForMemory(memory: MemoryItem): Promise<void> {
  const sourceIds = [...new Set(memory.sourceMessageIds ?? [])];
  if (!sourceIds.length && !memory.sourceSessionId) return;
  const sourceMessages = sourceIds.length ? await db.messages.bulkGet(sourceIds) : [];
  const sessions = await db.sessions.where('userId').equals(memory.userId).toArray();
  for (const session of sessions) {
    if (!session.summary) continue;
    let affected = session.id === memory.sourceSessionId;
    if (!affected && (session.summarySourceMessageIds?.length ?? 0) > 0) {
      affected = session.summarySourceMessageIds!.some((id) => sourceIds.includes(id));
    } else if (!affected && sourceIds.length) {
      affected = sourceMessages.some((message) => message?.sessionId === session.id
        && message.createdAt <= (session.summaryUpdatedAt ?? 0));
    }
    if (!affected) continue;
    const {
      summary: _summary,
      summaryUpdatedAt: _summaryUpdatedAt,
      summaryAttemptedAt: _summaryAttemptedAt,
      summarySourceMessageIds: _summarySourceMessageIds,
      summarySourceMessageRevisions: _summarySourceMessageRevisions,
      summarySourceMessageOffsets: _summarySourceMessageOffsets,
      summaryWitnessedBy: _summaryWitnessedBy,
      ...rest
    } = session;
    await db.sessions.put(rest);
    await invalidateSessionSummaryMemory(session.userId, session.id);
  }
}

/** One-time repair for older builds that detached source ids but left a pinned aggregate active. */
async function retireDetachedPinnedSessionSummaries(items: MemoryItem[]): Promise<MemoryItem[]> {
  const retired = new Map<string, MemoryItem>();
  for (const memory of items) {
    if (!isSessionAggregateSummary(memory) || !memory.pinned || (memory.sourceMessageIds?.length ?? 0) > 0
      || (memory.status ?? 'active') !== 'active') continue;
    const updatedAt = Date.now();
    const updated: MemoryItem = { ...memory, status: 'superseded', pinned: undefined, updatedAt };
    await memoryLedgerRepo.forgetMemoryItem(memory);
    await db.memories.put(updated);
    await memorySourceTombstoneRepo.record({ userId: memory.userId, sourceType: 'memory', sourceId: memory.id, sourceRevision: updatedAt, status: 'superseded' });
    retired.set(memory.id, updated);
  }
  return items.map((memory) => retired.get(memory.id) ?? memory);
}

/** 删除或撤回原始消息时，失效由其自动归纳出的记忆；独立置顶事实保留，摘要始终按聚合来源整体失效。 */
export async function invalidateUnpinnedMemoriesForMessages(userId: string, messageIds: string[]): Promise<number> {
  const ids = new Set(messageIds);
  if (!ids.size) return 0;
  const rows = await db.memories.where('userId').equals(userId).toArray();
  const affected = rows.filter((memory) =>
    (memory.status ?? 'active') === 'active' && (memory.sourceMessageIds ?? []).some((id) => ids.has(id)),
  );
  let invalidated = 0;
  const sourceTypes: MemoryEvidenceSource[] = ['chat', 'group', 'legacy'];

  for (const memory of affected) {
    const allSourceIds = [...new Set(memory.sourceMessageIds ?? [])];
    const changedIds = allSourceIds.filter((id) => ids.has(id));
    // A session summary is an aggregate claim: editing any input invalidates the
    // whole summary. Ordinary extracted memories may keep independent surviving
    // source messages instead of being discarded wholesale.
    const isAggregateSummary = isSessionAggregateSummary(memory);
    const revokedIds = isAggregateSummary ? (allSourceIds.length ? allSourceIds : [memory.id]) : changedIds;
    const remainingIds = allSourceIds.filter((id) => !revokedIds.includes(id));
    const shouldSupersede = isAggregateSummary || (!memory.pinned && remainingIds.length === 0);
    const retainedIds = remainingIds;
    const retainMap = (value?: Record<string, number>) => {
      if (!value) return undefined;
      const next = Object.fromEntries(Object.entries(value).filter(([id]) => retainedIds.includes(id)));
      return Object.keys(next).length ? next : undefined;
    };
    const now = Date.now();
    const updated: MemoryItem = {
      ...memory,
      ...(shouldSupersede ? { status: 'superseded' as const } : {}),
      ...(shouldSupersede ? { pinned: undefined } : {}),
      sourceMessageIds: retainedIds.length ? retainedIds : undefined,
      sourceMessageRevisions: retainMap(memory.sourceMessageRevisions),
      sourceMessageOffsets: retainMap(memory.sourceMessageOffsets),
      sourceMessageEndOffsets: retainMap(memory.sourceMessageEndOffsets),
      updatedAt: now,
    };
    await db.memories.put(updated);

    const claim = await memoryLedgerRepo.findClaim(userId, memory.memoryKind ?? 'fact', memory.content);
    if (claim) for (const sourceId of revokedIds) {
      // Revoke only this memory claim's evidence edge. A different fact extracted
      // from the same message remains supported by that message.
      for (const sourceType of sourceTypes) {
        await memoryLedgerRepo.revokeClaimSource(userId, claim.id, sourceType, sourceId,
          shouldSupersede ? 'superseded' : 'withdrawn');
      }
    }

    if (shouldSupersede) {
      invalidated += 1;
      await memorySourceTombstoneRepo.record({ userId, sourceType: 'memory', sourceId: memory.id, sourceRevision: now, status: 'superseded' });
    } else {
      // 独立置顶事实按设计保留（用户明确要求记住的不能被一次编辑清掉），
      // 但它已经和来源脱钩了：**必须留墓碑**，否则一份旧备份会把"还能被原话核对"
      // 的假象带回来，而那份原话在本机已经不存在了。
      if (updated.pinned && retainedIds.length === 0) {
        await memorySourceTombstoneRepo.record({ userId, sourceType: 'memory', sourceId: memory.id, sourceRevision: now, status: 'superseded' });
      }
      if (updated.pinned || retainedIds.length) await memoryLedgerRepo.syncMemoryItem(updated);
    }
  }
  return invalidated;
}

export async function invalidateSessionSummaryMemory(userId: string, sessionId: string): Promise<void> {
  const rows = await db.memories.where('userId').equals(userId).toArray();
  for (const memory of rows) {
    if (!isSessionAggregateSummary(memory) || memory.sourceSessionId !== sessionId || (memory.status ?? 'active') !== 'active') continue;
    const updatedAt = Date.now();
    const updated: MemoryItem = { ...memory, status: 'superseded', pinned: undefined, sourceMessageIds: undefined, updatedAt };
    await db.memories.put(updated);
    const sourceIds = memory.sourceMessageIds?.length ? memory.sourceMessageIds : [memory.id];
    await revokeMemoryEvidence(memory, sourceIds, 'superseded');
    await memorySourceTombstoneRepo.record({ userId, sourceType: 'memory', sourceId: memory.id, sourceRevision: updatedAt, status: 'superseded' });
  }
}

export const memoryRepo = {
  /** 获取一个用户最近留下的记忆，用于生命回顾等跨角色视图。 */
  async getRecentByUser(userId: string, limit = 60): Promise<MemoryItem[]> {
    const items = await db.memories
      .where('userId')
      .equals(userId)
      .toArray()
    const repaired = await retireDetachedPinnedSessionSummaries(items);
    return repaired
      .filter((item) => (item.status ?? 'active') === 'active')
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
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
    const own = all.filter((m) => m.userId === userId);
    return (await retireDetachedPinnedSessionSummaries(own)).sort((a, b) => a.createdAt - b.createdAt);
  },

  /** 取最近 limit 条记忆（新→旧），用于注入回复上下文，避免全量记忆撑爆 token */
  async getRecentByCharacter(characterId: string, userId: string, limit = 15): Promise<MemoryItem[]> {
    const all = await db.memories.where('characterId').equals(characterId).toArray();
    const own = all.filter((m) => m.userId === userId);
    return (await retireDetachedPinnedSessionSummaries(own))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  },

  /** 给运行时用的有效记忆查询；档案页仍可用 getRecentByCharacter 查看已替代记录。 */
  async getRecentActiveByCharacter(characterId: string, userId: string, limit = 15): Promise<MemoryItem[]> {
    const all = await db.memories.where('characterId').equals(characterId).toArray();
    const own = all.filter((memory) => memory.userId === userId);
    return (await retireDetachedPinnedSessionSummaries(own))
      .filter((memory) => (memory.status ?? 'active') === 'active')
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  },

  async create(memory: MemoryItem): Promise<string> {
    // 记忆不能因数量上限被物理删除。召回时按相关性与上下文预算裁剪，
    // 原始消息仍可溯源，用户主动删除则走 deleteById 的明确撤回路径。
    const id = await upsertMemory(memory);
    const stored = await db.memories.get(id);
    if (stored) await memoryLedgerRepo.syncMemoryItem(stored);
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
    const content = input.content.trim().slice(0, 2_400);
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
      const stored = await db.memories.get(existing.id);
      if (stored) await memoryLedgerRepo.syncMemoryItem(stored);
      return existing.id;
    }
    const id = crypto.randomUUID();
    const summary: MemoryItem = {
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
    };
    await db.memories.add(summary);
    await memoryLedgerRepo.syncMemoryItem(summary);
    return id;
  },

  /** 按 id 取记忆，用于「记忆依据」溯源（已删除的条目会被跳过） */
  async getByIds(ids: string[]): Promise<MemoryItem[]> {
    if (ids.length === 0) return [];
    const items = await db.memories.bulkGet(ids);
    return items.filter((item): item is MemoryItem => !!item);
  },

  /** 记录最近一次被召回的记忆；只更新元数据，不改写记忆内容。 */
  async markSpoken(ids: string[]): Promise<void> {
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
    if (pinned && isSessionAggregateSummary(current)) throw new Error('memory:cannot-pin-session-summary');
    await db.memories.update(id, {
      pinned: pinned || undefined,
      ...(pinned ? { stability: 'stable' as const, status: 'active' as const } : {}),
      updatedAt: Date.now(),
    });
  },

  /**
   * 用户自己在记忆档案里改正一条记忆的措辞（"其实不是这样"）。
   *
   * 这是**就地替换**而不是新建一条：
   * - 来源与证据（哪句话、哪次经历）保持不变，只是内容被用户纠正；
   * - 旧版本写入墓碑，因此下一次同步/恢复不会用旧文本覆盖用户的更正；
   * - 依赖这份旧措辞的会话摘要一并失效，避免摘要继续引用被改掉的说法。
   */
  async correctContent(id: string, content: string, userId: string): Promise<void> {
    const current = await db.memories.get(id);
    if (!current || current.userId !== userId) return;
    const next = normalizeMemoryContent(content);
    if (!next || next === current.content) return;
    await invalidateSessionSummariesForMemory(current);
    const updatedAt = Date.now();
    await memorySourceTombstoneRepo.record({
      userId: current.userId,
      sourceType: 'memory',
      sourceId: current.id,
      sourceRevision: current.updatedAt ?? current.createdAt,
      status: 'superseded',
    });
    await db.memories.update(id, { content: next, updatedAt });
    const updated = await db.memories.get(id);
    if (updated) await memoryLedgerRepo.syncMemoryItem(updated);
  },

  /** 用新事实替代旧事实，保留旧记录与来源用于审计，但不再召回。 */
  async supersede(oldId: string, replacementId: string): Promise<void> {
    const old = await db.memories.get(oldId);
    if (!old) return;
    await invalidateSessionSummariesForMemory(old);
    const updatedAt = Date.now();
    await db.memories.update(oldId, {
      status: 'superseded',
      supersededBy: replacementId,
      updatedAt,
    });
    await memorySourceTombstoneRepo.record({ userId: old.userId, sourceType: 'memory', sourceId: old.id, sourceRevision: updatedAt, status: 'superseded' });
    const updated = await db.memories.get(oldId);
    if (updated) await memoryLedgerRepo.syncMemoryItem(updated);
  },

  /** 用户明确纠正事实时，停用最可能的旧事实；普通新记忆不会触发。 */
  async supersedeLikelyCorrections(characterId: string, userId: string, replacement: MemoryItem): Promise<void> {
    if (!/(?:其实|不是|不再|已经改成|已经不|更正|纠正|现在是|我改口|说错了)/u.test(replacement.content)) return;
    const stopTerms = new Set(['这个', '那个', '现在', '其实', '不是', '不再', '已经', '改成', '更正', '纠正', '我改', '说错', '用户', '觉得', '感觉', '喜欢', '不喜']);
    const termsOf = (value: string): Set<string> => {
      const normalized = value.normalize('NFKC').toLocaleLowerCase().replace(/[\s\u3000，。、！？：；“”‘’（）()\[\]{}.,!?;:"']/gu, '');
      const terms = new Set<string>();
      for (const run of normalized.matchAll(/[\u4e00-\u9fff]{2,}/gu)) {
        const text = run[0];
        for (let i = 0; i < text.length - 1; i += 1) {
          const term = text.slice(i, i + 2);
          if (!stopTerms.has(term) && !/[我你他很的了在有是不欢]/u.test(term)) terms.add(term);
        }
      }
      for (const word of normalized.matchAll(/[a-z0-9]{3,}/gu)) terms.add(word[0]);
      return terms;
    };
    const replacementTerms = termsOf(replacement.content);
    if (!replacementTerms.size) return;
    const candidates = (await db.memories.where('characterId').equals(characterId).toArray())
      .filter((memory) => memory.userId === userId && memory.id !== replacement.id && (memory.status ?? 'active') === 'active')
      .filter((memory) => memory.memoryKind === replacement.memoryKind && (memory.memoryKind === 'fact' || memory.memoryKind === 'preference'))
      .map((memory) => {
        const oldTerms = termsOf(memory.content);
        const overlap = [...replacementTerms].filter((term) => oldTerms.has(term)).length;
        return { memory, overlap, score: overlap / Math.max(1, Math.min(replacementTerms.size, oldTerms.size)) };
      })
      .filter((item) => item.overlap > 0)
      .sort((a, b) => b.score - a.score || b.overlap - a.overlap);
    const best = candidates[0];
    const next = candidates[1];
    // Automatic correction is deliberately strict: ambiguous overlap leaves
    // both claims available for review instead of silently replacing a fact.
    if (best && (!next || best.score - next.score >= 0.2) && (best.overlap >= 2 || replacementTerms.size <= 3)) {
      await this.supersede(best.memory.id, replacement.id);
    }
  },

  async createMany(memories: MemoryItem[]): Promise<string[]> {
    if (memories.length === 0) return [];
    // 先全部写入，再按角色与账号隔离去重；保留长期证据，召回阶段再控制上下文大小。
    const ids: string[] = [];
    for (const m of memories) {
      const id = await upsertMemory(m);
      ids.push(id);
      const stored = await db.memories.get(id);
      if (stored) await memoryLedgerRepo.syncMemoryItem(stored);
    }
    return ids;
  },

  /** 删除一条记忆（记忆档案里用户主动删除；删除后角色不会再想起来） */
  async deleteById(id: string): Promise<void> {
    const memory = await db.memories.get(id);
    if (memory) {
      await invalidateSessionSummariesForMemory(memory);
      await memoryLedgerRepo.forgetMemoryItem(memory);
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
        await invalidateSessionSummariesForMemory(m);
        await memorySourceTombstoneRepo.record({ userId, sourceType: 'memory', sourceId: m.id, sourceRevision: m.updatedAt ?? m.createdAt, status: 'deleted' });
        await db.memories.delete(m.id);
      }
    }
  },

  async clearForCharacter(characterId: string, userId: string): Promise<void> {
    const all = await db.memories.where('characterId').equals(characterId).toArray();
    for (const m of all) {
      if (m.userId === userId) {
        await invalidateSessionSummariesForMemory(m);
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
