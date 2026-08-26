/**
 * 局域网同步数据：全量收集（导出）与合并写入（导入）。
 * 桌面端与手机端共用同一份格式，通过 HTTP 互传。
 */
import { db, type Character, type Session, type Message, type MemoryItem, type EmotionSnapshot, type CharacterState, type Diary } from '../db/index';

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
}

/** 收集当前设备全部业务数据（不含账号密码与 API Key，隐私不外传） */
export async function collectSyncData(
  userId: string | null,
  username: string | null,
): Promise<SyncExportData> {
  const [characters, sessions, messages, memories, emotionSnapshots, characterStates, diaries] =
    await Promise.all([
      db.characters.toArray(),
      db.sessions.toArray(),
      db.messages.toArray(),
      db.memories.toArray(),
      db.emotionSnapshots.toArray(),
      db.characterStates.toArray(),
      db.diaries.toArray(),
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
      [db.characters, db.sessions, db.messages, db.memories, db.emotionSnapshots, db.characterStates, db.diaries],
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
      },
    );
    return { ok: true, counts };
  } catch (err) {
    return { ok: false, error: '导入失败：' + ((err as Error)?.message ?? '未知错误') };
  }
}
