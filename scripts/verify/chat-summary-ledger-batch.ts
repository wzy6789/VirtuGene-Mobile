import { db, type MemoryItem } from '../../src/db';
import { memoryLedgerRepo } from '../../src/db/memory-ledger-repo';

const owner = 'summary-ledger-owner', actor = 'summary-ledger-actor';
const makeMemory = (sourceIds: string[], patch: Partial<MemoryItem> = {}): MemoryItem => ({
  id: 'summary-memory', userId: owner, characterId: actor, type: 'summary', memoryKind: 'summary',
  content: '合成摘要：用户原定周五面试，已更正为周四。', sourceSessionId: 'summary-session',
  sourceMessageIds: sourceIds, sourceMessageRevisions: Object.fromEntries(sourceIds.map(id => [id, 1])),
  sourceMessageOffsets: Object.fromEntries(sourceIds.map((id, i) => [id, i % 3])),
  sourceMessageEndOffsets: Object.fromEntries(sourceIds.map((id, i) => [id, 20 + i % 3])),
  createdAt: 100, confidence: .8, status: 'active', ...patch,
});
async function reset() {
  await db.transaction('rw', [db.sessions, db.memoryClaims, db.memoryEvidence, db.memoryKnowledge], async () => {
    await Promise.all([db.sessions.clear(), db.memoryClaims.clear(), db.memoryEvidence.clear(), db.memoryKnowledge.clear()]);
    await db.sessions.put({ id: 'summary-session', userId: owner, characterId: actor, type: 'private', createdAt: 1, updatedAt: 1 } as any);
  });
}
async function performanceFixture(count: number, existing = false) {
  await reset();
  const sourceIds = Array.from({ length: count }, (_, i) => 'synthetic-source-' + i);
  const memory = makeMemory(sourceIds);
  if (existing) memory.sourceMessageRevisions = Object.fromEntries(sourceIds.map((id, i) => [id, i % 11 === 0 ? 2 : 1]));
  const seedInput = { userId: owner, value: memory.content, memoryKind: 'summary' as const, source: { type: 'chat' as const, id: 'seed', revision: 1 }, characterIds: [actor] };
  const existingEvidence = existing ? sourceIds.map((sourceId, i) => ({ userId: owner, sourceType: 'chat' as const, sourceId, sourceRevision: i % 7 === 0 ? 2 : 1, observedAt: 10, confidence: .7, sourceOffset: 0, sourceEndOffset: 10, excerptHash: 'synthetic-old-evidence-' + i, ...(i % 31 === 0 ? { withdrawnAt: 50 } : {}) })) : [];
  const fixtureInput = { memory, seedInput, session: { id: 'summary-session', userId: owner, characterId: actor, type: 'private', createdAt: 1, updatedAt: 1 }, ...(existing ? { existingEvidence } : {}) };
  const inputSha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stableJson(fixtureInput))))).map(byte => byte.toString(16).padStart(2, '0')).join('');
  const seededClaimId = await memoryLedgerRepo.record(seedInput);
  if (existing) {
    await db.transaction('rw', db.memoryEvidence, async () => {
      for (let offset = 0; offset < existingEvidence.length; offset += 256) {
        await db.memoryEvidence.bulkPut(existingEvidence.slice(offset, offset + 256).map(row => ({ ...row, claimId: seededClaimId, id: `e:${encodeURIComponent(owner)}:chat:${encodeURIComponent(row.sourceId)}:${seededClaimId}` })));
      }
    });
  }
  const metrics = { canonicalQueries: 0, canonicalRows: 0, claimPutCalls: 0, claimPutRows: 0, knowledgeGetCalls: 0, knowledgeGetRows: 0, knowledgePutCalls: 0, knowledgePutRows: 0, evidenceGetCalls: 0, evidenceGetRows: 0, evidencePutCalls: 0, evidencePutRows: 0, maxEvidenceReadBatch: 0, maxEvidenceWriteBatch: 0, nativeWriteTransactions: 0, nativeWriteStoreNames: [] as string[][], sessionsWriteLock: false };
  const restore: Array<() => void> = [], transactions = new Set<any>();
  const nativeReadConnection = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open(db.name); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  let competingRead: Promise<void> | undefined, competingReadStarted = 0, competingReadElapsedMs: number | undefined, competingReadBeforeLedgerFinished: boolean | undefined, ledgerFinished = false;
  for (const table of [db.memoryClaims, db.memoryKnowledge, db.memoryEvidence]) {
    const core: any = table.core;
    for (const method of ['query', 'openCursor', 'get', 'getMany', 'mutate']) {
      const original = core[method];
      core[method] = function(request: any) {
        if (table.name === 'memoryEvidence' && method === 'mutate' && request.type === 'put' && !competingRead) {
          competingReadStarted = performance.now();
          competingRead = new Promise<void>((resolve, reject) => {
            const transaction = nativeReadConnection.transaction('sessions', 'readonly');
            transaction.objectStore('sessions').get('summary-session');
            transaction.oncomplete = () => { competingReadElapsedMs = performance.now() - competingReadStarted; competingReadBeforeLedgerFinished = !ledgerFinished; resolve(); };
            transaction.onabort = () => reject(transaction.error ?? Error('competing session read aborted'));
          });
        }
        return original.call(this, request).then((result: any) => {
        if (table.name === 'memoryClaims' && ['query', 'openCursor'].includes(method) && request.query?.index?.name === '[userId+canonicalKey]') {
          metrics.canonicalQueries++;
          metrics.canonicalRows += method === 'query' ? result.result.length : Number(!!result);
        }
        if (method === 'mutate' && request.type === 'put') {
          transactions.add(request.trans);
          const prefix = table.name === 'memoryClaims' ? 'claim' : table.name === 'memoryKnowledge' ? 'knowledge' : 'evidence';
          (metrics as any)[prefix + 'PutCalls']++;
          (metrics as any)[prefix + 'PutRows'] += request.values.length;
          if (table.name === 'memoryEvidence') metrics.maxEvidenceWriteBatch = Math.max(metrics.maxEvidenceWriteBatch, request.values.length);
        }
        if (['get', 'getMany'].includes(method) && table.name !== 'memoryClaims') {
          const prefix = table.name === 'memoryKnowledge' ? 'knowledge' : 'evidence';
          (metrics as any)[prefix + 'GetCalls']++;
          (metrics as any)[prefix + 'GetRows'] += method === 'get' ? Number(!!result) : result.filter(Boolean).length;
          if (table.name === 'memoryEvidence') metrics.maxEvidenceReadBatch = Math.max(metrics.maxEvidenceReadBatch, method === 'get' ? 1 : request.keys.length);
        }
        return result;
        });
      };
      restore.push(() => { core[method] = original; });
    }
  }
  const started = performance.now();
  let claimId: string, elapsedMs: number;
  try { claimId = await memoryLedgerRepo.syncMemoryItem(memory); elapsedMs = performance.now() - started; ledgerFinished = true; await competingRead; }
  finally { restore.reverse().forEach(fn => fn()); nativeReadConnection.close(); }
  metrics.nativeWriteTransactions = transactions.size;
  metrics.nativeWriteStoreNames = [...new Map([...transactions].map(transaction => { const stores = Array.from(transaction.objectStoreNames) as string[]; stores.sort(); return [JSON.stringify(stores), stores] as const; })).values()];
  metrics.sessionsWriteLock = metrics.nativeWriteStoreNames.some(stores => stores.includes('sessions'));
  const [evidence, claim, knowledge] = await Promise.all([db.memoryEvidence.where('[userId+claimId]').equals([owner, claimId]).toArray(), db.memoryClaims.get(claimId), db.memoryKnowledge.get(`${claimId}:${actor}`)]);
  const beforeBySource = new Map(existingEvidence.map(row => [row.sourceId, row]));
  const replaySemanticsCorrect = !existing || evidence.every(row => {
    if (row.sourceId === 'seed') return true;
    const prior = beforeBySource.get(row.sourceId), revision = memory.sourceMessageRevisions?.[row.sourceId] ?? 1;
    if (!prior) return false;
    const expectedWithdrawal = prior.withdrawnAt && revision <= prior.sourceRevision ? prior.withdrawnAt : undefined;
    return row.sourceRevision === revision && row.withdrawnAt === expectedWithdrawal && row.sourceOffset === memory.sourceMessageOffsets?.[row.sourceId] && row.sourceEndOffset === memory.sourceMessageEndOffsets?.[row.sourceId] && row.excerptHash === undefined;
  });
  const correct = evidence.length === count + 1 && claim?.status === 'active' && knowledge?.sourceId === sourceIds.at(-1) && replaySemanticsCorrect;
  return { count, existingEvidence: existing, inputSha256, elapsedMs, correct, ...(existing ? { replaySemanticsCorrect, seededWithdrawnEvidence: existingEvidence.filter(row => row.withdrawnAt).length, seededHigherRevisionEvidence: existingEvidence.filter(row => row.sourceRevision === 2).length } : {}), competingSessionRead: { elapsedMs: competingReadElapsedMs, completedBeforeLedgerFinished: competingReadBeforeLedgerFinished }, metrics, bounds: { canonicalQueries: 2, claimPutRows: 2, knowledgePutRows: 2, maxEvidenceReadBatch: 256, maxEvidenceWriteBatch: 256, nativeWriteTransactions: 1, sessionsWriteLock: false }, standaloneSessionLockCorrect: !metrics.sessionsWriteLock, withinBudget: metrics.canonicalQueries <= 2 && metrics.claimPutRows <= 2 && metrics.knowledgePutRows <= 2 && metrics.maxEvidenceReadBatch <= 256 && metrics.maxEvidenceWriteBatch <= 256 && metrics.nativeWriteTransactions <= 1 && !metrics.sessionsWriteLock };
}

