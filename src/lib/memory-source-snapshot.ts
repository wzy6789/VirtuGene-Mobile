import { db } from '../db/index';

interface SourceSnapshot { table: string; id: string; row: object }
// Read-time evidence stays transient. It is never sent to a model, saved in a
// character card, or serialized into a chat trace.
const snapshots = new WeakMap<object, SourceSnapshot[]>();

export function withMemorySourceSnapshot<T extends object>(value: T, table: string, row: { id: string }): T {
  snapshots.set(value, [...(snapshots.get(value) ?? []), { table, id: row.id, row }]);
  return value;
}

export function inheritMemorySourceSnapshots<T extends object>(value: T, ...sources: object[]): T {
  const inherited = sources.flatMap(source => snapshots.get(source) ?? []);
  if (inherited.length) snapshots.set(value, [...(snapshots.get(value) ?? []), ...inherited]);
  return value;
}

export async function memorySourceSnapshotsStillLive(value: object): Promise<boolean> {
  for (const source of snapshots.get(value) ?? []) {
    const current = await db.table(source.table).get(source.id);
    if (!current || JSON.stringify(current) !== JSON.stringify(source.row)) return false;
  }
  return true;
}
