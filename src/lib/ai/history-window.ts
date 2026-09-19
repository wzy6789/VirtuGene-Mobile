/**
 * Keep auxiliary AI requests small and deterministic.
 *
 * Chat itself has a separate rolling window. Emotion analysis, settling and
 * summarisation used to bypass that limit and could send hundreds of messages
 * (or a very large pasted message) in one request. This helper keeps the most
 * recent context while preserving the array indexes used by evidence fields.
 */
export const MAX_AUXILIARY_MESSAGES = 48;
export const MAX_AUXILIARY_MESSAGE_CHARS = 900;
export const MAX_AUXILIARY_TOTAL_CHARS = 30_000;

export function boundAuxiliaryHistory<T extends { role: string; content: string }>(history: T[]): T[] {
  const tail = history.slice(-MAX_AUXILIARY_MESSAGES);
  const kept: T[] = [];
  let remaining = MAX_AUXILIARY_TOTAL_CHARS;

  // Walk backwards so the newest turns always survive a tight total budget.
  for (let index = tail.length - 1; index >= 0 && remaining > 0; index -= 1) {
    const item = tail[index];
    const content = typeof item.content === 'string' ? item.content : '';
    const take = Math.min(MAX_AUXILIARY_MESSAGE_CHARS, remaining);
    kept.push({ ...item, content: content.slice(0, take) });
    remaining -= Math.min(content.length, take);
  }

  return kept.reverse();
}
