import { db, type MemorySourceTombstone } from './index';

export type MemorySourceType = MemorySourceTombstone['sourceType'];

export interface RecordMemorySourceTombstoneInput {
  userId: string;
  sourceType: MemorySourceType;
  sourceId: string;
  sourceRevision?: number;
  status: MemorySourceTombstone['status'];
  characterId?: string;
  suppressedMessageIds?: string[];
}

export function memorySourceTombstoneId(userId: string, sourceType: MemorySourceType, sourceId: string): string {
  return `memory-source:${encodeURIComponent(userId)}:${sourceType}:${encodeURIComponent(sourceId)}`;
}

const STATUS_PRIORITY: Record<MemorySourceTombstone['status'], number> = {
  superseded: 1,
  withdrawn: 2,
  deleted: 3,
};
type ImportSource = Pick<RecordMemorySourceTombstoneInput, 'userId' | 'sourceType' | 'sourceId' | 'sourceRevision'>;
function blocksSource(row: MemorySourceTombstone | undefined, revision = 0): boolean {
  return !!row && (row.status === 'deleted' || revision <= row.sourceRevision);
}

function mergeTombstone(input: RecordMemorySourceTombstoneInput, existing?: MemorySourceTombstone): MemorySourceTombstone {
  const sourceRevision = Math.max(0, input.sourceRevision ?? 0);
  const incomingIsNewer = sourceRevision > (existing?.sourceRevision ?? -1);
  const status = existing?.status === 'deleted' || input.status === 'deleted'
    ? 'deleted'
    : !existing || incomingIsNewer || STATUS_PRIORITY[input.status] > STATUS_PRIORITY[existing.status]
      ? input.status : existing.status;
  return {
    id: memorySourceTombstoneId(input.userId, input.sourceType, input.sourceId),
    userId: input.userId, sourceType: input.sourceType, sourceId: input.sourceId,
    characterId: input.characterId ?? existing?.characterId,
    suppressedMessageIds: [...new Set([...(existing?.suppressedMessageIds ?? []), ...(input.suppressedMessageIds ?? [])])],
    sourceRevision: Math.max(sourceRevision, existing?.sourceRevision ?? 0),
    status, updatedAt: Date.now(),
  };
}

export const memorySourceTombstoneRepo = {
  async record(input: RecordMemorySourceTombstoneInput): Promise<void> {
    await this.recordMany([input]);
  },

  /** Keep import protections atomic without a get/put round trip per message. */
  async recordMany(inputs: RecordMemorySourceTombstoneInput[]): Promise<void> {
    const valid = inputs.filter(input => input.userId && input.sourceId);
    if (!valid.length) return;
    await db.transaction('rw', db.memorySourceTombstones, async () => {
      for (let offset = 0; offset < valid.length; offset += 500) {
        const batch = valid.slice(offset, offset + 500);
        const ids = [...new Set(batch.map(input => memorySourceTombstoneId(input.userId, input.sourceType, input.sourceId)))];
        // Most deleted messages have never had a tombstone. A keyed cursor
        // returns only existing rows, instead of issuing one missing get per id.
        const existing = await db.memorySourceTombstones.where(':id').anyOf(ids).toArray();
        const merged = new Map<string, MemorySourceTombstone>(existing.map(row => [row.id, row]));
        for (const input of batch) {
          const id = memorySourceTombstoneId(input.userId, input.sourceType, input.sourceId);
          merged.set(id, mergeTombstone(input, merged.get(id)));
        }
        await db.memorySourceTombstones.bulkPut([...merged.values()]);
      }
    });
  },

  async suppressedMessages(userId: string, characterId: string): Promise<Set<string>> {
    const rows = await db.memorySourceTombstones.where('[userId+characterId]')
      .equals([userId, characterId]).toArray();
    return new Set(rows.flatMap(row => row.suppressedMessageIds ?? []));
  },

  /** Fresh validation of selected evidence, including non-message projections. */
  async selectedSuppressedMessages(userId: string, characterId: string, messageIds: readonly string[]): Promise<Set<string>> {
    const ids = [...new Set(messageIds.filter(id => !!id))];
    if (!userId || !characterId || !ids.length) return new Set();
    const wanted = new Set(ids);
    const rows = await db.memorySourceTombstones.where('suppressedMessageIds').anyOf(ids).distinct().toArray();
    return new Set(rows.filter(row => row.userId === userId && row.characterId === characterId)
      .flatMap(row => (row.suppressedMessageIds ?? []).filter(id => wanted.has(id))));
  },

  async blocksImport(input: {
    userId: string;
    sourceType: MemorySourceType;
    sourceId: string;
    sourceRevision?: number;
  }): Promise<boolean> {
    const row = await db.memorySourceTombstones.get(memorySourceTombstoneId(input.userId, input.sourceType, input.sourceId));
    return blocksSource(row, input.sourceRevision);
  },
  async blocksImports(inputs: ImportSource[]): Promise<boolean[]> {
    if (!inputs.length) return [];
    const ids = inputs.map(input => memorySourceTombstoneId(input.userId, input.sourceType, input.sourceId));
    const rows = await db.memorySourceTombstones.where(':id').anyOf([...new Set(ids)]).toArray();
    const byId = new Map(rows.map(row => [row.id, row]));
    return inputs.map((input, index) => blocksSource(byId.get(ids[index]), input.sourceRevision));
  },

  async merge(rows: MemorySourceTombstone[] = []): Promise<number> {
    await this.recordMany(rows);
    return rows.length;
  },
};
