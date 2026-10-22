import { db } from '../../src/db';
import { revalidateCharacterMemoryContext, type CharacterMemoryContext } from '../../src/lib/character-memory';
import { withMemorySourceSnapshot } from '../../src/lib/memory-source-snapshot';
import { memorySourceTombstoneId, memorySourceTombstoneRepo } from '../../src/db/memory-source-tombstone-repo';

let counters = { rows: 0, requests: 0, tables: {} as Record<string, number> };
const reset = () => { counters = { rows: 0, requests: 0, tables: {} }; };
db.use({ stack: 'dbcore', name: 'voice-reference-batch', create: down => ({ ...down, table: name => {
  const table = down.table(name), add = (n: number) => { counters.rows += n; counters.tables[name] = (counters.tables[name] ?? 0) + n; };
  return { ...table,
    get: async request => { counters.requests++; const value = await table.get(request); add(Number(!!value)); return value; },
    getMany: async request => { counters.requests++; const values = await table.getMany(request); add(values.filter(Boolean).length); return values; },
    query: async request => { counters.requests++; const result = await table.query(request); add(result.result.length); return result; },
    openCursor: async request => { counters.requests++; const cursor = await table.openCursor(request); if (!cursor) return cursor;
      const seen = new Set(), start = cursor.start.bind(cursor), count = () => { const id = JSON.stringify([cursor.key, cursor.primaryKey]); if (cursor.value && !seen.has(id)) { seen.add(id); add(1); } };
      count(); cursor.start = callback => start(() => { count(); callback(); }); return cursor;
    },
  };
} }) });

