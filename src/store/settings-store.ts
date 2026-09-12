import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface SettingsState {
  /** 日记 AI 辅助（润色/续写/提炼对话）总开关 */
  diaryAiEnabled: boolean;
  setDiaryAiEnabled: (enabled: boolean) => void;
  /**
   * ⚠️ 已删除（5.0.0 Phase 2b-4）：`diarySharedWithCharacters`。
   *
   * 那个 4.x 的**全局**开关会把"最近几篇日记"注入**每一个**角色的上下文，
   * 与 5.0 的逐条可见性（Diary.visibility / visibleTo）并存时构成了真实的隐私漏洞：
   * 用户无法判断"到底谁能看到什么"。现在日记只有在你**逐条授权**（告诉某角色 / 加入共同世界）
   * 之后才可能进入对应角色的上下文，且撤回后立即失效。
   *
   * 历史设置里即使还残留这个键（zustand persist 的旧数据），也**没有任何代码再读它**。
   */
  /** 手账隐私锁 PIN（SHA-256 摘要；为空表示未启用） */
  diaryPin: string | null;
  setDiaryPin: (pinHash: string | null) => void;
  /** 每日写日记提醒（系统通知） */
  diaryReminderEnabled: boolean;
  setDiaryReminderEnabled: (enabled: boolean) => void;
  /** 提醒时间 'HH:mm' */
  diaryReminderTime: string;
  setDiaryReminderTime: (time: string) => void;
  /** 角色语音总开关（默认开；关闭后消息不显示 🔊、不触发朗读） */
  ttsEnabled: boolean;
  setTtsEnabled: (enabled: boolean) => void;
  /** 朗读语速倍率（0.8 慢 / 1.0 标准 / 1.2 快），叠加到角色声线语速上 */
  ttsSpeed: number;
  setTtsSpeed: (speed: number) => void;
  /** 朗读引擎：edge（默认，免费稳定）/ mimo（需 MiMo key，效果更好，限时免费） */
  ttsEngine: 'edge' | 'mimo';
  setTtsEngine: (engine: 'edge' | 'mimo') => void;
  /** AI 语音消息模式：开启后 AI 回复自动合成语音，消息显示为语音气泡（点击播放，文字可展开） */
  aiVoiceMode: boolean;
  setAiVoiceMode: (enabled: boolean) => void;
  /** 默认对话模型（角色未单独指定时使用；null = deepseek-v4-flash） */
  defaultModel: { provider: string; model: string } | null;
  setDefaultModel: (model: { provider: string; model: string } | null) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      diaryAiEnabled: true,
      setDiaryAiEnabled: (diaryAiEnabled) => set({ diaryAiEnabled }),
      diaryPin: null,
      setDiaryPin: (diaryPin) => set({ diaryPin }),
      diaryReminderEnabled: false,
      setDiaryReminderEnabled: (diaryReminderEnabled) => set({ diaryReminderEnabled }),
      diaryReminderTime: '21:00',
      setDiaryReminderTime: (diaryReminderTime) => set({ diaryReminderTime }),
      ttsEnabled: true,
      setTtsEnabled: (ttsEnabled) => set({ ttsEnabled }),
      ttsSpeed: 1.0,
      setTtsSpeed: (ttsSpeed) => set({ ttsSpeed }),
      ttsEngine: 'edge',
      setTtsEngine: (ttsEngine) => set({ ttsEngine }),
      aiVoiceMode: false,
      setAiVoiceMode: (aiVoiceMode) => set({ aiVoiceMode }),
      defaultModel: null,
      setDefaultModel: (defaultModel) => set({ defaultModel }),
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
