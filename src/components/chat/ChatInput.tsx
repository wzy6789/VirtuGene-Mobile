import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { SoulOrb } from '../ui/SoulOrb';
import { animateVisual } from '../../lib/ui-visual-motion';
import { useFeedback } from '../../lib/feedback';
import { useRipple } from '../../lib/ripple';
import { IS_MOBILE } from '../../lib/platform';
import { VoiceMorphControl } from './VoiceMorphControl';
import { useSettingsStore } from '../../store/settings-store';
import { readChatComposerDraft, writeChatComposerDraft } from '../../lib/chat-composer-drafts';
import { useAuthStore } from '../../store/auth-store';

export interface ChatInputHandle {
  focus: () => void;
  setDraft: (text: string) => void;
}

export interface VoicePayload {
  dataUrl: string;
  duration: number;
  text: string;
}

/** Keep the conversation visible even when a short viewport is reduced by IME. */
function resizeComposerInput(input: HTMLTextAreaElement | null) {
  if (!input) return;
  input.style.height = 'auto';
  const limit = Math.min(160,Math.max(80,(window.visualViewport?.height??window.innerHeight)*.28));
  if (input.value) input.style.height = Math.min(input.scrollHeight + input.offsetHeight - input.clientHeight, limit) + 'px';
}

