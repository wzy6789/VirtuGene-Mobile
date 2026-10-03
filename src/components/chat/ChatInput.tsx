import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { useRipple } from '../../lib/ripple';
import { IS_MOBILE } from '../../lib/platform';
import { FontRuler } from '../ui/PhysicalInteractions';
import { VoiceMorphControl } from './VoiceMorphControl';
import { useSettingsStore } from '../../store/settings-store';

export interface ChatInputHandle {
  focus: () => void;
  setDraft: (text: string) => void;
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
  onStop?: () => void;
  /** 输入框聚焦（键盘弹起）时回调：父层滚动到最新消息（微信式：最后一条贴住输入框） */
  onFocusInput?: () => void;
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

/** Native recording gestures and the composer have independent lifecycles. */
export const ChatInput = forwardRef<ChatInputHandle, Props>(function ChatInput({ onSend, onSendImage, onSendVoice, disabled, onStop, onFocusInput }, ref) {
  const [text, setText] = useState('');
  const [showFontRuler, setShowFontRuler] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const ripple = useRipple();

  const [voiceActive, setVoiceActive] = useState(false);
  const [focused, setFocused] = useState(false);
  const fontSize = useSettingsStore(s => s.chatFontSize);
  const setFontSize = useSettingsStore(s => s.setChatFontSize);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus(),
    setDraft: (next) => {
      setText(next);
      requestAnimationFrame(() => {
        const el = inputRef.current;
        if (!el) return;
        el.focus();
        el.style.height = 'auto';
        el.style.height = Math.min(el.scrollHeight, 160) + 'px';
      });
    },
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

  useEffect(() => () => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    if (blurTimer.current) clearTimeout(blurTimer.current);
  }, []);

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
    // 输入法组合键（中文拼音选字）的 Enter 是"确认候选"，不应发送
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
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

  return (
    <div className="chat-composer relative border-t border-line p-3 sm:p-4" data-no-page-swipe data-no-back-swipe
      onFocusCapture={() => { if (blurTimer.current) clearTimeout(blurTimer.current); setFocused(true); }}
      onBlurCapture={e => {
        const host = e.currentTarget;
        // Touch-scrolling the ruler must not dismiss it when the keyboard stays open.
        blurTimer.current = setTimeout(() => { if (!host.contains(document.activeElement)) setFocused(false); }, 160);
      }}>
      {toast && <div role="status" className="absolute -top-12 left-3 right-3 z-50 glass-card rounded-2xl px-4 py-2 text-xs text-ink text-center shadow-lg">{toast}</div>}
      {IS_MOBILE && focused && showFontRuler && !voiceActive && <FontRuler value={fontSize} onChange={setFontSize} />}
      <div className={'chat-composer-inner flex items-end gap-2 max-w-3xl mx-auto ' + (voiceActive ? 'is-voice-active' : '')}>
        {IS_MOBILE && (onSendImage || onSendVoice) && <VoiceMorphControl disabled={disabled} onSend={onSendVoice}
          onImage={onSendImage ? () => fileRef.current?.click() : undefined} onActiveChange={setVoiceActive} onNotice={showToast} />}
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => void handlePickImage(e.target.files)} />
        <textarea ref={inputRef} value={text} onChange={handleInput} onKeyDown={handleKeyDown}
          onFocus={() => onFocusInput?.()} onClick={() => onFocusInput?.()}
          aria-label="消息内容" placeholder="发消息…" disabled={disabled || voiceActive} rows={1}
          style={{ fontSize: fontSize + 'px' }}
          className="chat-composer-input min-w-0 flex-1 resize-none bg-surface border border-line-strong rounded-xl px-4 py-3 text-sm text-ink placeholder-gray-500 outline-none focus:border-gene-purple transition-colors disabled:opacity-40" />
        {IS_MOBILE && focused && !voiceActive && <button type="button" aria-label="调整聊天字号" aria-expanded={showFontRuler} onClick={() => setShowFontRuler(value => !value)} className="min-h-11 w-11 shrink-0 text-xs text-sub">Aa</button>}
        <button type="button" aria-label={onStop ? '停止生成' : '发送消息'} onClick={onStop ?? handleSend} onPointerDown={onStop ? undefined : ripple.onPointerDown}
          data-generating={onStop ? 'true' : 'false'} title={onStop ? '停止本次回复' : undefined}
          disabled={!onStop && (disabled || voiceActive || !text.trim())}
          className="chat-composer-send ripple-host shrink-0 w-10 h-10 rounded-xl bg-gene-purple text-white flex items-center justify-center transition-all disabled:opacity-30">
          <span className="vg-composer-icon is-send" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m22 2-11 11M22 2l-7 20-4-9-9-4 20-7Z" /></svg></span>
          <span className="vg-composer-icon is-stop" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 16 16"><rect x="3" y="3" width="10" height="10" rx="2" fill="currentColor" /></svg></span>
        </button>
      </div>
    </div>
  );
});
