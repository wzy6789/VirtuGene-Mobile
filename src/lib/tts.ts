import { useCallback, useEffect, useRef, useState } from 'react';
import { edgeTTSSynthesize } from './edge-tts';
import { mimoTTSSynthesize, mapEdgeVoiceToMimo } from './mimo-tts';
import { useSettingsStore } from '../store/settings-store';

/**
 * 合成语音（不播放）：按引擎 MiMo → Edge 返回音频 ArrayBuffer。
 * 供 🔊 朗读与「AI 语音消息模式」后台合成共用。
 * @throws 引擎全部失败时抛错
 */
export async function synthesizeSpeech(text: string, voice: string, rate?: string, pitch?: string): Promise<ArrayBuffer> {
  if (useSettingsStore.getState().ttsEngine === 'mimo') {
    try {
      return await mimoTTSSynthesize(text, { voice: mapEdgeVoiceToMimo(voice) });
    } catch {
      /* MiMo 失败 → Edge 兜底 */
    }
  }
  const audio = await edgeTTSSynthesize(text, { voice, rate: rate ?? '+0%', pitch: pitch ?? '+0Hz' });
  if (audio.byteLength === 0) throw new Error('empty audio');
  return audio;
}

/** 音频 ArrayBuffer → base64 dataURL（语音消息存储用） */
export async function audioBufToDataUrl(buf: ArrayBuffer, mime = 'audio/mpeg'): Promise<string> {
  const blob = new Blob([buf], { type: mime });
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('read failed'));
    reader.readAsDataURL(blob);
  });
}

/** 解码音频获取时长（秒）；失败返回 0 */
export async function audioDurationSec(dataUrl: string): Promise<number> {
  try {
    const ctx = new AudioContext();
    try {
      const resp = await fetch(dataUrl);
      const buf = await resp.arrayBuffer();
      const decoded = await ctx.decodeAudioData(buf);
      return Math.max(1, Math.round(decoded.duration));
    } finally {
      try {
        void ctx.close();
      } catch {
        /* ignore */
      }
    }
  } catch {
    return 0;
  }
}

/**
 * TTS 播放控制（手机版）：用户主动点击才发声，绝不自动朗读。
 * 主实现：Edge-TTS 直连（WebSocket，微软神经网络音色，与桌面同款声线）
 * 兜底：Edge 失败（断网/接口变动/服务端拒绝）→ 回退系统语音（speechSynthesis）
 * 同一时刻只播一句：播新句自动停旧句；合成期间切到别的句，旧句合成结果直接丢弃。
 */
export function useTTS() {
  const [playingKey, setPlayingKey] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  /** 当前正在播放的句 key */
  const currentKeyRef = useRef<string | null>(null);
  /** 当前正在合成中的句 key（合成完成时校验，过期结果丢弃） */
  const pendingKeyRef = useRef<string | null>(null);
  const urlRef = useRef<string | null>(null);

  const stop = useCallback(() => {
    audioRef.current?.pause();
    audioRef.current = null;
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    currentKeyRef.current = null;
    pendingKeyRef.current = null;
    setPlayingKey(null);
    setBusyKey(null);
  }, []);

  const playAudio = useCallback((key: string, audioBuf: ArrayBuffer) => {
    const blob = new Blob([audioBuf], { type: 'audio/mpeg' });
    const url = URL.createObjectURL(blob);
    urlRef.current = url;
    const audio = new Audio(url);
    audioRef.current = audio;
    currentKeyRef.current = key;
    setPlayingKey(key);
    const clear = () => {
      if (currentKeyRef.current === key) {
        currentKeyRef.current = null;
        setPlayingKey(null);
      }
    };
    audio.onended = clear;
    audio.onerror = clear;
    void audio.play();
  }, []);

  /**
   * 等待系统语音引擎就绪（Android WebView 的 getVoices() 常延迟加载，首次可能为空）。
   * 最多等 1s，超时返回当前列表（可能为空，交给默认 voice 兜底）。
   */
  const ensureVoices = useCallback((): Promise<SpeechSynthesisVoice[]> => {
    return new Promise((resolve) => {
      if (!('speechSynthesis' in window)) {
        resolve([]);
        return;
      }
      const current = window.speechSynthesis.getVoices();
      if (current.length > 0) {
        resolve(current);
        return;
      }
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        window.speechSynthesis.removeEventListener?.('voiceschanged', finish);
        resolve(window.speechSynthesis.getVoices());
      };
      window.speechSynthesis.addEventListener?.('voiceschanged', finish);
      setTimeout(finish, 1000);
    });
  }, []);

  /** 系统语音兜底 */
  const playSystem = useCallback(
    async (key: string, text: string, voiceKeyword?: string, rateStr?: string, pitchStr?: string) => {
      if (!('speechSynthesis' in window)) return;
      const voices = await ensureVoices();
      const zh = voices.filter((v) => v.lang.toLowerCase().startsWith('zh'));
      const base = zh.find((v) => v.lang === 'zh-CN') ?? zh[0];
      const utter = new SpeechSynthesisUtterance(text.slice(0, 500));
      if (base) utter.voice = base;
      utter.rate = rateStr ? Math.max(0.5, Math.min(2, 1 + (parseFloat(rateStr) || 0) / 100)) : 1;
      utter.pitch = pitchStr ? Math.max(0.5, Math.min(2, 1 + (parseFloat(pitchStr) || 0) / 50)) : 1;
      const clear = () => {
        if (currentKeyRef.current === key) {
          currentKeyRef.current = null;
          setPlayingKey(null);
        }
      };
      utter.onend = clear;
      utter.onerror = clear;
      currentKeyRef.current = key;
      setPlayingKey(key);
      window.speechSynthesis.speak(utter);
    },
    [ensureVoices],
  );

  const speak = useCallback(
    async (key: string, text: string, voice: string, rate?: string, pitch?: string) => {
      // 同一句再点：停止（含播放中 / 合成中两种情况）
      if (currentKeyRef.current === key || pendingKeyRef.current === key) {
        stop();
        return;
      }
      stop();
      pendingKeyRef.current = key;
      setBusyKey(key);
      try {
        // 引擎选择：MiMo（设置开启且成功）→ Edge → 系统语音兜底
        const audio = await synthesizeSpeech(text, voice, rate, pitch);
        // 合成期间用户已切到别的句/退出 → 丢弃过期结果
        if (pendingKeyRef.current !== key) return;
        pendingKeyRef.current = null;
        setBusyKey(null);
        playAudio(key, audio);
      } catch {
        if (pendingKeyRef.current !== key) return;
        // Edge 失败 → 系统语音兜底
        pendingKeyRef.current = null;
        setBusyKey(null);
        playSystem(key, text, voice, rate, pitch);
      }
    },
    [stop, playAudio, playSystem],
  );

  useEffect(() => stop, [stop]);

  return { speakingKey: playingKey, busyKey, speak, stop };
}
