import Dexie from 'dexie';
import { db } from '../../src/db';
import { searchIndexedHistorySession } from '../../src/lib/chat-history-index';
import { recallHistoricalPrivateChat } from '../../src/lib/character-history-recall';
import { messageHistoryIdentity, messageHistoryProjection } from '../../src/db/message-history-index';
import { withChatSessionLock } from '../../src/lib/chat/request-coordinator';

type Counts = { transactions: number; requests: number; countCalls: number; postingQueries: number;
  bodyRows: number; keyRows: number; mutations: number };
let counts: Counts;
const reset = () => { counts = { transactions: 0, requests: 0, countCalls: 0, postingQueries: 0, bodyRows: 0, keyRows: 0, mutations: 0 }; };
reset();
db.use({ stack: 'dbcore', name: 'voice-empty-history', create: down => ({ ...down,
  transaction: (...args) => { counts.transactions++; return down.transaction(...args); },
  table: name => {
    const table = down.table(name);
    return { ...table,
      count: async request => { counts.requests++; counts.countCalls++; return table.count(request); },
      get: async request => { counts.requests++; const row = await table.get(request); counts.bodyRows += Number(!!row); return row; },
      getMany: async request => { counts.requests++; const rows = await table.getMany(request); counts.bodyRows += rows.filter(Boolean).length; return rows; },
      query: async request => {
        counts.requests++; if (name === 'messageHistorySearch' && request.query.index.name === 'entries') counts.postingQueries++;
        const result = await table.query(request); counts[request.values ? 'bodyRows' : 'keyRows'] += result.result.length; return result;
      },
      mutate: async request => { counts.mutations++; return table.mutate(request); },
    };
  },
}) });
const now = 1792029600000;
const rows = [
  { id: 'source-a', sessionId: 'nonempty', role: 'user', content: '观星约定买桂花糕', createdAt: now, revision: 1 },
  { id: 'source-b', sessionId: 'nonempty', role: 'user', content: '观星约定买桂花糕', createdAt: now, revision: 1 },
  { id: 'source-c', sessionId: 'nonempty', role: 'assistant', content: '桂花糕', createdAt: now - 10, revision: 1 },
  { id: 'source-failed', sessionId: 'nonempty', role: 'user', content: '观星约定买桂花糕', createdAt: now + 10, revision: 1, failed: true },
];
const params = (sessionId: string) => ({ sessionId, terms: ['观星', '约定', '桂花糕'], exactQuery: '观星约定桂花糕',
  excluded: new Set<string>(), preferAssistant: false, now, limit: 2 });
const hash = async (value: unknown) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',
  new TextEncoder().encode(JSON.stringify(value)))), byte => byte.toString(16).padStart(2, '0')).join('');
