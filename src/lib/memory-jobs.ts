import { db, type Message } from '../db';
import { memoryLedgerRepo } from '../db/memory-ledger-repo';
import { invalidateUnpinnedMemoriesForMessages, memoryRepo, normalizeMemoryKey } from '../db/memory-repo';
import { memorySourceTombstoneRepo } from '../db/memory-source-tombstone-repo';
import { extractMemories } from './ai/memory-consolidator';
import { hasAiGatewayAccess } from './ai/gateway';
import { prepareMemoryMetadata } from './memory-engine';

const runningUsers = new Set<string>();

async function jobSourcesAreCurrent(userId: string, job: import('../db').MemoryJob): Promise<boolean> {
  const currentJob = await db.memoryJobs.get(job.id);
  if (currentJob?.status !== 'running') return false;
  for (const sourceId of job.sourceIds) {
    const source = await db.messages.get(sourceId);
    const expectedRevision = job.sourceRevisions?.[sourceId] ?? 1;
    const session = source ? await db.sessions.get(source.sessionId) : undefined;
    if (!source || !session || session.userId !== userId || source.sessionId !== job.sessionId || source.role !== 'user'
      || source.failed || (source.revision ?? 1) !== expectedRevision
      || (job.sourceType === 'group' && !job.characterIds.every((id) => source.witnessedBy?.includes(id)))
      || await memorySourceTombstoneRepo.blocksImport({ userId, sourceType: 'message', sourceId, sourceRevision: expectedRevision })) return false;
  }
  return true;
}

/**
 * Durable, account-scoped extraction worker. User-authored messages are the
 * only extraction evidence; group audiences are the witness snapshot stored
 * with the source message, never the current group membership.
 */