/** The established public record API is the independent semantic oracle. */
async function sequentialReference(memory: MemoryItem) {
  const session = memory.sourceSessionId ? await db.sessions.get(memory.sourceSessionId) : undefined;
  const sourceType = memory.importedFromMemoryId ? 'legacy' : session?.type === 'group' ? 'group' : memory.sourceMessageIds?.length ? 'chat' : 'legacy';
  const sourceIds = memory.sourceMessageIds?.length ? memory.sourceMessageIds : memory.importedFromMemoryId ? [memory.importedFromMemoryId] : [memory.id];
  const canonicalKey = `${memory.memoryKind ?? 'fact'}:${memory.content.normalize('NFKC').toLocaleLowerCase().replace(/[\s\u3000，。！？、,.!?;；:："“”‘’（）()【】[\]{}]/g, '').slice(0, 240)}`;
  let first = '';
  for (const sourceId of sourceIds) {
    const id = await memoryLedgerRepo.record({ userId: memory.userId, subjectType: 'user', subjectId: memory.userId, predicate: memory.memoryKind ?? 'fact', value: memory.content, canonicalKey, memoryKind: memory.memoryKind ?? 'fact', stability: memory.stability, status: memory.status === 'withdrawn' ? 'withdrawn' : memory.status === 'superseded' ? 'superseded' : 'active', confidence: memory.confidence, importance: memory.pinned ? 1 : .5, pinned: memory.pinned,
      source: { type: sourceType, id: sourceId, revision: memory.sourceMessageRevisions?.[sourceId] ?? 1, observedAt: memory.createdAt, confidence: memory.confidence, ...(memory.sourceMessageOffsets?.[sourceId] !== undefined ? { sourceOffset: memory.sourceMessageOffsets[sourceId] } : {}), ...(memory.sourceMessageEndOffsets?.[sourceId] !== undefined ? { sourceEndOffset: memory.sourceMessageEndOffsets[sourceId] } : {}) }, characterIds: [memory.characterId], canMention: memory.status !== 'withdrawn' && memory.status !== 'superseded' });
    first ||= id;
  }
  return first;
}
async function semanticSnapshot() {
  const [claims, evidence, knowledge] = await Promise.all([db.memoryClaims.toArray(), db.memoryEvidence.toArray(), db.memoryKnowledge.toArray()]);
  const identities = new Map(claims.map(claim => [claim.id, JSON.stringify([claim.userId, claim.canonicalKey, claim.value])]));
  const sort = (rows: any[]) => rows.sort((a, b) => stableJson(a).localeCompare(stableJson(b)));
  return {
    claims: sort(claims.map(({ id, ...claim }) => claim)),
    evidence: sort(evidence.map(({ id, claimId, ...row }) => ({ ...row, claimIdentity: identities.get(claimId) ?? claimId }))),
    knowledge: sort(knowledge.map(({ id, claimId, ...row }) => ({ ...row, claimIdentity: identities.get(claimId) ?? claimId }))),
  };
}
function stableJson(value: unknown) {
  return JSON.stringify(value, (_key, row) => row && typeof row === 'object' && !Array.isArray(row) ? Object.fromEntries(Object.entries(row).sort(([a], [b]) => a.localeCompare(b))) : row);
}
type Scenario = { label: string; ids: string[]; memory?: Partial<MemoryItem>; setup?: (memory: MemoryItem, claimId: string) => Promise<void>; inspect?: (snapshot: Awaited<ReturnType<typeof semanticSnapshot>>) => boolean };
async function correctnessSuite() {
  const checks: Array<{ label: string; passed: boolean; detail?: unknown }> = [];
  const check = (passed: boolean, label: string, detail?: unknown) => checks.push({ label, passed, ...(!passed ? { detail } : {}) });
  const revoked = async (_memory: MemoryItem, claimId: string) => { await memoryLedgerRepo.revokeClaimSource(owner, claimId, 'chat', 'source-a'); };
  const scenarios: Scenario[] = [
    { label: 'single live source', ids: ['source-a'] },
    { label: 'same revoked source and same revision remain withdrawn', ids: ['source-a'], setup: revoked, inspect: s => s.claims[0].status === 'withdrawn' && s.evidence[0].withdrawnAt === 4000 && s.knowledge[0].revokedAt === 4000 && !s.knowledge[0].canMention },
    { label: 'same revoked source with newer revision reauthorizes', ids: ['source-a'], memory: { sourceMessageRevisions: { 'source-a': 2 } }, setup: revoked, inspect: s => s.claims[0].status === 'active' && !s.evidence[0].withdrawnAt && !s.knowledge[0].revokedAt && s.knowledge[0].canMention },
    { label: 'independent source reauthorizes revoked edge', ids: ['source-b'], setup: revoked, inspect: s => s.claims[0].status === 'active' && s.evidence.some(e => e.sourceId === 'source-a' && e.withdrawnAt === 4000) && !s.knowledge[0].revokedAt && s.knowledge[0].sourceId === 'source-b' },
    { label: 'duplicate withdrawn source never invents newer evidence', ids: ['source-a', 'source-a'], setup: revoked, inspect: s => s.claims[0].status === 'withdrawn' && s.evidence.length === 1 && !!s.knowledge[0].revokedAt },
    { label: 'A B A source order preserves old independent reauthorization semantics', ids: ['source-a', 'source-b', 'source-a'], setup: revoked, inspect: s => s.knowledge[0].sourceId === 'source-a' && s.evidence.some(e => e.sourceId === 'source-a' && !!e.withdrawnAt) },
    { label: 'B A B source order retains final B edge', ids: ['source-b', 'source-a', 'source-b'], setup: revoked, inspect: s => s.knowledge[0].sourceId === 'source-b' && !s.knowledge[0].revokedAt },
    { label: 'new revision with duplicate source consumes folded state', ids: ['source-a', 'source-b', 'source-a'], memory: { sourceMessageRevisions: { 'source-a': 2, 'source-b': 1 } }, setup: revoked, inspect: s => s.evidence.filter(e => e.sourceId === 'source-a').every(e => e.sourceRevision === 2 && !e.withdrawnAt) },
    { label: 'same withdrawn source repeated across 256 evidence boundary retains its withdrawal', ids: ['source-a', ...Array.from({ length: 256 }, (_, i) => 'boundary-old-' + i), 'source-a'], setup: revoked, inspect: s => s.evidence.some(e => e.sourceId === 'source-a' && e.withdrawnAt === 4000) && s.knowledge[0].sourceId === 'source-a' },
    { label: 'newer source repeated across 256 evidence boundary reads transaction-local cleared withdrawal', ids: ['source-a', ...Array.from({ length: 256 }, (_, i) => 'boundary-new-' + i), 'source-a'], memory: { sourceMessageRevisions: { 'source-a': 2 } }, setup: revoked, inspect: s => s.evidence.some(e => e.sourceId === 'source-a' && e.sourceRevision === 2 && !e.withdrawnAt) && !s.knowledge[0].revokedAt },
    { label: 'B duplicate in successive evidence batches preserves first batch updated revision', ids: ['source-a', 'source-b', ...Array.from({ length: 255 }, (_, i) => 'boundary-second-' + i), 'source-b'], memory: { sourceMessageRevisions: { 'source-a': 1, 'source-b': 2 } }, setup: async (memory, claimId) => { await memoryLedgerRepo.record({ userId: owner, value: memory.content, memoryKind: 'summary', source: { type: 'chat', id: 'source-b', revision: 1 }, characterIds: [actor] }); await memoryLedgerRepo.revokeClaimSource(owner, claimId, 'chat', 'source-b'); }, inspect: s => s.evidence.some(e => e.sourceId === 'source-b' && e.sourceRevision === 2 && !e.withdrawnAt) && s.knowledge[0].sourceId === 'source-b' },
    { label: 'lower source revision cannot clear prior withdrawal', ids: ['source-a', 'source-a'], memory: { sourceMessageRevisions: { 'source-a': 2 } }, setup: async (memory, claimId) => { await memoryLedgerRepo.record({ userId: owner, value: memory.content, memoryKind: 'summary', source: { type: 'chat', id: 'source-a', revision: 3 }, characterIds: [actor] }); await revoked(memory, claimId); }, inspect: s => s.claims[0].status === 'withdrawn' && s.evidence[0].sourceRevision === 2 && !!s.evidence[0].withdrawnAt },
    { label: 'one withdrawn source does not erase remaining independent evidence', ids: ['source-a', 'source-b'], setup: async (memory, claimId) => { await memoryLedgerRepo.record({ userId: owner, value: memory.content, memoryKind: 'summary', source: { type: 'chat', id: 'source-b', revision: 1 }, characterIds: [actor] }); await revoked(memory, claimId); }, inspect: s => s.claims[0].status === 'active' && s.evidence.some(e => e.sourceId === 'source-a' && !!e.withdrawnAt) && s.evidence.some(e => e.sourceId === 'source-b' && !e.withdrawnAt) },
    { label: 'explicit withdrawn summary remains unmentionable', ids: ['source-a', 'source-b'], memory: { status: 'withdrawn' }, inspect: s => s.claims[0].status === 'withdrawn' && !s.knowledge[0].canMention },
    { label: 'superseded summary remains unmentionable', ids: ['source-a', 'source-b'], memory: { status: 'superseded' }, inspect: s => s.claims[0].status === 'superseded' && !s.knowledge[0].canMention },
    { label: 'canonical conflict preserves dispute behavior and old claim fields', ids: ['source-a', 'source-b'], setup: async (memory, claimId) => { const key = (await db.memoryClaims.get(claimId))!.canonicalKey; await Promise.all([db.memoryClaims.clear(), db.memoryEvidence.clear(), db.memoryKnowledge.clear()]); const conflict = await memoryLedgerRepo.record({ userId: owner, value: '另一条彼此冲突的合成事实', canonicalKey: key, memoryKind: 'summary', source: { type: 'chat', id: 'conflict-source' }, characterIds: [actor] }); await db.memoryClaims.update(conflict, { retainedExtension: { conflict: true } } as any); }, inspect: s => s.claims.some(c => c.value === '另一条彼此冲突的合成事实' && c.status === 'disputed' && c.retainedExtension?.conflict) },
    { label: 'canonical and evidence lookups remain account scoped', ids: ['source-a', 'source-b'], setup: async memory => { const otherId = await memoryLedgerRepo.record({ userId: 'other-owner', value: memory.content, memoryKind: 'summary', source: { type: 'chat', id: 'source-a', revision: 8 }, characterIds: [actor] }); await db.memoryClaims.update(otherId, { retainedExtension: { foreign: true }, status: 'withdrawn' } as any); }, inspect: s => s.claims.some(c => c.userId === 'other-owner' && c.status === 'withdrawn' && c.retainedExtension?.foreign) && s.evidence.some(e => e.userId === 'other-owner' && e.sourceRevision === 8) },
    { label: 'another character knowledge edge stays unchanged', ids: ['source-a', 'source-b'], setup: async memory => { await memoryLedgerRepo.record({ userId: owner, value: memory.content, memoryKind: 'summary', source: { type: 'chat', id: 'foreign-character-source' }, characterIds: ['other-actor'] }); }, inspect: s => s.knowledge.some(k => k.characterId === 'other-actor' && k.sourceId === 'foreign-character-source') },
    { label: 'group session source type remains group', ids: ['source-a', 'source-b'], setup: async () => { await db.sessions.update('summary-session', { type: 'group' }); }, inspect: s => s.knowledge[0].sourceType === 'group' && s.evidence.filter(e => e.sourceId === 'source-b').every(e => e.sourceType === 'group') },
    { label: 'imported summary retains legacy provenance precedence', ids: ['source-a', 'source-b'], memory: { importedFromMemoryId: 'imported-memory' }, inspect: s => s.knowledge[0].sourceType === 'legacy' },
    { label: 'ordinary auto memory retains sequential behavior', ids: ['source-a', 'source-b', 'source-a'], memory: { type: 'auto' }, setup: revoked },
    { label: 'summary without source session retains legacy bridge', ids: ['source-a', 'source-b'], memory: { sourceSessionId: undefined }, setup: revoked },
    { label: 'summary without message ids retains memory-id fallback', ids: [], inspect: s => s.knowledge[0].sourceType === 'legacy' && s.knowledge[0].sourceId === 'summary-memory' },
  ];
  const originalNow = Date.now; Date.now = () => 4000;
  try {
    for (const scenario of scenarios) {
      const memory = makeMemory(scenario.ids, scenario.memory);
      const setup = async () => {
        await reset();
        const claimId = await memoryLedgerRepo.record({ userId: owner, value: memory.content, memoryKind: 'summary', confidence: .95, pinned: true, source: { type: 'chat', id: 'source-a', revision: 1, observedAt: 10 }, characterIds: [actor] });
        await db.memoryClaims.update(claimId, { retainedExtension: { nested: ['keep', 1] }, validFrom: 5, validUntil: 9000 } as any);
        await scenario.setup?.(memory, claimId);
      };
      await setup(); const actualId = await memoryLedgerRepo.syncMemoryItem(memory); const actual = await semanticSnapshot();
      check(!!actualId && !!await db.memoryClaims.get(actualId), scenario.label + ': returns a persisted claim');
      await setup(); await sequentialReference(memory); const expected = await semanticSnapshot();
      const equivalent = stableJson(actual) === stableJson(expected);
      check(equivalent, scenario.label + ': equivalent to sequential public record', equivalent ? undefined : { actual, expected });
      if (scenario.inspect) check(scenario.inspect(actual), scenario.label + ': explicit permission/provenance assertion', actual);
      if (!scenario.label.startsWith('canonical conflict')) check(actual.claims.some(c => c.userId === owner && c.retainedExtension?.nested?.[0] === 'keep'), scenario.label + ': retains unknown claim fields and validity dates', actual.claims);
    }
    await reset();
    const rollbackMemory = makeMemory(['rollback-a', ...Array.from({ length: 512 }, (_, i) => 'rollback-middle-' + i), 'rollback-b']);
    await memoryLedgerRepo.record({ userId: owner, value: rollbackMemory.content, memoryKind: 'summary', source: { type: 'chat', id: 'old-source' }, characterIds: [actor] });
    const before = stableJson(await semanticSnapshot());
    const fail = (_key: any, row: any) => { if (row.sourceId === 'rollback-b') throw Error('injected-summary-evidence-write-failure'); };
    let rejected = false;
    db.memoryEvidence.hook('creating', fail);
    try { await memoryLedgerRepo.syncMemoryItem(rollbackMemory); } catch (error) { rejected = String(error).includes('injected-summary-evidence-write-failure'); }
    finally { db.memoryEvidence.hook('creating').unsubscribe(fail); }
    check(rejected, 'injected late evidence failure is surfaced');
    check(stableJson(await semanticSnapshot()) === before, 'late evidence failure atomically rolls back claim, knowledge and all earlier evidence');
  } finally { Date.now = originalNow; }
  return { complete: checks.every(check => check.passed), checks };
}

(window as any).runSummaryLedgerBatch = async (options: { perfOnly?: boolean; scale?: boolean; existing?: boolean } = {}) => {
  await db.delete(); await db.open();
  const performance = [];
  for (const count of options.scale ? options.existing ? [50000] : [10000, 50000] : [512, 1000]) performance.push(await performanceFixture(count, options.existing));
  const correctness = options.perfOnly ? undefined : await correctnessSuite();
  return { complete: performance.every(item => item.correct && item.withinBudget) && correctness?.complete !== false, fixtureScope: (options.existing ? 'Replay of N existing same-claim evidence rows with mixed revision and withdrawal state. ' : 'N new source evidence rows for an existing canonical claim. ') + (options.scale ? 'After-only new scale fixture; no matching before timing or improvement claim.' : 'Same 512/1000-source fixture for saved-before and current-after comparison.'), performance, correctness, paidCalls: 0, scope: 'Actual memoryLedgerRepo.syncMemoryItem on synthetic native IndexedDB, compared with sequential public record and injected rollback, no model, microphone, Android or foreground timing claim.' };
};
