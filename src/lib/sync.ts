/**
 * 局域网同步数据：全量收集（导出）与合并写入（导入）。
 * 桌面端与手机端共用同一份格式，通过 HTTP 互传。
 */
import { db, type Character, type Session, type Message, type MemoryItem, type EmotionSnapshot, type CharacterState, type Diary, type ContinuityThread, type SharedStoryEvent, type World, type WorldEvent, type WorldScene, type WorldSceneEntry, type CharacterKnowledge, type SharedMemory, type RelationshipState, type RelationshipEvent, type WorldLocation, type WorldPresence, type WorldAgentState, type WorldPulse, type WorldObject, type Todo, type TodoOccurrence, type TodoReminder } from '../db/index';

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
  /** 4.0 生命连续性：未完成事件（新字段，旧数据包没有时按空处理） */
  continuityThreads?: ContinuityThread[];
  /** 4.0 人物共同事件（新字段，旧数据包没有时按空处理） */
  sharedStoryEvents?: SharedStoryEvent[];
  // ---- 5.0 Living World（旧数据包没有这些字段时按空处理）----
  worlds?: World[];
  worldEvents?: WorldEvent[];
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
}

/** 收集当前设备全部业务数据（不含账号密码与 API Key，隐私不外传） */
export async function collectSyncData(
  userId: string | null,
  username: string | null,
): Promise<SyncExportData> {
  const [characters, sessions, messages, memories, emotionSnapshots, characterStates, diaries, continuityThreads, sharedStoryEvents,
    worlds, worldEvents, worldScenes, worldSceneEntries, characterKnowledge, sharedMemories, relationshipStates, relationshipEvents,
    worldLocations, worldPresences, worldAgentStates, worldPulses, worldObjects, todos, todoOccurrences, todoReminders] =
    await Promise.all([
      db.characters.toArray(),
      db.sessions.toArray(),
      db.messages.toArray(),
      db.memories.toArray(),
      db.emotionSnapshots.toArray(),
      db.characterStates.toArray(),
      db.diaries.toArray(),
      db.continuityThreads.toArray(),
      db.sharedStoryEvents.toArray(),
      db.worlds.toArray(),
      db.worldEvents.toArray(),
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
    ]);
  return {
    __meta__: {
      app: 'VirtuGene',
      kind: 'sync',
      version: __APP_VERSION__,
      exportedAt: new Date().toISOString(),
      userId: userId ?? undefined,
      username: username ?? undefined,
    },
    characters,
    sessions,
    messages,
    memories,
    emotionSnapshots,
    characterStates,
    diaries,
    continuityThreads,
    sharedStoryEvents,
    worlds,
    worldEvents,
    worldScenes,
    worldSceneEntries,
    characterKnowledge,
    sharedMemories,
    relationshipStates,
    relationshipEvents,
    worldLocations,
    worldPresences,
    worldAgentStates,
    worldPulses,
    worldObjects,
    todos,
    todoOccurrences,
    todoReminders,
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

/** 合并写入本机 IndexedDB（按 id upsert；已存在的预设角色保留本机版本） */
export async function importSyncData(
  payload: unknown,
): Promise<{ ok: boolean; counts?: Record<string, number>; error?: string }> {
  const data = parseSyncData(payload);
  if (!data) {
    return { ok: false, error: '数据格式不正确，请确认来源是 VirtuGene 的局域网同步' };
  }
  try {
    const counts: Record<string, number> = {};
    await db.transaction(
      'rw',
      [db.characters, db.sessions, db.messages, db.memories, db.emotionSnapshots, db.characterStates, db.diaries, db.continuityThreads, db.sharedStoryEvents,
        db.worlds, db.worldEvents, db.worldScenes, db.worldSceneEntries, db.characterKnowledge, db.sharedMemories, db.relationshipStates, db.relationshipEvents,
        db.worldLocations, db.worldPresences, db.worldAgentStates, db.worldPulses, db.worldObjects, db.todos, db.todoOccurrences, db.todoReminders],
      async () => {
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
          await db.sessions.put(s);
          n += 1;
        }
        counts.sessions = n;

        n = 0;
        for (const m of data.messages ?? []) {
          await db.messages.put(m);
          n += 1;
        }
        counts.messages = n;

        n = 0;
        for (const m of data.memories ?? []) {
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
          await db.diaries.put(d);
          n += 1;
        }
        counts.diaries = n;

        n = 0;
        for (const t of data.continuityThreads ?? []) {
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
          await db.worlds.put(w);
          n += 1;
        }
        counts.worlds = n;

        n = 0;
        for (const e of data.worldEvents ?? []) {
          await db.worldEvents.put(e);
          n += 1;
        }
        counts.worldEvents = n;

        n = 0;
        for (const s of data.worldScenes ?? []) {
          await db.worldScenes.put(s);
          n += 1;
        }
        counts.worldScenes = n;

        n = 0;
        for (const e of data.worldSceneEntries ?? []) {
          await db.worldSceneEntries.put(e);
          n += 1;
        }
        counts.worldSceneEntries = n;

        n = 0;
        for (const k of data.characterKnowledge ?? []) {
          await db.characterKnowledge.put(k);
          n += 1;
        }
        counts.characterKnowledge = n;

        n = 0;
        for (const m of data.sharedMemories ?? []) {
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
        for (const todo of data.todos ?? []) { await db.todos.put(todo); n += 1; }
        counts.todos = n;
        n = 0;
        for (const occurrence of data.todoOccurrences ?? []) { await db.todoOccurrences.put(occurrence); n += 1; }
        counts.todoOccurrences = n;
        n = 0;
        for (const reminder of data.todoReminders ?? []) { await db.todoReminders.put(reminder); n += 1; }
        counts.todoReminders = n;
      },
    );
    return { ok: true, counts };
  } catch (err) {
    return { ok: false, error: '导入失败：' + ((err as Error)?.message ?? '未知错误') };
  }
}
