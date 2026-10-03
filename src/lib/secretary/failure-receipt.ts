import { db } from '../../db';
import { memorySourceTombstoneRepo } from '../../db/memory-source-tombstone-repo';
import type { SecretaryTask } from './types';
import { readSecretaryFailureReason, secretaryFailureMessage } from './failure';

/** Call inside the task write transaction so its failure and receipt commit together. */
export async function writeSecretaryFailureReceipt(task: SecretaryTask): Promise<boolean> {
  if (task.status !== 'failed' || task.results.length) return false;
  return db.transaction('rw', [db.messages, db.sessions, db.memorySourceTombstones], async () => {
    const [source, session] = await Promise.all([db.messages.get(task.messageId), db.sessions.get(task.sessionId)]);
    if (!source || source.role !== 'user' || source.sessionId !== task.sessionId
      || !session || session.userId !== task.userId || session.characterId !== task.characterId || session.type === 'group') return false;
    const content = readSecretaryFailureReason(task.failureReason);
    // An edited source receives a local stop notice, never the previous plan's result.
    if (source.content !== task.request && content !== secretaryFailureMessage(new Error('planning:source_changed'))) return false;
    const id = `secretary-reply:${task.messageId}`;
    if (await memorySourceTombstoneRepo.blocksImport({ userId: task.userId, sourceType: 'message', sourceId: source.id, sourceRevision: source.revision ?? 1 })
      || await memorySourceTombstoneRepo.blocksImport({ userId: task.userId, sourceType: 'message', sourceId: id, sourceRevision: 1 })) return false;
    const reply = await db.messages.get(id);
    if (!reply) await db.messages.add({ id, sessionId: task.sessionId, role: 'assistant', content,
      createdAt: task.updatedAt, isProactive: false, revision: 1, secretaryTaskId: task.id });
    else {
      if (reply.role !== 'assistant' || reply.sessionId !== task.sessionId || reply.secretaryTaskId !== task.id) return false;
      if (reply.content !== content) await db.messages.update(id, { content, revision: (reply.revision ?? 1) + 1 });
    }
    return true;
  });
}
