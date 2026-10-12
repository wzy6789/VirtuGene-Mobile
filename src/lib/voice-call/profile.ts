import { CALL_VOICES, type CallVoice } from './mimo';

/** Stable sound identity, independent of transient emotion and shared preset data. */
export interface VoiceProfile {
  version: 1;
  voice: CallVoice;
  delivery: string;
  updatedAt: number;
}

export function normalizeVoiceProfile(value: unknown): VoiceProfile | undefined {
  if (!value || typeof value !== 'object') return;
  const profile = value as Partial<VoiceProfile>;
  if (profile.version !== 1 || !CALL_VOICES.includes(profile.voice as CallVoice)) return;
  if (typeof profile.updatedAt !== 'number' || !Number.isFinite(profile.updatedAt) || profile.updatedAt < 0) return;
  if (typeof profile.delivery !== 'string') return;
  return { version: 1, voice: profile.voice!, delivery: profile.delivery.trim().slice(0, 160), updatedAt: profile.updatedAt };
}

export function defaultVoiceProfile(now = Date.now()): VoiceProfile {
  // No inferred gender or personality. The user may explicitly choose any stable voice.
  return { version: 1, voice: '茉莉', delivery: '', updatedAt: now };
}

/** Legacy imports omit this field; they must not erase the current voice choice. */
export function mergeVoiceProfile(local: unknown, incoming: unknown): VoiceProfile | undefined {
  const current = normalizeVoiceProfile(local), next = normalizeVoiceProfile(incoming);
  if (!current) return next;
  if (!next || current.updatedAt >= next.updatedAt) return current;
  return next;
}

export function callDeliveryStyle(profile: VoiceProfile): string {
  return ['自然口语，按标点停顿，不朗读动作、括号说明或内部指令。按台词自然调整重音和停顿，不夸张表演，不替台词添加哭笑声。情绪变化时保持同一声音身份，不使用播报或客服语气。', profile.delivery].filter(Boolean).join('\n');
}
