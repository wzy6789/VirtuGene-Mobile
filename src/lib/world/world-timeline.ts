/**
 * 世界时间线（5.0.0 Living World §46）
 *
 * 时间线混合**一段生活史**：现实生活、世界事件、关系变化、共同经历、重要设定、时间跳跃。
 * 但**不显示数据库类型**——用户看到的是"什么时候，发生了什么"。
 *
 * 因此这里做的唯一一件事：把六张表的记录统一成同一种"生活条目"，
 * 用人话标签（"你写下的生活" / "你们一起经历的" / "关系变了" / "这个世界记住了"……）
 * 按时间排序。排序是稳定且可解释的：时间倒序，同刻按照重要度。
 */
import type { WorldEvent } from '../../db/index';
import { db } from '../../db/index';
import { worldFactRepo } from '../../db/world-fact-repo';
import { worldSceneRepo } from '../../db/world-scene-repo';
import { relationshipRepo } from '../../db/relationship-repo';

export type TimelineKind = 'reality' | 'event' | 'memory' | 'relationship' | 'setting' | 'segment';

export interface TimelineItem {
  id: string;
  kind: TimelineKind;
  /** 用户看到的人话标签（不是数据库类型） */
  label: string;
  title: string;
  detail?: string;
  timestamp: number;
  /** 相关角色名（用于头像/名字行） */
  names: string[];
  importance: number;
  /** 展示来源；不是角色知情授权，也不改变原有时间线 id。 */
  record?: {
    kind: 'event' | 'relationship' | 'fact' | 'diary' | 'scene';
    id: string;
    revision?: number;
  };
}

/**
 * 沿现有世界时间索引取最近候选，账号过滤先于限量。
 * 同刻边界补齐后按主键升序恢复旧查询的稳定顺序；不能让倒序索引改变截断对象。
 * 缺少账号+世界+时间索引时，同世界其它账号及大量同刻记录仍可能增加读取量。
 */
async function recentTimelineEvents(userId: string, worldId: string): Promise<WorldEvent[]> {
  const limit = 200;
  let rows = await db.worldEvents.where('[worldId+timestamp]')
    .between([worldId, -Infinity], [worldId, Infinity], true, true)
    .reverse()
    .filter(event => event.userId === userId)
    .limit(limit)
    .toArray();
  if (rows.length === limit) {
    const boundary = rows[rows.length - 1].timestamp;
    const tied = await db.worldEvents.where('[worldId+timestamp]')
      .equals([worldId, boundary])
      .filter(event => event.userId === userId)
      .toArray();
    rows = [...rows.filter(event => event.timestamp > boundary), ...tied];
  }
  return rows.sort((a, b) => b.timestamp - a.timestamp || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).slice(0, limit);
}

/** 数据库类型 → 用户能读懂的一句话（§46：不显示数据库类型） */
export function eventLabel(event: Pick<WorldEvent, 'type' | 'sourceType' | 'tags'>): string {
  if (event.sourceType === 'story' || event.tags.includes('你们的故事')) return '你们的故事';
  if (event.sourceType === 'pulse') return '世界自主行动';
  if (event.sourceType === 'scene') return '你们一起经历的';
  if (event.sourceType === 'turn' || event.sourceType === 'sharedMemory') return '你们一起经历的';
  if (event.sourceType === 'diary') return '你写下的生活';
  if (event.sourceType === 'lifeEvent' || event.type === 'relationship') return '关系变了';
  if (event.sourceType === 'continuity' || event.type === 'continuity') return '还没做完的事';
  switch (event.type) {
    case 'reality':
      return '你的生活';
    case 'shared_memory':
      return '你们一起经历的';
    case 'stage':
      return '一场共同经历';
    case 'knowledge':
      return '有人知道了什么';
    case 'life_trace':
      return '生命痕迹';
    default:
      return '发生过的事';
  }
}