interface Props {
  draftOwnerId?: string;
  draftSessionId?: string;
  onSend: (text: string) => void;
  /** 发送图片消息（压缩后的 dataURL）；手机端「+」按钮触发 */
  onSendImage?: (dataUrl: string) => void;
  /** 发送语音消息（微信式：录音 dataURL + 时长 + 转文字；AI 通过 text 理解） */
  onSendVoice?: (voice: VoicePayload) => void;
  disabled?: boolean;
  /** Previous cancelled work still owns the write lock; editing stays available. */
  sendBlocked?: boolean;
  onStop?: () => void;
  /** Recheck keyboard layout while respecting whether history is being read. */
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
export const ChatInput = forwardRef<ChatInputHandle, Props>(function ChatInput({ draftOwnerId, draftSessionId, onSend, onSendImage, onSendVoice, disabled, sendBlocked, onStop, onFocusInput }, ref) {
  const [text, setText] = useState(() => readChatComposerDraft(draftOwnerId, draftSessionId));
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const alive = useRef(true);
  const updateText = useCallback((next: string) => {
    setText(next);
    writeChatComposerDraft(draftOwnerId, draftSessionId, next);
  }, [draftOwnerId, draftSessionId]);
  useLayoutEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  const composing = useRef(false);
  const sendOrb = useRef<HTMLSpanElement>(null);
  const sendAnimation = useRef<() => void>(() => {});
  useEffect(() => () => sendAnimation.current(), []);
  const fileRef = useRef<HTMLInputElement>(null);
  const ripple = useRipple();

  const [voiceActive, setVoiceActive] = useState(false);
  const fontSize = useSettingsStore(s => s.chatFontSize);
  useLayoutEffect(() => {
    const resize=()=>resizeComposerInput(inputRef.current);resize();
    const target=window.visualViewport??window;target.addEventListener('resize',resize);
    return()=>target.removeEventListener('resize',resize);
  }, [fontSize, voiceActive]);
  const showToast = useFeedback();
  const imageGeneration=useRef(0), imageReader=useRef<FileReader | null>(null);
  const imageTarget=useRef({draftOwnerId,draftSessionId,disabled,sendBlocked,onSendImage});
  imageTarget.current={draftOwnerId,draftSessionId,disabled,sendBlocked,onSendImage};
  useLayoutEffect(()=>{
    imageGeneration.current++;
    imageReader.current?.abort();imageReader.current=null;
    return()=>{imageGeneration.current++;imageReader.current?.abort();imageReader.current=null;};
  },[draftOwnerId,draftSessionId,disabled,sendBlocked]);
  useEffect(()=>useAuthStore.subscribe((next,previous)=>{
    if(next.userId!==previous.userId){imageGeneration.current++;imageReader.current?.abort();imageReader.current=null;}
  }),[]);

  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus(),
    setDraft: (next) => {
      updateText(next);
      requestAnimationFrame(() => {
        const el = inputRef.current;
        if (!el) return;
        el.focus();
        resizeComposerInput(el);
      });
    },
  }));

  // Auto-focus on mount（手机端不自动聚焦：由用户自行点击输入框进入聊天状态）
  useEffect(() => {
    if (IS_MOBILE) return;
    const timer = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, []);

  // Re-focus after sending（手机端不自动重新聚焦）
  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || disabled || sendBlocked) return;
    onSend(trimmed);
    sendAnimation.current();
    sendAnimation.current = animateVisual(sendOrb.current, [{opacity:0,transform:'scale(.75)'},{opacity:1,transform:'scale(1)',offset:.35},{opacity:0,transform:'scale(1.12)'}], 320);
    updateText('');
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      if (!IS_MOBILE) inputRef.current.focus();
    }
  }, [text, disabled, sendBlocked, onSend, updateText]);

  /** 选择图片 → 压缩 → 发送 */
  const handlePickImage = async (files: FileList | null) => {
    const f = files?.[0];
    if (!f || !f.type.startsWith('image/') || !onSendImage || disabled || sendBlocked) return;
    const token=++imageGeneration.current;
    imageReader.current?.abort();
    const owner=useAuthStore.getState().userId;
    const current=()=>{
      const target=imageTarget.current;
      return alive.current&&imageGeneration.current===token&&!target.disabled&&!target.sendBlocked
        &&target.draftOwnerId===draftOwnerId&&target.draftSessionId===draftSessionId
        &&useAuthStore.getState().userId===owner&&(!draftOwnerId||draftOwnerId===owner);
    };
    const reader = new FileReader();
    imageReader.current=reader;
    const finish=()=>{if(imageReader.current===reader)imageReader.current=null;};
    reader.onerror=()=>{if(current())showToast('图片暂时没能读取，请重新选择。');finish();};
    reader.onabort=finish;
    reader.onload = async () => {
      if (!current()) {finish();return;}
      const compressed = await compressImage(reader.result as string);
      if (current()) imageTarget.current.onSendImage?.(compressed);
      finish();
    };
    try {reader.readAsDataURL(f);} catch {if(current())showToast('图片暂时没能读取，请重新选择。');finish();}
    if (fileRef.current) fileRef.current.value = '';
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // 输入法组合键（中文拼音选字）的 Enter 是"确认候选"，不应发送
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && !composing.current && e.keyCode !== 229) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    updateText(e.target.value);
    resizeComposerInput(e.target);
  };

  return (
    <div className="chat-composer relative border-t border-line p-3 sm:p-4" data-no-page-swipe data-no-back-swipe>
      <div className={'chat-composer-inner flex items-end gap-2 max-w-3xl mx-auto ' + (voiceActive ? 'is-voice-active' : '')}>
        {IS_MOBILE && (onSendImage || onSendVoice) && <VoiceMorphControl disabled={disabled || sendBlocked} onSend={onSendVoice}
          onImage={onSendImage ? () => fileRef.current?.click() : undefined} onActiveChange={setVoiceActive} onNotice={showToast} />}
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => void handlePickImage(e.target.files)} />
        <textarea ref={inputRef} value={text} onChange={handleInput} onKeyDown={handleKeyDown}
          onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
          onFocus={() => onFocusInput?.()} onClick={() => onFocusInput?.()}
          aria-label="消息内容" placeholder="发消息…" disabled={disabled || voiceActive} rows={1}
            style={{ fontSize: `max(${fontSize}px,var(--vg-chat-input-scale,1rem))` }}
          className="vg-text-field chat-composer-input min-w-0 flex-1 resize-none disabled:opacity-40" />
        <button type="button" aria-label={onStop ? '停止生成' : '发送消息'} onClick={onStop ?? handleSend} onPointerDown={onStop ? undefined : ripple.onPointerDown}
          data-generating={onStop ? 'true' : 'false'} title={onStop ? '停止本次回复' : undefined}
          disabled={!onStop && (disabled || sendBlocked || voiceActive || !text.trim())}
          className="chat-composer-send ripple-host disabled:opacity-30">
          <span ref={sendOrb} className="vg-send-orb" aria-hidden="true"><SoulOrb size={28} emotion="happy" animated={false} /></span>
          <span className="vg-composer-icon is-send" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m22 2-11 11M22 2l-7 20-4-9-9-4 20-7Z" /></svg></span>
          <span className="vg-composer-icon is-stop" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 16 16"><rect x="3" y="3" width="10" height="10" rx="2" fill="currentColor" /></svg></span>
        </button>
      </div>
      {sendBlocked && <p role="status" className="text-xs text-sub mt-2">上一条消息正在收尾，可继续编辑。</p>}
    </div>
  );
});
