/**
 * 局域网同步数据：全量收集（导出）与合并写入（导入）。
 * 桌面端与手机端共用同一份格式，通过 HTTP 互传。
 */
import { db, type Character, type Session, type Message, type MemoryItem, type EmotionSnapshot, type CharacterState, type Diary, type Group, type ContinuityThread, type SharedStoryEvent, type World, type WorldEvent, type WorldScene, type WorldSceneEntry, type CharacterKnowledge, type SharedMemory, type RelationshipState, type RelationshipEvent, type WorldFact, type WorldTurn, type WorldLocation, type WorldPresence, type WorldAgentState, type WorldPulse, type WorldObject, type Todo, type TodoOccurrence, type TodoReminder, type Moment, type MomentMedia, type MomentView, type MomentReaction, type MomentContact, type MomentJob, type MomentNotification, type CharacterLifeEvent, type MomentPostPlan, type MemorySourceTombstone } from '../db/index';
import { memorySourceTombstoneRepo } from '../db/memory-source-tombstone-repo';
import { clearDiarySharing } from './world/diary-visibility';
import { momentsRepo } from '../db/moments-repo';
import { messageRepo } from '../db/message-repo';

export interface SyncExportData {
  __meta__: {
    app: 'VirtuGene';
    kind: 'sync';
    version: string;
    exportedAt: string;
    userId?: string;
    username?: string;
  };
  characters: Character[];
  sessions: Session[];
  messages: Message[];
  memories: MemoryItem[];
  emotionSnapshots: EmotionSnapshot[];
  characterStates: CharacterState[];
  diaries: Diary[];
  groups?: Group[];
  /** 4.0 生命连续性：未完成事件（新字段，旧数据包没有时按空处理） */
  continuityThreads?: ContinuityThread[];
  /** 4.0 人物共同事件（新字段，旧数据包没有时按空处理） */
  sharedStoryEvents?: SharedStoryEvent[];
  // ---- 5.0 Living World（旧数据包没有这些字段时按空处理）----
  worlds?: World[];
  worldEvents?: WorldEvent[];
  worldFacts?: WorldFact[];
  worldTurns?: WorldTurn[];
  worldScenes?: WorldScene[];
  worldSceneEntries?: WorldSceneEntry[];
  characterKnowledge?: CharacterKnowledge[];
  sharedMemories?: SharedMemory[];
  relationshipStates?: RelationshipState[];
  relationshipEvents?: RelationshipEvent[];
  worldLocations?: WorldLocation[];
  worldPresences?: WorldPresence[];
  worldAgentStates?: WorldAgentState[];
  worldPulses?: WorldPulse[];
  worldObjects?: WorldObject[];
  todos?: Todo[];
  todoOccurrences?: TodoOccurrence[];
  todoReminders?: TodoReminder[];
  moments?: Moment[];
  momentMedia?: MomentMedia[];
  momentViews?: MomentView[];
  momentReactions?: MomentReaction[];
  momentContacts?: MomentContact[];
  momentJobs?: MomentJob[];
  momentNotifications?: MomentNotification[];
  characterLifeEvents?: CharacterLifeEvent[];
  momentPostPlans?: MomentPostPlan[];
  /** 撤权墓碑：只含来源 id、版本和状态，不含任何正文。 */
  sourceTombstones?: MemorySourceTombstone[];
}

