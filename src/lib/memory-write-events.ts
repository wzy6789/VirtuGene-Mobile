import type { MemoryItem } from '../db';

/** Transient UI receipts; the existing memory row remains the only stored record. */
export interface MemoryWriteReceipt { memory: MemoryItem; created: boolean; sessionId?: string }
const listeners = new Set<(receipt: MemoryWriteReceipt) => void>();
export function subscribeMemoryWrites(listener: (receipt: MemoryWriteReceipt) => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function publishMemoryWrite(receipt: MemoryWriteReceipt) {
  if (receipt.memory.type === 'summary' || !(receipt.sessionId ?? receipt.memory.sourceSessionId)) return;
  for (const listener of listeners) {
    try { listener(receipt); } catch { /* Presentation cannot undo a committed write. */ }
  }
}
