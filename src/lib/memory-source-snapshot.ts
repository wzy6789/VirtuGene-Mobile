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

/** Use only when the caller separately validates the omitted routing row.
 * Source-message/entry snapshots are retained; this does not rewrite evidence. */
export function inheritMemorySnapshotsWithoutRoute<T extends object>(value:T,source:object,table:string,id:string):T{
  const retained=(snapshots.get(source)??[]).filter(row=>row.table!==table||row.id!==id);
  if(retained.length)snapshots.set(value,[...(snapshots.get(value)??[]),...retained]);
  return value;
}

/** Identity hints only. Callers must reread these exact rows and their current permissions. */
export function memorySourceSnapshotIds(value: object, table: string): string[] {
  return [...new Set((snapshots.get(value) ?? []).filter(source => source.table === table).map(source => source.id))];
}
export function memorySourceSnapshotTables(values:object[]):string[]{
  return [...new Set(values.flatMap(value=>(snapshots.get(value)??[]).map(source=>source.table)))];
}

export async function memorySourceSnapshotsBatchStillLive(values:object[]):Promise<Map<object,boolean>>{
  const byTable = new Map<string, SourceSnapshot[]>();
  for (const value of values) for (const source of snapshots.get(value) ?? []) {
    const rows = byTable.get(source.table) ?? [];
    rows.push(source); byTable.set(source.table, rows);
  }
  const results = new Map<string,Map<string,object>>();
  await Promise.all([...byTable].map(async ([table, sources]) => {
    const ids = [...new Set(sources.map(source => source.id))];
    const rows = await db.table(table).bulkGet(ids);
    results.set(table,new Map(ids.map((id,index)=>[id,rows[index]])));
  }));
  return new Map(values.map(value=>[value,(snapshots.get(value)??[]).every(source=>{
    const current=results.get(source.table)?.get(source.id);
    return !!current&&JSON.stringify(current)===JSON.stringify(source.row);
  })]));
}

export async function memorySourceSnapshotsStillLive(value: object): Promise<boolean> {
  return (await memorySourceSnapshotsBatchStillLive([value])).get(value)===true;
}
