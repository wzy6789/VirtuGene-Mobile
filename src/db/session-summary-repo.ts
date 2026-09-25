import { db, type Session } from './index';
import { invalidateSessionSummaryMemory } from './memory-repo';

/** Invalidate a summary if any message that it may contain changes or disappears. */
export async function invalidateSessionSummarySources(sessionId: string, messageIds: string[]): Promise<void> {
  if (!messageIds.length) return;
  const session = await db.sessions.get(sessionId);
  if (!session?.summary) return;
  const hasSourceIds = (session.summarySourceMessageIds?.length ?? 0) > 0;
  const sourceHit = hasSourceIds && session.summarySourceMessageIds!.some((id) => messageIds.includes(id));
  const legacyMessages = !hasSourceIds ? await db.messages.bulkGet(messageIds) : [];
  const legacyHit = !hasSourceIds && legacyMessages.some((message) => Boolean(message && message.createdAt <= (session.summaryUpdatedAt ?? 0)));
  if (!sourceHit && !legacyHit) return;
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
  await db.sessions.put(rest as Session);
  await invalidateSessionSummaryMemory(session.userId, session.id);
}