export async function processMemoryJobs(userId: string, apiKey: string | null, maxBatches = 2): Promise<number> {
  if (!userId || (!apiKey?.trim() && !hasAiGatewayAccess()) || runningUsers.has(userId)) return 0;
  runningUsers.add(userId);
  let completed = 0;
  try {
    for (let batchIndex = 0; batchIndex < Math.max(1, maxBatches); batchIndex += 1) {
      const jobs = await memoryLedgerRepo.leaseNextBatch(userId);
      if (!jobs.length) break;
      const activeJobs = jobs.filter((job) => job.task === 'extract' && (job.sourceType === 'chat' || job.sourceType === 'group'));
      const invalidJobs = jobs.filter((job) => !activeJobs.includes(job));
      for (const job of invalidJobs) await memoryLedgerRepo.finishJob(job.id, { skipped: true, reason: 'unsupported-task' });
      if (!activeJobs.length) continue;

      try {
        const sourceIds = [...new Set(activeJobs.flatMap((job) => job.sourceIds))];
        const messages = (await db.messages.bulkGet(sourceIds))
          .filter((message): message is Message => Boolean(message))
          .sort((a, b) => a.createdAt - b.createdAt);
        const messageById = new Map(messages.map((message) => [message.id, message]));
        const slices: { sourceId: string; revision: number; text: string; at: number; start: number; end: number }[] = [];
        const validJobIds = new Set<string>();

        for (const job of activeJobs) {
          let jobValid = true;
          for (const sourceId of job.sourceIds) {
            const message = messageById.get(sourceId);
            const expectedRevision = job.sourceRevisions?.[sourceId] ?? 1;
            const start = job.sourceOffsets?.[sourceId] ?? 0;
            const end = job.sourceEndOffsets?.[sourceId] ?? message?.content.length ?? 0;
            const session = message ? await db.sessions.get(message.sessionId) : undefined;
            if (!message || !session || session.userId !== userId || message.sessionId !== job.sessionId || message.role !== 'user' || (message.revision ?? 1) !== expectedRevision) {
              jobValid = false;
              continue;
            }
            if (message.failed) {
              jobValid = false;
              continue;
            }
            if (job.sourceType === 'group' && !job.characterIds.every((id) => message.witnessedBy?.includes(id))) {
              jobValid = false;
              continue;
            }
            const blocked = await memorySourceTombstoneRepo.blocksImport({
              userId,
              sourceType: 'message',
              sourceId,
              sourceRevision: expectedRevision,
            });
            if (blocked) {
              jobValid = false;
              continue;
            }
            const text = message.content.slice(Math.max(0, start), Math.max(start, end)).trim();
            if (text) slices.push({ sourceId, revision: expectedRevision, text, at: message.createdAt, start, end });
            else jobValid = false;
          }
          if (jobValid) validJobIds.add(job.id);
          else await memoryLedgerRepo.cancelJob(job.id, { reason: 'source-unavailable-edited-deleted-or-revoked' });
        }

        const validJobs = activeJobs.filter((job) => validJobIds.has(job.id));
        if (!slices.length || !validJobs.length) {
          for (const job of validJobs) {
            const current = await db.memoryJobs.get(job.id);
            if (current?.status === 'running') await memoryLedgerRepo.cancelJob(job.id, { reason: 'source-unavailable-or-revoked' });
          }
          continue;
        }

        // Include only the exact user-authored source segments. This avoids
        // attributing a character's generated guess or private audience data
        // to the user as if it were a confirmed fact.
        const result = await extractMemories({
          apiKey: apiKey ?? '',
          history: slices.map((slice) => ({ role: 'user', content: slice.text })),
        });
        if (result.error) throw new Error(result.error);

        // Discard model output if a source changed during inference. Since the
        // extractor returns one batch of claims, it cannot safely separate
        // facts from a stale slice and a current slice after the fact.
        const validBeforeWrite = await Promise.all(validJobs.map((job) => jobSourcesAreCurrent(userId, job)));
        if (validBeforeWrite.some((valid) => !valid)) {
          for (let index = 0; index < validJobs.length; index += 1) {
            const job = validJobs[index];
            if (validBeforeWrite[index]) {
              await db.memoryJobs.update(job.id, { status: 'queued', availableAt: Date.now(), leaseUntil: undefined, updatedAt: Date.now() });
            } else if ((await db.memoryJobs.get(job.id))?.status === 'running') {
              await memoryLedgerRepo.cancelJob(job.id, { reason: 'source-changed-during-extraction' });
            }
          }
          continue;
        }

        const evidenceIds = [...new Set(slices.map((slice) => slice.sourceId))];
        const evidenceRevisions = Object.fromEntries(slices.map((slice) => [slice.sourceId, slice.revision]));
        const evidenceOffsets = Object.fromEntries(slices.map((slice) => [slice.sourceId, slice.start]));
        const evidenceEndOffsets = Object.fromEntries(slices.map((slice) => [slice.sourceId, slice.end]));
        const now = Date.now();
        const extracted = [...new Set((result.memories ?? []).map((value) => value.trim()).filter(Boolean))].slice(0, 20);
        for (const characterId of activeJobs[0].characterIds) {
          const character = await db.characters.get(characterId);
          if (!character || character.createdBy !== userId) continue;
          const existing = await memoryRepo.getByCharacter(characterId, userId);
          const existingKeys = new Set(existing.filter((memory) => (memory.status ?? 'active') === 'active').map((memory) => normalizeMemoryKey(memory.content)));
          const fresh = extracted.filter((content) => !existingKeys.has(normalizeMemoryKey(content)));
          if (!fresh.length) continue;
          const rows = fresh.map((content, index) => ({
            id: crypto.randomUUID(),
            characterId,
            userId,
            content,
            type: 'auto' as const,
            ...prepareMemoryMetadata(content, { confidence: evidenceIds.length ? 0.9 : 0.6 }),
            createdAt: now + index,
            sourceSessionId: activeJobs[0].sessionId,
            sourceMessageIds: evidenceIds,
            sourceMessageRevisions: evidenceRevisions,
            sourceMessageOffsets: evidenceOffsets,
            sourceMessageEndOffsets: evidenceEndOffsets,
            confidence: evidenceIds.length ? 0.9 : 0.6,
            updatedAt: now + index,
          }));
          await memoryRepo.createMany(rows);
        }

        // Close the final race between validation and persistence. If a source
        // changed during the write, remove derived unpinned summaries; the
        // source tombstone also blocks any stale ledger provenance.
        const validAfterWrite = await Promise.all(validJobs.map((job) => jobSourcesAreCurrent(userId, job)));
        if (validAfterWrite.some((valid) => !valid)) await invalidateUnpinnedMemoriesForMessages(userId, evidenceIds);
        for (let index = 0; index < validJobs.length; index += 1) {
          const job = validJobs[index];
          if (!validAfterWrite[index]) {
            const current = await db.memoryJobs.get(job.id);
            if (current?.status === 'running') await memoryLedgerRepo.cancelJob(job.id, { reason: 'source-changed-during-persistence' });
            continue;
          }
          await memoryLedgerRepo.finishJob(job.id, { memoryCount: extracted.length, evidenceIds, evidenceRevisions });
          completed += 1;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'memory-extraction-failed';
        for (const job of activeJobs) {
          const current = await db.memoryJobs.get(job.id);
          if (current?.status === 'running') await memoryLedgerRepo.retryJob(job.id, message);
        }
      }
    }
  } finally {
    runningUsers.delete(userId);
  }
  return completed;
}
