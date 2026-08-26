/**
 * 局域网同步状态管理（手机端纯客户端版）。
 *
 * 手机端不提供同步服务，仅作为 HTTP 客户端直连桌面端：
 * - 「拉取」：GET  http://<桌面IP>:<端口>/sync/export  → 合并进本机 IndexedDB
 * - 「推送」：POST http://<桌面IP>:<端口>/sync/import  → 桌面端合并
 *
 * 桌面端只需实现这两个 HTTP 端点（含 CORS 头），协议见 MOBILE.md。
 */
import { create } from 'zustand';
import { collectSyncData, importSyncData, parseSyncData, type SyncExportData } from '../lib/sync';
import { useAuthStore } from './auth-store';
import { useChatStore } from './chat-store';
import { useDiaryStore } from './diary-store';

interface SyncState {
  clientStatus: string | null;
  /** 失败时置为 true，UI 用红色醒目展示 */
  clientError: boolean;
  clientBusy: boolean;
  pullFromDesktop: (host: string, port: number) => Promise<void>;
  pushToDesktop: (host: string, port: number) => Promise<void>;
}

/** 兼容用户误填「http:// 前缀 + 端口」的完整地址：剥离协议头与端口，只留纯 IP */
function normalizeHost(host: string): string {
  let h = host.trim();
  h = h.replace(/^https?:\/\//i, '');
  h = h.replace(/\/.*$/, ''); // 去掉路径（含 :port 之后的部分由端口框单独管理，这里一并兜底）
  return h.replace(/:\d+$/, ''); // 去掉末尾端口（如果用户把 :46789 也粘进来了）
}

/**
 * 带超时的 fetch（手动 AbortController + setTimeout，
 * 兼容旧 Android WebView 不支持的 AbortSignal.timeout）。
 */
async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** 把 fetch 失败转成用户能看懂的提示（区分超时 / 连接失败 / 其它） */
function describeFetchError(err: unknown): string {
  if (err instanceof DOMException && err.name === 'AbortError') {
    return '连接超时：桌面端无响应，请确认已开启同步服务、且手机与电脑在同一 Wi-Fi';
  }
  const msg = (err as Error)?.message ?? String(err);
  // 浏览器对连接失败统一报 "Failed to fetch"（含 CORS 被拦、端口不通、防火墙拦截）
  if (/failed to fetch|networkerror|load failed/i.test(msg)) {
    return '无法连接桌面端。请检查：① 桌面端已点击「开启同步」② 手机与电脑连同一 Wi-Fi ③ 电脑防火墙放行 46789 端口 ④ IP 地址是否正确';
  }
  return msg;
}

/**
 * 同步数据归属重映射：把数据里所有 userId / createdBy 改为当前登录账号。
 * 电脑版与手机版是独立本地账号（userId 不同），不重映射的话，
 * 同步过来的角色/会话/日记会因 createdBy ≠ 本机 userId 被列表过滤掉（数据在库里但看不到）。
 * 注意：messages / emotionSnapshots 无 userId 字段（按 sessionId 关联），无需改动。
 * 预设角色（createdBy=''，属于全设备共享）不改归属，避免与本机基因库预设重复。
 */
function remapDataToCurrentUser(data: SyncExportData, currentUserId: string): SyncExportData {
  const sourceUserId = data.__meta__?.userId;
  return {
    ...data,
    characters: (data.characters ?? []).map((c) => ({
      ...c,
      // 只重映射源账号自有的角色；预设角色 createdBy='' 保持不变
      createdBy: sourceUserId && c.createdBy === sourceUserId ? currentUserId : c.createdBy,
    })),
    sessions: (data.sessions ?? []).map((s) => ({ ...s, userId: currentUserId })),
    memories: (data.memories ?? []).map((m) => ({ ...m, userId: currentUserId })),
    characterStates: (data.characterStates ?? []).map((st) => ({ ...st, userId: currentUserId })),
    diaries: (data.diaries ?? []).map((d) => ({ ...d, userId: currentUserId })),
  };
}

/** 解析 + 归属重映射 + 校验，返回可直接入库的数据 */
function prepareImportPayload(payload: unknown, currentUserId: string): SyncExportData | null {
  const data = parseSyncData(payload);
  if (!data) return null;
  if (data.__meta__?.userId && data.__meta__.userId !== currentUserId) {
    return remapDataToCurrentUser(data, currentUserId);
  }
  return data;
}

export const useSyncStore = create<SyncState>((set) => ({
  clientStatus: null,
  clientError: false,
  clientBusy: false,

  pullFromDesktop: async (host, port) => {
    set({ clientBusy: true, clientError: false, clientStatus: '正在连接桌面端，拉取数据…' });
    try {
      const res = await fetchWithTimeout(`http://${normalizeHost(host)}:${port}/sync/export`, {}, 15_000);
      if (!res.ok) throw new Error(`桌面端返回 HTTP ${res.status}`);
      const payload = await res.json();
      const currentUserId = useAuthStore.getState().userId ?? '';
      const data = prepareImportPayload(payload, currentUserId);
      if (!data) throw new Error('数据格式不正确，请确认桌面端 VirtuGene 版本支持同步');
      const r = await importSyncData(data);
      if (!r.ok) throw new Error(r.error ?? '导入失败');
      await Promise.all([
        useChatStore.getState().loadCharacters(),
        useDiaryStore.getState().load(),
      ]);
      const c = r.counts;
      const sameAccount = (payload as { data?: { __meta__?: { userId?: string } } })?.data?.__meta__?.userId === currentUserId;
      set({
        clientError: false,
        clientStatus: `拉取完成${sameAccount ? '' : '（已归属到本机账号）'}：角色 ${c?.characters ?? 0}、会话 ${c?.sessions ?? 0}、消息 ${c?.messages ?? 0}、日记 ${c?.diaries ?? 0}`,
        clientBusy: false,
      });
    } catch (err) {
      set({
        clientError: true,
        clientStatus: '拉取失败：' + describeFetchError(err),
        clientBusy: false,
      });
    }
  },

  pushToDesktop: async (host, port) => {
    set({ clientBusy: true, clientError: false, clientStatus: '正在连接桌面端，推送本机数据…' });
    try {
      const { userId, username } = useAuthStore.getState();
      const data = await collectSyncData(userId, username);
      const res = await fetchWithTimeout(
        `http://${normalizeHost(host)}:${port}/sync/import`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data }),
        },
        20_000,
      );
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((payload as { error?: string })?.error ?? `桌面端返回 HTTP ${res.status}`);
      set({ clientError: false, clientStatus: '推送完成：桌面端已合并本次数据', clientBusy: false });
    } catch (err) {
      set({
        clientError: true,
        clientStatus: '推送失败：' + describeFetchError(err),
        clientBusy: false,
      });
    }
  },
}));