Object.assign(window, { voiceReferenceBatch: async () => {
  await db.delete(); await db.open(); const now = Date.now();
  await db.characters.bulkPut([{ id: 'a', createdBy: 'u', name: 'A' }, { id: 'b', createdBy: 'u', name: 'B' }] as any);
  await db.memorySourceTombstones.bulkPut(Array.from({ length: 11105 }, (_, i) => ({ id: memorySourceTombstoneId('u', 'message', `old-${i}`), userId: 'u', characterId: i < 3000 ? 'a' : 'b', sourceType: 'message', sourceId: `old-${i}`, sourceRevision: 1, status: 'deleted', suppressedMessageIds: [`old-${i}`], updatedAt: now })) as any);
  await db.continuityThreads.bulkPut(Array.from({ length: 5000 }, (_, i) => ({ id: `closed-${i}`, userId: i % 2 ? 'u' : 'foreign', characterId: 'a', status: 'done', title: `旧约定${i}`, kind: 'promise', createdAt: now, updatedAt: now })) as any);
  await db.momentViews.bulkPut(Array.from({ length: 10000 }, (_, i) => ({ id: `view-${i}`, userId: 'u', characterId: 'a', momentId: `unrelated-${i}`, viewedAt: now })) as any);
  const memories = [0, 1].map(i => ({ id: `selected-memory-${i}`, userId: 'u', characterId: 'a', status: 'active', type: 'auto', content: `已选记忆${i}`, memoryKind: 'fact', createdAt: now, updatedAt: now }));
  await db.memories.bulkPut(memories as any);
  const thread = { id: 'selected-thread', userId: 'u', characterId: 'a', status: 'open', title: '明天去观星', kind: 'promise', createdAt: now, updatedAt: now };
  await db.continuityThreads.put(thread as any);
  const post = { id: 'selected-post', userId: 'u', authorCharacterId: null, text: '今晚观星', mediaIds: [], visibility: 'selected', audienceCharacterIds: ['a'], deleted: false, createdAt: now, updatedAt: now };
  const reaction = { id: 'selected-reaction', userId: 'u', momentId: post.id, characterId: 'b', type: 'comment', content: '带好望远镜', status: 'active', createdAt: now, updatedAt: now };
  await db.moments.put(post as any); await db.momentReactions.put(reaction as any);
  const view = { id: 'selected-view', userId: 'u', characterId: 'a', momentId: post.id, viewedAt: now };
  await db.momentViews.bulkPut([view, { ...view, id: 'foreign-view', userId: 'foreign' }]);
  const references = [
    ...memories.map(memory => withMemorySourceSnapshot({ source: 'chat' as const, id: memory.id, text: memory.content, at: now }, 'memories', memory)),
    withMemorySourceSnapshot({ source: 'chat' as const, id: thread.id, text: thread.title, at: now }, 'continuityThreads', thread),
    withMemorySourceSnapshot({ source: 'moment' as const, id: post.id, text: post.text, at: now }, 'moments', post),
    withMemorySourceSnapshot(withMemorySourceSnapshot({ source: 'moment' as const, id: reaction.id, text: reaction.content, at: now }, 'moments', post), 'momentReactions', reaction),
  ];
  const prepared = { references, text: '', sections: {}, provenance: [] } as unknown as CharacterMemoryContext;
  const request = { userId: 'u', characterId: 'a', topic: '今晚观星' };
  let phase = 'initial';
  const validate = () => db.transaction('r', db.tables, () => revalidateCharacterMemoryContext(request, prepared))
    .catch(error => { throw Error(phase + ': ' + error.name + ': ' + error.message); });
  const samples = []; let rendered = '';
  for (let i = 0; i < 5; i++) {
    phase = `sample-${i}`;
    reset(); const start = performance.now(); const result = await validate();
    const elapsedMs = performance.now() - start;
    if (result.references.length !== references.length) throw Error('baseline selected references rejected');
    rendered = result.text;
    samples.push({ elapsedMs, ...structuredClone(counters) });
  }
  const checks: string[] = [];
  const absent = async (id: string, label: string) => { phase = label; if ((await validate()).references.some(r => r.id === id)) throw Error(label); checks.push(label); };
  for (const patch of [{ userId: 'foreign' }, { characterId: 'b' }, { status: 'done' }]) {
    await db.continuityThreads.update(thread.id, patch as any); await absent(thread.id, 'continuity scope or status rejected: ' + JSON.stringify(patch)); await db.continuityThreads.put(thread as any);
  }
  await db.momentViews.delete(view.id); await absent(reaction.id, 'foreign owner view cannot certify a reaction'); await db.momentViews.put(view);
  await db.moments.update(post.id, { visibility: 'private' }); await absent(post.id, 'post withdrawal rejected'); await absent(reaction.id, 'reaction parent withdrawal rejected'); await db.moments.put(post as any);
  await db.memorySourceTombstones.put({ id: memorySourceTombstoneId('u', 'message', memories[0].id), userId: 'u', characterId: 'a', sourceType: 'message', sourceId: memories[0].id, sourceRevision: 1, status: 'deleted', suppressedMessageIds: [memories[0].id], updatedAt: now });
  await absent(memories[0].id, 'next validation re-reads newly suppressed source');
  const summarySession = { id: 'summary-session', userId: 'u', characterId: 'a', type: 'single', title: '旧会话', summary: '以前约好观星', summarySourceMessageIds: ['summary-original'], summarySourceMessageRevisions: { 'summary-original': 1 }, createdAt: now, updatedAt: now };
  await db.sessions.put(summarySession as any);
  await db.messages.put({ id: 'summary-original', sessionId: summarySession.id, role: 'user', content: '以前约好观星', revision: 1, createdAt: now });
  const evidenceMemory = { ...memories[1], id: 'source-backed-memory', sourceSessionId: summarySession.id, sourceMessageIds: ['summary-original'] };
  await db.memories.put(evidenceMemory as any);
  const summaryReferences = [withMemorySourceSnapshot({ source: 'chat' as const, id: summarySession.id, text: summarySession.summary, at: now }, 'sessions', summarySession),
    withMemorySourceSnapshot({ source: 'chat' as const, id: evidenceMemory.id, text: evidenceMemory.content, at: now }, 'memories', evidenceMemory)];
  const verifySummary = () => revalidateCharacterMemoryContext(request, { ...prepared, references: summaryReferences });
  if ((await verifySummary()).references.length !== 2) throw Error('live source-backed memory and summary rejected'); checks.push('selected memory and summary retain live source evidence');
  await memorySourceTombstoneRepo.record({ userId: 'u', characterId: 'a', sourceType: 'diary', sourceId: 'summary-projection', status: 'withdrawn', sourceRevision: 1, suppressedMessageIds: ['summary-original'] });
  if ((await verifySummary()).references.length) throw Error('non-message projection suppression of summary/memory source missed'); checks.push('non-message projection suppresses selected memory and summary source IDs');
  await db.memorySourceTombstones.delete(memorySourceTombstoneId('u', 'diary', 'summary-projection'));
  if ((await verifySummary()).references.length !== 2) throw Error('source consent restoration remains cached'); checks.push('next validation sees restored projection consent');
  await db.messages.update('summary-original', { revision: 2, content: '已经改写的原文' });
  if ((await verifySummary()).references.some(reference => reference.id === summarySession.id)) throw Error('summary exact revision check skipped'); checks.push('summary still checks complete original source revisions');
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rendered));
  return { samples, checks, renderedHash: Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join(''), fixture: { sameCharacterUnrelatedTombstones: 3000, otherCharacterTombstones: 8105, unrelatedContinuity: 5000, unrelatedViews: 10000, selectedReferences: references.length }, apiCalls: 0, scope: 'selected reference validation using real isolated IndexedDB; desktop CPU 4x; not full candidate retrieval or real audio' };
} });
