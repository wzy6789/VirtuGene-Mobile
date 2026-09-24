import { db, type Session } from './index';
import { invalidateUnpinnedMemoriesForMessages } from './memory-repo';
import { memorySourceTombstoneRepo } from './memory-source-tombstone-repo';

export const sessionRepo = {
  /** 该用户全部会话（补记助手等场景需要跨角色收集某天的对话） */
  async getByUser(userId: string): Promise<Session[]> {
    return db.sessions
      .where('userId')
      .equals(userId)
      .toArray()
      .then((arr) => arr.sort((a, b) => b.updatedAt - a.updatedAt));
  },

  async getByCharacter(characterId: string, userId: string): Promise<Session[]> {
    const sessions = await db.sessions
      .where('[characterId+userId]')
      .equals([characterId, userId])
      .toArray();
    return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
  },

  async getById(id: string): Promise<Session | undefined> {
    return db.sessions.get(id);
  },

  async create(session: Session): Promise<string> {
    return db.sessions.add(session);
  },

  async updateTitle(id: string, title: string): Promise<number> {
    return db.sessions.update(id, { title, updatedAt: Date.now() });
  },

  async touch(id: string): Promise<number> {
    return db.sessions.update(id, { updatedAt: Date.now() });
  },

  async markSummaryAttempt(id: string, attemptedAt = Date.now()): Promise<number> {
    // 不改会话 updatedAt：失败的后台摘要不能伪装成用户最近聊过。
    return db.sessions.update(id, { summaryAttemptedAt: attemptedAt });
  },

  async update(id: string, patch: Partial<Session>): Promise<number> {
    return db.sessions.update(id, { ...patch, updatedAt: Date.now() });
  },

  async updateSummary(
    id: string,
    summary: string,
    witnessedBy?: string[],
    sourceMessageIds?: string[],
    sourceMessageRevisions?: Record<string, number>,
    sourceMessageOffsets?: Record<string, number>,
  ): Promise<number> {
    const patch: Partial<Session> = {
      summary,
      summaryUpdatedAt: Date.now(),
      summaryAttemptedAt: undefined,
      ...(sourceMessageIds ? {
        summarySourceMessageIds: [...new Set(sourceMessageIds)],
        summarySourceMessageRevisions: sourceMessageRevisions ?? {},
        summarySourceMessageOffsets: sourceMessageOffsets ?? {},
      } : {}),
    };
    if (witnessedBy) patch.summaryWitnessedBy = [...new Set(witnessedBy)].sort();
    return db.sessions.update(id, patch);
  },

  async deleteById(id: string): Promise<void> {
    await db.transaction('rw', [db.sessions, db.messages, db.memories, db.memorySourceTombstones], async () => {
      const session = await db.sessions.get(id);
      const messages = await db.messages.where('sessionId').equals(id).toArray();
      if (session) {
        await invalidateUnpinnedMemoriesForMessages(session.userId, messages.map((message) => message.id));
        for (const message of messages) {
          await memorySourceTombstoneRepo.record({ userId: session.userId, sourceType: 'message', sourceId: message.id, sourceRevision: message.revision ?? 1, status: 'deleted' });
        }
      }
      await db.sessions.delete(id);
      await db.messages.where('sessionId').equals(id).delete();
    });
  },

  async incrementUnread(id: string): Promise<void> {
    const s = await db.sessions.get(id);
    if (s) await db.sessions.update(id, { unreadCount: (s.unreadCount ?? 0) + 1 });
  },

  async clearUnread(id: string): Promise<void> {
    await db.sessions.update(id, { unreadCount: 0 });
  },

  async getTotalUnread(userId: string): Promise<number> {
    const all = await db.sessions.where('userId').equals(userId).toArray();
    return all.reduce((sum, s) => sum + (s.unreadCount ?? 0), 0);
  },

  async getUnreadByCharacter(characterId: string, userId: string): Promise<number> {
    const sessions = await db.sessions
      .where('[characterId+userId]')
      .equals([characterId, userId])
      .toArray();
    return sessions.reduce((sum, s) => sum + (s.unreadCount ?? 0), 0);
  },
};