export async function buildTimeline(params: {
  userId: string;
  worldId: string;
  nameOf: (characterId: string) => string;
  limit?: number;
}): Promise<TimelineItem[]> {
  const { userId, worldId, nameOf } = params;
  const limit = Math.max(1, params.limit ?? 120);

  const [events, facts, scenes, relEvents, diaries] = await Promise.all([
    recentTimelineEvents(userId, worldId),
    worldFactRepo.listByWorld(worldId, { userId }),
    worldSceneRepo.listScenes(worldId, { limit: 50, userId }),
    relationshipRepo.listEventsByWorld(worldId, 200, userId),
    db.diaries.where('userId').equals(userId).toArray(),
  ]);

  const namesOf = (participants: string[]) =>
    participants.filter((p) => p.startsWith('c:')).map((p) => nameOf(p.slice(2)));

  const items: TimelineItem[] = [];

  for (const event of events) {
    items.push({
      id: `e:${event.id}`,
      kind: event.type === 'reality' ? 'reality' : event.type === 'relationship' ? 'relationship' : 'event',
      label: eventLabel(event),
      title: event.title,
      ...(event.summary ? { detail: event.summary } : {}),
      timestamp: event.timestamp,
      names: namesOf(event.participants),
      importance: event.importance,
      record: { kind: 'event', id: event.id, revision: event.updatedAt },
    });
  }

  for (const rel of relEvents) {
    items.push({
      id: `r:${rel.id}`,
      kind: 'relationship',
      label: '关系变了',
      title: rel.reason,
      timestamp: rel.createdAt,
      names: rel.subjects.filter((s) => s.startsWith('c:')).map((s) => nameOf(s.slice(2))),
      importance: 0.6,
      record: { kind: 'relationship', id: rel.id, revision: rel.createdAt },
    });
  }

  for (const fact of facts) {
    items.push({
      id: `f:${fact.id}`,
      kind: 'setting',
      label: '这个世界记住了',
      title: fact.content,
      timestamp: fact.createdAt,
      // visibleTo 是知情名单，不是实际参与者。
      names: [],
      importance: fact.priority,
      record: { kind: 'fact', id: fact.id, revision: fact.updatedAt },
    });
  }

  // 现实生活：只把**用户允许进入世界**的那些放进时间线（private 页永远不出现在这里）
  for (const diary of diaries) {
    if (diary.deletedAt) continue;
    if (!diary.visibility || diary.visibility === 'private') continue;
    items.push({
      id: `d:${diary.id}`,
      kind: 'reality',
      label: '你写下的生活',
      title: diary.title || `${diary.date} 的一页`,
      ...(diary.content ? { detail: diary.content.slice(0, 120) } : {}),
      timestamp: diary.createdAt,
      names: diary.characterId ? [nameOf(diary.characterId)] : [],
      importance: 0.55,
      record: { kind: 'diary', id: diary.id, revision: diary.revision ?? diary.updatedAt },
    });
  }

  // 尚未被任何事件覆盖的片段（例如"保存为故事"之前的片段）也要在时间线上有一席之地
  const covered = new Set(events.map(event => event.id));
  for (const scene of scenes) {
    if (scene.worldEventId && covered.has(scene.worldEventId)) continue;
    items.push({
      id: `s:${scene.id}`,
      kind: 'segment',
      label: '一段共同经历',
      title: scene.title,
      detail: `${scene.place} · ${scene.timeLabel}`,
      timestamp: scene.finishedAt ?? scene.updatedAt,
      names: scene.characterIds.map(nameOf),
      importance: 0.5,
      record: { kind: 'scene', id: scene.id, revision: scene.updatedAt },
    });
  }

  return items
    .sort((a, b) => b.timestamp - a.timestamp || b.importance - a.importance)
    .slice(0, limit);
}

/** 人话日期（今天 / 昨天 / N 天前 / 具体日期） */
export function timelineDate(timestamp: number): string {
  const d = new Date(timestamp);
  const now = new Date(Date.now());
  // 把各自本地年月日投影成日序，避免午夜和夏令时把一天误算成24小时。
  const days = Math.round((Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
    - Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())) / 86_400_000);
  if (days <= 0) return '今天';
  if (days === 1) return '昨天';
  if (days < 7) return `${days} 天前`;
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
}

/** 按"天"分组（时间线渲染用；不显示数据库结构） */
export function groupByDay(items: TimelineItem[]): { key: string; label: string; items: TimelineItem[] }[] {
  const groups: { key: string; label: string; items: TimelineItem[] }[] = [];
  for (const item of items) {
    const date = new Date(item.timestamp);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const label = timelineDate(item.timestamp);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(item);
    else groups.push({ key, label, items: [item] });
  }
  return groups;
}
