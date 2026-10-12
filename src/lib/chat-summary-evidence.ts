import { db, type Session } from '../db/index';

/** A compressed record is usable only while its exact source versions live.
 * Legacy summaries remain stored; they do not acquire guessed provenance. */
export async function hasLivePrivateSummarySources(
  session: Session | undefined,
  userId: string,
  characterId: string,
  suppressed: ReadonlySet<string> = new Set(),
): Promise<boolean> {
  if (!session?.summary?.trim() || session.userId !== userId
    || session.characterId !== characterId || session.type === 'group') return false;
  const ids = session.summarySourceMessageIds ?? [];
  if (!ids.length || new Set(ids).size !== ids.length || ids.some(id => suppressed.has(id))) return false;
  const revisions = session.summarySourceMessageRevisions ?? {};
  if (ids.some(id => !Number.isInteger(revisions[id]) || revisions[id] < 1)) return false;
  const messages = await db.messages.bulkGet(ids);
  return messages.every((message, index) => !!message && message.sessionId === session.id
    && !message.failed && (message.revision ?? 1) === revisions[ids[index]]);
}
