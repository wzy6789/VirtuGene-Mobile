import { db, type World } from '../../src/db';
import { worldRepo } from '../../src/db/world-repo';
import { worldSceneRepo } from '../../src/db/world-scene-repo';
import { diaryRepo } from '../../src/db/diary-repo';
import { setDiarySharing } from '../../src/lib/world/diary-visibility';
import { buildCharacterMemoryContext, packCharacterMemory, type MemoryMode } from '../../src/lib/character-memory';
import { selectLiveSceneMoments } from '../../src/lib/world/scene-recall';
import { buildWorldContext, renderCharacterContext } from '../../src/lib/world/world-context';
import { messageRepo } from '../../src/db/message-repo';

const report = window.fetch.bind(window);
let passed = 0;
const lines: string[] = [];
function check(label: string, condition: unknown) {
  if (!condition) throw new Error(label);
  passed++; lines.push(`ok ${label}`);
}
const U = 'final-owner'; const A = 'final-a'; const B = 'final-b'; const now = Date.now();
const character = (id: string) => ({ id, createdBy: U, name: id, avatar: '🌙', systemPrompt: '说话直接，但关心细节。', tags: [], createdAt: now, isPreset: false, isCustom: true });
const modes: MemoryMode[] = ['private-chat', 'group-chat', 'world-scene', 'moments-comment'];
async function run() {
  window.fetch = (() => { throw new Error('unexpected network'); }) as typeof fetch;
  await db.characters.bulkPut([character(A), character(B)] as any);
  const original = await worldRepo.ensureDefaultWorld(U);
  const other = { ...original, id: 'final-other-world', isDefault: false, name: '另一个世界' } as World;
  await db.worlds.put(other);
  const sceneId = await worldSceneRepo.createScene({ userId: U, worldId: original.id, title: '商场', place: '商场', timeLabel: '午后', mood: '安静', characterIds: [A] });
  await worldSceneRepo.setSceneStatus(sceneId, 'active');
  await worldSceneRepo.appendEntry(sceneId, { kind: 'user_input', content: 'FINAL_DESTINATION 我去商场南门买桂花糕，给姐姐的。' });
  for (let i = 0; i < 35; i++) await worldSceneRepo.appendEntry(sceneId, { kind: 'dialogue', speakerId: A, content: `普通的闲聊 ${i}` });
  // Place enough newer finished scenes ahead of the active scene to reproduce pre-filter capping.
  for (let i = 0; i < 8; i++) {
    const id = await worldSceneRepo.createScene({ userId: U, worldId: original.id, title: `旧事${i}`, place: '家', timeLabel: '晚上', mood: '平静', characterIds: [A] });
    await db.worldScenes.update(id, { status: 'finished', finishedAt: now + 1000 + i, updatedAt: now + 1000 + i });
  }
  check('newer finished scenes cannot hide an active witnessed scene', (await selectLiveSceneMoments({ userId: U, worldId: original.id, characterId: A })).some(row => row.scene.id === sceneId));
  const currentId = await worldSceneRepo.createScene({ userId: U, worldId: other.id, title: '新世界', place: '屋顶', timeLabel: '晚上', mood: '安静', characterIds: [A, B] });
  const current = (await worldSceneRepo.getScene(currentId))!;
  for (const mode of modes) {
    const recall = await buildCharacterMemoryContext({ userId: U, characterId: A, mode, topic: '桂花糕给谁的？', scene: { worldId: other.id, sceneId: currentId, liveSegments: true }, budget: 3500 });
    check(`${mode}: natural question recalls another world's own witnessed detail`, recall.text.includes('FINAL_DESTINATION'));
    const denied = await buildCharacterMemoryContext({ userId: U, characterId: B, mode, topic: '桂花糕给谁的？', worldId: other.id });
    check(`${mode}: another role cannot recall that private experience`, !denied.text.includes('FINAL_DESTINATION'));
  }
  const ctx = await buildWorldContext({ userId: U, worldId: other.id, scene: current, characters: [character(A), character(B)] as any, userText: '桂花糕给谁的？' });
  check('real world actor context keeps its own cross-world memory', renderCharacterContext(ctx, A).includes('FINAL_DESTINATION'));
  check('other world actor context receives none of that memory', !renderCharacterContext(ctx, B).includes('FINAL_DESTINATION'));

  const diary = await diaryRepo.create({ userId: U, date: '2026-09-26', title: '小事', content: 'FINAL_DIARY 周五去学陶艺。', tags: [] });
  await setDiarySharing({ userId: U, diaryId: diary, visibility: 'selected', visibleTo: [A] });
  for (const mode of modes) {
    const recall = await buildCharacterMemoryContext({ userId: U, characterId: A, mode, topic: '今天怎么样', worldId: other.id, withCatalog: true });
    check(`${mode}: authorized diary follows its owner to another world`, recall.text.includes('FINAL_DIARY') && recall.catalog?.diaries.some(row => row.id === diary));
  }
  const shared = await buildCharacterMemoryContext({ userId: U, characterId: A, mode: 'group-chat', audience: [A, B], topic: '日记', withCatalog: true });
  check('shared prompt and catalog both reject a diary authorized only to A', !shared.text.includes('FINAL_DIARY') && !shared.catalog?.diaries.length);
  await setDiarySharing({ userId: U, diaryId: diary, visibility: 'private' });
  check('revocation immediately removes diary in every world', !(await buildCharacterMemoryContext({ userId: U, characterId: A, worldId: other.id, topic: '日记' })).text.includes('FINAL_DIARY'));

  await db.todos.put({ id: 'final-todo', userId: U, title: 'FINAL_TODO 取包裹', note: '快递柜密码已告诉你', status: 'todo', recurrence: { kind: 'none' }, visibility: 'selected', visibleTo: [A], createdAt: now, updatedAt: now } as any);
  for (const mode of modes) {
    const recall = await buildCharacterMemoryContext({ userId: U, characterId: A, mode, topic: '那个待办是什么？' });
    check(`${mode}: authorized undated task is remembered as unfinished`, recall.text.includes('FINAL_TODO') && recall.text.includes('未完成事项'));
  }
  check('undated task does not become a reminder on unrelated turns', !(await buildCharacterMemoryContext({ userId: U, characterId: A, topic: '今天的云很好看' })).text.includes('FINAL_TODO'));
  await db.todos.update('final-todo', { visibleTo: [B] });
  check('todo authorization change immediately removes A knowledge', !(await buildCharacterMemoryContext({ userId: U, characterId: A, topic: '待办' })).text.includes('FINAL_TODO'));

  await db.sessions.put({ id: 'final-chat-session', userId: U, characterId: A, createdAt: now - 1000, updatedAt: now } as any);
  await db.messages.put({ id: 'final-old-message', sessionId: 'final-chat-session', role: 'user', content: 'FINAL_CHAT 青海旅行要在黑马河见面。', createdAt: now - 1000 } as any);
  for (let i = 0; i < 20; i++) await db.messages.put({ id: `final-chat-new-${i}`, sessionId: 'final-chat-session', role: 'assistant', content: `无关闲聊 ${i}`, createdAt: now + i } as any);
  check('ordinary private detail question searches beyond recent six turns', (await buildCharacterMemoryContext({ userId: U, characterId: A, topic: '青海旅行在哪里见面？' })).text.includes('FINAL_CHAT'));
  await messageRepo.deleteById('final-old-message');
  check('deleted original never returns through natural history lookup', !(await buildCharacterMemoryContext({ userId: U, characterId: A, topic: '青海旅行在哪里见面？' })).text.includes('FINAL_CHAT'));

  await db.groups.put({ id: 'final-group', userId: U, name: '茶会', characterIds: [A, B], createdAt: now, updatedAt: now } as any);
  await db.sessions.put({ id: 'final-group-session', userId: U, characterId: 'final-group', groupId: 'final-group', type: 'group', createdAt: now, updatedAt: now } as any);
  await db.messages.put({ id: 'final-group-message', sessionId: 'final-group-session', role: 'user', content: 'FINAL_GROUP 茶会安排在银杏树下。', witnessedBy: [A], createdAt: now } as any);
  for (const mode of modes) {
    const recall = await buildCharacterMemoryContext({ userId: U, characterId: A, mode, topic: '茶会安排在哪里？' });
    check(`${mode}: witnessed group speech follows this character`, recall.text.includes('FINAL_GROUP'));
  }
  check('unwitnessed group speech is never granted to another member', !(await buildCharacterMemoryContext({ userId: U, characterId: B, topic: '茶会在哪里？' })).text.includes('FINAL_GROUP'));

  await db.moments.put({ id: 'final-post', userId: U, text: 'FINAL_MOMENT 绝版诗集在书桌左边。', visibility: 'selected', audienceCharacterIds: [A], mediaIds: [], createdAt: now - 50000, updatedAt: now - 50000 } as any);
  await db.momentViews.put({ id: 'final-post-view', userId: U, characterId: A, momentId: 'final-post', viewedAt: now } as any);
  await db.momentReactions.put({ id: 'final-like', userId: U, momentId: 'final-post', characterId: A, type: 'like', status: 'active', createdAt: now, updatedAt: now } as any);
  await db.moments.bulkPut(Array.from({ length: 35 }, (_, i) => ({ id: `final-new-post-${i}`, userId: U, text: `近期日常 ${i}`, visibility: 'all', audienceCharacterIds: [A], mediaIds: [], createdAt: now + i, updatedAt: now + i })) as any);
  for (const mode of modes) {
    const recall = await buildCharacterMemoryContext({ userId: U, characterId: A, mode, topic: '绝版诗集放在哪里？', budget: 3500 });
    check(`${mode}: natural question retrieves viewed old post beyond thirty newer posts`, recall.text.includes('FINAL_MOMENT'));
  }
  check('own like is recalled with the viewed post', (await buildCharacterMemoryContext({ userId: U, characterId: A, topic: '绝版诗集点赞了吗？' })).text.includes('点了赞'));
  await db.moments.update('final-post', { audienceCharacterIds: [B] });
  check('post permission revocation removes post and reaction together', !(await buildCharacterMemoryContext({ userId: U, characterId: A, topic: '绝版诗集点赞了吗？' })).text.includes('FINAL_MOMENT'));

  const packed = packCharacterMemory([
    { source: 'chat', id: 'pinned', text: '用户明确要求记住的安排', at: now - 1000, pinned: true },
    { source: 'world', id: 'related', text: '桂花糕 桂花糕 桂花糕', at: now },
    { source: 'world', id: 'related', text: '同一条正文另一种包装', at: now },
  ], '桂花糕', 600);
  check('user-pinned memory outranks keyword repetition', packed.references[0].id === 'pinned');
  check('same source id cannot occupy two prompt slots', packed.references.filter(row => row.id === 'related').length === 1);
  check('foreign account cannot read the character memory', !(await buildCharacterMemoryContext({ userId: 'other-user', characterId: A, topic: '桂花糕' })).text);
  await report('/result?suite=memory-final', { method: 'POST', body: `${lines.join('\n')}\nPASS ${passed} memory checks\nALL PASS` });
}
run().catch(async error => { await report('/result?suite=memory-final', { method: 'POST', body: `${lines.join('\n')}\nFAIL ${error.stack ?? error}\n1 FAILED` }); });
