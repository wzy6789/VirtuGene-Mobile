import { db } from '../../src/db';
import { useAuthStore } from '../../src/store/auth-store';
import { revalidateCharacterMemoryContext, type CharacterMemoryContext } from '../../src/lib/character-memory';
import { withMemorySourceSnapshot } from '../../src/lib/memory-source-snapshot';
import { memorySourceTombstoneId, memorySourceTombstoneRepo } from '../../src/db/memory-source-tombstone-repo';
import { prepareCallContext } from '../../src/lib/voice-call/context';

type Counts = { transactions: number; requests: number; rows: number; keys: number;
  tables: Record<string, { requests: number; rows: number; keys: number }> };
let counts: Counts;
const reset = () => { counts = { transactions: 0, requests: 0, rows: 0, keys: 0, tables: {} }; };
reset();
db.use({ stack: 'dbcore', name: 'voice-selected-session', create: down => ({ ...down,
  transaction: (...args) => { counts.transactions++; return down.transaction(...args); },
  table: name => {
    const table = down.table(name);
    const add = (kind: 'requests' | 'rows' | 'keys', n = 1) => {
      counts[kind] += n;
      const target = counts.tables[name] ??= { requests: 0, rows: 0, keys: 0 }; target[kind] += n;
    };
    return { ...table,
      get: async request => { add('requests'); const row = await table.get(request); add('rows', Number(!!row)); return row; },
      getMany: async request => { add('requests'); const rows = await table.getMany(request); add('rows', rows.filter(Boolean).length); return rows; },
      query: async request => { add('requests'); const result = await table.query(request); add(request.values ? 'rows' : 'keys', result.result.length); return result; },
      openCursor: async request => {
        add('requests'); const cursor = await table.openCursor(request); if (!cursor) return cursor;
        const seen = new Set<string>(), start = cursor.start.bind(cursor);
        const count = () => { const id = JSON.stringify([cursor.key, cursor.primaryKey]);
          if (!seen.has(id)) { seen.add(id); add(request.values ? 'rows' : 'keys'); } };
        count(); cursor.start = callback => start(() => { count(); callback(); }); return cursor;
      },
    };
  },
}) });

const hash = async (value: unknown) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',
  new TextEncoder().encode(JSON.stringify(value)))), byte => byte.toString(16).padStart(2, '0')).join('');
const now = 1792029600000;
const request = { userId: 'u', characterId: 'a', topic: '观星约定' };
const session = { id: 'selected-session', userId: 'u', characterId: 'a', type: 'single', title: '所选原话会话',
  summary: '早前约好一起观星 SUMMARY_SOURCE', summarySourceMessageIds: ['selected-message-0', 'selected-message-1'],
  summarySourceMessageRevisions: { 'selected-message-0': 1, 'selected-message-1': 1 }, createdAt: now - 1000, updatedAt: now - 1 };
const second = { ...session, id: 'selected-second', title: '另一所选原话会话', summary: undefined,
  summarySourceMessageIds: undefined, summarySourceMessageRevisions: undefined, updatedAt: now - 2 };
const originals = [0, 1, 2].map(index => ({ id: `selected-message-${index}`,
  sessionId: index === 2 ? second.id : session.id, role: index % 2 ? 'assistant' : 'user',
  content: `观星原话${index} SELECTED_RAW_${index}`, revision: 1, createdAt: now - 100 + index }));
let prepared: CharacterMemoryContext;
let expectedReferenceCount = 4;
const validate = () => revalidateCharacterMemoryContext(request, prepared);

