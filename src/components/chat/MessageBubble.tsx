import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Message } from '../../db/index';
import { Avatar } from '../ui/Avatar';
import { ipc } from '../../lib/ipc-client';

/* ---- 语音播放（模块级单例：同一时刻只播一条，微信式） ---- */
let activeVoice: { id: string; audio: HTMLAudioElement; onEnd: () => void } | null = null;

function stopActiveVoice() {
  if (activeVoice) {
    const { audio, onEnd } = activeVoice;
    activeVoice = null;
    audio.pause();
    onEnd();
  }
}

/** 点击语音气泡：同一条切换播放/停止；不同条先停旧的再播新的 */
function toggleVoice(id: string, dataUrl: string, onStart: () => void, onEnd: () => void) {
  if (activeVoice?.id === id) {
    stopActiveVoice();
    return;
  }
  stopActiveVoice();
  const audio = new Audio(dataUrl);
  activeVoice = { id, audio, onEnd };
  audio.onended = () => {
    if (activeVoice?.id === id) {
      activeVoice = null;
      onEnd();
    }
  };
  audio.onerror = () => {
    if (activeVoice?.id === id) {
      activeVoice = null;
      onEnd();
    }
  };
  onStart();
  void audio.play();
}

/** 语音波形条（由消息 id 稳定生成，播放中放大跳动） */
function WaveBars({ seed, active }: { seed: string; active: boolean }) {
  const bars = useMemo(() => {
    let h = 5381;
    const arr: number[] = [];
    for (let i = 0; i < 20; i++) {
      h = ((h << 5) + h + seed.charCodeAt(i % seed.length)) >>> 0;
      arr.push(3 + (h % 8));
    }
    return arr;
  }, [seed]);
  return (
    <span className={`flex items-center gap-[2px] h-7 transition-opacity ${active ? 'opacity-100' : 'opacity-85'}`}>
      {bars.map((b, i) => (
        <span
          key={i}
          className={`w-[3px] rounded-full transition-all ${active ? 'bg-white animate-pulse' : 'bg-white/85'}`}
          style={{ height: `${active ? b * 1.5 + 2 : b}px`, animationDelay: `${(i % 6) * 90}ms` }}
        />
      ))}
    </span>
  );
}

interface Props {
  message: Message;
  avatar: string;
  animate?: boolean;
  /** 是否为会话最新一条消息（触发一次性光晕扫过） */
  isLatest?: boolean;
  onQuote?: (message: Message) => void;
  onDelete?: (message: Message) => void;
  onRetry?: (message: Message) => void;
  /** TTS 朗读（仅 AI 消息；用户主动点击才发声） */
  onSpeak?: (message: Message) => void;
  /** 本条消息的朗读键（消息 id） */
  speakKey?: string | null;
  speakingKey?: string | null;
  busyKey?: string | null;
  /** 角色当前心情小表情（仅 AI 消息；显示在气泡角上） */
  moodEmoji?: string;
  /** 长按菜单"记住"：把消息存进角色记忆 */
  onRemember?: (message: Message) => void;
}

