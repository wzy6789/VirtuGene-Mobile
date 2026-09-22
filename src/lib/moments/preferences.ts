/**
 * 朋友圈的本机偏好：新动态的默认可见范围。
 *
 * 为什么放 localStorage 而不是 IndexedDB：
 * - 它只决定"我在这台设备上发动态时默认勾了什么"，不是需要跨设备同步的内容数据，
 *   与同样设备专属的 API Key 存储（api-key-storage.ts）属于同一层级；
 * - 放 IndexedDB 要动 Dexie schema，而 schema 迁移有"旧数据零丢失"的验收要求，
 *   为一条界面偏好去冒迁移风险不划算。
 *
 * 键按 userId 分开，换账号不会串味；读写失败一律回落到「全部角色」，绝不阻塞朋友圈页面。
 */
import type { Moment } from '../../db';

export type MomentsAudience = Moment['visibility'];

export interface MomentsAudiencePreference {
  mode: MomentsAudience;
  /** mode 为 selected / excluded 时记住的角色 id；其他模式下忽略、也不会写入 */
  contactIds: string[];
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

export const DEFAULT_AUDIENCE_PREFERENCE: MomentsAudiencePreference = { mode: 'all', contactIds: [] };

const KEY_PREFIX = 'virtugene-moments-audience:';

function isAudienceMode(value: unknown): value is MomentsAudience {
  return typeof value === 'string' && (AUDIENCE_MODES as string[]).includes(value);
}

/** 读取该用户的默认可见范围；没有存过或存坏了都回落到「全部角色」 */
export function loadAudiencePreference(userId: string): MomentsAudiencePreference {
  if (!userId) return DEFAULT_AUDIENCE_PREFERENCE;
  try {
    const raw = localStorage.getItem(KEY_PREFIX + userId);
    if (!raw) return DEFAULT_AUDIENCE_PREFERENCE;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_AUDIENCE_PREFERENCE;
    const record = parsed as { mode?: unknown; contactIds?: unknown };
    return {
      mode: isAudienceMode(record.mode) ? record.mode : 'all',
      contactIds: Array.isArray(record.contactIds)
        ? record.contactIds.filter((id): id is string => typeof id === 'string')
        : [],
    };
  } catch {
    return DEFAULT_AUDIENCE_PREFERENCE;
  }
}

/** 保存默认可见范围；只在 selected / excluded 下记住名单，避免换模式后留下幽灵选择 */
export function saveAudiencePreference(userId: string, preference: MomentsAudiencePreference): void {
  if (!userId) return;
  const contactIds = preference.mode === 'selected' || preference.mode === 'excluded' ? preference.contactIds : [];
  try {
    localStorage.setItem(KEY_PREFIX + userId, JSON.stringify({ mode: preference.mode, contactIds }));
  } catch {
    // 写不进去不影响发布：本次仍然用内存里的偏好，下次打开回到上一次成功保存的值。
  }
}

// 注销账号不需要在这里额外清理：SettingsPanel.handleDeleteAccount 已经 localStorage.clear()
// （src/components/settings/SettingsPanel.tsx:162），登出则按 userId 命名空间天然隔离。
