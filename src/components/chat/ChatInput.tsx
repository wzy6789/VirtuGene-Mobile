import { useState, useRef, useCallback, useEffect, forwardRef, useImperativeHandle } from 'react';
import { useRipple } from '../../lib/ripple';
import { IS_MOBILE } from '../../lib/platform';

export interface ChatInputHandle {
  focus: () => void;
}

interface Props {
  onSend: (text: string) => void;
  /** 发送图片消息（压缩后的 dataURL）；手机端「+」按钮触发 */
  onSendImage?: (dataUrl: string) => void;
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

export const ChatInput = forwardRef<ChatInputHandle, Props>(function ChatInput({ onSend, onSendImage, disabled }, ref) {
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const ripple = useRipple();

  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus(),
  }));

  // Auto-focus on mount（手机端不自动聚焦：由用户自行点击输入框进入聊天状态）
  useEffect(() => {
    if (IS_MOBILE) return;
    // Small delay to ensure DOM is fully settled
    const timer = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(timer);
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

  return (
    <div className="border-t border-line p-4">
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
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => void handlePickImage(e.target.files)}
        />
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
      </div>
    </div>
  );
});
