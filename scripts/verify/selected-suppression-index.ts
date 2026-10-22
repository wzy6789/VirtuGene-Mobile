import Dexie from 'dexie';
import { db } from '../../src/db';
import { memorySourceTombstoneRepo as repo } from '../../src/db/memory-source-tombstone-repo';

Object.assign(window, { selectedSuppressionChecks: async () => {
  const checks: string[] = []; const check = (ok: unknown, label: string) => { if (!ok) throw Error(label); checks.push(label); };
  await db.delete();
  const schema = Object.fromEntries(db.tables.map(table => [table.name, [table.schema.primKey.src, ...table.schema.indexes.filter(index => table.name !== 'memorySourceTombstones' || index.name !== 'suppressedMessageIds').map(index => index.src)].join(',')]));
  const legacy = new Dexie(db.name); legacy.version(40).stores(schema); await legacy.open();
  const base = { userId: 'u', characterId: 'a', sourceType: 'message', sourceRevision: 1, status: 'deleted', updatedAt: 1 };
  const rows = Array.from({ length: 8105 }, (_, i) => ({ ...base, id: `noise-${i}`, sourceId: `noise-source-${i}`, suppressedMessageIds: [`noise-message-${i}`] }));
  const special: any[] = [
    { ...base, id: 'legacy-nondeterministic', sourceId: 'diary-1', sourceType: 'diary', suppressedMessageIds: ['m1', 'm2', 'not-requested'], retainedExtension: { legacy: true } },
    { ...base, id: 'overlapping-source', sourceId: 'todo-1', sourceType: 'todo', suppressedMessageIds: ['m1', 'm1'] },
    { ...base, id: 'foreign-owner', sourceId: 'f1', userId: 'other', suppressedMessageIds: ['m1', 'foreign-only'] },
    { ...base, id: 'foreign-character', sourceId: 'f2', characterId: 'b', suppressedMessageIds: ['m1', 'other-role-only'] },
    { ...base, id: 'missing-character', sourceId: 'f3', characterId: undefined, suppressedMessageIds: ['m1'] },
    { ...base, id: 'legacy-missing-array', sourceId: 'f4', oldField: 'preserve' },
  ];
  await legacy.table('memorySourceTombstones').bulkPut([...rows, ...special]);
  const before = await legacy.table('memorySourceTombstones').toArray(); legacy.close(); await db.open();
  check(db.verno === 41, 'database schema is 41 without changing the app version');
  check(JSON.stringify(before) === JSON.stringify(await db.memorySourceTombstones.toArray()), 'v40 migration preserves rows, unknown fields, absent array and absent character');
  const indexes = db.memorySourceTombstones.schema.indexes;
  check(indexes.some(index => index.name === 'suppressedMessageIds' && index.multi) && indexes.some(index => index.name === '[userId+characterId]'), 'multi-value selected index and existing candidate scope index coexist');
  check(db.sessions.schema.indexes.some(index => index.name === '[characterId+userId+createdAt+id]'), 'v40 session ordering index remains present');
  check([...(await repo.selectedSuppressedMessages('u', 'a', ['m1', 'm2', 'm1']))].sort().join(',') === 'm1,m2', 'all projection source types and duplicate entries use set semantics without leaking extra ids');
  check(!(await repo.selectedSuppressedMessages('u', 'a', ['foreign-only', 'other-role-only'])).size, 'foreign account and character matches never authorize a suppression');
  check(!(await repo.selectedSuppressedMessages('u', 'a', [])).size, 'empty requested evidence stays empty');
  // Inspect the actual native multi-value cursor, including misses.
  const core = db.memorySourceTombstones.core, originalCursor = core.openCursor.bind(core), originalQuery = core.query.bind(core);
  let observed = 0;
  core.query = async request => { const result = await originalQuery(request); observed += result.result.length; return result; };
  core.openCursor = async request => {
    const cursor = await originalCursor(request); if (!cursor) return cursor;
    const seen = new Set<string>(), start = cursor.start.bind(cursor);
    const count = () => { const id = JSON.stringify([cursor.key, cursor.primaryKey]); if (cursor.value && !seen.has(id)) { seen.add(id); observed++; } };
    count(); cursor.start = callback => start(() => { count(); callback(); }); return cursor;
  };
  let missingReads = 0, selectedReads = 0;
  try {
    await repo.selectedSuppressedMessages('u', 'a', ['no-match']); missingReads = observed; observed = 0;
    await repo.selectedSuppressedMessages('u', 'a', ['m1', 'm2']); selectedReads = observed;
  } finally { core.openCursor = originalCursor; core.query = originalQuery; }
  check(missingReads === 0 && selectedReads <= 6, 'selected validation reads zero missing rows and only matching index entries, not 8105 unrelated same-role rows');
  await db.memorySourceTombstones.delete('legacy-nondeterministic');
  check((await repo.selectedSuppressedMessages('u', 'a', ['m1', 'm2'])).has('m1') && !(await repo.selectedSuppressedMessages('u', 'a', ['m2'])).size, 'deleting one of overlapping sources preserves the remaining suppression');
  await db.memorySourceTombstones.put({ ...base, id: 'editable', sourceId: 'edit', suppressedMessageIds: ['edit-v1'] } as any);
  await db.memorySourceTombstones.update('editable', { suppressedMessageIds: ['edit-v2'] });
  check(!(await repo.selectedSuppressedMessages('u', 'a', ['edit-v1'])).size && (await repo.selectedSuppressedMessages('u', 'a', ['edit-v2'])).has('edit-v2'), 'array edits remove old index entries and add new ones immediately');
  await db.memorySourceTombstones.update('editable', { characterId: 'b' });
  check(!(await repo.selectedSuppressedMessages('u', 'a', ['edit-v2'])).size && (await repo.selectedSuppressedMessages('u', 'b', ['edit-v2'])).has('edit-v2'), 'role transfer is visible on the next fresh check');
  await db.memorySourceTombstones.update('editable', { userId: 'other' });
  check(!(await repo.selectedSuppressedMessages('u', 'b', ['edit-v2'])).size && (await repo.selectedSuppressedMessages('other', 'b', ['edit-v2'])).has('edit-v2'), 'account transfer is visible on the next fresh check');
  try { await db.transaction('rw', db.memorySourceTombstones, async () => { await db.memorySourceTombstones.update('editable', { suppressedMessageIds: ['rollback-only'], userId: 'u', characterId: 'a' }); throw Error('rollback'); }); } catch {}
  check(!(await repo.selectedSuppressedMessages('u', 'a', ['rollback-only'])).size && (await repo.selectedSuppressedMessages('other', 'b', ['edit-v2'])).has('edit-v2'), 'transaction rollback restores both rows and multi-value index entries');
  await repo.record({ userId: 'u', characterId: 'a', sourceType: 'todo', sourceId: 'merged-projection', status: 'withdrawn', sourceRevision: 1, suppressedMessageIds: ['merge-a'] });
  await repo.merge([{ ...base, id: 'ignored-legacy-import-id', sourceType: 'todo', sourceId: 'merged-projection', sourceRevision: 2, suppressedMessageIds: ['merge-b', 'merge-a'] }] as any);
  check([...(await repo.selectedSuppressedMessages('u', 'a', ['merge-a', 'merge-b']))].sort().join(',') === 'merge-a,merge-b', 'merge preserves combined non-message projection suppression');
  const rollbackName = db.name + '-v41-rollback'; await Dexie.delete(rollbackName);
  const rollbackOld = new Dexie(rollbackName); rollbackOld.version(40).stores({ memorySourceTombstones: schema.memorySourceTombstones }); await rollbackOld.open();
  await rollbackOld.table('memorySourceTombstones').put({ ...base, id: 'kept', sourceId: 'kept', suppressedMessageIds: ['original'] }); rollbackOld.close();
  const trial = new Dexie(rollbackName); trial.version(40).stores({ memorySourceTombstones: schema.memorySourceTombstones }); trial.version(41).stores({ memorySourceTombstones: schema.memorySourceTombstones + ',*suppressedMessageIds' }).upgrade(async transaction => { await transaction.table('memorySourceTombstones').update('kept', { suppressedMessageIds: ['failed-upgrade'] }); throw Error('intentional upgrade rollback'); });
  try { await trial.open(); throw Error('upgrade unexpectedly succeeded'); } catch (error) { check(String(error).includes('intentional upgrade rollback'), 'failed schema migration is reported'); } finally { trial.close(); }
  await rollbackOld.open(); const kept = await rollbackOld.table('memorySourceTombstones').get('kept');
  check(kept.suppressedMessageIds[0] === 'original' && !rollbackOld.table('memorySourceTombstones').schema.idxByName.suppressedMessageIds, 'failed schema migration leaves v40 rows and indexes intact'); rollbackOld.close(); await Dexie.delete(rollbackName);
  return { complete: true, checks, seedRows: before.length, missingReads, selectedReads, realApiCalls: 0 };
} });
