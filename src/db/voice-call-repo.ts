import { db } from './index';
import { messageRepo } from './message-repo';
import { projectCallMessages, type VoiceCallRecord } from '../lib/voice-call/record';
import { useAuthStore } from '../store/auth-store';
import { memorySourceTombstoneRepo } from './memory-source-tombstone-repo';
import Dexie from 'dexie';

/** Audit data and its heard-speech projection commit atomically, using existing memory job rules. */
export const voiceCallRepo = {
  async save(record: VoiceCallRecord): Promise<VoiceCallRecord> {
    projectCallMessages(record);
    if (!Number.isFinite(record.startedAt) || !Number.isFinite(record.endedAt) || record.endedAt < record.startedAt) throw new Error('voice:record');
    return db.transaction('rw', db.tables, async () => {
      if (useAuthStore.getState().userId !== record.userId) throw new Error('voice:account_changed');
      const [session, character, existing] = await Promise.all([
        db.sessions.get(record.sessionId), db.characters.get(record.characterId), db.voiceCalls.get(record.id),
      ]);
      if (!session || session.userId !== record.userId || session.characterId !== record.characterId || session.type === 'group'
        || !character || character.createdBy !== record.userId || character.agentProfile === 'secretary') throw new Error('voice:context_changed');
      if (existing) {
        if (existing.userId !== record.userId || existing.sessionId !== record.sessionId || existing.characterId !== record.characterId) throw new Error('voice:record_collision');
        if (existing.status !== 'active' || existing.exchanges.length > record.exchanges.length) return existing;
      }
      // Previous committed turns are immutable; only append new completed/interrupted turns.
      const exchanges = [...(existing?.exchanges ?? []), ...record.exchanges.slice(existing?.exchanges.length ?? 0)].map((exchange, index) => ({
        ...exchange, recordedAt: exchange.recordedAt ?? record.endedAt + index * 2,
      }));
      const rows = projectCallMessages({ ...record, exchanges });
      for (const row of rows) {
        if (await memorySourceTombstoneRepo.blocksImport({ userId: record.userId, sourceType: 'message', sourceId: row.id, sourceRevision: 1 })) throw new Error('voice:source_withdrawn');
        const current = await db.messages.get(row.id);
        if (existing?.messageIds.includes(row.id)) {
          if (!current || current.sessionId !== row.sessionId || current.role !== row.role || current.content !== row.content) throw new Error('voice:source_changed');
          continue;
        }
        if (current) throw new Error('voice:message_collision');
        await messageRepo.create(row);
      }
      const saved = { ...record, summary: undefined, summaryParts: undefined, summaryTotalParts: undefined, summaryState: 'pending' as const, messageIds: rows.map(row => row.id),
        exchanges: exchanges.map(exchange => ({ ...exchange, heardText: rows.find(row => row.id === `voice:${record.id}:${exchange.turnId}:assistant`)?.content ?? '' })) };
      await db.voiceCalls.put(saved);
      await db.sessions.update(record.sessionId, { updatedAt: Math.max(record.endedAt, session.updatedAt) });
      if (useAuthStore.getState().userId !== record.userId) throw new Error('voice:account_changed');
      return saved;
    });
  },
  async get(id: string, userId: string): Promise<VoiceCallRecord | undefined> {
    if (useAuthStore.getState().userId !== userId) return;
    const row = await db.voiceCalls.get(id);
    return useAuthStore.getState().userId === userId && row?.userId === userId ? row : undefined;
  },
  async list(sessionId: string, userId: string, options: { before?: number; beforeId?: string; limit?: number } = {}): Promise<VoiceCallRecord[]> {
    if (useAuthStore.getState().userId !== userId) return [];
    const session = await db.sessions.get(sessionId);
    if (session?.userId !== userId) return [];
    const rows = await db.voiceCalls.where('[sessionId+endedAt]').between([sessionId, Dexie.minKey], [sessionId, options.before ?? Dexie.maxKey], true, options.before === undefined || !!options.beforeId)
      .reverse().filter(row => row.userId === userId && !(options.beforeId && row.endedAt === options.before && row.id >= options.beforeId)).limit(Math.max(1, Math.min(50, options.limit ?? 20))).toArray();
    return useAuthStore.getState().userId === userId ? rows : [];
  },
};
