import { db, type WorldPulse } from './index';

export const worldPulseRepo = {
  async getById(id: string): Promise<WorldPulse | undefined> {
    return db.worldPulses.get(id);
  },

  async create(input: Omit<WorldPulse, 'id' | 'createdAt' | 'status' | 'eventIds'> & { eventIds?: string[] }): Promise<WorldPulse> {
    const row: WorldPulse = {
      ...input,
      id: crypto.randomUUID(),
      status: 'pending',
      eventIds: input.eventIds ?? [],
      createdAt: Date.now(),
    };
    await db.worldPulses.put(row);
    return row;
  },

  async complete(id: string, patch: { eventIds?: string[]; summary?: string }): Promise<void> {
    const existing = await db.worldPulses.get(id);
    if (!existing) return;
    await db.worldPulses.put({
      ...existing,
      status: 'completed',
      ...(patch.eventIds ? { eventIds: patch.eventIds } : {}),
      ...(patch.summary ? { summary: patch.summary.slice(0, 500) } : {}),
      completedAt: Date.now(),
    });
  },

  async fail(id: string, error: string): Promise<void> {
    const existing = await db.worldPulses.get(id);
    if (!existing) return;
    await db.worldPulses.put({ ...existing, status: 'failed', error: error.slice(0, 240), completedAt: Date.now() });
  },

  async listRecent(worldId: string, limit = 10, userId?: string): Promise<WorldPulse[]> {
    const rows = await db.worldPulses.where('worldId').equals(worldId).toArray();
    return rows
      .filter((row) => userId === undefined || row.userId === userId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, Math.max(1, limit));
  },

  async clearForWorld(worldId: string): Promise<void> {
    await db.worldPulses.where('worldId').equals(worldId).delete();
  },

  async clearForUser(userId: string): Promise<void> {
    await db.worldPulses.where('userId').equals(userId).delete();
  },
};
