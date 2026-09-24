import { db, type MemoryClaim, type MemoryEvidence, type MemoryEvidenceSource, type MemoryItem, type MemoryJob, type MemoryKnowledge, type MemoryUsage } from './index';

function normalize(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/[\s\u3000，。！？、,.!?;；:："“”‘’（）()【】[\]{}]/g, '').slice(0, 240);
}

function exactKey(kind: MemoryClaim['memoryKind'], value: string): string {
  return `${kind}:${normalize(value)}`;
}

function evidenceId(userId: string, sourceType: MemoryEvidenceSource, sourceId: string, claimId: string): string {
  return `e:${encodeURIComponent(userId)}:${sourceType}:${encodeURIComponent(sourceId)}:${claimId}`;
}

export interface RecordClaimInput {
  userId: string;
  subjectType?: MemoryClaim['subjectType'];
  subjectId?: string;
  predicate?: string;
  value: string;
  canonicalKey?: string;
  memoryKind: MemoryClaim['memoryKind'];
  stability?: MemoryClaim['stability'];
  status?: MemoryClaim['status'];
  confidence?: number;
  importance?: number;
  pinned?: boolean;
  validFrom?: number;
  validUntil?: number;
  source?: { type: MemoryEvidenceSource; id: string; revision?: number; observedAt?: number; confidence?: number; sourceOffset?: number; sourceEndOffset?: number };
  characterIds?: string[];
  canMention?: boolean;
}

/**
 * The canonical memory ledger is an account-scoped index over source records.
 * Source text stays in its original table; this repository stores the claim,
 * provenance ids, and the per-character knowledge edge.
 */
export const memoryLedgerRepo = {
  async record(input: RecordClaimInput): Promise<string> {
    const value = input.value.trim().slice(0, 2_400);
    if (!value) return '';
    const now = Date.now();
    const canonicalKey = input.canonicalKey?.trim() || exactKey(input.memoryKind, value);
    const subjectId = input.subjectId ?? input.userId;
    const matches = await db.memoryClaims.where('[userId+canonicalKey]').equals([input.userId, canonicalKey]).toArray();
    const exact = matches.find((claim) => normalize(claim.value) === normalize(value));
    const conflict = !exact && matches.find((claim) => claim.status === 'active');
    const claimId = exact?.id ?? crypto.randomUUID();
    const sourceType = input.source?.type ?? 'legacy';
    const sourceId = input.source?.id ?? `claim:${claimId}`;
    const characterIds = [...new Set(input.characterIds ?? [])];

    await db.transaction('rw', [db.memoryClaims, db.memoryEvidence, db.memoryKnowledge], async () => {
      const current = exact ? await db.memoryClaims.get(exact.id) : undefined;
      if (!current && conflict) {
        await db.memoryClaims.update(conflict.id, { status: 'disputed', updatedAt: now });
      }
      const oldEvidenceId = input.source ? evidenceId(input.userId, sourceType, sourceId, claimId) : undefined;
      const oldEvidence = oldEvidenceId ? await db.memoryEvidence.get(oldEvidenceId) : undefined;
      const currentKnowledgeRows = await Promise.all(characterIds.map((characterId) => db.memoryKnowledge.get(`${claimId}:${characterId}`)));
      const newerEvidence = Boolean(input.source && oldEvidence && (input.source.revision ?? 1) > oldEvidence.sourceRevision);
      const newIndependentEvidence = Boolean(input.source && currentKnowledgeRows.some((edge) => edge?.revokedAt && edge.sourceId !== sourceId));
      const reauthorized = newerEvidence || newIndependentEvidence;
      const claim: MemoryClaim = current ? {
        ...current,
        confidence: Math.max(current.confidence, input.confidence ?? 0.6),
        importance: Math.max(current.importance, input.importance ?? 0.5),
        pinned: current.pinned === true || input.pinned === true ? true : undefined,
        status: current.status === 'withdrawn'
          ? (reauthorized ? input.status ?? 'active' : 'withdrawn')
          : (input.status ?? current.status),
        stability: input.stability ?? current.stability,
        ...(input.validFrom !== undefined ? { validFrom: input.validFrom } : {}),
        ...(input.validUntil !== undefined ? { validUntil: input.validUntil } : {}),
        updatedAt: now,
      } : {
        id: claimId,
        userId: input.userId,
        subjectType: input.subjectType ?? 'user',
        subjectId,
        predicate: input.predicate ?? input.memoryKind,
        value,
        canonicalKey,
        memoryKind: input.memoryKind,
        stability: input.stability ?? (input.pinned ? 'stable' : 'temporary'),
        status: conflict ? 'disputed' : (input.status ?? 'active'),
        confidence: Math.max(0, Math.min(1, input.confidence ?? 0.6)),
        importance: Math.max(0, Math.min(1, input.importance ?? (input.pinned ? 1 : 0.5))),
        ...(input.pinned ? { pinned: true } : {}),
        ...(input.validFrom !== undefined ? { validFrom: input.validFrom } : {}),
        ...(input.validUntil !== undefined ? { validUntil: input.validUntil } : {}),
        createdAt: now,
        updatedAt: now,
      };
      await db.memoryClaims.put(claim);

      if (input.source) {
        const id = evidenceId(input.userId, sourceType, sourceId, claimId);
        const evidence: MemoryEvidence = {
          id,
          userId: input.userId,
          claimId,
          sourceType,
          sourceId,
          sourceRevision: input.source.revision ?? 1,
          observedAt: input.source.observedAt ?? now,
          confidence: input.source.confidence ?? input.confidence ?? 0.6,
          ...(oldEvidence?.withdrawnAt && !newerEvidence ? { withdrawnAt: oldEvidence.withdrawnAt } : {}),
          ...(input.source.sourceOffset !== undefined ? { sourceOffset: input.source.sourceOffset } : {}),
          ...(input.source.sourceEndOffset !== undefined ? { sourceEndOffset: input.source.sourceEndOffset } : {}),
        };
        await db.memoryEvidence.put(evidence);
      }

      for (const [index, characterId] of characterIds.entries()) {
        const id = `${claimId}:${characterId}`;
        const currentKnowledge = currentKnowledgeRows[index];
        const canMention = currentKnowledge?.revokedAt && !reauthorized
          ? false
          : input.canMention ?? currentKnowledge?.canMention ?? true;
        const knowledge: MemoryKnowledge = {
          id,
          userId: input.userId,
          claimId,
          characterId,
          knowledgeLevel: 'full',
          canMention,
          learnedAt: currentKnowledge?.learnedAt ?? input.source?.observedAt ?? now,
          // Point the current edge at the newest evidence. The full provenance
          // graph remains in memoryEvidence, while this edge is the active
          // permission anchor used for revocation checks.
          sourceType,
          sourceId,
          ...(!reauthorized && currentKnowledge?.revokedAt ? { revokedAt: currentKnowledge.revokedAt } : {}),
        };
        await db.memoryKnowledge.put(knowledge);
      }
    });
    return claimId;
  },

  /** Bridge for the existing MemoryItem API during the staged migration. */
  async syncMemoryItem(memory: MemoryItem): Promise<string> {
    const sourceSession = memory.sourceSessionId ? await db.sessions.get(memory.sourceSessionId) : undefined;
    const sourceType: MemoryEvidenceSource = memory.importedFromMemoryId
      ? 'legacy'
      : sourceSession?.type === 'group' ? 'group'
        : memory.sourceMessageIds?.length ? 'chat' : 'legacy';
    const sourceIds = memory.sourceMessageIds?.length ? memory.sourceMessageIds : memory.importedFromMemoryId ? [memory.importedFromMemoryId] : [memory.id];
    let firstId = '';
    for (const sourceId of sourceIds) {
      const id = await this.record({
        userId: memory.userId,
        subjectType: 'user',
        subjectId: memory.userId,
        predicate: memory.memoryKind ?? 'fact',
        value: memory.content,
        canonicalKey: exactKey(memory.memoryKind ?? 'fact', memory.content),
        memoryKind: memory.memoryKind ?? 'fact',
        stability: memory.stability,
        status: memory.status === 'withdrawn' ? 'withdrawn' : memory.status === 'superseded' ? 'superseded' : 'active',
        confidence: memory.confidence,
        importance: memory.pinned ? 1 : 0.5,
        pinned: memory.pinned,
        source: {
          type: sourceType,
          id: sourceId,
          revision: memory.sourceMessageRevisions?.[sourceId] ?? 1,
          observedAt: memory.createdAt,
          confidence: memory.confidence,
          ...(memory.sourceMessageOffsets?.[sourceId] !== undefined ? { sourceOffset: memory.sourceMessageOffsets[sourceId] } : {}),
          ...(memory.sourceMessageEndOffsets?.[sourceId] !== undefined ? { sourceEndOffset: memory.sourceMessageEndOffsets[sourceId] } : {}),
        },
        characterIds: [memory.characterId],
        canMention: memory.status !== 'withdrawn' && memory.status !== 'superseded',
      });
      firstId ||= id;
    }
    return firstId;
  },

  async forgetMemoryItem(memory: MemoryItem): Promise<void> {
    const key = exactKey(memory.memoryKind ?? 'fact', memory.content);
    const claims = await db.memoryClaims.where('[userId+canonicalKey]').equals([memory.userId, key]).toArray();
    const claimIds = claims.filter((claim) => normalize(claim.value) === normalize(memory.content)).map((claim) => claim.id);
    if (!claimIds.length) return;
    const now = Date.now();
    await db.transaction('rw', db.memoryKnowledge, async () => {
      for (const claimId of claimIds) {
        const id = `${claimId}:${memory.characterId}`;
        const edge = await db.memoryKnowledge.get(id);
        if (edge) await db.memoryKnowledge.put({ ...edge, canMention: false, revokedAt: now });
      }
    });
  },

  async enqueue(input: Omit<MemoryJob, 'id' | 'status' | 'attempts' | 'availableAt' | 'createdAt' | 'updatedAt'>): Promise<string> {
    const sourceIds = [...new Set(input.sourceIds)].sort();
    const ranges = JSON.stringify(Object.entries(input.sourceOffsets ?? {}).sort(([a], [b]) => a.localeCompare(b)).map(([sourceId, start]) => [sourceId, start, input.sourceEndOffsets?.[sourceId] ?? '']));
    const revisions = JSON.stringify(Object.entries(input.sourceRevisions ?? {}).sort(([a], [b]) => a.localeCompare(b)));
    const id = `job:${encodeURIComponent(input.userId)}:${input.task}:${input.sourceType}:${sourceIds.map(encodeURIComponent).join(',')}:${encodeURIComponent(revisions)}:${encodeURIComponent(ranges)}`;
    const existing = await db.memoryJobs.get(id);
    if (existing && ['queued', 'running', 'retry', 'done'].includes(existing.status)) return id;
    const now = Date.now();
    await db.memoryJobs.put({
      ...input,
      id,
      sourceIds,
      status: 'queued',
      attempts: existing?.attempts ?? 0,
      availableAt: now,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
    return id;
  },

  async leaseNext(userId: string, now = Date.now(), leaseMs = 60_000): Promise<MemoryJob | undefined> {
    return db.transaction('rw', db.memoryJobs, async () => {
      const rows = await db.memoryJobs.where('userId').equals(userId).toArray();
      const candidates = rows.filter((job) => job.status === 'queued' || job.status === 'retry' || (job.status === 'running' && (job.leaseUntil ?? 0) <= now));
      const job = candidates.sort((a, b) => a.availableAt - b.availableAt || a.createdAt - b.createdAt)[0];
      if (!job) return undefined;
      const leased = { ...job, status: 'running' as const, leaseUntil: now + leaseMs, attempts: job.attempts + 1, updatedAt: now };
      await db.memoryJobs.put(leased);
      return leased;
    });
  },

  /** Lease a small same-session batch so extraction keeps conversational context without racing another tab. */
  async leaseNextBatch(userId: string, limit = 8, now = Date.now(), leaseMs = 90_000): Promise<MemoryJob[]> {
    return db.transaction('rw', db.memoryJobs, async () => {
      const rows = await db.memoryJobs.where('userId').equals(userId).toArray();
      const eligible = rows
        .filter((job) => (job.status === 'queued' || job.status === 'retry' || (job.status === 'running' && (job.leaseUntil ?? 0) <= now)) && job.availableAt <= now)
        .sort((a, b) => a.availableAt - b.availableAt || a.createdAt - b.createdAt);
      const first = eligible[0];
      if (!first) return [];
      const audienceKey = [...first.characterIds].sort().join('\u0000');
      const batch = eligible.filter((job) => job.sessionId === first.sessionId && job.sourceType === first.sourceType && [...job.characterIds].sort().join('\u0000') === audienceKey).slice(0, Math.max(1, limit));
      const leased: MemoryJob[] = [];
      for (const job of batch) {
        const row = { ...job, status: 'running' as const, leaseUntil: now + leaseMs, attempts: job.attempts + 1, updatedAt: now };
        await db.memoryJobs.put(row);
        leased.push(row);
      }
      return leased;
    });
  },

  async finishJob(id: string, payload?: unknown): Promise<void> {
    const now = Date.now();
    await db.memoryJobs.update(id, { status: 'done', payload, leaseUntil: undefined, lastError: undefined, updatedAt: now });
  },

  async cancelJob(id: string, payload?: unknown): Promise<void> {
    const now = Date.now();
    await db.memoryJobs.update(id, { status: 'cancelled', payload, leaseUntil: undefined, updatedAt: now });
  },

  async retryJob(id: string, error: string): Promise<void> {
    const job = await db.memoryJobs.get(id);
    if (!job) return;
    const now = Date.now();
    const terminal = job.attempts >= 8;
    const delay = Math.min(6 * 60 * 60_000, 15_000 * 2 ** Math.min(10, job.attempts));
    await db.memoryJobs.update(id, { status: terminal ? 'failed' : 'retry', availableAt: terminal ? Number.MAX_SAFE_INTEGER : now + delay, leaseUntil: undefined, lastError: error.slice(0, 240), updatedAt: now });
  },

  async recordUsage(input: Omit<MemoryUsage, 'id' | 'at'> & { at?: number }): Promise<void> {
    const at = input.at ?? Date.now();
    const id = `${encodeURIComponent(input.userId)}:${encodeURIComponent(input.characterId)}:${input.messageId ?? `at:${at}`}:${input.claimId}:${input.stage}`;
    await db.memoryUsage.put({ ...input, id, at });
  },

  async claimsKnownBy(userId: string, characterId: string): Promise<MemoryClaim[]> {
    const edges = await db.memoryKnowledge.where('[userId+characterId]').equals([userId, characterId]).toArray();
    const sourceTypeForTombstone: Partial<Record<MemoryEvidenceSource, string>> = {
      chat: 'message', group: 'message', legacy: 'memory', moment: 'moment', momentReaction: 'momentReaction',
      diary: 'diary', todo: 'todo', todoOccurrence: 'todoOccurrence', worldEvent: 'worldEvent', sharedMemory: 'sharedMemory',
      worldScene: 'worldScene', worldSceneEntry: 'worldSceneEntry', continuityThread: 'continuityThread', relationshipEvent: 'relationshipEvent',
    };
    const eligible: MemoryKnowledge[] = [];
    for (const edge of edges) {
      if (!edge.canMention || edge.revokedAt) continue;
      const sourceType = sourceTypeForTombstone[edge.sourceType];
      if (!sourceType) continue;
      const tombstoneId = `memory-source:${encodeURIComponent(userId)}:${sourceType}:${encodeURIComponent(edge.sourceId)}`;
      const tombstone = await db.memorySourceTombstones.get(tombstoneId);
      if (!tombstone) { eligible.push(edge); continue; }
      if (tombstone.status === 'deleted') continue;
      const evidence = await db.memoryEvidence.where('[userId+claimId]').equals([userId, edge.claimId])
        .filter((row) => row.sourceType === edge.sourceType && row.sourceId === edge.sourceId).first();
      if ((evidence?.sourceRevision ?? 0) > tombstone.sourceRevision) eligible.push(edge);
    }
    const allowed = new Set(eligible.map((edge) => edge.claimId));
    const claims = await db.memoryClaims.where('userId').equals(userId).toArray();
    return claims.filter((claim) => allowed.has(claim.id) && claim.status === 'active');
  },

  async findClaim(userId: string, memoryKind: MemoryClaim['memoryKind'], value: string): Promise<MemoryClaim | undefined> {
    const key = exactKey(memoryKind, value);
    const rows = await db.memoryClaims.where('[userId+canonicalKey]').equals([userId, key]).toArray();
    return rows.find((row) => normalize(row.value) === normalize(value));
  },

  async claimIdsForSource(userId: string, sourceType: MemoryEvidenceSource, sourceId: string): Promise<string[]> {
    const evidence = await db.memoryEvidence.where('[userId+sourceType+sourceId]').equals([userId, sourceType, sourceId]).toArray();
    return [...new Set(evidence.filter((row) => !row.withdrawnAt).map((row) => row.claimId))];
  },

  async jobStatusForCharacter(userId: string, characterId: string): Promise<{ pending: number; failed: number }> {
    const rows = await db.memoryJobs.where('userId').equals(userId).toArray();
    const relevant = rows.filter((job) => job.characterIds.includes(characterId));
    return {
      pending: relevant.filter((job) => job.status === 'queued' || job.status === 'retry' || job.status === 'running').length,
      failed: relevant.filter((job) => job.status === 'failed').length,
    };
  },

  async retryFailedJobs(userId: string, characterId: string): Promise<number> {
    const rows = await db.memoryJobs.where('userId').equals(userId).toArray();
    const retry = rows.filter((job) => job.characterIds.includes(characterId) && job.status === 'failed');
    const now = Date.now();
    for (const job of retry) await db.memoryJobs.update(job.id, { status: 'queued', attempts: 0, availableAt: now, leaseUntil: undefined, lastError: undefined, updatedAt: now });
    return retry.length;
  },

  async revokeSource(userId: string, sourceType: MemoryEvidenceSource, sourceId: string): Promise<number> {
    return db.transaction('rw', [db.memoryEvidence, db.memoryKnowledge, db.memoryClaims], async () => {
      const rows = await db.memoryEvidence.where('[userId+sourceType+sourceId]').equals([userId, sourceType, sourceId]).toArray();
      if (rows.length === 0) return 0;
      const now = Date.now();
      await db.memoryEvidence.bulkPut(rows.map((row) => ({ ...row, withdrawnAt: now })));
      const claims = new Set(rows.map((row) => row.claimId));
      for (const claimId of claims) {
        const knowledge = await db.memoryKnowledge.where('[userId+claimId]').equals([userId, claimId]).toArray();
        const stillHasEvidence = await db.memoryEvidence.where('[userId+claimId]').equals([userId, claimId]).filter((row) => !row.withdrawnAt).count();
        if (stillHasEvidence === 0) {
          await db.memoryKnowledge.bulkPut(knowledge.map((row) => ({ ...row, canMention: false, revokedAt: now })));
          await db.memoryClaims.update(claimId, { status: 'withdrawn', updatedAt: now });
        } else {
          await db.memoryKnowledge.where('[userId+claimId]').equals([userId, claimId]).filter((row) => row.sourceType === sourceType && row.sourceId === sourceId).modify({ canMention: false, revokedAt: now });
        }
      }
      return rows.length;
    });
  },
};
