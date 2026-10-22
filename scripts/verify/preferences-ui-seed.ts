import './ui-shell-seed';
import { db } from '../../src/db';
import { hashPassword } from '../../src/lib/crypto';
import { createSecretary } from '../../src/lib/secretary/character';
import { loadMomentsPreferences, saveMomentsPreferences } from '../../src/lib/moments/preferences';

// Local bootstrap only. Verification opens the actual production App on a fresh origin.
(window as any).preferencesSeed = async () => {
  await (window as any).shellSeed();
  await db.open();
  const userId = 'ui-shell-user';
  const { hash, salt } = await hashPassword('local-old-password');
  await db.users.update(userId, { passwordHash: hash, passwordSalt: salt });
  saveMomentsPreferences(userId, { ...loadMomentsPreferences(userId), autonomousPostsEnabled: false });
  const secretary = await createSecretary(userId, '星禾', { preferences: '喜欢简洁的回应，保留真实记录。' });
  const sourceSessionId = 'preferences-secretary-session', sourceMessageId = 'preferences-secretary-source';
  await db.sessions.put({ id: sourceSessionId, characterId: secretary.id, userId, title: '星禾', modelAsked: true, createdAt: Date.now(), updatedAt: Date.now(), unreadCount: 0 });
  await db.messages.put({ id: sourceMessageId, sessionId: sourceSessionId, role: 'user', content: '记住：我喜欢简洁的回应，重要的安排请说清楚。', revision: 1, createdAt: Date.now(), isProactive: false });
  await db.memories.put({ id: 'preferences-secretary-memory', characterId: secretary.id, userId,
    content: '我喜欢简洁的回应，重要的安排请说清楚。', type: 'auto', memoryKind: 'preference',
    status: 'active', pinned: true, sourceSessionId, sourceMessageIds: [sourceMessageId], sourceMessageRevisions: { [sourceMessageId]: 1 }, createdAt: Date.now(), updatedAt: Date.now() });
  await db.memories.put({ id: 'preferences-foreign-secretary-memory', characterId: secretary.id, userId: 'another-owner',
    content: '另一个账号的私密助理记忆，不应出现。', type: 'auto', memoryKind: 'preference',
    status: 'active', sourceSessionId, sourceMessageIds: [sourceMessageId], sourceMessageRevisions: { [sourceMessageId]: 1 }, createdAt: Date.now(), updatedAt: Date.now() });
  localStorage.setItem(`virtugene:secretary-intro:v2:${userId}`, '1');
  db.close();
};
