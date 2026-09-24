/**
 * A summary source cursor tracks how much of each message has actually reached
 * the summarizer. Long pasted messages are sent in 1,200-character segments so
 * a gateway payload cap cannot silently mark the unseen tail as summarized.
 */
export const SUMMARY_SEGMENT_CHARS = 1_200;
export const SUMMARY_BATCH_SEGMENTS = 12;

export interface SummaryCursor {
  sourceMessageIds?: string[];
  sourceMessageRevisions?: Record<string, number>;
  sourceMessageOffsets?: Record<string, number>;
}

export interface SummarySegment<T extends { id: string; revision?: number; content: string }> {
  message: T;
  content: string;
  endOffset: number;
}

function nextSegmentEnd(content: string, offset: number): number {
  let end = Math.min(content.length, offset + SUMMARY_SEGMENT_CHARS);
  // Do not split a supplementary Unicode character across two model prompts.
  if (end < content.length && end > offset) {
    const before = content.charCodeAt(end - 1);
    const after = content.charCodeAt(end);
    if (before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff) end += 1;
  }
  return end;
}

function sameRevision<T extends { id: string; revision?: number }>(message: T, cursor: SummaryCursor): boolean {
  const previousRevision = cursor.sourceMessageRevisions?.[message.id];
  return previousRevision === undefined || previousRevision === (message.revision ?? 1);
}

/** Return non-empty messages whose complete current revision is not covered. */
export function findUncoveredSummaryMessages<T extends { id: string; revision?: number; content: string }>(
  messages: T[],
  cursor: SummaryCursor,
): T[] {
  const sourceIds = new Set(cursor.sourceMessageIds ?? []);
  return messages.filter((message) => {
    if (!message.content.trim()) return false;
    if (!sourceIds.has(message.id) || !sameRevision(message, cursor)) return true;
    const offset = cursor.sourceMessageOffsets?.[message.id];
    // Old summaries had no offset. Their prompt clipped each message to 1,200
    // characters, so only that prefix is trusted; process any remaining tail.
    const coveredThrough = offset ?? Math.min(message.content.length, SUMMARY_SEGMENT_CHARS);
    return coveredThrough < message.content.length;
  });
}

/** Build a chronological, bounded batch and advance offsets only for sent text. */
export function buildSummaryBatch<T extends { id: string; revision?: number; content: string }>(
  messages: T[],
  cursor: SummaryCursor,
  maxSegments = SUMMARY_BATCH_SEGMENTS,
): SummarySegment<T>[] {
  const sourceIds = new Set(cursor.sourceMessageIds ?? []);
  const segments: SummarySegment<T>[] = [];
  for (const message of messages) {
    if (segments.length >= maxSegments) break;
    if (!message.content.trim()) continue;
    const validPrior = sourceIds.has(message.id) && sameRevision(message, cursor);
    const priorOffset = cursor.sourceMessageOffsets?.[message.id];
    let offset = validPrior
      ? (priorOffset ?? Math.min(message.content.length, SUMMARY_SEGMENT_CHARS))
      : 0;
    offset = Math.max(0, Math.min(message.content.length, offset));
    while (offset < message.content.length && segments.length < maxSegments) {
      const endOffset = nextSegmentEnd(message.content, offset);
      segments.push({ message, content: message.content.slice(offset, endOffset), endOffset });
      offset = endOffset;
    }
  }
  return segments;
}
