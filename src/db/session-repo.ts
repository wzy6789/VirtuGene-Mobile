import { db, type Session } from './index';

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

  async updateSummary(id: string, summary: string): Promise<number> {
    return db.sessions.update(id, { summary, summaryUpdatedAt: Date.now() });
  },

  async deleteById(id: string): Promise<void> {
    await db.sessions.delete(id);
    await db.messages.where('sessionId').equals(id).delete();
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
