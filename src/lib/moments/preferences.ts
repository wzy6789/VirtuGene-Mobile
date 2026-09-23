/**
 * 朋友圈的本机偏好：默认可见范围、红点、密度、封面、历史可见范围、发布提示。
 *
 * 为什么放 localStorage 而不是 IndexedDB：
 * - 它们只决定"这台设备上朋友圈长什么样、默认怎么发"，不是需要同步的内容数据，
 *   与同样设备专属的 API Key 存储（api-key-storage.ts）属于同一层级；
 * - 放 IndexedDB 要动 Dexie schema，而 schema 迁移有"旧数据零丢失"的验收要求，
 *   为几条界面偏好去冒迁移风险不划算。
 *
 * 例外：「不看他（她）的朋友圈」不在这里——那是关系状态，存在 `momentContacts.muted`，
 * 跟着联系人行一起同步/备份（sync.ts 会带上 momentContacts）。
 *
 * 键按 userId 分开，换账号不会串味；读写失败一律回落到出厂值，绝不阻塞朋友圈页面。
 */
import type { Moment } from '../../db';

export type MomentsAudience = Moment['visibility'];
export type MomentsDensity = 'comfortable' | 'compact';
export type MomentsHistoryWindow = 'all' | '3d' | '1m' | '6m';
export type MomentPostFrequency = 'quiet' | 'natural' | 'active';
export const MOMENT_POST_FREQUENCY_LABELS: Record<MomentPostFrequency, string> = {
  quiet: '安静',
  natural: '自然',
  active: '活跃',
};

export interface MomentsAudiencePreference {
  mode: MomentsAudience;
  /** mode 为 selected / excluded 时记住的角色 id；其他模式下忽略、也不会写入 */
  contactIds: string[];
}

export interface MomentsPreferences {
  /** 新动态的默认可见范围 */
  audience: MomentsAudiencePreference;
  /** 未读红点：互动条上的红点 + 「世界 → 朋友圈」入口角标 */
  showUnreadBadge: boolean;
  /** 列表密度：紧凑档压缩封面与条目间距，首屏能多放一条动态 */
  density: MomentsDensity;
  /** 朋友圈封面：空串 = 默认渐变；否则是压缩后的 dataURL */
  cover: string;
  /** 允许角色查看我的历史动态的范围 */
  historyWindow: MomentsHistoryWindow;
  /** 发布成功后是否弹一条提示 */
  notifyAfterPublish: boolean;
  /** 好友可以基于自己的生活事件主动发布动态。 */
  autonomousPostsEnabled: boolean;
  /** 默认节奏；单个角色可在 contactPostModes 中覆盖。 */
  postFrequency: MomentPostFrequency;
  contactPostModes: Record<string, MomentPostFrequency>;
}

/** 四种可见范围，顺序与发布面板里的按钮一致 */
export const AUDIENCE_MODES: MomentsAudience[] = ['all', 'selected', 'excluded', 'private'];

/** 可见范围的中文名，发布面板与默认设置共用一套说法 */
export const AUDIENCE_MODE_LABELS: Record<MomentsAudience, string> = {
  all: '全部角色',
  selected: '部分可见',
  excluded: '不给谁看',
  private: '仅自己',
};

export const HISTORY_WINDOWS: MomentsHistoryWindow[] = ['all', '3d', '1m', '6m'];

export const HISTORY_WINDOW_LABELS: Record<MomentsHistoryWindow, string> = {
  all: '全部',
  '3d': '最近 3 天',
  '1m': '最近 1 个月',
  '6m': '最近半年',
};

/** 天数；null = 不限制。182 ≈ 半年 */
const HISTORY_WINDOW_DAYS: Record<MomentsHistoryWindow, number | null> = {
  all: null,
  '3d': 3,
  '1m': 30,
  '6m': 182,
};

export const DENSITY_LABELS: Record<MomentsDensity, string> = {
  comfortable: '宽松',
  compact: '紧凑',
};

export const DEFAULT_AUDIENCE_PREFERENCE: MomentsAudiencePreference = { mode: 'all', contactIds: [] };

export const DEFAULT_MOMENTS_PREFERENCES: MomentsPreferences = {
  audience: DEFAULT_AUDIENCE_PREFERENCE,
  showUnreadBadge: true,
  density: 'comfortable',
  cover: '',
  historyWindow: 'all',
  notifyAfterPublish: true,
  autonomousPostsEnabled: true,
  postFrequency: 'natural',
  contactPostModes: {},
};

const KEY_PREFIX = 'virtugene-moments:';
/** 上一轮单独存默认可见范围用的键，读到就并进来（同一个账号不必重设一次） */
const LEGACY_AUDIENCE_PREFIX = 'virtugene-moments-audience:';

