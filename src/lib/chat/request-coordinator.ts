/** One queue for ordinary sends, diary sharing and assistant relay.
 * Enqueue BEFORE writing the next user message, so an active turn cannot read it. */
const queues = new Map<string, Promise<unknown>>();
const foregroundListeners = new Set<() => void>();
/** Low priority work must yield as soon as a send is queued, not after it finishes. */
export function onChatRequestStart(listener: () => void): () => void {
  foregroundListeners.add(listener);
  return () => { foregroundListeners.delete(listener); };
}
/** Low-priority indexing yields to any foreground chat, including relayed sends. */
export function hasActiveChatRequest(): boolean { return queues.size > 0; }
export async function withChatSessionLock<T>(sessionId: string, run: () => Promise<T>): Promise<T> {
  const previous = queues.get(sessionId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(run);
  queues.set(sessionId, next);
  // A low-priority observer is not an authorization gate. Its failure must
  // never strand this queue or reject a foreground message before its finally.
  for (const listener of foregroundListeners) { try { listener(); } catch {} }
  try { return await next; }
  finally { if (queues.get(sessionId) === next) queues.delete(sessionId); }
}
