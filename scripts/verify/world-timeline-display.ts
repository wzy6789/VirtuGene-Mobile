import { db, type WorldEvent, type WorldFact, type WorldScene, type Diary, type RelationshipEvent } from '../../src/db';
import { worldEventRepo } from '../../src/db/world-event-repo';
import { readTimelineRecord } from '../../src/lib/world/timeline-record';
import { buildTimeline, groupByDay, timelineDate, type TimelineItem } from '../../src/lib/world/world-timeline';

const userId = 'timeline-fixture-user';
const worldId = 'timeline-fixture-world';
const checks: string[] = [];
function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
  checks.push(message);
}
const event = (id: string, patch: Partial<WorldEvent> = {}): WorldEvent => ({
  id, userId, worldId, type: 'stage', title: id, summary: '原有摘要', participants: ['u:timeline-fixture-user', 'c:participant'],
  timestamp: 100, importance: 0.5, sourceType: 'story', sourceId: 'underlying-source-is-not-row-id', visibility: 'world',
  resolved: true, relatedEventIds: [], memoryIds: [], tags: [], createdAt: 80, updatedAt: 91, ...patch,
});
const fact = (id: string, patch: Partial<WorldFact> = {}): WorldFact => ({
  id, userId, worldId, category: 'custom', content: id, visibility: 'selected', visibleTo: ['knower'],
  sourceType: 'user', priority: 0.7, active: true, createdAt: 100, updatedAt: 92, ...patch,
});
const scene = (id: string, patch: Partial<WorldScene> = {}): WorldScene => ({
  id, userId, worldId, title: id, place: '庭院', timeLabel: '傍晚', mood: '安静', characterIds: ['participant'], status: 'finished',
  state: { participants: [], facts: [], unresolvedThreads: [], currentBeat: '', turnCount: 0 } as WorldScene['state'],
  startedAt: 70, finishedAt: 100, createdAt: 70, updatedAt: 93, ...patch,
});
const diary = (id: string, patch: Partial<Diary> = {}): Diary => ({
  id, userId, date: '2026-10-16', title: id, content: '日记正文', mood: 3, tags: [], characterId: 'participant',
  visibility: 'world', revision: 4, createdAt: 100, updatedAt: 94, ...patch,
});
const relationship = (id: string, patch: Partial<RelationshipEvent> = {}): RelationshipEvent => ({
  id, userId, worldId, pairKey: 'pair', subjectA: 'u:timeline-fixture-user', subjectB: 'c:participant',
  subjects: ['u:timeline-fixture-user', 'c:participant'], facets: { trust: 1 }, reason: id,
  sourceType: 'settlement', createdAt: 100, ...patch,
});
const nameOf = (id: string) => `名字:${id}`;
async function clearSources() {
  await Promise.all([db.worldEvents.clear(), db.worldFacts.clear(), db.worldScenes.clear(), db.relationshipEvents.clear(), db.diaries.clear()]);
}

/** Counts actual returned query bodies and visited value-cursor rows, including rows rejected by Dexie filters. */
async function measure<T>(run: () => Promise<T>): Promise<{ value: T; bodies: Record<string, number>; durationMs: number }> {
  const bodies: Record<string, number> = {};
  const restore: (() => void)[] = [];
  for (const table of [db.worldEvents, db.worldFacts, db.worldScenes, db.relationshipEvents, db.diaries]) {
    const core = (table as any).core;
    const query = core.query;
    const openCursor = core.openCursor;
    bodies[table.name] = 0;
    core.query = async function (request: any) {
      const result = await query.call(this, request);
      if (request.values) bodies[table.name] += result.result.length;
      return result;
    };
    core.openCursor = async function (request: any) {
      const cursor = await openCursor.call(this, request);
      if (cursor && request.values) {
        const start = cursor.start;
        cursor.start = function (callback: () => void) {
          return start.call(this, () => { bodies[table.name]++; callback(); });
        };
      }
      return cursor;
    };
    restore.push(() => { core.query = query; core.openCursor = openCursor; });
  }
  const start = performance.now();
  try { return { value: await run(), bodies, durationMs: performance.now() - start }; }
  finally { restore.forEach(fn => fn()); }
}

