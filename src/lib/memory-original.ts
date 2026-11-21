import { db } from '../db';
import { memorySourceTombstoneRepo } from '../db/memory-source-tombstone-repo';

export interface MemoryOriginal {
  quotes: { id: string; text: string }[];
  unavailable: number;
  changed: boolean;
}

/** Selected archive evidence only. Never cache authorization or scan history. */
export async function readMemoryOriginal(userId: string, characterId: string, memoryId: string): Promise<MemoryOriginal> {
  return db.transaction('r', db.memories, db.messages, db.sessions, db.memorySourceTombstones, async () => {
    const empty: MemoryOriginal = { quotes: [], unavailable: 0, changed: false };
    const memory = await db.memories.get(memoryId);
    if (!memory || memory.userId !== userId || memory.characterId !== characterId || memory.status === 'withdrawn') return empty;
    const ids = [...new Set(memory.sourceMessageIds ?? [])];
    if (!ids.length) return empty;
    const messages = await db.messages.bulkGet(ids);
    const sessionIds = [...new Set(messages.flatMap(m => m ? [m.sessionId] : []))];
    const [sessions, suppressed, blocked] = await Promise.all([
      db.sessions.bulkGet(sessionIds),
      memorySourceTombstoneRepo.selectedSuppressedMessages(userId, characterId, ids),
      memorySourceTombstoneRepo.blocksImports(messages.flatMap(m => m ? [{ userId, sourceType: 'message' as const, sourceId: m.id, sourceRevision: m.revision ?? 1 }] : [])),
    ]);
    const bySession = new Map(sessions.flatMap(s => s ? [[s.id, s] as const] : []));
    let blockIndex = 0;
    // Imports share summaries, never authority to inspect another role's raw
    // chat. A deduplicated row may still retain valid current-role sources.
    for (const message of messages) {
      const denied = message ? blocked[blockIndex++] : true;
      const session = message && bySession.get(message.sessionId);
      if (!message || !session || session.userId !== userId || message.failed || message.interrupted || denied
        || suppressed.has(message.id) || memory.sourceSessionId && memory.sourceSessionId !== session.id
        || (session.type === 'group' ? !message.witnessedBy?.includes(characterId) : session.characterId !== characterId)) {
        empty.unavailable++; continue;
      }
      if ((memory.sourceMessageRevisions?.[message.id] ?? 1) !== (message.revision ?? 1)) {
        empty.unavailable++; empty.changed = true; continue;
      }
      const start = memory.sourceMessageOffsets?.[message.id] ?? 0;
      const end = memory.sourceMessageEndOffsets?.[message.id] ?? message.content.length;
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > message.content.length) {
        empty.unavailable++; continue;
      }
      empty.quotes.push({ id: message.id, text: message.content.slice(start, Math.min(end, start + 160)) });
    }
    return empty;
  });
}
