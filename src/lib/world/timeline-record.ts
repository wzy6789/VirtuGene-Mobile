import { db } from '../../db';
import type { TimelineItem } from './world-timeline';
import { readWorldMemoryOrigin, type WorldMemoryOrigin } from './memory-origin';

export type TimelineRecordRef = NonNullable<TimelineItem['record']> | { kind: 'memory'; id: string; revision?: number };
export interface TimelineRecordDetail {
  title: string;
  body?: string;
  recordedAt: number;
  revision?: number;
  changed: boolean;
  scope: string;
  participants?: string[];
  visibleTo?: string[];
  sourceLabel?: string;
  origin?: WorldMemoryOrigin;
}

/** Read the selected current record only. This does not enter chat, wake a scene,
 * retrieve model context, or claim to reproduce an older source revision. */
export async function readTimelineRecord(userId: string, worldId: string, ref: TimelineRecordRef,
  isCurrent: () => boolean, originLimit = 8): Promise<TimelineRecordDetail | undefined> {
  if (!userId || !isCurrent()) return;
  return db.transaction('r', [db.worlds, db.worldEvents, db.relationshipEvents, db.worldFacts, db.diaries, db.worldScenes, db.sharedMemories,
    db.messages, db.sessions, db.worldTurns, db.worldSceneEntries, db.sharedStoryEvents, db.memorySourceTombstones], async () => {
    const world = await db.worlds.get(worldId);
    if (!world || world.userId !== userId || !isCurrent()) return;
    let value: Omit<TimelineRecordDetail, 'changed'> | undefined;
    if (ref.kind === 'memory') {
      const row = await db.sharedMemories.get(ref.id);
      if (row?.userId === userId && row.worldId === worldId) value = {
        title: row.title, body: row.summary, recordedAt: row.createdAt, revision: row.updatedAt,
        scope: visibilityText(row.visibility), participants: row.participants,
        visibleTo: row.visibility === 'selected' ? row.visibleTo ?? [] : undefined,
        sourceLabel: memorySourceLabel(row.sourceType),
        origin: await readWorldMemoryOrigin(row, originLimit),
      };
    } else if (ref.kind === 'event') {
      const row = await db.worldEvents.get(ref.id);
      if (row?.sourceType === 'diary') {
        const diary = await db.diaries.get(row.sourceId);
        if (!diary || diary.userId !== userId || diary.deletedAt || diary.visibility !== 'world'
          || diary.worldEventId !== row.id || (typeof row.meta?.diaryRevision === 'number'
            && row.meta.diaryRevision !== (diary.revision ?? 1))) return;
      }
      if (row?.userId === userId && row.worldId === worldId) value = {
        title: row.title, body: row.summary, recordedAt: row.timestamp, revision: row.updatedAt,
        scope: visibilityText(row.visibility),
      };
    } else if (ref.kind === 'relationship') {
      const row = await db.relationshipEvents.get(ref.id);
      if (row?.userId === userId && row.worldId === worldId) value = {
        title: row.reason, recordedAt: row.createdAt, revision: row.createdAt, scope: '当前世界的关系记录',
      };
    } else if (ref.kind === 'fact') {
      const row = await db.worldFacts.get(ref.id);
      if (row?.userId === userId && row.worldId === worldId) value = {
        title: '世界设定', body: row.content, recordedAt: row.createdAt, revision: row.updatedAt,
        scope: `${visibilityText(row.visibility)}${row.active ? '' : ' · 已暂停生效'}`,
      };
    } else if (ref.kind === 'diary') {
      const row = await db.diaries.get(ref.id);
      if (row?.userId === userId && !row.deletedAt && row.visibility && row.visibility !== 'private') value = {
        title: row.title || `${row.date} 的一页`, body: row.content, recordedAt: row.createdAt,
        revision: row.revision ?? row.updatedAt, scope: row.visibility === 'world' ? '已加入世界的日记' : '已授权分享的日记',
      };
    } else if (ref.kind === 'scene') {
      const row = await db.worldScenes.get(ref.id);
      if (row?.userId === userId && row.worldId === worldId) value = {
        title: row.title, body: [row.place, row.timeLabel].filter(Boolean).join(' · '),
        recordedAt: row.finishedAt ?? row.updatedAt, revision: row.updatedAt, scope: '当前世界的场景记录',
      };
    }
    if (!value || !isCurrent()) return;
    return { ...value, changed: ref.revision !== undefined && value.revision !== ref.revision };
  });
}

export function memorySourceLabel(value: string): string {
  return ({ message: '收藏的对话', story: '世界故事', scene: '共同场景', turn: '世界经历',
    'migration:sharedEvent': '共同经历' } as Record<string, string>)[value] ?? '保存的记录';
}

function visibilityText(value: string): string {
  if (value === 'world') return '世界内角色可知情';
  if (value === 'selected') return '仅指定角色可知情';
  return '仅自己可见';
}