async function verifyTimeline() {
  checks.length = 0;
  await db.delete();
  await db.open();
  try {
    await db.worldEvents.bulkPut([
      event('shown-event'), event('foreign-world-event', { worldId: 'another-world' }),
      event('foreign-account-event', { userId: 'another-user' }),
    ]);
    await db.worldFacts.bulkPut([fact('shown-fact'), fact('foreign-world-fact', { worldId: 'another-world' }), fact('foreign-account-fact', { userId: 'another-user' })]);
    await db.relationshipEvents.bulkPut([relationship('shown-relationship'), relationship('foreign-world-relationship', { worldId: 'another-world' }), relationship('foreign-account-relationship', { userId: 'another-user' })]);
    await db.worldScenes.bulkPut([
      scene('covered-scene', { worldEventId: 'shown-event' }), scene('orphan-scene', { worldEventId: 'deleted-event' }), scene('unlinked-scene'),
      scene('foreign-reference-scene', { worldEventId: 'foreign-world-event' }), scene('foreign-account-reference-scene', { worldEventId: 'foreign-account-event' }),
      scene('foreign-world-scene', { worldId: 'another-world' }), scene('foreign-account-scene', { userId: 'another-user' }),
    ]);
    await db.diaries.bulkPut([
      diary('shown-diary'), diary('legacy-diary', { revision: undefined }), diary('private-diary', { visibility: 'private', createdAt: 10000 }),
      diary('deleted-diary', { deletedAt: 1 }), diary('no-consent-diary', { visibility: undefined }), diary('foreign-account-diary', { userId: 'another-user' }),
    ]);
    const items = await buildTimeline({ userId, worldId, nameOf });
    const byId = new Map(items.map(item => [item.id, item]));
    check(items.length === 9, 'all nine authorized candidates retained without covered scene duplication');
    check(!byId.has('s:covered-scene') && byId.has('e:shown-event'), 'scene hidden only when its linked event was actually returned');
    check(['orphan-scene', 'unlinked-scene', 'foreign-reference-scene', 'foreign-account-reference-scene'].every(id => byId.has(`s:${id}`)), 'deleted, absent and out-of-scope event links keep scene visible');
    check(!items.some(item => /foreign-(?:world|account)-(?:event|fact|relationship|scene|diary)$/.test(item.record!.id)), 'world-owned sources enforce account and world scope; diaries enforce their existing account scope');
    check(!items.some(item => ['private-diary', 'deleted-diary', 'no-consent-diary'].includes(item.record!.id)), 'private, deleted and unconsented diaries excluded before final limit');
    check(byId.get('f:shown-fact')!.names.length === 0, 'fact knowledge recipients are never rendered as participants');
    check(byId.get('e:shown-event')!.names.join() === '名字:participant' && byId.get('r:shown-relationship')!.names.join() === '名字:participant', 'event and relationship participant names keep their original meaning');
    for (const [id, kind, revision] of [
      ['e:shown-event', 'event', 91], ['f:shown-fact', 'fact', 92], ['s:orphan-scene', 'scene', 93],
      ['d:shown-diary', 'diary', 4], ['d:legacy-diary', 'diary', 94], ['r:shown-relationship', 'relationship', 100],
    ] as const) {
      check(JSON.stringify(byId.get(id)!.record) === JSON.stringify({ kind, id: id.slice(2), revision }), `real row identity and revision: ${kind} ${id}`);
    }
    check(items.map(item => item.id).slice(0, 4).join() === 'f:shown-fact,r:shown-relationship,d:legacy-diary,d:shown-diary', 'same-time importance order and stable source order preserved');
    check(byId.get('e:shown-event')!.label === '你们的故事' && byId.get('f:shown-fact')!.label === '这个世界记住了' && byId.get('s:orphan-scene')!.label === '一段共同经历', 'human labels and scene detail retained');
    check(byId.get('s:orphan-scene')!.detail === '庭院 · 傍晚', 'original scene place and time text retained');
    await db.worlds.put({ id: worldId, userId, name: '隔离世界', isDefault: true, createdAt: 1, updatedAt: 1 });
    const current = () => true;
    for (const id of ['e:shown-event','f:shown-fact','s:orphan-scene','d:shown-diary','r:shown-relationship']) {
      const detail = await readTimelineRecord(userId, worldId, byId.get(id)!.record!, current);
      check(!!detail && !detail.changed, `selected current record loads without full history: ${id}`);
    }
    check(!await readTimelineRecord('another-user',worldId,byId.get('e:shown-event')!.record!,current),'foreign owner cannot read selected detail');
    check(!await readTimelineRecord(userId,worldId,byId.get('e:shown-event')!.record!,()=>false),'obsolete view receives no record');
    await db.worldEvents.update('shown-event',{title:'新版标题',updatedAt:101});
    const changed = await readTimelineRecord(userId,worldId,byId.get('e:shown-event')!.record!,current);
    check(changed?.changed && changed.title==='新版标题','edited source shows current content and changed state');
    await db.diaries.update('shown-diary',{visibility:'private'});
    check(!await readTimelineRecord(userId,worldId,byId.get('d:shown-diary')!.record!,current),'revoked diary detail returns no old body');
    await db.worldEvents.delete('shown-event');
    check(!await readTimelineRecord(userId,worldId,byId.get('e:shown-event')!.record!,current),'deleted event detail returns no old body');
    await db.worldEvents.put(event('diary-event',{sourceType:'diary',sourceId:'shown-diary',meta:{diaryRevision:4}}));
    check(!await readTimelineRecord(userId,worldId,{kind:'event',id:'diary-event'},current),'private diary cannot survive through an old mirrored event');
    await db.diaries.update('shown-diary',{visibility:'world',worldEventId:'diary-event'});
    check(!!await readTimelineRecord(userId,worldId,{kind:'event',id:'diary-event'},current),'current diary authorization and reverse link permit current event');
    await db.diaries.update('shown-diary',{revision:5});
    check(!await readTimelineRecord(userId,worldId,{kind:'event',id:'diary-event'},current),'stale mirrored diary revision is not exposed');
    await db.sharedMemories.put({id:'selected-memory',userId,worldId,title:'角色之间的经历',summary:'当前保存的摘要',participants:['c:participant'],characterIds:['participant'],sourceType:'story',sourceId:'orphan-scene',importance:.5,visibility:'selected',visibleTo:['listener'],relatedCharacters:['participant'],relatedRelationships:[],tags:[],createdAt:70,updatedAt:71});
    const memoryRef={kind:'memory' as const,id:'selected-memory',revision:71};
    const memory=await readTimelineRecord(userId,worldId,memoryRef,current);
    check(memory?.sourceLabel==='世界故事'&&memory.body==='当前保存的摘要','selected memory shows current saved content and source label');
    check(memory?.participants?.join()==='c:participant'&&memory.visibleTo?.join()==='listener','memory participants and knowledge recipients remain distinct');
    check(!await readTimelineRecord('another-user',worldId,memoryRef,current),'other owner cannot open a saved memory');
    await db.sharedMemories.update('selected-memory',{summary:'新的当前摘要',updatedAt:72});
    const changedMemory=await readTimelineRecord(userId,worldId,memoryRef,current);
    check(changedMemory?.changed&&changedMemory.body==='新的当前摘要','edited saved memory replaces prior summary');
    await db.sharedMemories.delete('selected-memory');
    check(!await readTimelineRecord(userId,worldId,memoryRef,current),'deleted memory returns no cached summary');

    const originalNow = Date.now;
    try {
      Date.now = () => new Date(2026, 0, 2, 0, 10).getTime();
      check(timelineDate(new Date(2026, 0, 1, 23, 59).getTime()) === '昨天', 'local midnight starts yesterday even after only eleven minutes');
      check(timelineDate(new Date(2026, 0, 2, 0, 5).getTime()) === '今天', 'same local date remains today');
      check(timelineDate(new Date(2025, 11, 31, 23, 59).getTime()) === '2 天前', 'year boundary uses local calendar day difference');
      const base = items[0];
      const groups = groupByDay([2025, 2024].map(year => ({ ...base, timestamp: new Date(year, 0, 2, 12).getTime() })));
      check(groups.length === 2 && groups[0].label === groups[1].label && groups[0].key === '2025-01-02' && groups[1].key === '2024-01-02', 'same human date labels in different years never share a group');
      const midnightGroups = groupByDay([new Date(2026, 0, 2, 0, 5), new Date(2026, 0, 1, 23, 59)].map(date => ({ ...base, timestamp: date.getTime() })));
      check(midnightGroups.length === 2 && midnightGroups.map(group => group.label).join() === '今天,昨天', 'group keys and local labels agree across midnight');
      Date.now = () => new Date(2026, 2, 9, 0, 10).getTime();
      check(timelineDate(new Date(2026, 2, 8, 0, 1).getTime()) === '昨天', 'calendar day calculation survives a daylight-saving transition');
    } finally { Date.now = originalNow; }

    await clearSources();
    const owned = Array.from({ length: 6000 }, (_, i) => event(`owned-${String(i).padStart(5, '0')}`, { timestamp: 10000 + i }));
    const foreign = Array.from({ length: 600 }, (_, i) => event(`foreign-${i}`, { timestamp: 20000 + i, userId: 'another-user' }));
    const otherWorld = Array.from({ length: 600 }, (_, i) => event(`other-world-${i}`, { timestamp: 30000 + i, worldId: 'another-world' }));
    await db.worldEvents.bulkPut([...owned, ...foreign, ...otherWorld]);
    const baseline = await measure(() => worldEventRepo.getRecent(worldId, 200, userId));
    const optimized = await measure(() => buildTimeline({ userId, worldId, nameOf, limit: 200 }));
    check(JSON.stringify(baseline.value.map(row => `e:${row.id}`)) === JSON.stringify(optimized.value.map(item => item.id)), 'indexed candidate query matches original selection and ordering with stock records and foreign accounts');
    check(baseline.bodies.worldEvents === 6600 && optimized.bodies.worldEvents < 1000, 'indexed recent events read fewer than 1000 bodies versus 6600 baseline bodies');

    await clearSources();
    await db.worldEvents.bulkPut(Array.from({ length: 260 }, (_, i) => event(`tie-${String(i).padStart(4, '0')}`, { timestamp: 70000, importance: i % 2 ? 0.8 : 0.4 })));
    const tiedBaseline = await worldEventRepo.getRecent(worldId, 200, userId);
    const tiedActual = await buildTimeline({ userId, worldId, nameOf, limit: 200 });
    const expectedTies = [...tiedBaseline].sort((a, b) => b.timestamp - a.timestamp || b.importance - a.importance).map(row => `e:${row.id}`);
    check(JSON.stringify(expectedTies) === JSON.stringify(tiedActual.map(item => item.id)), '200-row boundary preserves original primary-key selection and importance order for 260 same-time events');
    await db.worldScenes.put(scene('outside-window-scene', { worldEventId: 'tie-0259', finishedAt: 80000 }));
    const outside = await buildTimeline({ userId, worldId, nameOf, limit: 500 });
    check(outside.some(item => item.id === 's:outside-window-scene') && !outside.some(item => item.id === 'e:tie-0259'), 'scene remains when linked event exists outside returned event candidate window');

    return {
      complete: true, checks, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      isolation: 'Fresh headless-browser context and ephemeral localhost origin; synthetic IndexedDB only; no model, microphone, Android or private database access.',
      models: { model: '未确认', reasoning: '未确认', applicationModelCalls: 0 },
      performance: { seedRows: 7200, baseline: { bodies: baseline.bodies, durationMs: baseline.durationMs }, indexed: { bodies: optimized.bodies, durationMs: optimized.durationMs } },
      limitations: [
        'Events lack [userId+worldId+timestamp]; rejecting other-account rows within this world can still visit many cursor bodies.',
        'Equal-timestamp boundary rows are read in full to preserve existing primary-key selection; a large tie can cost more reads.',
        'Facts, scenes and relationships retain one world-index candidate scan each; diaries retain one account-index scan with private/deleted filtering before final limit.',
        'Diaries have no worldId and preserve their existing account-wide timeline scope. No source limit or privacy rule was reduced.',
        'Timing is desktop synthetic IndexedDB candidate preparation only, not model latency, first-visible output or Android performance.',
      ],
    };
  } finally { await db.delete(); }
}

Object.assign(window, { worldTimelineDisplayChecks: verifyTimeline });
