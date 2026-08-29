/**
 * MiMo TTS（小米官方语音合成，OpenAI 兼容，限时免费）：
 * - 端点：https://api.xiaomimimo.com/v1/chat/completions（chat 接口带 audio 参数）
 * - 模型：mimo-v2.5-tts（预置音色）/ voiceclone（克隆，P2）/ voicedesign（音色设计，P2）
 * - 音色：mimo_default、冰糖、茉莉、苏打、白桦、Mia、Chloe、Milo、Dean
 * - key：与 MiMo 对话同一个 key（设备加密存储 'mimo-key'）
 * - 失败由调用方回退 Edge-TTS → 系统语音
 */
import { loadSecret } from './api-key-storage';

const MIMO_TTS_URL = 'https://api.xiaomimimo.com/v1/chat/completions';
const MIMO_TTS_MODEL = 'mimo-v2.5-tts';
const MIMO_TTS_TIMEOUT_MS = 30_000;

/** Edge 音色（按性别）→ MiMo 预置音色映射（v1 简化：女→茉莉，男→Dean，可按需细调） */
export function mapEdgeVoiceToMimo(edgeVoice: string): string {
  return /Yun/i.test(edgeVoice) ? 'Dean' : '茉莉';
}

export interface MimoTTSSynthOptions {
  voice: string;
}

/** MiMo TTS 合成，返回音频 ArrayBuffer（mp3）；失败抛错 */
export async function mimoTTSSynthesize(text: string, options: MimoTTSSynthOptions): Promise<ArrayBuffer> {
  const apiKey = await loadSecret('mimo-key');
  if (!apiKey) throw new Error('auth:invalid_key');

  const res = await fetchWithTimeoutMimo(
    MIMO_TTS_URL,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MIMO_TTS_MODEL,
        messages: [
          { role: 'user', content: '请用指定音色朗读以下内容。' },
          { role: 'assistant', content: text.slice(0, 800) },
        ],
        audio: { format: 'mp3', voice: options.voice },
      }),
    },
    MIMO_TTS_TIMEOUT_MS,
  );

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) throw new Error('auth:invalid_key');
    throw new Error('server:error');
  }

  // 响应可能是二进制音频（audio/speech 风格）或 JSON（chat 接口 audio 输出，base64）
  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('audio/') || contentType.includes('application/octet-stream')) {
    const buf = await res.arrayBuffer();
    if (buf.byteLength === 0) throw new Error('empty audio');
    return buf;
  }

  const data = (await res.json()) as Record<string, unknown>;
  // OpenAI 风格 audio 输出：choices[0].message.audio.data（base64）
  const choice = (data as { choices?: { message?: { audio?: { data?: string } } }[] })?.choices?.[0];
  const candidates: Array<string | undefined> = [
    choice?.message?.audio?.data,
    (data.audio as string | undefined) ?? (data.audio as { data?: string } | undefined)?.data,
    data.output_audio as string | undefined,
    (data.data as { audio?: string } | undefined)?.audio,
  ];
  const audioB64 = candidates.find((c): c is string => typeof c === 'string' && c.length > 0);
  if (!audioB64) throw new Error('empty audio');

  const binary = atob(audioB64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function fetchWithTimeoutMimo(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
