import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { useRipple } from '../../lib/ripple';
import { IS_MOBILE, IS_CAPACITOR } from '../../lib/platform';
import { AudioRecorder } from '../../lib/recorder';
import { isSpeechAvailable, ensureRecordPermission, startSpeechRecognition, stopSpeechRecognition, cancelSpeechRecognition } from '../../lib/speech-recognition';

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
/** 上滑取消阈值（px） */
const CANCEL_OFFSET = 60;

export const ChatInput = forwardRef<ChatInputHandle, Props>(function ChatInput({ onSend, onSendImage, onSendVoice, disabled }, ref) {
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const ripple = useRipple();

  // 语音（按住说话）
  const [voiceMode, setVoiceMode] = useState(false);
  const [recState, setRecState] = useState<'idle' | 'recording' | 'canceling' | 'converting'>('idle');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [level, setLevel] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const recorderRef = useRef<AudioRecorder | null>(null);
  const startYRef = useRef(0);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const maxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus(),
  }));

  const showToast = (msg: string, ms = 1800) => {
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

  /** 切换「按住说话」模式：先检查环境与麦克风权限 */
  const toggleVoiceMode = async () => {
    if (voiceMode) {
      setVoiceMode(false);
      return;
    }
    if (!onSendVoice) return;
    // 浏览器预览（非 App）没有原生语音识别
    if (!IS_CAPACITOR) {
      showToast('语音功能需安装 App 使用（浏览器预览不支持）', 2400);
      return;
    }
    const granted = await ensureRecordPermission();
    if (!granted) {
      showToast('需要麦克风权限才能发语音（请在系统设置中允许）', 2400);
      return;
    }
    // 手机是否有系统语音识别引擎（部分精简 ROM / 关闭了语音输入的设备没有）
    const available = await isSpeechAvailable();
    if (!available) {
      showToast('手机未检测到系统语音识别，请用键盘输入', 2400);
      return;
    }
    setVoiceMode(true);
  };

  /** 发送路径（松手 ≥1s / 60s 自动到点） */
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
    const [result, text] = await Promise.all([r?.stop() ?? Promise.resolve(null), stopSpeechRecognition()]);
    setRecState('idle');
    setLevel(0);
    if (!result || !text) {
      // 区分：录音失败 / 没听清 / 设备没有识别引擎，给准确提示
      let msg = '没听清，请再说一次';
      if (!result) msg = '录音失败';
      else if (!text) {
        const avail = await isSpeechAvailable();
        msg = avail ? '没听清，请再说一次' : '手机未检测到系统语音识别，请用键盘输入';
      }
      showToast(msg, 2000);
      return;
    }
    onSendVoice?.({ dataUrl: result.dataUrl, duration: result.durationSec, text });
  };

  const startRecording = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || recState !== 'idle') return;
    e.preventDefault();
    const r = new AudioRecorder();
    recorderRef.current = r;
    startYRef.current = e.clientY;
    setRecState('recording');
    setElapsedMs(0);
    setLevel(0);
    setToast(null);
    try {
      navigator.vibrate?.(15);
    } catch {
      /* ignore */
    }
    void startSpeechRecognition(); // 并行识别（失败也能录音，转文字为空时提示重说）
    void r
      .start((lv) => setLevel(lv))
      .catch(() => {
        if (recorderRef.current === r) showToast('无法使用麦克风');
      });
    elapsedTimerRef.current = setInterval(() => setElapsedMs(r.elapsedMs), 100);
    maxTimerRef.current = setTimeout(() => void finishAndSend(), MAX_RECORD_MS);
  };

  const moveRecording = (e: React.PointerEvent<HTMLDivElement>) => {
    if (recState !== 'recording' && recState !== 'canceling') return;
    const dy = e.clientY - startYRef.current;
    if (dy < -CANCEL_OFFSET) setRecState('canceling');
    else if (dy > -CANCEL_OFFSET * 0.4) setRecState('recording');
  };

  const endRecording = () => {
    if (recState !== 'recording' && recState !== 'canceling') return;
    if (recState === 'canceling') {
      recorderRef.current?.cancel();
      void cancelSpeechRecognition();
      if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
      if (maxTimerRef.current) clearTimeout(maxTimerRef.current);
      setRecState('idle');
      setLevel(0);
      return;
    }
    void finishAndSend();
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
  const canceling = recState === 'canceling';

  return (
    <div className="relative border-t border-line p-4">
      {/* 输入区浮动提示（模式切换失败/语音反馈，两种模式都可见） */}
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
            disabled={disabled}
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
        {/* 手机端「按住说话」切换（微信式：再点切回键盘） */}
        {IS_MOBILE && onSendVoice && (
          <button
            onClick={() => void toggleVoiceMode()}
            disabled={disabled}
            title={voiceMode ? '切回键盘' : '按住说话'}
            className={`shrink-0 w-10 h-10 rounded-xl border flex items-center justify-center transition-colors disabled:opacity-40 ${
              voiceMode ? 'bg-gene-purple/15 border-gene-purple/40 text-gene-purple' : 'bg-surface border-line text-gray-500 hover:text-ink'
            }`}
          >
            {voiceMode ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="6" width="20" height="12" rx="2" />
                <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h.01M18 14h.01" />
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

        {voiceMode && onSendVoice ? (
          /* 按住说话条 */
          <div
            onPointerDown={startRecording}
            onPointerMove={moveRecording}
            onPointerUp={endRecording}
            onPointerCancel={endRecording}
            className={`flex-1 h-11 rounded-xl border flex items-center justify-center text-sm select-none touch-none transition-colors ${
              recording || canceling
                ? 'bg-gene-purple/10 border-gene-purple/40 text-gene-purple'
                : 'bg-surface border-line-strong text-gray-500'
            } ${disabled ? 'opacity-40' : 'active:bg-surface-strong'}`}
          >
            {recording ? (
              <span className="flex items-center gap-2">
                <VoiceBars level={level} />
                <span className="tabular-nums">{fmtDuration(elapsedMs)}</span>
                <span className="text-xs text-gray-400">松开 发送 · 上滑 取消</span>
              </span>
            ) : canceling ? (
              <span className="flex items-center gap-1.5 text-red-400">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
                松开 取消
              </span>
            ) : recState === 'converting' ? (
              <span className="flex items-center gap-2 text-xs text-gray-400">
                <span className="w-3.5 h-3.5 rounded-full border-2 border-gray-300 border-t-life-cyan animate-spin" />
                转文字中…
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="2" width="6" height="12" rx="3" />
                  <path d="M5 10v1a7 7 0 0 0 14 0v-1" />
                  <line x1="12" y1="18" x2="12" y2="22" />
                </svg>
                按住 说话
              </span>
            )}
          </div>
        ) : (
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
        )}
        {!voiceMode && (
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
