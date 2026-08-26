import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface SettingsState {
  /** 日记 AI 辅助（润色/续写/提炼对话）总开关 */
  diaryAiEnabled: boolean;
  setDiaryAiEnabled: (enabled: boolean) => void;
  /** 是否允许角色在对话中看到你的日记片段（隐私开关，默认关） */
  diarySharedWithCharacters: boolean;
  setDiarySharedWithCharacters: (enabled: boolean) => void;
  /** 手账隐私锁 PIN（SHA-256 摘要；为空表示未启用） */
  diaryPin: string | null;
  setDiaryPin: (pinHash: string | null) => void;
  /** 每日写日记提醒（系统通知） */
  diaryReminderEnabled: boolean;
  setDiaryReminderEnabled: (enabled: boolean) => void;
  /** 提醒时间 'HH:mm' */
  diaryReminderTime: string;
  setDiaryReminderTime: (time: string) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      diaryAiEnabled: true,
      setDiaryAiEnabled: (diaryAiEnabled) => set({ diaryAiEnabled }),
      diarySharedWithCharacters: false,
      setDiarySharedWithCharacters: (diarySharedWithCharacters) => set({ diarySharedWithCharacters }),
      diaryPin: null,
      setDiaryPin: (diaryPin) => set({ diaryPin }),
      diaryReminderEnabled: false,
      setDiaryReminderEnabled: (diaryReminderEnabled) => set({ diaryReminderEnabled }),
      diaryReminderTime: '21:00',
      setDiaryReminderTime: (diaryReminderTime) => set({ diaryReminderTime }),
    }),
    { name: 'virtugene-settings' },
  ),
);

/** SHA-256 摘要（用于 PIN 存储，避免明文落盘） */
export async function sha256(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
