import { db, type MemorySourceTombstone } from './index';

export type MemorySourceType = MemorySourceTombstone['sourceType'];

export interface RecordMemorySourceTombstoneInput {
  userId: string;
  sourceType: MemorySourceType;
  sourceId: string;
  sourceRevision?: number;
  status: MemorySourceTombstone['status'];
}

export function memorySourceTombstoneId(userId: string, sourceType: MemorySourceType, sourceId: string): string {
  return `memory-source:${encodeURIComponent(userId)}:${sourceType}:${encodeURIComponent(sourceId)}`;
}

const STATUS_PRIORITY: Record<MemorySourceTombstone['status'], number> = {
  superseded: 1,
  withdrawn: 2,
  deleted: 3,
};

export const memorySourceTombstoneRepo = {
  async record(input: RecordMemorySourceTombstoneInput): Promise<void> {
    if (!input.userId || !input.sourceId) return;
    const id = memorySourceTombstoneId(input.userId, input.sourceType, input.sourceId);
    const existing = await db.memorySourceTombstones.get(id);
    const sourceRevision = Math.max(0, input.sourceRevision ?? 0);
    const incomingIsNewer = sourceRevision > (existing?.sourceRevision ?? -1);
    const status = existing?.status === 'deleted' || input.status === 'deleted'
      ? 'deleted'
      : !existing || incomingIsNewer || STATUS_PRIORITY[input.status] > STATUS_PRIORITY[existing.status]
        ? input.status
        : existing.status;
    await db.memorySourceTombstones.put({
      id,
      userId: input.userId,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      sourceRevision: Math.max(sourceRevision, existing?.sourceRevision ?? 0),
      status,
      updatedAt: Date.now(),
    });
  },

  async blocksImport(input: {
    userId: string;
    sourceType: MemorySourceType;
    sourceId: string;
    sourceRevision?: number;
  }): Promise<boolean> {
    const row = await db.memorySourceTombstones.get(memorySourceTombstoneId(input.userId, input.sourceType, input.sourceId));
    if (!row) return false;
    if (row.status === 'deleted') return true;
    return (input.sourceRevision ?? 0) <= row.sourceRevision;
  },

  async merge(rows: MemorySourceTombstone[] = []): Promise<number> {
    let merged = 0;
    for (const row of rows) {
      await this.record(row);
      merged += 1;
    }
    return merged;
  },
};