function isAudienceMode(value: unknown): value is MomentsAudience {
  return typeof value === 'string' && (AUDIENCE_MODES as string[]).includes(value);
}
function isHistoryWindow(value: unknown): value is MomentsHistoryWindow {
  return typeof value === 'string' && (HISTORY_WINDOWS as string[]).includes(value);
}
function isPostFrequency(value: unknown): value is MomentPostFrequency {
  return value === 'quiet' || value === 'natural' || value === 'active';
}

function normalizeAudience(value: unknown): MomentsAudiencePreference {
  if (typeof value !== 'object' || value === null) return DEFAULT_AUDIENCE_PREFERENCE;
  const record = value as { mode?: unknown; contactIds?: unknown };
  return {
    mode: isAudienceMode(record.mode) ? record.mode : 'all',
    contactIds: Array.isArray(record.contactIds)
      ? record.contactIds.filter((id): id is string => typeof id === 'string')
      : [],
  };
}

function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as unknown) : undefined;
  } catch {
    return undefined;
  }
}

/** 读取该用户的朋友圈偏好；没有存过或存坏了都回落到出厂值（逐字段兜底，坏一个不影响其它） */
export function loadMomentsPreferences(userId: string): MomentsPreferences {
  if (!userId) return DEFAULT_MOMENTS_PREFERENCES;
  const stored = readJson(KEY_PREFIX + userId);
  const record = (typeof stored === 'object' && stored !== null ? stored : {}) as Record<string, unknown>;
  const legacy = record.audience === undefined ? readJson(LEGACY_AUDIENCE_PREFIX + userId) : undefined;
  return {
    audience: normalizeAudience(record.audience ?? legacy),
    showUnreadBadge: typeof record.showUnreadBadge === 'boolean' ? record.showUnreadBadge : DEFAULT_MOMENTS_PREFERENCES.showUnreadBadge,
    density: record.density === 'compact' || record.density === 'comfortable' ? record.density : DEFAULT_MOMENTS_PREFERENCES.density,
    cover: typeof record.cover === 'string' ? record.cover : DEFAULT_MOMENTS_PREFERENCES.cover,
    historyWindow: isHistoryWindow(record.historyWindow) ? record.historyWindow : DEFAULT_MOMENTS_PREFERENCES.historyWindow,
    notifyAfterPublish: typeof record.notifyAfterPublish === 'boolean' ? record.notifyAfterPublish : DEFAULT_MOMENTS_PREFERENCES.notifyAfterPublish,
    autonomousPostsEnabled: typeof record.autonomousPostsEnabled === 'boolean' ? record.autonomousPostsEnabled : DEFAULT_MOMENTS_PREFERENCES.autonomousPostsEnabled,
    postFrequency: isPostFrequency(record.postFrequency) ? record.postFrequency : DEFAULT_MOMENTS_PREFERENCES.postFrequency,
    contactPostModes: typeof record.contactPostModes === 'object' && record.contactPostModes !== null
      ? Object.fromEntries(Object.entries(record.contactPostModes as Record<string, unknown>).filter((entry): entry is [string, MomentPostFrequency] => isPostFrequency(entry[1])))
      : {},
  };
}

/** 保存朋友圈偏好；只在 selected / excluded 下记住名单，避免换模式后留下幽灵选择 */
export function saveMomentsPreferences(userId: string, preferences: MomentsPreferences): void {
  if (!userId) return;
  const audience = preferences.audience;
  const contactIds = audience.mode === 'selected' || audience.mode === 'excluded' ? audience.contactIds : [];
  try {
    localStorage.setItem(
      KEY_PREFIX + userId,
      JSON.stringify({
        audience: { mode: audience.mode, contactIds },
        showUnreadBadge: preferences.showUnreadBadge,
        density: preferences.density,
        cover: preferences.cover,
        historyWindow: preferences.historyWindow,
        notifyAfterPublish: preferences.notifyAfterPublish,
        autonomousPostsEnabled: preferences.autonomousPostsEnabled,
        postFrequency: preferences.postFrequency,
        contactPostModes: preferences.contactPostModes,
      }),
    );
    localStorage.removeItem(LEGACY_AUDIENCE_PREFIX + userId);
  } catch {
    // 写不进去不影响发布：本次仍然用内存里的偏好，下次打开回到上一次成功保存的值。
  }
}

/**
 * 历史可见范围的时间下界（毫秒）；返回 0 表示不限制。
 *
 * 这个判断发生在客户端（动态本来就只存在本机 IndexedDB，角色互动也由本机发起），
 * 所以偏好读本机存储与执行位置是一致的。跨设备导入备份时，新设备用自己的设置。
 */
export function historyWindowCutoff(userId: string, now = Date.now()): number {
  const days = HISTORY_WINDOW_DAYS[loadMomentsPreferences(userId).historyWindow];
  return days === null ? 0 : now - days * 24 * 60 * 60 * 1000;
}

// 注销账号不需要在这里额外清理：SettingsPanel.handleDeleteAccount 已经 localStorage.clear()
// （src/components/settings/SettingsPanel.tsx:162），登出则按 userId 命名空间天然隔离。
