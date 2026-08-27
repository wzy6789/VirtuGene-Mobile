/**
 * 语音转文字（系统语音识别）封装：调 @capgo/capacitor-speech-recognition，
 * 底层是安卓系统 SpeechRecognizer（免费、离线、支持中文，引擎随手机）。
 * 非 Capacitor 环境（浏览器预览）调用会优雅失败，由调用方提示。
 */
import { SpeechRecognition } from '@capgo/capacitor-speech-recognition';
import { IS_CAPACITOR } from './platform';

let partialListener: { remove: () => Promise<void> } | null = null;
let latestPartial = '';

/** 检查/申请麦克风 + 语音识别权限 */
export async function ensureRecordPermission(): Promise<boolean> {
  if (!IS_CAPACITOR) return false;
  try {
    const status = await SpeechRecognition.checkPermissions();
    if (status.speechRecognition === 'granted') return true;
    const req = await SpeechRecognition.requestPermissions();
    return req.speechRecognition === 'granted';
  } catch {
    return false;
  }
}

/** 设备是否支持语音识别 */
export async function isSpeechAvailable(): Promise<boolean> {
  if (!IS_CAPACITOR) return false;
  try {
    return (await SpeechRecognition.available()).available;
  } catch {
    return false;
  }
}

/** 开始识别（中文）；partialResults 实时回调 */
export async function startSpeechRecognition(onPartial?: (text: string) => void): Promise<boolean> {
  if (!IS_CAPACITOR) return false;
  try {
    latestPartial = '';
    partialListener = await SpeechRecognition.addListener('partialResults', (e) => {
      const t = (e.matches?.[0] ?? e.accumulatedText ?? '').trim();
      if (t) {
        latestPartial = t;
        onPartial?.(t);
      }
    });
    await SpeechRecognition.start({ language: 'zh-CN', maxResults: 3, partialResults: true });
    return true;
  } catch {
    try {
      await partialListener?.remove();
    } catch {
      /* ignore */
    }
    partialListener = null;
    return false;
  }
}

/** 停止识别并返回最佳转写文本 */
export async function stopSpeechRecognition(): Promise<string> {
  try {
    await SpeechRecognition.stop();
  } catch {
    /* ignore */
  }
  try {
    await partialListener?.remove();
  } catch {
    /* ignore */
  }
  partialListener = null;
  // 优先取原生缓存的最后结果，其次用监听累计的 partial
  try {
    const last = await SpeechRecognition.getLastPartialResult();
    if (last.available && last.text.trim()) return last.text.trim();
  } catch {
    /* ignore */
  }
  return latestPartial.trim();
}

/** 取消识别（丢弃转写） */
export async function cancelSpeechRecognition(): Promise<void> {
  try {
    await SpeechRecognition.stop();
  } catch {
    /* ignore */
  }
  try {
    await partialListener?.remove();
  } catch {
    /* ignore */
  }
  partialListener = null;
  latestPartial = '';
}
