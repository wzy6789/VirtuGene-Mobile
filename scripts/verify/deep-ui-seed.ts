import './ui-shell-seed';
import { db } from '../../src/db';
import { worldRepo } from '../../src/db/world-repo';

// Bootstrap-only fixture: the page under test is the complete production App.
// Each run uses a fresh HTTP origin / browser context and an isolated IndexedDB.
(window as any).deepSeed = async () => {
  await (window as any).shellSeed();
  await db.open();
  const userId = 'ui-shell-user', characterId = 'ui-shell-role-0', sessionId = 'ui-shell-session-0';
  const now = Date.now();
  const contents = [
    '喜欢在雨天读书，窗边会放一杯不加糖的热茶。',
    '我们约好了，下次散步时一起看看街角新开的书店。',
    '那天晚风很轻，我们聊了很久，也没有急着结束。',
    '忙碌的时候，希望先把事情做完，再慢慢分享一天。',
    '她记得你喜欢紫色，也记得你不喜欢太甜的点心。',
  ];
  for (const [index, content] of contents.entries()) {
    const messageId = `deep-source-${index}`;
    await db.messages.put({ id: messageId, sessionId, role: 'user', content, createdAt: now - (index + 1) * 60000, isProactive: false });
    await db.memories.put({ id: `deep-memory-${index}`, characterId, userId, content, type: 'auto', memoryKind: ['preference', 'promise', 'episode', 'fact', 'preference'][index] as 'preference', status: 'active', stability: 'stable', pinned: false, confidence: .95, sourceSessionId: sessionId, sourceMessageIds: [messageId], createdAt: now - index * 60000, updatedAt: now - index * 60000 });
  }
  await db.memories.bulkPut([
    { id: 'deep-withdrawn', characterId, userId, content: '已撤回的记忆，不得成为记忆碎片。', type: 'auto', memoryKind: 'fact', status: 'withdrawn', createdAt: now + 1000 },
    { id: 'deep-foreign', characterId, userId: 'different-owner', content: '其他账号的私密记忆，不应出现。', type: 'auto', memoryKind: 'fact', status: 'active', createdAt: now + 2000 },
  ]);
  await db.memories.bulkPut(Array.from({ length: 200 }, (_, index) => ({
    id: `deep-story-memory-${index}`, characterId, userId,
    content: `第${index + 1}段共同记忆：散步时聊到了一本新书，平凡的生活也慢慢留下了自己的颜色。`,
    type: 'auto' as const, memoryKind: 'episode' as const, status: 'active' as const,
    createdAt: now - (index + 20) * 3600000, updatedAt: now - (index + 20) * 3600000,
  })));
  await db.emotionSnapshots.put({ id: 'deep-emotion', characterId, sessionId, dimensions: { valence: 7, arousal: 4, intimacy: 6, engagement: 7, expressiveness: 6, stability: 7 }, dominantEmotion: '期待', summary: '她对下一次见面怀着温柔的期待。忙碌里仍愿意认真倾听，也慢慢分享自己的日常；这种亲近来自真实交流，而非急于下结论。', messageCount: 9, createdAt: now });
  await db.characterStates.put({ characterId, userId, affinity: 38, mood: 6, milestones: [], updatedAt: now });
  for (let index = 0; index < 3; index++) {
    const date = new Date(now - index * 86400000);
    const day = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
    await db.diaries.put({ id: `deep-diary-${index}`, userId, date: day, title: ['晚风与热茶', '留一点时间给自己', '雨天也很温柔'][index], content: '今天的生活慢了下来。在回家的路上看到了很好看的晚霞，和星澜分享了街角的小书店。想把这段普通却明亮的日子留下来。', mood: 4, tags: ['日常', '散步'], visibility: 'private', revision: 1, aiNote: '谢谢你愿意把这段生活留给自己。', aiNoteAt: now, createdAt: now, updatedAt: now });
  }
  const world = await worldRepo.ensureDefaultWorld(userId, '星域旅人');
  await db.worldFacts.put({ id: 'deep-world-rule', userId, worldId: world.id, category: 'rule', content: '这里的秋天很长，街角有一家安静的书店。', visibility: 'world', sourceType: 'user', priority: .9, active: true, createdAt: now, updatedAt: now });
  db.close();
};
