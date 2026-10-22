/** Transaction-safe source invalidation shared by message/session maintenance. */
import { db, type MemoryEvidenceSource, type MemoryItem } from './index';
import { memoryLedgerRepo } from './memory-ledger-repo';
import { memorySourceTombstoneRepo } from './memory-source-tombstone-repo';


export function isSessionAggregateSummary(memory: MemoryItem): boolean {
  return memory.type === 'summary' && Boolean(memory.sourceSessionId);
}


export async function revokeMemoryEvidence(
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
  await memoryLedgerRepo.revokeClaimSources(memory.userId, claim.id, [sourceType], sourceIds, exhaustedStatus);
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
    const revokedIdSet = new Set(revokedIds);
    const remainingIds = allSourceIds.filter((id) => !revokedIdSet.has(id));
    // Legacy batch extraction has no per-fact evidence mapping. Treat that batch
    // as a dependency set, never as independent confirmations of every fact.
    const dependentBatch = memory.type === 'auto' && !memory.pinned && allSourceIds.length > 1
      && memory.sourceEvidenceMode !== 'independent';
    const shouldSupersede = isAggregateSummary || dependentBatch || (!memory.pinned && remainingIds.length === 0);
    const retainedIds = remainingIds;
    const retainedIdSet = new Set(retainedIds);
    const retainMap = (value?: Record<string, number>) => {
      if (!value) return undefined;
      const next = Object.fromEntries(Object.entries(value).filter(([id]) => retainedIdSet.has(id)));
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
    if (claim) {
      // Revoke only this memory claim's evidence edge. A different fact extracted
      // from the same message remains supported by that message.
      await memoryLedgerRepo.revokeClaimSources(userId, claim.id, sourceTypes, revokedIds,
        shouldSupersede ? 'superseded' : 'withdrawn');
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
