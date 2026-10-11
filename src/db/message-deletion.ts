import { db } from './index';
import { memorySourceTombstoneRepo } from './memory-source-tombstone-repo';

/** Called inside the deletion transaction. Keep full text/image payloads bounded
 * while retaining every message revision for permanent backup-import protection. */
export async function protectDeletedSessionMessages(sessionId: string, userId: string): Promise<string[]> {
  const ids = await db.messages.where('sessionId').equals(sessionId).primaryKeys();
  for (let offset = 0; offset < ids.length; offset += 100) {
    const messages = await db.messages.bulkGet(ids.slice(offset, offset + 100));
    await memorySourceTombstoneRepo.recordMany(messages.flatMap(message => message ? [{
      userId, sourceType: 'message' as const, sourceId: message.id,
      sourceRevision: message.revision ?? 1, status: 'deleted' as const,
    }] : []));
  }
  return ids;
}
