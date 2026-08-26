import { useState, useRef, useCallback, useEffect, forwardRef, useImperativeHandle } from 'react';
import { useRipple } from '../../lib/ripple';
import { IS_MOBILE } from '../../lib/platform';

export interface ChatInputHandle {
  focus: () => void;
}

interface Props {
  onSend: (text: string) => void;
  disabled?: boolean;
}

export const ChatInput = forwardRef<ChatInputHandle, Props>(function ChatInput({ onSend, disabled }, ref) {
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
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
      <div className="flex items-end gap-3 max-w-3xl mx-auto">
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