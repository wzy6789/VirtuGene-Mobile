/**
 * 角色声线判定（手机版）：AI 根据角色形象特点，选 Edge 音色 + 音域档位（band），
 * 一次性判定并固定。与桌面端 electron/ipc/voice.ts 逻辑一致，改为纯函数直连 DeepSeek。
 * 提示词与音色池见 src/lib/voice-map.ts（VOICE_SELECT_PROMPT / VOICE_POOL / VOICE_BAND_INFO）。
 */
import { fetchWithTimeout } from './http';
import {
  VOICE_SELECT_PROMPT,
  sanitizeVoiceProfile,
  completeVoiceProfile,
  voiceGender,
  DEFAULT_MALE_VOICE,
  DEFAULT_VOICE,
  type VoiceProfile,
} from '../voice-map';

export interface VoiceAssignParams {
  apiKey: string;
  characterId: string;
  character: { name: string; systemPrompt: string; tags?: string[] };
  userHint?: string;
}

export async function assignVoice(
  params: VoiceAssignParams,
): Promise<{ voice?: VoiceProfile; error?: string; detail?: string }> {
  const { apiKey, characterId, character } = params;
  if (!apiKey) return { error: 'auth:invalid_key' };
  try {
    const hint = params.userHint?.trim() ? `\n\n用户对声线的额外期望（请优先满足）：\n${params.userHint.trim().slice(0, 300)}` : '';
    const desc = `角色名：${character.name}\n性格标签：${(character.tags ?? []).join('、') || '无'}\n性格与说话风格：\n${character.systemPrompt.slice(0, 1500)}${hint}`;
    const response = await fetchWithTimeout(
      'https://api.deepseek.com/v1/chat/completions',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'deepseek-v4-flash',
          messages: [
            { role: 'system', content: '你是 VirtuGene 的声线设计师，为数字灵魂挑选合适的语音。' },
            { role: 'user', content: VOICE_SELECT_PROMPT + desc },
          ],
          max_tokens: 300,
          temperature: 0.4,
        }),
      },
      30_000,
    );
    if (!response.ok) {
      let detail = '';
      try {
        detail = (await response.text()).slice(0, 200);
      } catch {
        /* ignore */
      }
      return { error: response.status === 401 ? 'auth:invalid_key' : 'server:error', detail: `HTTP ${response.status}${detail ? '：' + detail : ''}` };
    }
    const data = await response.json();
    const text: string = data.choices?.[0]?.message?.content ?? '';
    let t = text.trim();
    if (t.startsWith('```')) t = t.replace(/```json?/i, '').replace(/```/, '').trim();
    let parsed: unknown;
    try {
      parsed = JSON.parse(t);
    } catch {
      return { error: 'server:error', detail: `AI 返回内容无法解析为 JSON：${t.slice(0, 200)}` };
    }
    // 校验 + 补全档位
    const raw = parsed as { voice?: string; band?: string; rate?: string; pitch?: string; gender?: string; reason?: string };
    let profile: VoiceProfile = sanitizeVoiceProfile(raw);
    // 男女硬校验（最高优先级）：AI 判定的角色性别必须与音色性别一致，
    // 不一致 → 强制修正为该性别的默认音色（男→云扬，女→晓晓），杜绝男角色配女声/反之
    const g = raw.gender;
    if (g === 'male' || g === 'female') {
      if (voiceGender(profile.voice) !== g) {
        profile =
          g === 'male'
            ? { ...DEFAULT_MALE_VOICE, rate: profile.rate, pitch: profile.pitch }
            : { ...DEFAULT_VOICE, rate: profile.rate, pitch: profile.pitch };
      }
    }
    const full: VoiceProfile = completeVoiceProfile(profile, characterId ?? '');
    return { voice: full };
  } catch (err) {
    return { error: 'server:error', detail: String((err as Error)?.message ?? err).slice(0, 200) };
  }
}
