import { db } from '../../src/db';
import { useAuthStore } from '../../src/store/auth-store';
import { prepareCallContext } from '../../src/lib/voice-call/context';
import { knowledgeRepo } from '../../src/db/knowledge-repo';
import { memorySourceTombstoneId } from '../../src/db/memory-source-tombstone-repo';
import { VoiceCallController } from '../../src/lib/voice-call/controller';

type Counts = { transactions: number; rows: number; requests: number; tables: Record<string, number> };
let counts: Counts;
const reset = () => { counts = { transactions: 0, rows: 0, requests: 0, tables: {} }; };
reset();
db.use({ stack: 'dbcore', name: 'voice-context-latency', create: down => ({ ...down,
  transaction: (...args) => { counts.transactions++; return down.transaction(...args); },
  table: name => {
    const table = down.table(name);
    const add = (n: number) => { counts.rows += n; counts.tables[name] = (counts.tables[name] ?? 0) + n; };
    return { ...table,
      get: async request => { counts.requests++; const row = await table.get(request); add(Number(!!row)); return row; },
      getMany: async request => { counts.requests++; const rows = await table.getMany(request); add(rows.filter(Boolean).length); return rows; },
      query: async request => { counts.requests++; const result = await table.query(request); add(result.result.length); return result; },
      openCursor: async request => {
        counts.requests++; const cursor = await table.openCursor(request); if (!cursor) return cursor;
        const seen = new Set<string>(); const start = cursor.start.bind(cursor);
        const count = () => { const key = JSON.stringify([cursor.key, cursor.primaryKey]); if (cursor.value && !seen.has(key)) { seen.add(key); add(1); } };
        count(); cursor.start = callback => start(() => { count(); callback(); }); return cursor;
      },
    };
  },
}) });

