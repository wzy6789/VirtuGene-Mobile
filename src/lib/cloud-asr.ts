/**
 * 云端语音识别（硅基流动 SiliconFlow · SenseVoice，OpenAI 兼容，免费）：
 * - 国内直连无需代理；手机号注册 cloud.siliconflow.cn 拿 sk- 密钥
 * - 模型：FunAudioLLM/SenseVoiceSmall（平台免费模型，中文识别效果好）
 * - 流程：录音 webm/opus dataURL → AudioContext 解码 → 重采样 16kHz 单声道 →
 *   PCM16 WAV → POST /v1/audio/transcriptions
 * 用途：无系统语音识别引擎的手机（如 OPPO ColorOS 不开放标准 SpeechRecognizer 接口）的备用通道。
 */

const ASR_ENDPOINT = 'https://api.siliconflow.cn/v1/audio/transcriptions';
const ASR_MODEL = 'FunAudioLLM/SenseVoiceSmall';
const ASR_TIMEOUT_MS = 30_000;

/** 云端识别密钥在设备加密存储中的名字（ChatInput / 设置共用） */
export const CLOUD_ASR_KEY_NAME = 'siliconflow-asr';

/** webm/opus → 16kHz 单声道 PCM16 WAV（纯 Web 实现） */
async function webmToWav16k(dataUrl: string): Promise<ArrayBuffer> {
  const audioCtx = new AudioContext();
  try {
    const resp = await fetch(dataUrl);
    const arrayBuf = await resp.arrayBuffer();
    let decoded: AudioBuffer;
    try {
      decoded = await audioCtx.decodeAudioData(arrayBuf);
    } catch {
      throw new Error('音频解码失败（录音可能异常）');
    }
    const src = decoded.getChannelData(0); // 单声道化（取左声道）
    const targetRate = 16000;
    const duration = decoded.duration || (src.length / (decoded.sampleRate || 48000));
    const outLen = Math.max(1, Math.round(duration * targetRate));
    const ratio = outLen > 0 && src.length > 0 ? src.length / outLen : 1;
    const bytesPerSample = 2;
    const buffer = new ArrayBuffer(44 + outLen * bytesPerSample);
    const view = new DataView(buffer);

    const writeStr = (off: number, s: string) => {
      for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
    };
    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + outLen * bytesPerSample, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 1, true); // mono
    view.setUint32(24, targetRate, true);
    view.setUint32(28, targetRate * bytesPerSample, true);
    view.setUint16(32, bytesPerSample, true);
    view.setUint16(34, 16, true); // bits
    writeStr(36, 'data');
    view.setUint32(40, outLen * bytesPerSample, true);

    let off = 44;
    for (let i = 0; i < outLen; i++) {
      const idx = Math.min(src.length - 1, Math.round(i * ratio));
      const s = Math.max(-1, Math.min(1, src[idx] ?? 0));
      view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      off += 2;
    }
    return buffer;
  } finally {
    try {
      void audioCtx.close();
    } catch {
      /* ignore */
    }
  }
}

/**
 * 云端转写录音。成功返回转写文本（可能为空串）；失败抛错。
 * 503/429（服务端繁忙/限流）自动退避重试最多 3 次。
 */
export async function transcribeWithSiliconFlow(dataUrl: string, apiKey: string): Promise<string> {
  const wav = await webmToWav16k(dataUrl);

  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, 600 * attempt)); // 600ms / 1200ms 退避
    }
    try {
      return await transcribeOnce(wav, apiKey);
    } catch (err) {
      const msg = (err as Error)?.message ?? '';
      // 仅 503/429 可重试；其余错误直接抛
      if (!msg.includes('HTTP 503') && !msg.includes('HTTP 429')) throw err;
      lastErr = err as Error;
    }
  }
  throw lastErr ?? new Error('HTTP 503');
}

async function transcribeOnce(wav: ArrayBuffer, apiKey: string): Promise<string> {
  const form = new FormData();
  form.append('file', new Blob([wav], { type: 'audio/wav' }), 'recording.wav');
  form.append('model', ASR_MODEL);
  form.append('language', 'zh');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ASR_TIMEOUT_MS);
  try {
    const res = await fetch(ASR_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: controller.signal,
    });
    if (!res.ok) {
      let detail = '';
      try {
        detail = (await res.text()).slice(0, 200);
      } catch {
        /* ignore */
      }
      throw new Error(`HTTP ${res.status}${detail ? '：' + detail : ''}`);
    }
    const data = (await res.json()) as { text?: string };
    return (data?.text ?? '').trim();
  } finally {
    clearTimeout(timer);
  }
}
