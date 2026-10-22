import { db } from '../../src/db';
import { ownedSelectedPrivateSessionIds } from '../../src/db/selected-private-session';

Object.assign(window, { voiceSessionKeyScope: async () => {
  await db.delete(); await db.open();
  const checks: string[] = [];
  const check = (value: unknown, label: string) => { if (!value) throw Error(label); checks.push(label); };
  const base = { userId: 'u', characterId: 'a', type: 'single', title: '隔离会话', createdAt: 1, updatedAt: 1 };
  const large = { summary: '长摘要'.repeat(20000), summarySourceMessageIds: Array.from({ length: 2048 }, (_, i) => 'source-' + i),
    summarySourceMessageRevisions: Object.fromEntries(Array.from({ length: 2048 }, (_, i) => ['source-' + i, 1])) };
  const rows = [
    ...Array.from({ length: 9000 }, (_, i) => ({ ...base, id: 'noise-' + String(i).padStart(5, '0') })),
    ...Array.from({ length: 1000 }, (_, i) => ({ ...base, type: 'group', id: 'noise-group-' + String(i).padStart(5, '0') })),
    { ...base, id: '000-first' }, { ...base, id: '100-large', ...large },
    { ...base, id: '200-missing-type', type: undefined }, { ...base, id: '300-other-type', type: 'legacy-private' },
    { ...base, id: '400-group', type: 'group' }, { ...base, id: '500-foreign', userId: 'foreign' },
    { ...base, id: '600-other-role', characterId: 'b' }, { ...base, id: 'zzz-last' },
  ];
  await db.sessions.bulkPut(rows as any);
  const selected = ['zzz-last', '100-large', '400-group', '500-foreign', '600-other-role', '200-missing-type',
    '300-other-type', '000-first', '!before-first', '150-missing-between', 'zzzz-after-last', '100-large'];
  const expected = ['000-first', '100-large', '200-missing-type', '300-other-type', 'zzz-last'];
  const resultIds = async (ids: Iterable<string> = selected) => [...await ownedSelectedPrivateSessionIds('u', 'a', ids)].sort();
  const same = (actual: string[], wanted = expected) => JSON.stringify(actual) === JSON.stringify(wanted);
  const core = db.sessions.core, originalCursor = core.openCursor, originalGetMany = core.getMany;
  let unsupported = false, keyReads = 0, valueRequests = 0;
  const bulkKeys: string[][] = [];
  core.openCursor = async function (request) {
    if (request.values) valueRequests++;
    const cursor = await originalCursor.call(this, request); if (!cursor) return cursor;
    const start = cursor.start.bind(cursor);
    cursor.start = callback => start(() => {
      keyReads++;
      // Disable only after Dexie restores native methods in start().
      if (unsupported) (cursor as any).continuePrimaryKey = undefined;
      callback();
    });
    return cursor;
  };
  core.getMany = async function (request) { valueRequests++; bulkKeys.push([...request.keys]); return originalGetMany.call(this, request); };
  let scopedReads = 0;
  try {
    check(same(await resultIds()), 'exact selected keys preserve owner, role, group and legacy type semantics');
    scopedReads = keyReads;
    check(valueRequests === 0, 'supported cursor does not request any full session values');
    check(keyReads <= 2 * (new Set(selected).size + 1), 'key reads stay bounded by selected IDs, independently of 10000 unrelated sessions');
    check(same(await resultIds(['150-missing-between', '!before-first', 'zzzz-after-last']), []), 'all-missing targets before, between and after existing keys remain absent');
    const beforeEmpty = keyReads;
    check(same(await resultIds([]), []) && keyReads === beforeEmpty && valueRequests === 0, 'empty selection opens no cursor or value request');
    check(same(await db.transaction('r', db.sessions, () => resultIds())), 'helper reuses a surrounding readonly transaction');
    unsupported = true; const bulkBefore = bulkKeys.length;
    check(same(await resultIds()), 'missing native seek capability uses equivalent exact-value fallback');
    check(bulkKeys.length === bulkBefore + 1 && same([...bulkKeys.at(-1)!].sort(), [...new Set(selected)].sort()), 'fallback fetches only unique selected IDs');
    unsupported = false;
    for (const patch of [{ userId: 'foreign' }, { characterId: 'b' }, { type: 'group' }]) {
      await db.sessions.update('100-large', patch as any);
      check(!(await resultIds()).includes('100-large'), 'fresh check rejects changed scope ' + JSON.stringify(patch));
      await db.sessions.put({ ...base, id: '100-large', ...large } as any);
      check((await resultIds()).includes('100-large'), 'fresh check sees restored scope ' + JSON.stringify(patch));
    }
    await db.sessions.delete('100-large');
    check(!(await resultIds()).includes('100-large'), 'fresh check rejects a deleted selected session');
    await db.sessions.put({ ...base, id: '100-large', ...large } as any);
    check((await resultIds()).includes('100-large'), 'fresh check sees a recreated selected session');
    try { await db.transaction('rw', db.sessions, async () => {
      await db.sessions.update('100-large', { characterId: 'b' }); throw Error('intentional rollback');
    }); } catch (error) { if (!String(error).includes('intentional rollback')) throw error; }
    check(same(await resultIds()), 'rolled-back ownership update leaves row and compound-index authorization intact');
    await db.sessions.where('userId').equals('u').delete();
    check(same(await resultIds(), []), 'empty owner/group index scopes never authorize foreign sessions');
  } finally { core.openCursor = originalCursor; core.getMany = originalGetMany; }
  return { complete: true, checks, scopedKeyReads: scopedReads, selectedUniqueIds: new Set(selected).size,
    unrelatedSessions: 10000, realApiCalls: 0, microphone: false,
    scope: 'Focused correctness and key/value-read counts in isolated real IndexedDB; no latency measurement, provider or Android.' };
} });