Object.assign(window, { voiceContextReadCounts: () => structuredClone(counts), resetVoiceContextReadCounts: reset,
voiceContextLatency: async (rich = false, hotspot = false, setupOnly = false) => {
  const topic = hotspot ? '还记得一起观星 CHAT_MEMORY SHARED_MEMORY TODO_SOURCE CONTINUITY_SOURCE MOMENT_SOURCE REACTION_SOURCE 吗' : rich ? '还记得一起观星 CHAT_MEMORY SHARED_MEMORY TODO_SOURCE 吗' : '还记得一起观星吗';
  await db.delete(); await db.open(); useAuthStore.setState({ userId: 'u' });
  const now = 1792029600000;
  globalThis.Date = new Proxy(Date, {
    construct: (target, args) => Reflect.construct(target, args.length ? args : [now]),
    apply: target => new target(now).toString(),
    get: (target, key) => key === 'now' ? () => now : Reflect.get(target, key),
  });
  await db.characters.bulkPut(['a', 'b', 'c'].map(id => ({ id, createdBy: 'u', name: `角色${id}`, systemPrompt: '说话简洁认真，保留自己的判断。', createdAt: now, tags: [] })) as any);
  await db.sessions.put({ id: 's', userId: 'u', characterId: 'a', type: 'single', title: '通话', createdAt: now, updatedAt: now, unreadCount: 0 } as any);
  await db.worlds.put({ id: 'w', userId: 'u', name: '测试世界', createdAt: now, isDefault: true } as any);
  await db.messages.bulkPut(Array.from({ length: 2000 }, (_, i) => ({ id: `m${i}`, sessionId: 's', role: i % 2 ? 'assistant' : 'user', content: `记得一起观星${i}`, createdAt: now + i })) as any);
  await db.diaries.bulkPut(Array.from({ length: 600 }, (_, i) => ({ id: `d${i}`, userId: 'u', date: '2026-10-15', title: `观星${i}`, content: '观星记录。' + '正文'.repeat(500), characterId: 'a', visibility: i < 6 ? 'world' : 'private', worldEventId: i < 6 ? `e${i}` : undefined, createdAt: now, updatedAt: now, revision: 1, tags: [] })) as any);
  await db.characterKnowledge.bulkPut(Array.from({ length: 10000 }, (_, i) => ({ id: `unrelated${i}`, userId: 'u', worldId: 'w', characterId: i % 2 ? 'b' : 'a', eventId: `other${i}`, knowledgeLevel: 'full', canMention: true, learnedAt: now })) as any);
  await db.memorySourceTombstones.bulkPut(Array.from({ length: 10605 }, (_, i) => {
    const userId = i < 8105 ? 'u' : 'foreign', characterId = i < 8105 ? i % 2 ? 'b' : 'c' : 'a', sourceId = `withdrawn${i}`;
    return { id: memorySourceTombstoneId(userId, 'message', sourceId), userId, characterId, sourceType: 'message', sourceId, sourceRevision: 1, status: 'deleted', updatedAt: now, suppressedMessageIds: [sourceId] };
  }) as any);
  for (let i = 0; i < 6; i++) {
    await db.worldEvents.put({ id: `e${i}`, userId: 'u', worldId: 'w', type: 'stage', title: `一起观星${i}`, summary: `观星地点${i}`, visibility: 'world', participants: ['c:a'], sourceType: 'diary', sourceId: `d${i}`, timestamp: now, createdAt: now, updatedAt: now, memoryIds: [] } as any);
    await knowledgeRepo.upsert({ userId: 'u', worldId: 'w', characterId: 'a', eventId: `e${i}`, knowledgeLevel: 'full', canMention: true });
    await knowledgeRepo.upsert({ userId: 'u', worldId: 'w', characterId: 'a', eventId: `diary:d${i}`, knowledgeLevel: 'full', canMention: true });
  }
  if (rich) {
    await db.sessions.put({ id: 'old-session', userId: 'u', characterId: 'a', type: 'single', title: '此前私聊', createdAt: now - 1000, updatedAt: now - 1000, unreadCount: 0 } as any);
    await db.messages.put({ id: 'old-source', sessionId: 'old-session', role: 'user', content: '观星时我喜欢准备绿茶 CHAT_SOURCE', revision: 1, createdAt: now - 1000 } as any);
    await db.memories.put({ id: 'chat-memory', userId: 'u', characterId: 'a', content: '用户观星时喜欢准备绿茶 CHAT_MEMORY', type: 'auto', memoryKind: 'preference', sourceEvidenceMode: 'independent', sourceSessionId: 'old-session', sourceMessageIds: ['old-source'], sourceMessageRevisions: { 'old-source': 1 }, status: 'active', createdAt: now - 1000, updatedAt: now - 1000 } as any);
    await db.sharedMemories.put({ id: 'shared-memory', userId: 'u', worldId: 'w', title: '观星共同经历 SHARED_MEMORY', summary: '那次在山顶看到了流星。', visibility: 'selected', visibleTo: ['a'], characterIds: ['a'], participants: ['c:a'], importance: 1, createdAt: now + 1, updatedAt: now + 1 } as any);
    await db.worldEvents.put({ id: 'shared-event', userId: 'u', worldId: 'w', type: 'shared_memory', title: '观星结算事件', summary: '那次观星已记录。', visibility: 'selected', visibleTo: ['a'], participants: ['c:a'], sourceType: 'shared_memory', sourceId: 'shared-memory', memoryIds: ['shared-memory'], timestamp: now + 1, createdAt: now + 1, updatedAt: now + 1 } as any);
    await knowledgeRepo.upsert({ userId: 'u', worldId: 'w', characterId: 'a', eventId: 'shared-event', knowledgeLevel: 'full', canMention: true, learnedAt: now + 1 });
    await db.todos.put({ id: 'shared-completed', userId: 'u', title: '观星器材归还 TODO_SOURCE', note: '已经归还', dueDate: '2026-10-14', recurrence: { kind: 'none' }, status: 'completed', completedAt: now, visibility: 'selected', visibleTo: ['a'], createdAt: now, updatedAt: now } as any);
    await db.todoOccurrences.put({ id: 'todo-occ:shared-completed:2026-10-14', userId: 'u', todoId: 'shared-completed', dueDate: '2026-10-14', originalDueDate: '2026-10-14', status: 'completed', completedAt: now, createdAt: now, updatedAt: now } as any);
  }
  if (hotspot) {
    await db.continuityThreads.bulkPut(Array.from({ length: 5000 }, (_, i) => ({ id: `closed-${i}`, userId: i % 2 ? 'u' : 'foreign', characterId: 'a', status: 'done', title: `旧约定${i}`, kind: 'promise', createdAt: now, updatedAt: now })) as any);
    await db.continuityThreads.put({ id: 'selected-thread', userId: 'u', characterId: 'a', status: 'open', title: '观星约定 CONTINUITY_SOURCE', kind: 'promise', createdAt: now, updatedAt: now } as any);
    await db.momentViews.bulkPut(Array.from({ length: 10000 }, (_, i) => ({ id: `view-${i}`, userId: 'u', characterId: 'a', momentId: `unrelated-${i}`, viewedAt: now })) as any);
    await db.moments.put({ id: 'selected-post', userId: 'u', authorCharacterId: null, text: '观星照片 MOMENT_SOURCE', mediaIds: [], visibility: 'selected', audienceCharacterIds: ['a'], deleted: false, createdAt: now, updatedAt: now } as any);
    await db.momentReactions.put({ id: 'selected-reaction', userId: 'u', momentId: 'selected-post', characterId: 'b', type: 'comment', content: '准备观星 REACTION_SOURCE', status: 'active', createdAt: now, updatedAt: now } as any);
    await db.momentViews.put({ id: 'selected-view', userId: 'u', characterId: 'a', momentId: 'selected-post', viewedAt: now });
    await db.memorySourceTombstones.bulkPut(Array.from({ length: 3000 }, (_, i) => ({ id: memorySourceTombstoneId('u', 'message', `same-role-old-${i}`), userId: 'u', characterId: 'a', sourceType: 'message', sourceId: `same-role-old-${i}`, sourceRevision: 1, status: 'deleted', updatedAt: now, suppressedMessageIds: [`same-role-old-${i}`] })) as any);
  }
  if (setupOnly) return { ready: true, historyMessages: 2000, unrelatedTombstones: 13605, unrelatedKnowledge: 10000,
    unrelatedContinuity: 5000, unrelatedViews: 10000 };
  const samples = [];
  for (const matching of [0, 2]) {
    if (matching) await db.memorySourceTombstones.bulkPut(Array.from({ length: matching }, (_, i) => ({ id: memorySourceTombstoneId('u', 'message', `owned-withdrawn${i}`), userId: 'u', characterId: 'a', sourceType: 'message', sourceId: `owned-withdrawn${i}`, sourceRevision: 1, status: 'deleted', updatedAt: now, suppressedMessageIds: [`owned-withdrawn${i}`] })) as any);
    for (let sample = 0; sample < (hotspot ? 3 : 5); sample++) {
      reset(); const started = performance.now();
      const context = await prepareCallContext({ userId: 'u', characterId: 'a', sessionId: 's', worldId: 'w' }, topic, [], new AbortController().signal);
      if (rich) for (const marker of ['CHAT_MEMORY', 'SHARED_MEMORY', 'TODO_SOURCE', ...(hotspot ? ['CONTINUITY_SOURCE', 'MOMENT_SOURCE', 'REACTION_SOURCE'] : [])]) {
        if (!context.messages[0].content.includes(marker)) throw Error(`rich reference absent from actual system prompt: ${marker}`);
      }
      const prepareMs = performance.now() - started, preparation = structuredClone(counts);
      const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(context.messages)));
      const validations = [];
      for (let i = 0; i < 12; i++) {
        reset(); const checkedAt = performance.now(); await context.assertCurrent!();
        validations.push({ ms: performance.now() - checkedAt, ...structuredClone(counts) });
      }
      samples.push({ matching, sample, prepareMs, preparation, validations, promptHash: Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('') });
    }
  }
  const checks: string[] = [];
  const owner = { userId: 'u', characterId: 'a', sessionId: 's', worldId: 'w' };
  const abort = new AbortController();
  const guarded = await prepareCallContext(owner, topic, [], abort.signal);
  const rejects = async (operation: Promise<unknown>, expected: string, label: string) => {
    try { await operation; throw Error(`${label}: unexpectedly allowed`); }
    catch (error) {
      if ((error as Error).message !== expected && (error as Error).name !== expected) throw error;
      checks.push(label);
    }
  };
  // A call can lose its account while IndexedDB work is already queued.
  const checkingAccount = guarded.assertCurrent!(); useAuthStore.setState({ userId: 'foreign' });
  await rejects(checkingAccount, 'voice:account_changed', 'in-flight account switch rejects packet');
  useAuthStore.setState({ userId: 'u' }); await guarded.assertCurrent!();
  if (rich) await db.messages.update('m1998', { content: '已经更正的当前用户台词' });
  else await db.worldEvents.update('e0', { summary: '已经更正的地点' });
  await rejects(guarded.assertCurrent!(), 'voice:context_changed', 'next packet re-reads committed source edit');
  if (rich) await db.messages.update('m1998', { content: '记得一起观星1998' });
  else await db.worldEvents.update('e0', { summary: '观星地点0' });
  await guarded.assertCurrent!();
  const checkingAbort = guarded.assertCurrent!(); abort.abort();
  await rejects(checkingAbort, 'AbortError', 'in-flight cancellation rejects packet');
  const sourceResults = [], turns = [];
  if (rich) {
    for (const source of ['chat-memory', 'shared-memory', 'todo'] as const) {
      const context = await prepareCallContext(owner, topic, [], new AbortController().signal);
      const table = source === 'chat-memory' ? db.memories : source === 'shared-memory' ? db.sharedMemories : db.todos;
      const id = source === 'todo' ? 'shared-completed' : source;
      const original = (await table.get(id))!;
      await (table as any).update(id, source === 'chat-memory' ? { content: '已经改写的记忆' } : { visibility: 'private' });
      let rejected = false, error: string | undefined;
      try { await context.assertCurrent!(); } catch (e) { rejected = true; error = (e as Error).message; }
      sourceResults.push({ source, rejected, error });
      await (table as any).put(original);
    }
    for (let i = 0; i < 3; i++) {
      let completed: any, preparedMs = 0, frames = 0;
      const audio: any = { start: async () => ({ echoCancellation: true, noiseSuppression: true, routes: [] }), beginPlayback: async () => {}, append: async () => ({ playedFrames: frames += 480, writtenFrames: frames, sampleRate: 24000 }), drain: async () => ({ playedFrames: frames, writtenFrames: frames, sampleRate: 24000, complete: true }), interrupt: async () => ({ playedFrames: frames, writtenFrames: frames }), close: async () => {} };
      const controller = new VoiceCallController(`context-rich-${i}`, { now: () => performance.now(), inputMode: 'text', audio, voice: 'mimo_default', style: '', onView: () => {},
        context: async (text, exchanges, signal, mode) => { const start = performance.now(); const result = await prepareCallContext(owner, text, exchanges, signal, mode); preparedMs = performance.now() - start; return result; },
        api: { recognize: async () => { throw Error('ASR forbidden'); }, dialogue: async (_, opts) => { await opts.onText('还记得那次一起观星。'); }, synthesize: async (_, _v, _s, opts) => { for (let c = 0; c < 10; c++) await opts.onPcm(new Uint8Array(960)); } }, onExchange: exchange => { completed = exchange; },
      } as any);
      await controller.start(); reset(); const start = performance.now(); await controller.sendText(topic);
      while (!completed) { if (performance.now() - start > 30000) throw Error('rich local turn timeout'); await new Promise(r => setTimeout(r, 5)); }
      turns.push({ prepareMs: preparedMs, firstPlaybackMs: completed.metrics.firstPlaybackMs, totalMs: performance.now() - start, ...structuredClone(counts) }); await controller.end();
    }
  }
  return { samples, checks, sourceResults, turns, fixture: { historyMessages: 2000, diaries: 600, unrelatedKnowledge: 10000, unrelatedTombstones: 10605, sameAccountOtherCharacterTombstones: 8105, otherAccountSameCharacterTombstones: 2500, sameCharacterUnrelatedTombstones: hotspot ? 3000 : 0, unrelatedContinuity: hotspot ? 5000 : 0, unrelatedViews: hotspot ? 10000 : 0, rich }, apiCalls: 0, scope: 'isolated real IndexedDB; CPU 4x desktop Chrome; actual context/controller and repeated source checks; synthetic text/dialogue/PCM transport; no ASR/model/TTS/audio/network' };
} });
