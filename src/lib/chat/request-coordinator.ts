/** One queue for ordinary sends, diary sharing and assistant relay.
 * Enqueue BEFORE writing the next user message, so an active turn cannot read it. */
const queues = new Map<string, Promise<unknown>>();
export async function withChatSessionLock<T>(sessionId: string, run: () => Promise<T>): Promise<T> {
  const previous = queues.get(sessionId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(run);
  queues.set(sessionId, next);
  try { return await next; }
  finally { if (queues.get(sessionId) === next) queues.delete(sessionId); }
}
