/**
 * 数据备份 / 一键恢复（2.1.0 核心）：
 * - 备份：收集全量数据（含账号 users 表）→ 密码加密 → 写 Android 共享存储
 *   （Download/VirtuGeneBackup/，卸载 App 不丢失）
 * - 恢复：读备份文件 → 密码解密 → 全量导入 IndexedDB → 账号不存在则自动重建
 * - 目标：卸载重装后「一键恢复」，账号+角色+聊天+日记全回来，无需重新注册
 */
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { db, type User } from '../db/index';
import { collectSyncData, importSyncData, type SyncExportData } from './sync';
import { encryptBackup, decryptBackup, type EncryptedBackup } from './backup-crypto';
import { useAuthStore } from '../store/auth-store';
import { userRepo } from '../db/user-repo';
import { useChatStore } from '../store/chat-store';
import { useDiaryStore } from '../store/diary-store';

const BACKUP_DIR = 'VirtuGeneBackup';
const BACKUP_FILE = 'virtugene-backup.json';

/** 备份文件内容：加密载荷 + 元信息 */
export interface BackupFile {
  app: 'VirtuGene';
  kind: 'backup';
  createdAt: string;
  /** 数据归属的用户名（仅提示用） */
  username?: string;
  payload: EncryptedBackup;
}

/** 全量数据快照（含账号表） */
export interface BackupData {
  __meta__: {
    app: 'VirtuGene';
    kind: 'backup';
    version: string;
    exportedAt: string;
    userId?: string;
    username?: string;
  };
  users?: User[];
  characters: SyncExportData['characters'];
  sessions: SyncExportData['sessions'];
  messages: SyncExportData['messages'];
  memories: SyncExportData['memories'];
  emotionSnapshots: SyncExportData['emotionSnapshots'];
  characterStates: SyncExportData['characterStates'];
  diaries: SyncExportData['diaries'];
}

/** 收集全量数据（含账号表，用于完整备份） */
export async function collectBackupData(userId: string | null, username: string | null): Promise<BackupData> {
  const base = await collectSyncData(userId, username);
  const users = await db.users.toArray();
  return {
    __meta__: { ...base.__meta__, kind: 'backup' },
    users,
    characters: base.characters,
    sessions: base.sessions,
    messages: base.messages,
    memories: base.memories,
    emotionSnapshots: base.emotionSnapshots,
    characterStates: base.characterStates,
    diaries: base.diaries,
  };
}

/**
 * 创建加密备份并写入共享存储。
 * @param password 备份密码（独立于登录密码）
 * @returns 备份文件路径 / 失败抛异常
 */
export async function createBackup(password: string): Promise<string> {
  const { userId, username } = useAuthStore.getState();
  const data = await collectBackupData(userId, username);
  const plain = JSON.stringify(data);
  const encrypted = await encryptBackup(plain, password);
  const file: BackupFile = {
    app: 'VirtuGene',
    kind: 'backup',
    createdAt: new Date().toISOString(),
    username: username ?? undefined,
    payload: encrypted,
  };

  // 写共享存储（Download/VirtuGeneBackup/，卸载 App 不丢）
  await Filesystem.mkdir({ path: BACKUP_DIR, directory: Directory.Documents, recursive: true });
  const path = `${BACKUP_DIR}/${BACKUP_FILE}`;
  await Filesystem.writeFile({
    path,
    directory: Directory.Documents,
    data: JSON.stringify(file),
    encoding: Encoding.UTF8,
  });
  return path;
}

/** 读取并解密备份文件；密码错误抛异常 */
export async function readBackup(password: string): Promise<{ data: BackupData; file: BackupFile }> {
  const res = await Filesystem.readFile({
    path: `${BACKUP_DIR}/${BACKUP_FILE}`,
    directory: Directory.Documents,
    encoding: Encoding.UTF8,
  });
  const raw = typeof res.data === 'string' ? res.data : await (res.data as Blob).text();
  const parsed = JSON.parse(raw) as BackupFile;
  const plain = await decryptBackup(parsed.payload, password);
  const data = JSON.parse(plain) as BackupData;
  return { data, file: parsed };
}

/** 检测是否存在备份文件（首启引导用） */
export async function hasBackup(): Promise<boolean> {
  try {
    const res = await Filesystem.readFile({
      path: `${BACKUP_DIR}/${BACKUP_FILE}`,
      directory: Directory.Documents,
      encoding: Encoding.UTF8,
    });
    const raw = typeof res.data === 'string' ? res.data : '';
    return raw.length > 10;
  } catch {
    return false;
  }
}

/**
 * 恢复备份：全量导入 IndexedDB + 账号不存在则自动重建 + 自动登录。
 * 返回恢复后的登录信息（供前端直接进入登录态）。
 */
export async function restoreBackup(password: string): Promise<{
  ok: boolean;
  error?: string;
  restoredCounts?: Record<string, number>;
  account?: { userId: string; username: string };
}> {
  try {
    const { data } = await readBackup(password);
    if (!data || !data.__meta__) return { ok: false, error: '备份文件格式不正确' };

    // 1. 导入业务数据（复用 importSyncData，按 id upsert）
    const syncPayload: SyncExportData = {
      __meta__: { ...data.__meta__, kind: 'sync' },
      characters: data.characters ?? [],
      sessions: data.sessions ?? [],
      messages: data.messages ?? [],
      memories: data.memories ?? [],
      emotionSnapshots: data.emotionSnapshots ?? [],
      characterStates: data.characterStates ?? [],
      diaries: data.diaries ?? [],
    };
    const r = await importSyncData(syncPayload);
    if (!r.ok) return { ok: false, error: r.error ?? '数据导入失败' };

    // 2. 账号恢复：备份里有账号且库里没有 → 重建（用户名去重则加后缀）
    let account: { userId: string; username: string } | undefined;
    const backupUser = data.users?.[0];
    if (backupUser) {
      const existing = await userRepo.findByUsername(backupUser.username);
      if (!existing) {
        await db.users.add(backupUser);
        account = { userId: backupUser.id, username: backupUser.username };
      } else {
        account = { userId: existing.id, username: existing.username };
      }
    }

    // 3. 刷新内存状态
    await useChatStore.getState().loadCharacters();
    await useDiaryStore.getState().load();

    return { ok: true, restoredCounts: r.counts, account };
  } catch (err) {
    return { ok: false, error: (err as Error)?.message ?? '恢复失败（可能是密码错误）' };
  }
}

/** 删除备份文件（可选） */
export async function deleteBackup(): Promise<void> {
  try {
    await Filesystem.deleteFile({ path: `${BACKUP_DIR}/${BACKUP_FILE}`, directory: Directory.Documents });
  } catch {
    /* ignore */
  }
}
