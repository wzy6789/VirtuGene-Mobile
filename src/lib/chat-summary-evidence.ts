import { db, type Session } from '../db/index';
import { messageEvidenceKey, messageEvidencePrefix } from '../db/message-evidence-key';
import type {SummaryCursor} from './ai/summary-batches';

/** Old gateway requests clipped every segment to 1000 UTF-16 units while
 * bookkeeping advanced by 1200. Only that first contiguous prefix is assured;
 * absent offsets assure no range. Keep sourced text but replay uncertain tails.
 * New successful summaries persist explicit offsets for this normalized set. */
export function summaryCoverageCursor(session:Session):SummaryCursor{
  const ids=session.summarySourceMessageIds??[];
  return {sourceMessageIds:ids,sourceMessageRevisions:session.summarySourceMessageRevisions,
    sourceMessageOffsets:session.summaryCoveragePolicy==='lossless-segments-v1'
      ?session.summarySourceMessageOffsets
      :Object.fromEntries(ids.map(id=>[id,Math.min(session.summarySourceMessageOffsets?.[id]??0,1000)]))};
}

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
  // Index-only query: every exact id/session/version/nonfailed tuple must still
  // exist. Reading fresh keys preserves deletion/edit/failure checks without
  // repeatedly deserializing the complete historical message bodies.
  const groups = new Map<number, string[]>();
  for (const id of ids) {
    const group = groups.get(revisions[id]) ?? [];
    group.push(id); groups.set(revisions[id], group);
  }
  return db.transaction('r', db.messages, async () => {
    const results = await Promise.all([...groups].map(async ([revision, sourceIds]) => {
      const index = db.messages.where('sourceEvidenceKey');
      // Large contiguous source sets use getAllKeys over this exact session /
      // revision / nonfailed index range. Avoid thousands of cursor callbacks;
      // still compare every requested original id, and never read any body.
      const prefix = messageEvidencePrefix(session.id, revision);
      const liveIds = sourceIds.length >= 128
        ? await index.between(prefix, prefix + '\uffff', true, false).primaryKeys()
        : await index.anyOf(sourceIds.map(id => messageEvidenceKey({id, sessionId:session.id, revision}))).primaryKeys();
      const live = new Set(liveIds);
      return sourceIds.every(id => live.has(id));
    }));
    return results.every(Boolean);
  });
}
