import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { useRipple } from '../../lib/ripple';
import { IS_MOBILE, IS_CAPACITOR } from '../../lib/platform';
import { AudioRecorder } from '../../lib/recorder';
import { isSpeechAvailable, ensureRecordPermission, startSpeechRecognition, stopSpeechRecognition, cancelSpeechRecognition } from '../../lib/speech-recognition';
import { loadSecret } from '../../lib/api-key-storage';
import { transcribeWithSiliconFlow, CLOUD_ASR_KEY_NAME } from '../../lib/cloud-asr';

export interface ChatInputHandle {
  focus: () => void;
}

export interface VoicePayload {
  dataUrl: string;
  duration: number;
  text: string;
}

interface Props {
  onSend: (text: string) => void;
  /** 发送图片消息（压缩后的 dataURL）；手机端「+」按钮触发 */
  onSendImage?: (dataUrl: string) => void;
  /** 发送语音消息（微信式：录音 dataURL + 时长 + 转文字；AI 通过 text 理解） */
  onSendVoice?: (voice: VoicePayload) => void;
  disabled?: boolean;
}

/** 图片压缩：dataURL → canvas 缩放（最大边 1280）+ JPEG 0.82，减少 IndexedDB 占用 */
function compressImage(dataUrl: string): Promise<string> {
  return new Promise((resolve) => {
    try {
      const img = new Image();
      img.onload = () => {
        try {
          const MAX_EDGE = 1280;
          const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
          const w = Math.max(1, Math.round(img.width * scale));
          const h = Math.max(1, Math.round(img.height * scale));
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (!ctx) { resolve(dataUrl); return; }
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', 0.82));
        } catch {
          resolve(dataUrl);
        }
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    } catch {
      resolve(dataUrl);
    }
  });
}

/** 录音中的声波条（电平驱动高度） */
function VoiceBars({ level }: { level: number }) {
  const base = [0.45, 0.85, 0.6, 1, 0.7];
  return (
    <span className="flex items-end gap-[2px] h-4">
      {base.map((h, i) => (
        <span
          key={i}
          className="w-[3px] rounded-full bg-gene-purple transition-[height] duration-75"
          style={{ height: `${Math.max(4, Math.min(16, (h + level * 0.9) * 14))}px` }}
        />
      ))}
    </span>
  );
}

function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** 语音最长 60s（微信式） */
const MAX_RECORD_MS = 60_000;

/**
 * 输入区：文字 / 图片 / 语音（DeepSeek 式：点话筒直接开始录音，再点停止发送）。
 * 语音转文字：系统识别优先 → 云端（SiliconFlow，需在「我的 → 设置」填 Key）兜底。
 */
export const ChatInput = forwardRef<ChatInputHandle, Props>(function ChatInput({ onSend, onSendImage, onSendVoice, disabled }, ref) {
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const ripple = useRipple();

  // 语音（点击即录）
  const [recState, setRecState] = useState<'idle' | 'recording' | 'converting'>('idle');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [level, setLevel] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const recorderRef = useRef<AudioRecorder | null>(null);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const maxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus(),
  }));

  const showToast = (msg: string, ms = 2000) => {
    setToast(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), ms);
  };

  // Auto-focus on mount（手机端不自动聚焦：由用户自行点击输入框进入聊天状态）
  useEffect(() => {
    if (IS_MOBILE) return;
    const timer = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, []);

  // 卸载时清理录音/识别/定时器
  useEffect(
    () => () => {
      recorderRef.current?.cancel();
      void cancelSpeechRecognition();
      if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
      if (maxTimerRef.current) clearTimeout(maxTimerRef.current);
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    },
    [],
  );

  /** 开始录音 + 并行识别（先拿到麦克风录音，再启动识别，避免识别抢占麦克风） */
  const startRecording = async () => {
    const r = new AudioRecorder();
    recorderRef.current = r;
    setRecState('recording');
    setElapsedMs(0);
    setLevel(0);
    setToast(null);
    try {
      await r.start((lv) => setLevel(lv));
    } catch (err) {
      // 录音启动失败：细分原因给准确提示（原生插件错误信息优先）
      const name = (err as DOMException)?.name;
      const rawMsg = (err as Error)?.message;
      if (name === 'NotAllowedError') showToast('麦克风权限被拒绝，请在系统设置中允许', 2600);
      else if (name === 'NotReadableError') showToast('麦克风被占用（如正在录屏/通话），请稍后重试', 2600);
      else showToast(rawMsg || '无法使用麦克风，请重试', 2600);
      setRecState('idle');
      setLevel(0);
      return;
    }
    try {
      navigator.vibrate?.(15);
    } catch {
      /* ignore */
    }
    // 录音已就绪后再启动系统识别（识别失败静默，转文字走云端/提示）
    void startSpeechRecognition();
    elapsedTimerRef.current = setInterval(() => setElapsedMs(r.elapsedMs), 100);
    maxTimerRef.current = setTimeout(() => void finishAndSend(), MAX_RECORD_MS);
  };

  /** 停止并发送（转文字：系统 → 云端兜底） */
  const finishAndSend = async () => {
    const r = recorderRef.current;
    if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
    if (maxTimerRef.current) clearTimeout(maxTimerRef.current);
    const ms = r?.elapsedMs ?? 0;
    if (ms < 1000) {
      r?.cancel();
      void cancelSpeechRecognition();
      setRecState('idle');
      showToast('说话时间太短');
      return;
    }
    setRecState('converting');
    const [result, sysText] = await Promise.all([r?.stop() ?? Promise.resolve(null), stopSpeechRecognition()]);
    // 系统识别无结果 → 尝试云端识别（「我的 → 设置 → 语音」填了 SiliconFlow Key 时）
    const cloudKey = await loadSecret(CLOUD_ASR_KEY_NAME);
    let text = sysText;
    if (result && !text && cloudKey) {
      try {
        text = await transcribeWithSiliconFlow(result.dataUrl, cloudKey);
      } catch {
        /* 云端失败：落入下方精确提示 */
      }
    }
    setRecState('idle');
    setLevel(0);
    if (!result || !text) {
      // 区分：录音失败 / 没听清 / 无识别引擎（分「没填云端 key」与「填了但云端失败」）
      let msg = '没听清，请再说一次';
      if (!result) {
        msg = '录音失败';
      } else if (!text) {
        const avail = await isSpeechAvailable();
        if (avail) {
          msg = '没听清，请再说一次';
        } else {
          msg = cloudKey
            ? '语音识别失败（云端），请重试或在「我的 → API Key → 硅基」检查 Key'
            : '手机无系统语音识别：在「我的 → 设置 → 语音」填云端识别 Key 后可发语音';
        }
      }
      showToast(msg, 3000);
      return;
    }
    onSendVoice?.({ dataUrl: result.dataUrl, duration: result.durationSec, text });
  };

  /** 取消录音（丢弃） */
  const cancelRecording = () => {
    recorderRef.current?.cancel();
    void cancelSpeechRecognition();
    if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
    if (maxTimerRef.current) clearTimeout(maxTimerRef.current);
    setRecState('idle');
    setLevel(0);
  };

  /** 点话筒：空闲 → 开始录音；录音中 → 停止发送 */
  const handleMicClick = async () => {
    if (disabled) return;
    if (recState === 'recording') {
      await finishAndSend();
      return;
    }
    if (recState !== 'idle') return;
    if (!IS_CAPACITOR) {
      showToast('语音功能需安装 App 使用（浏览器预览不支持）', 2400);
      return;
    }
    const granted = await ensureRecordPermission();
    if (!granted) {
      showToast('需要麦克风权限才能发语音（请在系统设置中允许）', 2400);
      return;
    }
    void startRecording();
  };

  // Re-focus after sending（手机端不自动重新聚焦）
  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setText('');
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      if (!IS_MOBILE) inputRef.current.focus();
    }
  }, [text, disabled, onSend]);

  /** 选择图片 → 压缩 → 发送 */
  const handlePickImage = async (files: FileList | null) => {
    const f = files?.[0];
    if (!f || !f.type.startsWith('image/') || !onSendImage) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const compressed = await compressImage(reader.result as string);
      onSendImage(compressed);
    };
    reader.readAsDataURL(f);
    if (fileRef.current) fileRef.current.value = '';
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
  };

  const recording = recState === 'recording';

  return (
    <div className="relative border-t border-line p-4">
      {/* 输入区浮动提示 */}
      {toast && (
        <div className="absolute -top-9 left-1/2 -translate-x-1/2 z-50 glass-card rounded-full px-4 py-1.5 text-xs text-ink animate-fade-in whitespace-nowrap shadow-lg">
          {toast}
        </div>
      )}
      <div className="flex items-end gap-2 max-w-3xl mx-auto">
        {/* 手机端「+」：相册发图（微信式） */}
        {IS_MOBILE && onSendImage && (
          <button
            onClick={() => fileRef.current?.click()}
            onPointerDown={ripple.onPointerDown}
            disabled={disabled || recState !== 'idle'}
            title="发送图片"
            className="ripple-host shrink-0 w-10 h-10 rounded-xl bg-surface border border-line text-gray-500 flex items-center justify-center hover:text-ink transition-colors disabled:opacity-40"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <path d="m21 15-5-5L5 21" />
            </svg>
          </button>
        )}
        {/* 手机端话筒：点一下直接开始录音，再点停止发送（DeepSeek 式） */}
        {IS_MOBILE && onSendVoice && (
          <button
            onClick={() => void handleMicClick()}
            disabled={disabled || recState === 'converting'}
            title={recording ? '点击停止并发送' : '按住说话'}
            className={`shrink-0 w-10 h-10 rounded-xl border flex items-center justify-center transition-colors disabled:opacity-40 ${
              recording
                ? 'bg-red-500/15 border-red-500/40 text-red-500 animate-pulse'
                : 'bg-surface border-line text-gray-500 hover:text-ink'
            }`}
          >
            {recording ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <rect x="7" y="7" width="10" height="10" rx="2" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="2" width="6" height="12" rx="3" />
                <path d="M5 10v1a7 7 0 0 0 14 0v-1" />
                <line x1="12" y1="18" x2="12" y2="22" />
              </svg>
            )}
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => void handlePickImage(e.target.files)}
        />

        {recState === 'idle' ? (
          <textarea
            ref={inputRef}
            value={text}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder="发消息…"
            disabled={disabled}
            rows={1}
            className="flex-1 resize-none bg-surface border border-line-strong rounded-xl px-4 py-3 text-sm text-ink placeholder-gray-500 outline-none focus:border-gene-purple focus:shadow-[0_0_0_3px_rgba(108,92,231,0.14),0_0_18px_rgba(108,92,231,0.22)] transition-all disabled:opacity-40"
          />
        ) : (
          /* 录音状态条：声波 + 计时，点击停止发送 */
          <div
            onClick={() => {
              if (recording) void finishAndSend();
            }}
            className={`flex-1 h-11 rounded-xl border flex items-center justify-center text-sm select-none transition-colors ${
              recording
                ? 'bg-red-500/10 border-red-500/40 text-red-500'
                : 'bg-surface border-line-strong text-gray-400'
            }`}
          >
            {recording ? (
              <span className="flex items-center gap-2">
                <VoiceBars level={level} />
                <span className="tabular-nums">{fmtDuration(elapsedMs)}</span>
                <span className="text-xs text-gray-400">点击停止发送</span>
              </span>
            ) : (
              <span className="flex items-center gap-2 text-xs">
                <span className="w-3.5 h-3.5 rounded-full border-2 border-gray-300 border-t-life-cyan animate-spin" />
                转文字中…
              </span>
            )}
          </div>
        )}
        {recState === 'recording' ? (
          /* 录音中：取消按钮（丢弃） */
          <button
            onClick={cancelRecording}
            title="取消"
            className="shrink-0 w-10 h-10 rounded-xl bg-surface border border-line text-gray-500 flex items-center justify-center hover:text-red-400 transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        ) : recState === 'converting' ? (
          <div className="shrink-0 w-10" />
        ) : (
          <button
            onClick={handleSend}
            onPointerDown={ripple.onPointerDown}
            disabled={disabled || !text.trim()}
            className="ripple-host shrink-0 w-10 h-10 rounded-xl bg-gene-purple text-white flex items-center justify-center hover:bg-[#5B4BD4] shadow-[0_2px_12px_rgba(108,92,231,0.35)] transition-all disabled:opacity-30 disabled:shadow-none"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
});