Object.assign(window, { voiceEmptyHistory: {
  setup: async () => {
    await db.delete(); await db.open();
    await db.characters.put({ id: 'a', createdBy: 'u', name: '隔离角色', createdAt: now, systemPrompt: '' } as any);
    await db.sessions.bulkPut([...Array.from({ length: 512 }, (_, index) => ({ id: `empty-${index}`, userId: 'u',
      characterId: 'a', type: 'single', title: '空会话', createdAt: now, updatedAt: now - index })),
    ...['nonempty', 'empty-corrupt', 'empty-concurrent'].map(id => ({ id, userId: 'u', characterId: 'a',
      type: 'single', title: id, createdAt: now, updatedAt: now + 1 }))] as any);
    await db.messages.bulkPut(rows as any);
    return { emptyOwnedSessions: 514, nonemptyOwnedSessions: 1, originalRows: rows.length,
      queryTerms: params('empty-0').terms, matchLimit: 2 };
  },
  sample: async (kind: 'empty' | 'nonempty') => {
    reset(); const started = performance.now(), result = await searchIndexedHistorySession(params(kind === 'empty' ? 'empty-0' : 'nonempty'));
    const elapsedMs = performance.now() - started, readCounts = structuredClone(counts);
    if (!result || result.length !== (kind === 'empty' ? 0 : 2)) throw Error(kind + ': result mismatch');
    return { elapsedMs, ...readCounts, resultHash: await hash(result) };
  },
  fullRecall: async () => {
    reset(); const started = performance.now();
    const result = await recallHistoricalPrivateChat({ userId: 'u', characterId: 'a', query: '还记得观星时一起买桂花糕的旧约定吗', limit: 2 });
    const elapsedMs = performance.now() - started, readCounts = structuredClone(counts);
    if (result.map(row => row.messageId).join(',') !== 'source-a,source-b') throw Error('full owned history changed tied source ordering');
    return { elapsedMs, ...readCounts, resultHash: await hash(result), returned: result.length };
  },
  checks: async () => withChatSessionLock('empty-history-fixture', async () => {
    const checks: string[] = [];
    const check = (condition: unknown, label: string) => { if (!condition) throw Error(label); checks.push(label); };
    check((await searchIndexedHistorySession(params('empty-0')))?.length === 0, 'both empty counts return an empty result');
    check((await searchIndexedHistorySession(params('nonempty')))?.map(hit => hit.row.id).join(',') === 'source-a,source-b', 'nonempty ranking and timestamp ties remain stable');
    check((await searchIndexedHistorySession({ ...params('nonempty'), terms: ['不存在'], exactQuery: '不存在' }))?.length === 0, 'nonempty zero-match lookup preserved');
    check((await searchIndexedHistorySession({ ...params('nonempty'), excluded: new Set(rows.map(row => row.id)) }))?.length === 0, 'source exclusions preserved');
    check(!(await searchIndexedHistorySession(params('nonempty')))?.some(hit => hit.row.id === 'source-failed'), 'failed sources remain excluded');
    await db.messages.update('source-a', { content: '更正后的观星约定买桂花糕', revision: 2 });
    check((await searchIndexedHistorySession(params('nonempty')))?.find(hit => hit.row.id === 'source-a')?.row.revision === 2, 'edited original revision read freshly');
    await db.messages.put(rows[0] as any);
    await db.messageHistorySearch.delete(messageHistoryIdentity(rows[0]));
    check((await searchIndexedHistorySession(params('nonempty')))?.map(hit => hit.row.id).join(',') === 'source-a,source-b', 'missing projection still merges unindexed original');
    await db.messageHistorySearch.put(messageHistoryProjection(rows[0]));
    const ghost = { ...rows[0], id: 'ghost', sessionId: 'empty-corrupt' };
    await db.messageHistorySearch.put(messageHistoryProjection(ghost));
    check(await searchIndexedHistorySession(params('empty-corrupt')) === undefined, 'zero originals plus stale projection retains damaged-index fallback');
    check(!(await recallHistoricalPrivateChat({ userId: 'u', characterId: 'a', query: '观星约定买桂花糕', limit: 4 })).some(hit => hit.messageId === ghost.id), 'stale projection cannot invent original history');
    await db.messageHistorySearch.delete(messageHistoryIdentity(ghost));
    // A writer is queued from the original-count completion. The original and
    // projection counts share a read transaction, so this lookup sees neither
    // half of the queued insert; the next lookup must see both committed rows.
    const core = db.messages.core, originalCount = core.count;
    const concurrent = { ...rows[0], id: 'concurrent-source', sessionId: 'empty-concurrent' };
    let writer: Promise<unknown> | undefined, injected = false;
    core.count = async request => {
      const result = await originalCount.call(core, request);
      if (!injected) { injected = true; writer = Dexie.ignoreTransaction(() => db.messages.put(concurrent as any)); }
      return result;
    };
    try {
      check((await searchIndexedHistorySession(params('empty-concurrent')))?.length === 0, 'queued writer cannot split same-transaction empty counts');
      check(injected && !!writer, 'concurrent writer was queued during count verification');
      await writer;
      check((await searchIndexedHistorySession(params('empty-concurrent')))?.[0]?.row.id === concurrent.id, 'next lookup sees committed concurrent original and projection');
    } finally { core.count = originalCount; await writer; await db.messages.delete(concurrent.id); }
    try { await db.transaction('rw', db.messages, db.messageHistorySearch, async () => {
      await db.messages.put(concurrent as any); throw Error('expected rollback');
    }); } catch (error) { if ((error as Error).message !== 'expected rollback') throw error; }
    check((await searchIndexedHistorySession(params('empty-concurrent')))?.length === 0, 'rollback leaves empty original and projection stores');
    check((await recallHistoricalPrivateChat({ userId: 'foreign', characterId: 'a', query: '观星约定买桂花糕' })).length === 0, 'history remains account scoped');
    check((await recallHistoricalPrivateChat({ userId: 'u', characterId: 'foreign', query: '观星约定买桂花糕' })).length === 0, 'history remains character scoped');
    return { checks, apiCalls: 0 };
  }),
} });
