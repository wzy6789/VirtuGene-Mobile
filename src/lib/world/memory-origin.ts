import Dexie from 'dexie';
import { db, type SharedMemory, type WorldSceneEntry } from '../../db';
import { memorySourceTombstoneRepo } from '../../db/memory-source-tombstone-repo';

export interface WorldMemoryOrigin {
  status: 'available' | 'unavailable' | 'unsupported';
  passages: { id: string; body: string; kind?: string; speakerId?: string }[];
  hasMore: boolean;
}
const unavailable = (): WorldMemoryOrigin => ({ status: 'unavailable', passages: [], hasMore: false });

/** Called inside the owned selected-record transaction. No scene activation,
 * model context retrieval or text-similarity fallback. Sources are current rows,
 * not an invented snapshot of their contents when the memory was collected. */
export async function readWorldMemoryOrigin(memory: SharedMemory, limit = 8): Promise<WorldMemoryOrigin> {
  const { userId, worldId, sourceId, sourceType } = memory;
  limit = Math.max(8, Math.floor(Number.isFinite(limit) ? limit : 8));
  if (sourceType === 'message') {
    const message = await db.messages.get(sourceId);
    const session = message && await db.sessions.get(message.sessionId);
    if (!message || !session || session.userId !== userId || message.failed || message.interrupted) return unavailable();
    const [blocked, suppressed] = await Promise.all([
      memorySourceTombstoneRepo.blocksImport({ userId, sourceType: 'message', sourceId, sourceRevision: message.revision ?? 1 }),
      memorySourceTombstoneRepo.selectedSuppressedMessages(userId, session.characterId, [sourceId]),
    ]);
    if (blocked || suppressed.has(sourceId)) return unavailable();
    return { status: 'available', passages: [{ id: message.id, body: message.content, kind: message.role, speakerId: message.senderId }], hasMore: false };
  }
  if (sourceType === 'story' || sourceType === 'scene' || sourceType === 'turn') {
    let turn;
    if (sourceType === 'turn') {
      turn = await db.worldTurns.get(sourceId);
      // Settlement uses turnId, turnId:1, ... . Try the exact key first so an
      // actual colon-containing turn id is never accidentally shortened.
      if (!turn && /:\d+$/.test(sourceId)) turn = await db.worldTurns.get(sourceId.replace(/:\d+$/, ''));
      if (!turn || turn.userId !== userId || turn.worldId !== worldId || turn.status !== 'completed'
        || !turn.settledMemoryIds.includes(memory.id)
        || await memorySourceTombstoneRepo.blocksImport({ userId, sourceType: 'worldTurn', sourceId: turn.id, sourceRevision: turn.updatedAt })) return unavailable();
    }
    const scene = await db.worldScenes.get(turn?.sceneId ?? sourceId);
    if (!scene || scene.userId !== userId || scene.worldId !== worldId
      || await memorySourceTombstoneRepo.blocksImport({ userId, sourceType: 'worldScene', sourceId: scene.id, sourceRevision: scene.updatedAt })) return unavailable();
    let entries: WorldSceneEntry[];
    let hasMore: boolean;
    if (turn) {
      const ids = [...new Set(turn.entryIds)];
      hasMore = ids.length > limit;
      entries = (await db.worldSceneEntries.bulkGet(ids.slice(-limit))).filter((e): e is WorldSceneEntry => !!e && e.sceneId === scene.id);
    } else {
      const found = await db.worldSceneEntries.where('[sceneId+index]')
        .between([scene.id, Dexie.minKey], [scene.id, Dexie.maxKey]).reverse().limit(limit + 1).toArray();
      hasMore = found.length > limit;
      entries = found.slice(0, limit).reverse();
    }
    entries = entries.filter(e => ['narration', 'dialogue', 'action', 'user_input'].includes(e.kind));
    const blocks = await memorySourceTombstoneRepo.blocksImports(entries.map(e => ({ userId, sourceType: 'worldSceneEntry', sourceId: e.id, sourceRevision: e.createdAt })));
    const passages = entries.flatMap((e, i) => blocks[i] ? [] : [{ id: e.id, body: e.content, kind: e.kind, speakerId: e.speakerId }]);
    return { status: 'available', passages, hasMore };
  }
  if (sourceType === 'migration:sharedEvent') {
    const event = await db.sharedStoryEvents.get(sourceId);
    if (!event || event.userId !== userId || await memorySourceTombstoneRepo.blocksImport({ userId, sourceType: 'sharedStoryEvent', sourceId, sourceRevision: event.updatedAt })) return unavailable();
    return { status: 'available', passages: [{ id: event.id, body: [event.title, event.detail].filter(Boolean).join('\n') }], hasMore: false };
  }
  return { status: 'unsupported', passages: [], hasMore: false };
}