/** 收集当前设备全部业务数据（不含账号密码与 API Key，隐私不外传） */
export async function collectSyncData(
  userId: string | null,
  username: string | null,
): Promise<SyncExportData> {
  const [characters, sessions, messages, memories, emotionSnapshots, characterStates, diaries, groups, continuityThreads, sharedStoryEvents,
    worlds, worldEvents, worldFacts, worldTurns, worldScenes, worldSceneEntries, characterKnowledge, sharedMemories, relationshipStates, relationshipEvents,
    worldLocations, worldPresences, worldAgentStates, worldPulses, worldObjects, todos, todoOccurrences, todoReminders,
    moments, momentMedia, momentViews, momentReactions, momentContacts, momentJobs, momentNotifications, characterLifeEvents, momentPostPlans, sourceTombstones] =
    await Promise.all([
      db.characters.toArray(),
      db.sessions.toArray(),
      db.messages.toArray(),
      db.memories.toArray(),
      db.emotionSnapshots.toArray(),
      db.characterStates.toArray(),
      db.diaries.toArray(),
      db.groups.toArray(),
      db.continuityThreads.toArray(),
      db.sharedStoryEvents.toArray(),
      db.worlds.toArray(),
      db.worldEvents.toArray(),
      db.worldFacts.toArray(),
      db.worldTurns.toArray(),
      db.worldScenes.toArray(),
      db.worldSceneEntries.toArray(),
      db.characterKnowledge.toArray(),
      db.sharedMemories.toArray(),
      db.relationshipStates.toArray(),
      db.relationshipEvents.toArray(),
      db.worldLocations.toArray(),
      db.worldPresences.toArray(),
      db.worldAgentStates.toArray(),
      db.worldPulses.toArray(),
      db.worldObjects.toArray(),
      db.todos.toArray(),
      db.todoOccurrences.toArray(),
      db.todoReminders.toArray(),
      db.moments.toArray(),
      db.momentMedia.toArray(),
      db.momentViews.toArray(),
      db.momentReactions.toArray(),
      db.momentContacts.toArray(),
      db.momentJobs.toArray(),
      db.momentNotifications.toArray(),
      db.characterLifeEvents.toArray(),
      db.momentPostPlans.toArray(),
      db.memorySourceTombstones.toArray(),
    ]);
  const ownerId = userId ?? '';
  const owns = <T extends { userId?: string }>(rows: T[]) => ownerId ? rows.filter((row) => row.userId === ownerId) : [];
  const accountCharacters = ownerId ? characters.filter((character) => character.createdBy === ownerId || character.isPreset) : [];
  const accountSessions = owns(sessions);
  const sessionIds = new Set(accountSessions.map((session) => session.id));
  const accountWorlds = owns(worlds);
  const accountScenes = owns(worldScenes);
  const sceneIds = new Set(accountScenes.map((scene) => scene.id));
  return {
    __meta__: {
      app: 'VirtuGene',
      kind: 'sync',
      version: __APP_VERSION__,
      exportedAt: new Date().toISOString(),
      userId: userId ?? undefined,
      username: username ?? undefined,
    },
    characters: accountCharacters,
    sessions: accountSessions,
    messages: messages.filter((item) => sessionIds.has(item.sessionId)),
    memories: owns(memories),
    emotionSnapshots: emotionSnapshots.filter((item) => sessionIds.has(item.sessionId)),
    characterStates: owns(characterStates),
    diaries: owns(diaries),
    groups: owns(groups),
    continuityThreads: owns(continuityThreads),
    sharedStoryEvents: owns(sharedStoryEvents),
    worlds: accountWorlds,
    worldEvents: owns(worldEvents),
    worldFacts: owns(worldFacts),
    worldTurns: owns(worldTurns),
    worldScenes: accountScenes,
    worldSceneEntries: worldSceneEntries.filter((item) => sceneIds.has(item.sceneId)),
    characterKnowledge: owns(characterKnowledge),
    sharedMemories: owns(sharedMemories),
    relationshipStates: owns(relationshipStates),
    relationshipEvents: owns(relationshipEvents),
    worldLocations: owns(worldLocations),
    worldPresences: owns(worldPresences),
    worldAgentStates: owns(worldAgentStates),
    worldPulses: owns(worldPulses),
    worldObjects: owns(worldObjects),
    todos: owns(todos),
    todoOccurrences: owns(todoOccurrences),
    todoReminders: owns(todoReminders),
    // 朋友圈数据必须跟随当前账号导出。即使同一台设备切换过账号，
    // 也不能把其他账号的动态、屏蔽名单或角色互动带到同步端。
    moments: owns(moments),
    momentMedia: owns(momentMedia),
    momentViews: owns(momentViews),
    momentReactions: owns(momentReactions),
    momentContacts: owns(momentContacts),
    momentJobs: owns(momentJobs),
    momentNotifications: owns(momentNotifications),
    characterLifeEvents: owns(characterLifeEvents),
    momentPostPlans: owns(momentPostPlans),
    sourceTombstones: owns(sourceTombstones),
  };
}

/** 校验并解析同步数据（兼容裸数组等容错场景） */
export function parseSyncData(payload: unknown): SyncExportData | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Partial<SyncExportData>;
  if (p.__meta__?.kind === 'sync') return payload as SyncExportData;
  // 容错：桌面端 /sync/export 返回 { app, kind: 'sync-export', data }，data 才是 SyncExportData
  const inner = (payload as { data?: unknown }).data;
  if (inner && typeof inner === 'object' && (inner as SyncExportData).__meta__?.kind === 'sync') {
    return inner as SyncExportData;
  }
  return null;
}

async function removeStaleSessionSummary(session: Session, userId: string): Promise<Session> {
  if (!session.summary) return session;
  const sourceIds = session.summarySourceMessageIds ?? [];
  let stale = sourceIds.length === 0;
  for (const messageId of sourceIds) {
    if (await memorySourceTombstoneRepo.blocksImport({
      userId,
      sourceType: 'message',
      sourceId: messageId,
      sourceRevision: session.summarySourceMessageRevisions?.[messageId] ?? 0,
    })) {
      stale = true;
      break;
    }
  }
  if (!stale) return session;
  const { summary: _summary, summaryUpdatedAt: _summaryUpdatedAt, summarySourceMessageIds: _sourceIds,
    summarySourceMessageRevisions: _sourceRevisions, summarySourceMessageOffsets: _sourceOffsets,
    summaryWitnessedBy: _witnessedBy, ...rest } = session;
  return rest as Session;
}

