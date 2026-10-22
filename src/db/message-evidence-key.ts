import { isIncompleteAssistantReply, type ReplyDeliveryState } from '../lib/chat/reply-delivery';

/** An index projection of source identity, never a cache of authorization.
 * Message writes and their index update commit in the same IndexedDB transaction. */
export function messageEvidenceKey(row: ReplyDeliveryState & { id: string; sessionId: string; revision?: number; failed?: boolean }): string {
  return JSON.stringify([row.sessionId, row.revision ?? 1, !row.failed && !isIncompleteAssistantReply(row), row.id]);
}

export function messageEvidencePrefix(sessionId: string, revision: number): string {
  return JSON.stringify([sessionId, revision, true]).slice(0, -1) + ',';
}
