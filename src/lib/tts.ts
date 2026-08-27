import { useCallback, useEffect, useRef, useState } from 'react';
import { edgeTTSSynthesize } from './edge-tts';

/**
 * TTS 播放控制（手机版）：用户主动点击才发声，绝不自动朗读。
 * 主实现：Edge-TTS 直连（WebSocket，微软神经网络音色，与桌面同款声线）
 * 兜底：Edge 失败（断网/接口变动/服务端拒绝）→ 回退系统语音（speechSynthesis）
 * 同一时刻只播一句（播新句自动停旧句）。
 */
export function useTTS() {
  const [playingKey, setPlayingKey] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const currentKeyRef = useRef<string | null>(null);
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

  /** 系统语音兜底 */
  const playSystem = useCallback((key: string, text: string, voiceKeyword?: string, rateStr?: string, pitchStr?: string) => {
    if (!('speechSynthesis' in window)) return;
    const utter = new SpeechSynthesisUtterance(text.slice(0, 500));
    const voices = window.speechSynthesis.getVoices();
    const zh = voices.filter((v) => v.lang.toLowerCase().startsWith('zh'));
    const base = zh.find((v) => v.lang === 'zh-CN') ?? zh[0];
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
  }, []);

  const speak = useCallback(
    async (key: string, text: string, voice: string, rate?: string, pitch?: string) => {
      if (currentKeyRef.current === key) {
        stop();
        return;
      }
      stop();
      setBusyKey(key);
      try {
        const audio = await edgeTTSSynthesize(text, { voice, rate: rate ?? '+0%', pitch: pitch ?? '+0Hz' });
        if (audio.byteLength === 0) throw new Error('empty audio');
        setBusyKey(null);
        playAudio(key, audio);
      } catch {
        // Edge 失败 → 系统语音兜底
        setBusyKey(null);
        playSystem(key, text, voice, rate, pitch);
      }
    },
    [stop, playAudio, playSystem],
  );

  useEffect(() => stop, [stop]);

  return { speakingKey: playingKey, busyKey, speak, stop };
}