export function MessageBubble({ message, avatar, animate, isLatest, onQuote, onDelete, onRetry, onSpeak, speakKey, speakingKey, busyKey, moodEmoji, onRemember }: Props) {
  const isUser = message.role === 'user';
  const [copied, setCopied] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [voicePlaying, setVoicePlaying] = useState(false);
  /** AI 语音消息：转文字是否展开 */
  const [showTranscript, setShowTranscript] = useState(false);

  useEffect(() => {
    if (!menu) return;
    const handler = () => {
      setMenu(null);
      setConfirmDelete(false);
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [menu]);

  const handleCopy = async () => {
    if (copied) return;
    await ipc.clipboard.writeText(message.content);
    setCopied(true);
    setMenu(null);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY });
  };

  return (
    <div className={`group flex items-start gap-2 mb-4 ${isUser ? 'flex-row-reverse' : 'flex-row'} ${
      animate ? 'animate-message-in' : ''
    }`}>
      <Avatar avatar={avatar} size="sm" />
      {isUser && message.failed && (
        <button
          onClick={() => onRetry?.(message)}
          title="发送失败，点击重发"
          className="shrink-0 w-6 h-6 flex items-center justify-center rounded-full text-red-400 hover:bg-red-500/10 transition-colors"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </button>
      )}
      <div className="relative max-w-[75%]">
        {/* 角色当前心情小表情（AI 消息，气泡角上） */}
        {!isUser && moodEmoji && (
          <span className="absolute -top-2 -right-1.5 text-[11px] leading-none select-none">{moodEmoji}</span>
        )}
        <div
          onContextMenu={handleContextMenu}
          className={`px-4 py-3 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap break-words transition-shadow ${
            isLatest && !isUser ? 'animate-message-sweep' : ''
          } ${
            isUser
              ? 'bg-gradient-to-br from-gene-purple to-[#5B4BD4] text-white rounded-br-md shadow-[0_4px_16px_rgba(108,92,231,0.30)]'
              : 'bg-msgai text-msgaitxt rounded-bl-md border-l-2 border-life-cyan shadow-[0_2px_10px_rgba(0,206,201,0.08)]'
          }`}
        >
          {message.replyToContent && (
            <div
              className={`text-xs mb-1.5 line-clamp-1 border-l-2 pl-2 ${
                isUser ? 'border-white/40 text-white/70' : 'border-gray-300 text-gray-500'
              }`}
            >
              {message.replyToContent}
            </div>
          )}
          {message.image && (
            <img
              src={message.image}
              alt="图片"
              onClick={(e) => {
                e.stopPropagation();
                setPreviewImage(message.image!);
              }}
              className={`max-w-[220px] max-h-[260px] rounded-xl object-cover cursor-zoom-in ${
                message.content ? 'mb-2' : ''
              }`}
            />
          )}
          {message.audio ? (
            /* 微信式语音消息：波形 + 时长 + 点击播放；AI 语音合成中显示占位，不闪文字 */
            <div>
              {message.audio.dataUrl ? (
                <div
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleVoice(
                      message.id,
                      message.audio!.dataUrl,
                      () => setVoicePlaying(true),
                      () => setVoicePlaying(false),
                    );
                  }}
                  className={`flex items-center gap-2.5 cursor-pointer select-none py-0.5 ${
                    isUser ? 'text-white' : 'text-ink'
                  }`}
                >
                  {voicePlaying ? (
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" className="shrink-0">
                      <rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" />
                    </svg>
                  ) : (
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" className="shrink-0">
                      <polygon points="6 3 20 12 6 21 6 3" />
                    </svg>
                  )}
                  <WaveBars seed={message.id} active={voicePlaying} />
                  <span className="text-xs tabular-nums shrink-0">{message.audio.duration}″</span>
                </div>
              ) : (
                /* AI 语音合成中：占位气泡（不显示文字，避免先文字后气泡闪烁） */
                <div className={`flex items-center gap-2.5 py-0.5 ${isUser ? 'text-white' : 'text-gray-400'}`}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" className="shrink-0 opacity-60">
                    <polygon points="6 3 20 12 6 21 6 3" />
                  </svg>
                  <WaveBars seed={message.id} active={false} />
                  <span className="text-xs">语音发送中…</span>
                </div>
              )}
              {message.audio.text &&
                (isUser ? (
                  <p className="mt-1 text-xs leading-relaxed text-white/80">{message.audio.text}</p>
                ) : (
                  /* AI 语音消息：默认不显示文字，点「转文字」主动展开（微信式） */
                  <div className="mt-1">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowTranscript((v) => !v);
                      }}
                      className="text-[10px] text-gray-400 hover:text-ink transition-colors"
                    >
                      {showTranscript ? '收起文字' : '转文字'}
                    </button>
                    {showTranscript && (
                      <p className="mt-0.5 text-xs leading-relaxed text-gray-500">{message.audio.text}</p>
                    )}
                  </div>
                ))}
            </div>
          ) : (
            message.content
          )}
        </div>
        {/* 朗读按钮（仅 AI 消息；常显，触屏可点；播放中变青色/显示停止）。
            阻止冒泡：避免误触发滚动容器/气泡的点击聚焦行为 */}
        {!isUser && onSpeak && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onSpeak(message);
            }}
            title={speakingKey === speakKey ? '停止朗读' : busyKey === speakKey ? '合成中…' : '朗读'}
            className={`absolute top-0 left-full ml-1.5 flex items-center justify-center w-7 h-7 rounded-lg bg-surface/90 border transition-all active:scale-90 ${
              speakingKey === speakKey || busyKey === speakKey
                ? '!text-life-cyan border-life-cyan/40 shadow-[0_0_10px_rgba(0,206,201,0.25)]'
                : 'border-line text-gray-400 hover:text-ink hover:border-gray-300'
            }`}
          >
            {speakingKey === speakKey ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" />
              </svg>
            ) : busyKey === speakKey ? (
              <svg className="animate-spin" width="14" height="14" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeDasharray="28" strokeDashoffset="20" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none" />
                <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
              </svg>
            )}
          </button>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleCopy();
          }}
          title={copied ? '已复制' : '复制'}
          className={`absolute ${isUser ? 'top-1.5 right-full mr-1.5' : 'top-8 left-full ml-1.5'} flex items-center justify-center w-6 h-6 rounded-md bg-panel border border-line text-gray-400 hover:text-ink transition-all opacity-0 group-hover:opacity-100 ${
            copied ? 'opacity-100 !text-life-cyan' : ''
          }`}
        >
          {copied ? (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          ) : (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          )}
        </button>
      </div>

      {/* Context menu — rendered via portal so position:fixed is relative to the viewport,
          not the virtualized row's transform container */}
      {menu &&
        createPortal(
          <div
            className="fixed z-[60] min-w-[140px] py-1.5 glass-card rounded-xl shadow-2xl"
            style={{ left: menu.x + 4, top: menu.y + 4 }}
            onClick={(e) => e.stopPropagation()}
          >
            {confirmDelete ? (
              <div className="px-4 py-2">
                <p className="text-sm text-sub mb-1">删除这条消息？</p>
                <p className="text-xs text-gray-500 mb-3">这段基因序列将被永久抹除</p>
                <div className="flex gap-2 justify-end">
                  <button
                    onClick={() => {
                      setConfirmDelete(false);
                      setMenu(null);
                    }}
                    className="px-3 py-1.5 rounded-lg text-xs text-gray-400 hover:bg-surface transition-colors"
                  >
                    取消
                  </button>
                  <button
                    onClick={() => {
                      onDelete?.(message);
                      setMenu(null);
                      setConfirmDelete(false);
                    }}
                    className="px-3 py-1.5 rounded-lg text-xs bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
                  >
                    删除
                  </button>
                </div>
              </div>
            ) : (
              <>
                <button
                  onClick={handleCopy}
                  className="w-full flex items-center gap-2 px-4 py-2 text-sm text-sub hover:bg-surface transition-colors"
                >
                  📋 复制
                </button>
                <button
                  onClick={() => {
                    onQuote?.(message);
                    setMenu(null);
                  }}
                  className="w-full flex items-center gap-2 px-4 py-2 text-sm text-sub hover:bg-surface transition-colors"
                >
                  💬 引用
                </button>
                {onRemember && (
                  <button
                    onClick={() => {
                      onRemember(message);
                      setMenu(null);
                    }}
                    className="w-full flex items-center gap-2 px-4 py-2 text-sm text-sub hover:bg-surface transition-colors"
                  >
                    💾 记住
                  </button>
                )}
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
                >
                  🗑️ 删除
                </button>
              </>
            )}
          </div>,
          document.body,
        )}

      {/* 全屏图片预览 */}
      {previewImage &&
        createPortal(
          <div
            className="fixed inset-0 z-[80] bg-black/90 flex items-center justify-center"
            onClick={() => setPreviewImage(null)}
          >
            <img src={previewImage} alt="预览" className="max-w-full max-h-full object-contain" />
            <button className="absolute top-[max(env(safe-area-inset-top),16px)] right-4 w-9 h-9 flex items-center justify-center rounded-full bg-white/10 text-white text-xl hover:bg-white/20 transition-colors">
              ✕
            </button>
          </div>,
          document.body,
        )}
    </div>
  );
}
