import Dexie from 'dexie';
import { db, type Message } from './index';

/** 会话消息分页大小：进入会话时只加载最近 200 条，更早的消息按需加载 */
export const MESSAGE_PAGE_SIZE = 200;

export const messageRepo = {
  /** 全量读取（后台分析用，如记忆/情绪结算，调用方自行 slice） */
  async getBySession(sessionId: string): Promise<Message[]> {
    return db.messages
      .where('sessionId')
      .equals(sessionId)
      .sortBy('createdAt');
  },

  /**
   * 分页读取：取该会话最近的 limit 条（升序返回）。
   * 传 before 时取 createdAt < before 的最近 limit 条（用于加载更早的消息）。
   */
  async getPage(sessionId: string, opts: { limit?: number; before?: number } = {}): Promise<Message[]> {
    const limit = Math.max(1, opts.limit ?? MESSAGE_PAGE_SIZE);
    const upper = opts.before != null ? [sessionId, opts.before] : [sessionId, Dexie.maxKey];
    const rows = await db.messages
      .where('[sessionId+createdAt]')
      .between([sessionId, Dexie.minKey], upper, true, opts.before == null)
      .reverse()
      .limit(limit)
      .toArray();
    return rows.reverse();
  },

  async countBySession(sessionId: string): Promise<number> {
    return db.messages.where('sessionId').equals(sessionId).count();
  },

  /** 按 id 取消息（记忆溯源"看当时说的话"用） */
  async getById(id: string): Promise<Message | undefined> {
    return db.messages.get(id);
  },

  async getByIds(ids: string[]): Promise<Message[]> {
    if (ids.length === 0) return [];
    const items = await db.messages.bulkGet(ids);
    return items.filter((item): item is Message => !!item);
  },

  /** 取会话最后一条消息（利用复合索引，避免全量加载） */
  async getLast(sessionId: string): Promise<Message | undefined> {
    return db.messages
      .where('[sessionId+createdAt]')
      .between([sessionId, Dexie.minKey], [sessionId, Dexie.maxKey])
      .last();
  },

  /** 取会话第一条消息（相识天数等统计用） */
  async getFirst(sessionId: string): Promise<Message | undefined> {
    return db.messages
      .where('[sessionId+createdAt]')
      .between([sessionId, Dexie.minKey], [sessionId, Dexie.maxKey])
      .first();
  },

  async create(message: Message): Promise<string> {
    return db.transaction('rw', db.messages, db.sessions, db.groups, async () => {
      const session = await db.sessions.get(message.sessionId);
      const group = session?.type === 'group' && session.groupId ? await db.groups.get(session.groupId) : undefined;
      const witnessedBy = group && group.userId === session?.userId ? [...new Set(group.characterIds)] : undefined;
      return db.messages.add({ ...message, witnessedBy });
    });
  },

  async deleteBySession(sessionId: string): Promise<void> {
    await db.messages.where('sessionId').equals(sessionId).delete();
  },

  async deleteById(id: string): Promise<void> {
    await db.messages.delete(id);
  },

  /** 标记发送失败/成功（微信式重发机制） */
  async markFailed(id: string, failed = true): Promise<number> {
    return db.messages.update(id, { failed });
  },

  async update(id: string, patch: Partial<Message>): Promise<number> {
    return db.messages.update(id, patch);
  },
};
