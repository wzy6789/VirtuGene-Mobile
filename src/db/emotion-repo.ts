import { db, type EmotionSnapshot } from './index';

const MAX_SNAPSHOTS_PER_SESSION = 50;

export const emotionRepo = {
  async getBySession(sessionId: string): Promise<EmotionSnapshot[]> {
    return db.emotionSnapshots
      .where('sessionId')
      .equals(sessionId)
      .reverse()
      .sortBy('createdAt');
  },

  async getLatest(sessionId: string): Promise<EmotionSnapshot | undefined> {
    const snapshots = await db.emotionSnapshots
      .where('sessionId')
      .equals(sessionId)
      .reverse()
      .sortBy('createdAt');
    return snapshots[0];
  },

  async create(snapshot: EmotionSnapshot): Promise<string> {
    // Trim oldest if exceeding limit
    const count = await db.emotionSnapshots
      .where('sessionId')
      .equals(snapshot.sessionId)
      .count();
    if (count >= MAX_SNAPSHOTS_PER_SESSION) {
      const oldest = await db.emotionSnapshots
        .where('sessionId')
        .equals(snapshot.sessionId)
        .sortBy('createdAt');
      const toDelete = oldest.slice(0, count - MAX_SNAPSHOTS_PER_SESSION + 1);
      for (const d of toDelete) {
        await db.emotionSnapshots.delete(d.id);
      }
    }
    return db.emotionSnapshots.add(snapshot);
  },

  async deleteBySession(sessionId: string): Promise<void> {
    await db.emotionSnapshots.where('sessionId').equals(sessionId).delete();
  },
};
