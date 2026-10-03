import { db, type SecretaryBinding } from '../../db';
import { useAuthStore } from '../../store/auth-store';

export const DIARY_FORMATS = { natural: '自然叙述', brief: '简短记录', sections: '分段复盘' } as const;
export const MOMENT_STYLES = { natural: '自然日常', concise: '简洁直白', warm: '温暖细腻', lively: '轻松活泼' } as const;
export const REPLY_LENGTHS = { concise: '简短回应', normal: '适度说明' } as const;
export const TODO_PRIORITIES = { normal: '普通', important: '重要', urgent: '紧急' } as const;

export interface SecretaryWorkPreferences {
  diaryFormat: keyof typeof DIARY_FORMATS;
  momentStyle: keyof typeof MOMENT_STYLES;
  replyLength: keyof typeof REPLY_LENGTHS;
  todoPriority: keyof typeof TODO_PRIORITIES;
  reminderMinutes: number;
  proactiveHelp?: boolean;
}

export const DEFAULT_WORK_PREFERENCES: SecretaryWorkPreferences = {
  diaryFormat: 'natural', momentStyle: 'natural', replyLength: 'concise', todoPriority: 'normal', reminderMinutes: 0, proactiveHelp: false,
};

export function validateWorkPreferences(value: unknown): SecretaryWorkPreferences {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('办事习惯格式不正确。');
  const raw = value as Record<string, unknown>;
  for (const [key, choices] of Object.entries({ diaryFormat: DIARY_FORMATS, momentStyle: MOMENT_STYLES, replyLength: REPLY_LENGTHS, todoPriority: TODO_PRIORITIES })) {
    if (typeof raw[key] !== 'string' || !Object.prototype.hasOwnProperty.call(choices, raw[key])) throw new Error('办事习惯选项不正确。');
  }
  if (!Number.isInteger(raw.reminderMinutes) || Number(raw.reminderMinutes) < 0 || Number(raw.reminderMinutes) > 10080) throw new Error('提前提醒需要是0到10080分钟。');
  if (raw.proactiveHelp != null && typeof raw.proactiveHelp !== 'boolean') throw new Error('主动协助选项不正确。');
  return { diaryFormat: raw.diaryFormat, momentStyle: raw.momentStyle, replyLength: raw.replyLength, todoPriority: raw.todoPriority, reminderMinutes: raw.reminderMinutes, proactiveHelp: raw.proactiveHelp === true } as SecretaryWorkPreferences;
}

export function workPreferencesOrDefault(value: unknown): SecretaryWorkPreferences {
  try { return validateWorkPreferences(value); } catch { return { ...DEFAULT_WORK_PREFERENCES }; }
}

export async function readWorkPreferences(userId: string): Promise<SecretaryBinding | undefined> {
  if (!userId || useAuthStore.getState().userId !== userId) return;
  return db.transaction('r', db.secretaryBindings, db.characters, async () => {
    const binding = await db.secretaryBindings.get(userId);
    const character = binding ? await db.characters.get(binding.characterId) : undefined;
    if (character?.createdBy === userId && character.agentProfile === 'secretary' && !character.isPreset && useAuthStore.getState().userId === userId) return binding;
  });
}

export async function saveWorkPreferences(userId: string, value: unknown, expected: { characterId: string; employmentId?: string; version: number }): Promise<SecretaryBinding> {
  const preferences = validateWorkPreferences(value);
  if (useAuthStore.getState().userId !== userId) throw new Error('账号已切换，请重新打开办事习惯。');
  return db.transaction('rw', db.secretaryBindings, db.characters, async () => {
    const binding = await readWorkPreferences(userId);
    if (!binding || binding.characterId !== expected.characterId || binding.employmentId !== expected.employmentId) throw new Error('助理聘用已变化，请重新打开办事习惯。');
    if ((binding.workPreferencesUpdatedAt ?? 0) !== expected.version) throw new Error('办事习惯已在其他地方修改，请重新读取后再保存。');
    const now = Math.max(Date.now(), (binding.updatedAt ?? 0) + 1, (binding.workPreferencesUpdatedAt ?? 0) + 1);
    const changed = { ...binding, workPreferences: preferences, workPreferencesUpdatedAt: now, updatedAt: now };
    if (useAuthStore.getState().userId !== userId) throw new Error('账号已切换，未保存。');
    await db.secretaryBindings.put(changed);
    return changed;
  });
}

export function workPreferencesPrompt(value: SecretaryWorkPreferences): string {
  return `用户已保存的办事习惯（本次明确要求优先）：
日记格式：${DIARY_FORMATS[value.diaryFormat]}${value.diaryFormat === 'sections' ? '，按“今天发生的事 / 感受 / 接下来”分段，只写已有真实素材，缺素材的小节省略' : value.diaryFormat === 'brief' ? '，短段落，省去铺陈，不漏关键事实' : '，自然第一人称，不强加模板'}。
朋友圈文风：${MOMENT_STYLES[value.momentStyle]}。不改变受众、不自动发布、不编造事实。
助理回应长度：${REPLY_LENGTHS[value.replyLength]}，不影响代写内容的完整性。
新建待办未指明优先级时由应用采用“${TODO_PRIORITIES[value.todoPriority]}”；不要自行填priority覆盖习惯。
用户明确要求提醒、但没说提前多久时，由应用采用${value.reminderMinutes === 0 ? '准时' : `提前${value.reminderMinutes}分钟`}提醒。没有提醒要求不能添加提醒；缺具体日期或时间仍询问，不默认编造时间。
这些习惯不授权修改已有记录；修改待办未指定的设置继续保留。`;
}

/** Merge independently from employment: an older hiring snapshot cannot erase newer habits. */
export function mergeWorkPreferences(local: SecretaryBinding, incoming: SecretaryBinding): Pick<SecretaryBinding, 'workPreferences' | 'workPreferencesUpdatedAt'> {
  const a = local.workPreferencesUpdatedAt ?? 0, b = incoming.workPreferencesUpdatedAt ?? 0;
  const newer = b > a || b === a && JSON.stringify(incoming.workPreferences ?? {}) > JSON.stringify(local.workPreferences ?? {}) ? incoming : local;
  return { workPreferences: newer.workPreferences, workPreferencesUpdatedAt: newer.workPreferencesUpdatedAt };
}