Object.assign(window, { voiceSelectedSession: {
  setup: async (largeSelectedSession = false) => {
    await db.delete(); await db.open(); useAuthStore.setState({ userId: 'u' });
    globalThis.Date = new Proxy(Date, {
      construct: (target, args) => Reflect.construct(target, args.length ? args : [now]),
      apply: target => new target(now).toString(),
      get: (target, key) => key === 'now' ? () => now : Reflect.get(target, key),
    });
    await db.characters.bulkPut(['a', 'b'].map(id => ({ id, createdBy: 'u', name: `角色${id}`,
      systemPrompt: '说话简洁认真，保留自己的判断。', createdAt: now, tags: [] })) as any);
    await db.worlds.put({ id: 'w', userId: 'u', name: '隔离测试世界', isDefault: true, createdAt: now, updatedAt: now } as any);
    const privateCount = largeSelectedSession ? 12 : 9000, groupCount = largeSelectedSession ? 2 : 1000;
    const otherCount = largeSelectedSession ? 2 : 600, ownedCount = privateCount + groupCount;
    const unrelated = Array.from({ length: ownedCount + otherCount }, (_, index) => ({ id: `unrelated-session-${index}`,
      userId: index < ownedCount || index % 2 ? 'u' : 'foreign', characterId: index < ownedCount || index % 2 === 0 ? 'a' : 'b',
      type: index >= privateCount && index < ownedCount ? 'group' : 'single', title: `无关旧会话${index}`,
      createdAt: now - 10000, updatedAt: now - 10000, unreadCount: 0 }));
    // A long-running summary retains every original source version. Use UUID-
    // length IDs and the production 2,400-character summary cap; source rows
    // remain valid, but this stratum selects only raw references so reading the
    // large parent session is incidental authorization work, not prompt input.
    const summarySources = largeSelectedSession ? Array.from({ length: 2046 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${index.toString().padStart(12, '0')}`, sessionId: session.id,
      role: index % 2 ? 'assistant' : 'user', content: `摘要原文${index}`, revision: 1, createdAt: now - 5000 - index,
    })) : [];
    if (largeSelectedSession) {
      const ids = [...originals.slice(0, 2).map(row => row.id), ...summarySources.map(row => row.id)];
      Object.assign(session, { summary: '早前约好一起观星 SUMMARY_SOURCE。' + '保持已确认的原话与约定。'.repeat(2400).slice(0, 2376),
        summarySourceMessageIds: ids, summarySourceMessageRevisions: Object.fromEntries(ids.map(id => [id, 1])) });
      session.summary = session.summary.slice(0, 2400);
    }
    await db.sessions.bulkPut([...unrelated, session, second, { id: 'live', userId: 'u', characterId: 'a',
      type: 'single', title: '当前通话', createdAt: now, updatedAt: now, unreadCount: 0 }] as any);
    await db.messages.bulkPut([...summarySources, ...originals, { id: 'live-user', sessionId: 'live', role: 'user', content: '你好', revision: 1, createdAt: now }] as any);
    const otherRoleTombstones = largeSelectedSession ? 20 : 8105, sameRoleTombstones = largeSelectedSession ? 20 : 3000;
    await db.memorySourceTombstones.bulkPut(Array.from({ length: otherRoleTombstones + sameRoleTombstones }, (_, index) => {
      const sourceId = `unrelated-withdrawn-${index}`;
      return { id: memorySourceTombstoneId('u', 'message', sourceId), userId: 'u', characterId: index < otherRoleTombstones ? 'b' : 'a',
        sourceType: 'message', sourceId, sourceRevision: 1, status: 'deleted', suppressedMessageIds: [sourceId], updatedAt: now };
    }) as any);
    prepared = { text: '', references: [
      ...originals.map(row => withMemorySourceSnapshot({ source: 'chat' as const, id: row.id, text: row.content, at: row.createdAt }, 'messages', row)),
      ...(!largeSelectedSession ? [withMemorySourceSnapshot({ source: 'chat' as const, id: session.id, text: session.summary, at: session.updatedAt }, 'sessions', session)] : []),
    ], sections: { profile: '', episodes: '', promises: '', crossChannel: '', recent: '', historical: '' }, provenance: [],
      retrieval: { status: 'references', explicitRequest: true, selectedCount: largeSelectedSession ? 3 : 4 } };
    expectedReferenceCount = prepared.references.length;
    return { stratum: largeSelectedSession ? 'small-history-large-selected-session' : 'large-unrelated-history',
      unrelatedSameOwnerPrivateSessions: privateCount, unrelatedSameOwnerGroupSessions: groupCount,
      unrelatedOtherOwnerOrRoleSessions: otherCount, selectedSessions: 2, selectedReferences: expectedReferenceCount,
      selectedSessionJsonBytes: new TextEncoder().encode(JSON.stringify(session)).byteLength,
      selectedSessionSummaryChars: session.summary.length, selectedSessionSummarySourceCount: session.summarySourceMessageIds.length,
      rawSelectedReferencesOnly: largeSelectedSession,
      unrelatedOtherRoleTombstones: otherRoleTombstones, unrelatedSameRoleTombstones: sameRoleTombstones };
  },
  sample: async () => {
    reset(); const started = performance.now(), result = await validate();
    const elapsedMs = performance.now() - started, reads = structuredClone(counts);
    if (result.references.length !== expectedReferenceCount) throw Error('valid selected original or summary rejected');
    return { elapsedMs, ...reads, contextHash: await hash(result) };
  },
  checks: async () => {
    const checks: string[] = [];
    const absent = async (ids: string[], label: string) => {
      const result = await validate();
      if (result.references.some(reference => ids.includes(reference.id))) throw Error(label + ': source remained allowed');
      checks.push(label);
    };
    const selectedIds = [originals[0].id, originals[1].id, session.id];
    for (const patch of [{ userId: 'foreign' }, { characterId: 'b' }, { type: 'group' }]) {
      await db.sessions.update(session.id, patch as any);
      await absent(selectedIds, 'fresh selected session rejects ' + JSON.stringify(patch));
      await db.sessions.put(session as any);
      if ((await validate()).references.length !== expectedReferenceCount) throw Error('restored ownership remained cached');
      checks.push('restored selected session visible after ' + JSON.stringify(patch));
    }
    await db.sessions.delete(session.id); await absent(selectedIds, 'deleted selected session rejected');
    await db.sessions.put(session as any);
    if ((await validate()).references.length !== expectedReferenceCount) throw Error('recreated selected session remained denied');
    checks.push('recreated selected session rechecked');
    for (const patch of [{ content: '已经改写的原话' }, { failed: true }, { revision: 2 }]) {
      await db.messages.update(originals[0].id, patch as any);
      await absent([originals[0].id], 'source snapshot rejects ' + JSON.stringify(patch));
      if (expectedReferenceCount === 4 && ('failed' in patch || 'revision' in patch)) await absent([session.id], 'summary source rejects ' + JSON.stringify(patch));
      await db.messages.put(originals[0] as any);
    }
    await memorySourceTombstoneRepo.record({ userId: 'u', characterId: 'a', sourceType: 'diary', sourceId: 'withdrawn-projection',
      sourceRevision: 1, status: 'withdrawn', suppressedMessageIds: [originals[0].id] });
    await absent([originals[0].id, session.id], 'projected source revocation still rejects original and summary');
    await db.memorySourceTombstones.delete(memorySourceTombstoneId('u', 'diary', 'withdrawn-projection'));
    if ((await validate()).references.length !== expectedReferenceCount) throw Error('restored projection permission remained cached');
    checks.push('projection permission restoration freshly read');
    // Delay one source snapshot after initial ownership has been read. With no
    // surrounding read transaction, a second transaction can commit the move
    // before final ownership refresh; that refresh must not reuse the first.
    const originalTable = db.table;
    let messageReads = 0, mutationRequested = false, mutationObserved = false;
    (db as any).table = function (name: string) {
      const table = originalTable.call(this, name);
      if (name === 'messages') {
        const originalBulkGet = table.bulkGet;
        table.bulkGet = async function (...args: any[]) {
          const rows = await (originalBulkGet as any).apply(this, args); messageReads++;
          if (!mutationRequested) { mutationRequested = true; await db.sessions.update(session.id, { characterId: 'b' }); mutationObserved = true; }
          return rows;
        };
      }
      return table;
    };
    try {
      const result = await validate();
      if (!mutationObserved) throw Error(`in-flight ownership mutation hook did not run: reads=${messageReads}`);
      if (result.references.some(reference => selectedIds.includes(reference.id))) {
        throw Error('in-flight transfer remained allowed: ' + JSON.stringify({ messageReads, current: await db.sessions.get(session.id), retained: result.references.map(reference => reference.id) }));
      }
      checks.push('ownership transfer committed during async source validation rejected');
    } finally { db.table = originalTable; await db.sessions.put(session as any); }
    if ((await validate()).references.length !== expectedReferenceCount) throw Error('next validation reused denied ownership');
    checks.push('next check rereads restored ownership after in-flight transfer');
    // Selected dependencies may change between passes too: a message moved to
    // a foreign-owned session cannot retain its previous session authorization.
    await db.sessions.put({ ...second, id: 'foreign-session', userId: 'foreign' } as any);
    await db.messages.update(originals[2].id, { sessionId: 'foreign-session' });
    await absent([originals[2].id], 'selected message moved to foreign session rejected');
    await db.messages.put(originals[2] as any);
    if ((await validate()).references.length !== expectedReferenceCount) throw Error('restored message dependency not re-read');
    checks.push('restored exact message dependency freshly read');
    const context = await prepareCallContext({ userId: 'u', characterId: 'a', sessionId: 'live', worldId: 'w' },
      '你好', [], new AbortController().signal);
    if (!context.messages[0].content.includes('SELECTED_RAW_0')) throw Error('actual model input omitted selected raw evidence');
    await context.assertCurrent!();
    return { checks, actualModelInputHash: await hash(context.messages), actualModelInputLength: JSON.stringify(context.messages).length,
      apiCalls: 0, noMicrophone: true };
  },
} });
