/**
 * 手账隐私锁的解锁状态（模块级，应用会话内保持）。
 * 独立成模块避免 Sidebar/SettingsPanel 静态依赖 DiaryPage（会破坏 React.lazy 拆包）。
 */
let diaryUnlocked = false;

export function isDiaryUnlocked(): boolean {
  return diaryUnlocked;
}

export function setDiaryUnlocked(v: boolean) {
  diaryUnlocked = v;
}

/** 登出/切换账号时重置（避免换账号后直接看到日记） */
export function resetDiaryUnlock() {
  diaryUnlocked = false;
}
