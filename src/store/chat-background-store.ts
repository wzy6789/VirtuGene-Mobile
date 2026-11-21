import { create } from 'zustand';
import { chatBackgroundRepo, backgroundSettingKey, type BackgroundSetting } from '../db/chat-background-repo';
import { DEFAULT_GLOBAL_BACKGROUND, normalizeChatBackground, type ChatBackgroundConfig, type GlobalChatBackground } from '../lib/chat-background-config';
import { useAuthStore } from './auth-store';
import { useSettingsStore } from './settings-store';
import { CINEMATIC_CHAT_DEFAULT_VERSION } from '../lib/chat-background-config';

export const useChatBackgroundStore = create<{ rows: Record<string, BackgroundSetting>; ready: Record<string, boolean>; errors: Record<string,string> }>(() => ({ rows:{}, ready:{}, errors:{} }));
const pending = new Map<string, Promise<void>>();
export function ensureChatBackground(userId: string, retry = false): Promise<void> {
  if (!userId || useAuthStore.getState().userId !== userId) return Promise.resolve();
  if (!retry && useChatBackgroundStore.getState().ready[userId]) return Promise.resolve();
  if (pending.has(userId)) return pending.get(userId)!;
  const task = chatBackgroundRepo.load(userId).then(rows => {
    if (useAuthStore.getState().userId !== userId) return;
    if((rows.find(row=>row.roleId==='')?.cinematicDefaultVersion??0)>=CINEMATIC_CHAT_DEFAULT_VERSION){
      useSettingsStore.getState().adoptCinematicChatDefaults(userId,CINEMATIC_CHAT_DEFAULT_VERSION);
    }
    useChatBackgroundStore.setState(state => {
      const next = { ...state.rows };
      for (const [key,row] of Object.entries(next)) if (row.userId === userId) delete next[key];
      rows.forEach(row => { next[row.id] = row; });
      return { rows:next, ready:{...state.ready,[userId]:true}, errors:{...state.errors,[userId]:''} };
    });
  }).catch(() => { if (useAuthStore.getState().userId === userId) useChatBackgroundStore.setState(state => ({errors:{...state.errors,[userId]:'本地聊天外观未能读取，暂用安全主题。可在聊天外观里重试。'}})); }).finally(() => pending.delete(userId));
  pending.set(userId,task); return task;
}
export function readBackgroundRows(userId: string, roleId?: string) {
  const state = useChatBackgroundStore.getState(), globalRow = state.rows[backgroundSettingKey(userId,'')], roleRow = roleId ? state.rows[backgroundSettingKey(userId,roleId)] : undefined;
  const global: GlobalChatBackground = globalRow ? { strategy:globalRow.strategy === 'fixed' ? 'fixed' : 'characterRecommended',config:normalizeChatBackground(globalRow.config).config } : DEFAULT_GLOBAL_BACKGROUND;
  const override: ChatBackgroundConfig | undefined = roleRow ? normalizeChatBackground(roleRow.config).config : undefined;
  return { globalRow,roleRow,global,override };
}
export function publishBackground(row: BackgroundSetting) { if (useAuthStore.getState().userId === row.userId) useChatBackgroundStore.setState(state => ({ rows:{...state.rows,[row.id]:row} })); }
export function forgetRoleBackground(userId: string, roleId: string) { useChatBackgroundStore.setState(state => { const rows={...state.rows}; delete rows[backgroundSettingKey(userId,roleId)]; return {rows}; }); }