/** 合并写入本机 IndexedDB（按 id upsert；已存在的预设角色保留本机版本） */
export async function importSyncData(
  payload: unknown,
): Promise<{ ok: boolean; counts?: Record<string, number>; error?: string }> {
  const parsed = parseSyncData(payload);
  if (!parsed) {
    return { ok: false, error: '数据格式不正确，请确认来源是 VirtuGene 的局域网同步' };
  }
  const ownerIds = new Set<string>();
  for (const value of Object.values(parsed)) {
    if (!Array.isArray(value)) continue;
    for (const row of value) {
      const rowUserId = row && typeof row === 'object' ? (row as { userId?: unknown }).userId : undefined;
      if (typeof rowUserId === 'string' && rowUserId) ownerIds.add(rowUserId);
    }
  }
  const ownerId = parsed.__meta__.userId ?? (ownerIds.size === 1 ? [...ownerIds][0] : '');
  if (!ownerId || [...ownerIds].some((id) => id !== ownerId)) {
    return { ok: false, error: '同步数据缺少唯一账号归属信息；为避免跨账号混入，已停止导入' };
  }
  const owned = <T extends { userId?: string }>(rows?: T[]) => (rows ?? []).filter((row) => row.userId === ownerId);
  const sessions = owned(parsed.sessions);
  const sessionIds = new Set(sessions.map((session) => session.id));
  const scenes = owned(parsed.worldScenes);
  const sceneIds = new Set(scenes.map((scene) => scene.id));
  const data: SyncExportData = {
    ...parsed,
    characters: (parsed.characters ?? []).filter((character) => character.isPreset || character.createdBy === ownerId),
    sessions,
    messages: (parsed.messages ?? []).filter((message) => sessionIds.has(message.sessionId)),
    memories: owned(parsed.memories),
    emotionSnapshots: (parsed.emotionSnapshots ?? []).filter((snapshot) => sessionIds.has(snapshot.sessionId)),
    characterStates: owned(parsed.characterStates),
    diaries: owned(parsed.diaries),
    groups: owned(parsed.groups),
    continuityThreads: owned(parsed.continuityThreads),
    sharedStoryEvents: owned(parsed.sharedStoryEvents),
    worlds: owned(parsed.worlds),
    worldEvents: owned(parsed.worldEvents),
    worldFacts: owned(parsed.worldFacts),
    worldTurns: owned(parsed.worldTurns),
    worldScenes: scenes,
    worldSceneEntries: (parsed.worldSceneEntries ?? []).filter((entry) => sceneIds.has(entry.sceneId)),
    characterKnowledge: owned(parsed.characterKnowledge),
    sharedMemories: owned(parsed.sharedMemories),
    relationshipStates: owned(parsed.relationshipStates),
    relationshipEvents: owned(parsed.relationshipEvents),
    worldLocations: owned(parsed.worldLocations),
    worldPresences: owned(parsed.worldPresences),
    worldAgentStates: owned(parsed.worldAgentStates),
    worldPulses: owned(parsed.worldPulses),
    worldObjects: owned(parsed.worldObjects),
    todos: owned(parsed.todos),
    todoOccurrences: owned(parsed.todoOccurrences),
    todoReminders: owned(parsed.todoReminders),
    moments: owned(parsed.moments),
    momentMedia: owned(parsed.momentMedia),
    momentViews: owned(parsed.momentViews),
    momentReactions: owned(parsed.momentReactions),
    momentContacts: owned(parsed.momentContacts),
    momentJobs: owned(parsed.momentJobs),
    momentNotifications: owned(parsed.momentNotifications),
    characterLifeEvents: owned(parsed.characterLifeEvents),
    momentPostPlans: owned(parsed.momentPostPlans),
    sourceTombstones: owned(parsed.sourceTombstones),
  };
  try {
    const counts: Record<string, number> = {};
    await db.transaction(
      'rw',
      [db.characters, db.sessions, db.messages, db.memories, db.emotionSnapshots, db.characterStates, db.diaries, db.groups, db.continuityThreads, db.sharedStoryEvents,
        db.worlds, db.worldEvents, db.worldFacts, db.worldTurns, db.worldScenes, db.worldSceneEntries, db.characterKnowledge, db.sharedMemories, db.relationshipStates, db.relationshipEvents,
        db.worldLocations, db.worldPresences, db.worldAgentStates, db.worldPulses, db.worldObjects, db.todos, db.todoOccurrences, db.todoReminders,
        db.moments, db.momentMedia, db.momentViews, db.momentReactions, db.momentContacts, db.momentJobs, db.momentNotifications,
        db.characterLifeEvents, db.momentPostPlans, db.memorySourceTombstones],
      async () => {
        await memorySourceTombstoneRepo.merge(data.sourceTombstones ?? []);
        const tombstones = data.sourceTombstones ?? [];
        const incomingDiaryRevision = (id: string) => data.diaries?.find((diary) => diary.id === id)?.revision ?? 0;
        const incomingMomentRevision = (id: string) => data.moments?.find((moment) => moment.id === id)?.visibilityRevision ?? 0;
        // 把新同步来的撤回应用到本机现存旧数据；如果同一包里有更高版本，交给新版本本身更新。
        for (const tombstone of tombstones) {
          if (tombstone.sourceType === 'memory') {
            const current = await db.memories.get(tombstone.sourceId);
            if (!current || current.userId !== ownerId || (current.updatedAt ?? current.createdAt) > tombstone.sourceRevision) continue;
            if (tombstone.status === 'deleted') await db.memories.delete(current.id);
            else await db.memories.update(current.id, { status: tombstone.status === 'withdrawn' ? 'withdrawn' : 'superseded', updatedAt: Math.max(Date.now(), tombstone.sourceRevision) });
          } else if (tombstone.sourceType === 'message' && tombstone.status === 'deleted') {
            const current = await db.messages.get(tombstone.sourceId);
            const session = current ? await db.sessions.get(current.sessionId) : undefined;
            if (current && session?.userId === ownerId && (current.revision ?? 1) <= tombstone.sourceRevision) {
              await messageRepo.deleteById(current.id);
            }
          } else if (tombstone.sourceType === 'diary') {
            if (tombstone.status === 'deleted') {
              await clearDiarySharing(ownerId, tombstone.sourceId, { purge: true });
            } else if (incomingDiaryRevision(tombstone.sourceId) <= tombstone.sourceRevision) {
              const current = await db.diaries.get(tombstone.sourceId);
              if (current?.userId === ownerId && (current.revision ?? 1) <= tombstone.sourceRevision) {
                await clearDiarySharing(ownerId, current.id);
              }
            }
          } else if (tombstone.sourceType === 'moment' && tombstone.status !== 'deleted'
            && incomingMomentRevision(tombstone.sourceId) <= tombstone.sourceRevision) {
            const current = await db.moments.get(tombstone.sourceId);
            if (current?.userId === ownerId && current.visibilityRevision <= tombstone.sourceRevision && !current.deleted) {
              await momentsRepo.updateAudience(ownerId, current.id, { visibility: 'private' });
            }
          } else if (tombstone.sourceType === 'moment' && tombstone.status === 'deleted') {
            const current = await db.moments.get(tombstone.sourceId);
            if (current?.userId !== ownerId) continue;
            await db.momentJobs.where('momentId').equals(current.id).delete();
            await db.momentReactions.where('momentId').equals(current.id).delete();
            await db.momentMedia.where('momentId').equals(current.id).delete();
            await db.momentViews.where('momentId').equals(current.id).delete();
            await db.momentNotifications.where('momentId').equals(current.id).delete();
            await db.moments.delete(current.id);
          } else if (tombstone.sourceType === 'momentReaction') {
            const current = await db.momentReactions.get(tombstone.sourceId);
            if (!current || current.userId !== ownerId) continue;
            const revision = current.updatedAt ?? current.createdAt;
            if (tombstone.status === 'deleted' && revision <= tombstone.sourceRevision) {
              await db.momentReactions.delete(current.id);
            } else if (tombstone.status === 'withdrawn' && revision <= tombstone.sourceRevision && current.status === 'active') {
              await db.momentReactions.update(current.id, { status: 'withdrawn', updatedAt: Date.now() });
            }
          } else if (tombstone.sourceType === 'todo') {
            const current = await db.todos.get(tombstone.sourceId);
            if (!current || current.userId !== ownerId) continue;
            if (tombstone.status === 'deleted') {
              await db.todos.delete(current.id);
              await db.todoOccurrences.where('todoId').equals(current.id).delete();
              await db.todoReminders.where('todoId').equals(current.id).delete();
            } else if (current.updatedAt <= tombstone.sourceRevision && current.status !== 'cancelled') {
              await db.todos.update(current.id, { status: 'cancelled', updatedAt: Date.now() });
            }
          } else if (tombstone.sourceType === 'todoOccurrence') {
            const current = await db.todoOccurrences.get(tombstone.sourceId);
            if (!current || current.userId !== ownerId || current.updatedAt > tombstone.sourceRevision) continue;
            await db.todoOccurrences.update(current.id, { status: 'cancelled', updatedAt: Date.now() });
          } else if (tombstone.sourceType === 'worldEvent' || tombstone.sourceType === 'sharedMemory'
            || tombstone.sourceType === 'worldFact' || tombstone.sourceType === 'worldSceneEntry'
            || tombstone.sourceType === 'worldScene' || tombstone.sourceType === 'worldTurn'
            || tombstone.sourceType === 'continuityThread' || tombstone.sourceType === 'relationshipEvent') {
            const revisionOf = (row: { updatedAt?: number; createdAt?: number }) => row.updatedAt ?? row.createdAt ?? 0;
            const blocked = (row: { updatedAt?: number; createdAt?: number }) => tombstone.status === 'deleted' || revisionOf(row) <= tombstone.sourceRevision;
            if (tombstone.sourceType === 'worldEvent') {
              const current = await db.worldEvents.get(tombstone.sourceId);
              if (current?.userId === ownerId && blocked(current)) {
                await db.worldEvents.delete(current.id);
                await db.characterKnowledge.where('eventId').equals(current.id).filter((row) => row.userId === ownerId).delete();
              }
            } else if (tombstone.sourceType === 'sharedMemory') {
              const current = await db.sharedMemories.get(tombstone.sourceId);
              if (current?.userId === ownerId && blocked(current)) await db.sharedMemories.delete(current.id);
            } else if (tombstone.sourceType === 'worldFact') {
              const current = await db.worldFacts.get(tombstone.sourceId);
              if (current?.userId === ownerId && blocked(current)) await db.worldFacts.delete(current.id);
            } else if (tombstone.sourceType === 'worldSceneEntry') {
              const current = await db.worldSceneEntries.get(tombstone.sourceId);
              const scene = current ? await db.worldScenes.get(current.sceneId) : undefined;
              if (current && scene?.userId === ownerId && blocked(current)) await db.worldSceneEntries.delete(current.id);
            } else if (tombstone.sourceType === 'worldScene') {
              const current = await db.worldScenes.get(tombstone.sourceId);
              if (current?.userId === ownerId && blocked(current)) {
                await db.worldSceneEntries.where('sceneId').equals(current.id).delete();
                await db.worldScenes.delete(current.id);
                await db.worldObjects.where('sceneId').equals(current.id).delete();
              }
            } else if (tombstone.sourceType === 'worldTurn') {
              const current = await db.worldTurns.get(tombstone.sourceId);
              if (current?.userId === ownerId && blocked(current) && current.status !== 'undone') {
                await db.worldTurns.put({ ...current, status: 'undone', entryIds: [], settledEventIds: [], settledMemoryIds: [],
                  settledRelationshipEventIds: [], settledThreadIds: [], settledFactIds: [], deactivatedFactIds: [],
                  settledLifeEventIds: [], stateDeltas: [], settled: true, updatedAt: Date.now() });
              }
            } else if (tombstone.sourceType === 'continuityThread') {
              const current = await db.continuityThreads.get(tombstone.sourceId);
              if (current?.userId === ownerId && blocked(current)) await db.continuityThreads.delete(current.id);
            } else if (tombstone.sourceType === 'relationshipEvent') {
              const current = await db.relationshipEvents.get(tombstone.sourceId);
              if (current?.userId === ownerId && blocked(current)) await db.relationshipEvents.delete(current.id);
            }
          }
        }
        let n = 0;
        for (const c of data.characters ?? []) {
          const existing = await db.characters.get(c.id);
          if (existing?.isPreset && c.isPreset) continue;
          await db.characters.put(c);
          n += 1;
        }
        counts.characters = n;

        n = 0;
        for (const s of data.sessions ?? []) {
          const existing = await db.sessions.get(s.id);
          const preferred = existing && existing.updatedAt > s.updatedAt ? existing : s;
          const session = await removeStaleSessionSummary(preferred, ownerId);
          await db.sessions.put(session);
          n += 1;
        }
        counts.sessions = n;

        n = 0;
        for (const m of data.messages ?? []) {
          const revision = m.revision ?? 1;
          if (await memorySourceTombstoneRepo.blocksImport({ userId: ownerId, sourceType: 'message', sourceId: m.id, sourceRevision: revision })) continue;
          const existing = await db.messages.get(m.id);
          if (existing && (existing.revision ?? 1) >= revision) continue;
          await db.messages.put({ ...m, revision });
          n += 1;
        }
        counts.messages = n;

        n = 0;
        for (const m of data.memories ?? []) {
          const revision = m.updatedAt ?? m.createdAt;
          if (await memorySourceTombstoneRepo.blocksImport({ userId: ownerId, sourceType: 'memory', sourceId: m.id, sourceRevision: revision })) continue;
          const existing = await db.memories.get(m.id);
          if (existing && (existing.updatedAt ?? existing.createdAt) >= revision && (existing.status ?? 'active') !== 'active') continue;
          if (existing && (existing.updatedAt ?? existing.createdAt) > revision) continue;
          await db.memories.put(m);
          n += 1;
        }
        counts.memories = n;

        n = 0;
        for (const e of data.emotionSnapshots ?? []) {
          await db.emotionSnapshots.put(e);
          n += 1;
        }
        counts.emotionSnapshots = n;

        n = 0;
        for (const cs of data.characterStates ?? []) {
          await db.characterStates.put(cs);
          n += 1;
        }
        counts.characterStates = n;

        n = 0;
        for (const d of data.diaries ?? []) {
          const revision = d.revision ?? 1;
          if (await memorySourceTombstoneRepo.blocksImport({ userId: ownerId, sourceType: 'diary', sourceId: d.id, sourceRevision: revision })) continue;
          const existing = await db.diaries.get(d.id);
          if (existing && (existing.revision ?? 1) > revision) continue;
          if (existing && (existing.revision ?? 1) === revision && existing.updatedAt > d.updatedAt) continue;
          if (existing && (existing.revision ?? 1) === revision && existing.visibility === 'private' && d.visibility !== 'private') continue;
          await db.diaries.put(d);
          n += 1;
        }
        counts.diaries = n;

        n = 0;
        for (const group of data.groups ?? []) { await db.groups.put(group); n += 1; }
        counts.groups = n;

        n = 0;
        for (const t of data.continuityThreads ?? []) {
          const revision = t.updatedAt ?? t.createdAt;
          if (await memorySourceTombstoneRepo.blocksImport({ userId: ownerId, sourceType: 'continuityThread', sourceId: t.id, sourceRevision: revision })) continue;
          const existing = await db.continuityThreads.get(t.id);
          if (existing && (existing.updatedAt ?? existing.createdAt) > revision) continue;
          await db.continuityThreads.put(t);
          n += 1;
        }
        counts.continuityThreads = n;

        n = 0;
        for (const e of data.sharedStoryEvents ?? []) {
          await db.sharedStoryEvents.put(e);
          n += 1;
        }
        counts.sharedStoryEvents = n;

        // ---- 5.0 Living World：旧数据包没有这些字段时整段跳过 ----
        n = 0;
        for (const w of data.worlds ?? []) {
          const existing = await db.worlds.get(w.id);
          if (existing && existing.updatedAt > w.updatedAt) continue;
          await db.worlds.put(w);
          n += 1;
        }
        counts.worlds = n;

        n = 0;
        for (const e of data.worldEvents ?? []) {
          const revision = e.updatedAt ?? e.createdAt;
          if (await memorySourceTombstoneRepo.blocksImport({ userId: ownerId, sourceType: 'worldEvent', sourceId: e.id, sourceRevision: revision })) continue;
          if (e.sourceType === 'diary' && e.sourceId) {
            const diaryRevision = Number(e.meta?.diaryRevision ?? 0);
            if (await memorySourceTombstoneRepo.blocksImport({ userId: ownerId, sourceType: 'diary', sourceId: e.sourceId, sourceRevision: diaryRevision })) continue;
          }
          const existing = await db.worldEvents.get(e.id);
          if (existing && (existing.updatedAt ?? existing.createdAt) > revision) continue;
          await db.worldEvents.put(e);
          n += 1;
        }
        counts.worldEvents = n;

        n = 0;
        for (const fact of data.worldFacts ?? []) {
          const revision = fact.updatedAt ?? fact.createdAt;
          if (await memorySourceTombstoneRepo.blocksImport({ userId: ownerId, sourceType: 'worldFact', sourceId: fact.id, sourceRevision: revision })) continue;
          const existing = await db.worldFacts.get(fact.id);
          if (existing && (existing.updatedAt ?? existing.createdAt) > revision) continue;
          await db.worldFacts.put(fact); n += 1;
        }
        counts.worldFacts = n;
        n = 0;
        n = 0;
        for (const s of data.worldScenes ?? []) {
          if (await memorySourceTombstoneRepo.blocksImport({ userId: ownerId, sourceType: 'worldScene', sourceId: s.id, sourceRevision: s.updatedAt })) continue;
          const existing = await db.worldScenes.get(s.id);
          if (existing && existing.updatedAt > s.updatedAt) continue;
          await db.worldScenes.put(s);
          n += 1;
        }
        counts.worldScenes = n;

        n = 0;
        for (const turn of data.worldTurns ?? []) {
          if (await memorySourceTombstoneRepo.blocksImport({ userId: ownerId, sourceType: 'worldTurn', sourceId: turn.id, sourceRevision: turn.updatedAt })) continue;
          const scene = await db.worldScenes.get(turn.sceneId);
          if (!scene || scene.userId !== ownerId) continue;
          const existing = await db.worldTurns.get(turn.id);
          if (existing && (existing.status === 'undone' || existing.updatedAt >= turn.updatedAt)) continue;
          await db.worldTurns.put(turn); n += 1;
        }
        counts.worldTurns = n;

        n = 0;
        for (const e of data.worldSceneEntries ?? []) {
          const scene = await db.worldScenes.get(e.sceneId);
          if (!scene || scene.userId !== ownerId) continue;
          if (await memorySourceTombstoneRepo.blocksImport({ userId: ownerId, sourceType: 'worldSceneEntry', sourceId: e.id, sourceRevision: e.createdAt })) continue;
          const existing = await db.worldSceneEntries.get(e.id);
          if (existing && existing.createdAt > e.createdAt) continue;
          await db.worldSceneEntries.put(e);
          n += 1;
        }
        counts.worldSceneEntries = n;

        n = 0;
        for (const k of data.characterKnowledge ?? []) {
          const diaryId = k.eventId.startsWith('diary:') ? k.eventId.slice('diary:'.length) : '';
          if (diaryId && await memorySourceTombstoneRepo.blocksImport({
            userId: ownerId,
            sourceType: 'diary',
            sourceId: diaryId,
            sourceRevision: k.sourceRevision ?? 0,
          })) continue;
          if (await memorySourceTombstoneRepo.blocksImport({ userId: ownerId, sourceType: 'worldEvent', sourceId: k.eventId, sourceRevision: k.sourceRevision ?? 0 })) continue;
          await db.characterKnowledge.put(k);
          n += 1;
        }
        counts.characterKnowledge = n;

        n = 0;
        for (const m of data.sharedMemories ?? []) {
          const revision = m.updatedAt ?? m.createdAt;
          if (await memorySourceTombstoneRepo.blocksImport({ userId: ownerId, sourceType: 'sharedMemory', sourceId: m.id, sourceRevision: revision })) continue;
          const existing = await db.sharedMemories.get(m.id);
          if (existing && (existing.updatedAt ?? existing.createdAt) > revision) continue;
          await db.sharedMemories.put(m);
          n += 1;
        }
        counts.sharedMemories = n;

        n = 0;
        for (const s of data.relationshipStates ?? []) {
          // R7 裁定：世界层不保存好感度。旧备份里可能还带着早期版本写的 `affinity` 快照，
          // 导入时直接剥掉，避免把"第二个数值来源"又搬回来。
          const { affinity: _legacyAffinity, ...rest } = s as RelationshipState & { affinity?: number };
          await db.relationshipStates.put(rest as RelationshipState);
          n += 1;
        }
        counts.relationshipStates = n;

        n = 0;
        for (const e of data.relationshipEvents ?? []) {
          if (await memorySourceTombstoneRepo.blocksImport({ userId: ownerId, sourceType: 'relationshipEvent', sourceId: e.id, sourceRevision: e.createdAt })) continue;
          const existing = await db.relationshipEvents.get(e.id);
          if (existing && existing.createdAt > e.createdAt) continue;
          await db.relationshipEvents.put(e);
          n += 1;
        }
        counts.relationshipEvents = n;

        n = 0;
        for (const location of data.worldLocations ?? []) {
          await db.worldLocations.put(location);
          n += 1;
        }
        counts.worldLocations = n;

        n = 0;
        for (const presence of data.worldPresences ?? []) {
          await db.worldPresences.put(presence);
          n += 1;
        }
        counts.worldPresences = n;

        n = 0;
        for (const agent of data.worldAgentStates ?? []) {
          await db.worldAgentStates.put(agent);
          n += 1;
        }
        counts.worldAgentStates = n;

        n = 0;
        for (const pulse of data.worldPulses ?? []) {
          await db.worldPulses.put(pulse);
          n += 1;
        }
        counts.worldPulses = n;

        n = 0;
        for (const object of data.worldObjects ?? []) {
          await db.worldObjects.put(object);
          n += 1;
        }
        counts.worldObjects = n;

        n = 0;
        for (const todo of data.todos ?? []) {
          if (await memorySourceTombstoneRepo.blocksImport({ userId: ownerId, sourceType: 'todo', sourceId: todo.id, sourceRevision: todo.updatedAt })) continue;
          const existing = await db.todos.get(todo.id);
          if (existing && existing.updatedAt >= todo.updatedAt) continue;
          await db.todos.put(todo); n += 1;
        }
        counts.todos = n;
        n = 0;
        for (const occurrence of data.todoOccurrences ?? []) {
          if (await memorySourceTombstoneRepo.blocksImport({ userId: ownerId, sourceType: 'todoOccurrence', sourceId: occurrence.id, sourceRevision: occurrence.updatedAt })) continue;
          const todo = await db.todos.get(occurrence.todoId);
          if (!todo || todo.userId !== ownerId || todo.status === 'deleted' || todo.status === 'cancelled') continue;
          const existing = await db.todoOccurrences.get(occurrence.id);
          if (existing && existing.updatedAt >= occurrence.updatedAt) continue;
          await db.todoOccurrences.put(occurrence); n += 1;
        }
        counts.todoOccurrences = n;
        n = 0;
        for (const reminder of data.todoReminders ?? []) { await db.todoReminders.put(reminder); n += 1; }
        counts.todoReminders = n;

        n = 0;
        for (const moment of data.moments ?? []) {
          if (await memorySourceTombstoneRepo.blocksImport({ userId: ownerId, sourceType: 'moment', sourceId: moment.id, sourceRevision: moment.visibilityRevision })) continue;
          const existing = await db.moments.get(moment.id);
          if (existing && existing.visibilityRevision > moment.visibilityRevision) continue;
          if (existing && existing.visibilityRevision === moment.visibilityRevision && existing.updatedAt > moment.updatedAt) continue;
          await db.moments.put(moment); n += 1;
        }
        counts.moments = n;
        n = 0;
        for (const media of data.momentMedia ?? []) {
          const moment = await db.moments.get(media.momentId);
          if (!moment || moment.userId !== ownerId || moment.deleted
            || await memorySourceTombstoneRepo.blocksImport({ userId: ownerId, sourceType: 'moment', sourceId: moment.id, sourceRevision: moment.visibilityRevision })) continue;
          await db.momentMedia.put(media); n += 1;
        }
        counts.momentMedia = n;
        n = 0;
        for (const view of data.momentViews ?? []) {
          const moment = await db.moments.get(view.momentId);
          if (!moment || moment.userId !== ownerId || moment.deleted
            || await memorySourceTombstoneRepo.blocksImport({ userId: ownerId, sourceType: 'moment', sourceId: moment.id, sourceRevision: moment.visibilityRevision })) continue;
          await db.momentViews.put(view); n += 1;
        }
        counts.momentViews = n;
        n = 0;
        for (const reaction of data.momentReactions ?? []) {
          const moment = await db.moments.get(reaction.momentId);
          if (!moment || moment.userId !== ownerId || moment.deleted
            || await memorySourceTombstoneRepo.blocksImport({ userId: ownerId, sourceType: 'moment', sourceId: moment.id, sourceRevision: moment.visibilityRevision })) continue;
          if (await memorySourceTombstoneRepo.blocksImport({ userId: ownerId, sourceType: 'momentReaction', sourceId: reaction.id, sourceRevision: reaction.updatedAt ?? reaction.createdAt })) continue;
          const existing = await db.momentReactions.get(reaction.id);
          if (existing && existing.updatedAt > reaction.updatedAt) continue;
          await db.momentReactions.put(reaction); n += 1;
        }
        counts.momentReactions = n;
        n = 0;
        for (const contact of data.momentContacts ?? []) { await db.momentContacts.put(contact); n += 1; }
        counts.momentContacts = n;
        n = 0;
        for (const job of data.momentJobs ?? []) {
          const moment = await db.moments.get(job.momentId);
          if (!moment || moment.userId !== ownerId || moment.deleted || moment.visibilityRevision !== job.visibilityRevision
            || !(moment.audienceCharacterIds ?? []).includes(job.characterId)) continue;
          // 恢复旧备份不能复活已撤销、失败或已完成的互动；只有原本排队的任务可继续。
          await db.momentJobs.put({ ...job, status: job.status === 'running' ? 'queued' : job.status,
            leaseUntil: undefined, updatedAt: Date.now() }); n += 1;
        }
        counts.momentJobs = n;
        n = 0;
        for (const notification of data.momentNotifications ?? []) {
          const moment = await db.moments.get(notification.momentId);
          if (!moment || moment.userId !== ownerId || moment.deleted
            || await memorySourceTombstoneRepo.blocksImport({ userId: ownerId, sourceType: 'moment', sourceId: moment.id, sourceRevision: moment.visibilityRevision })) continue;
          await db.momentNotifications.put(notification); n += 1;
        }
        counts.momentNotifications = n;
        n = 0;
        for (const event of data.characterLifeEvents ?? []) { await db.characterLifeEvents.put(event); n += 1; }
        counts.characterLifeEvents = n;
        n = 0;
        for (const plan of data.momentPostPlans ?? []) {
          await db.momentPostPlans.put({ ...plan, status: plan.status === 'running' ? 'failed' : plan.status, leaseUntil: undefined, updatedAt: Date.now() });
          n += 1;
        }
        counts.momentPostPlans = n;
      },
    );
    return { ok: true, counts };
  } catch (err) {
    return { ok: false, error: '导入失败：' + ((err as Error)?.message ?? '未知错误') };
  }
}
