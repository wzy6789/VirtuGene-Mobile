import { useSettingsStore } from '../../store/settings-store';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Message } from '../../db/index';
import { Avatar } from '../ui/Avatar';
import { SoulOrb } from '../ui/SoulOrb';
import { confirm } from '../../lib/haptics';
import { ipc } from '../../lib/ipc-client';
import { normalizeBubbleText } from '../../lib/chat-pacing';

/* ---- 语音播放（模块级单例：同一时刻只播一条，微信式） ---- */
let activeVoice: { id: string; audio: HTMLAudioElement; onEnd: () => void } | null = null;

// Context menus are rendered in a portal, so each bubble needs to explicitly
// close the menu owned by the previous bubble.  Keeping one closer at module
// scope also works with virtualized message lists where rows mount/unmount.
let closeActiveMessageMenu: (() => void) | null = null;

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
  streaming?: boolean;
  /** Earlier parts remain pending, but only the last part is still receiving text. */
  streamingActive?: boolean;
  /** Saved content which has already been visible in the streaming preview. */
  streamed?: boolean;
  waiting?: boolean;
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
  /** 角色名作为每段对话的发言锚点，让阅读时更接近故事分镜。 */
  /** 保留兼容字段；手机端每条独立消息都显示头像，避免连发时失去发言归属。 */
  showIdentity?: boolean;
  /** 长按菜单"记住"：把消息存进角色记忆 */
  onRemember?: (message: Message) => void;
  /** 长按菜单"收藏为共同记忆"：把这条消息变成你们共同经历过的事（5.0 世界层） */
  onCollectMemory?: (message: Message) => void;
  /** 这条消息是否已经被收藏为共同记忆（菜单据此显示已收藏态，而不是再收藏一次） */
  collected?: boolean;
  /** 长按菜单"查看记忆依据"：仅当这条消息记录了本机注入数据时出现 */
  onShowBasis?: (message: Message) => void;
}

export const MessageBubble = memo(function MessageBubble({ message, avatar, streaming, streamingActive = streaming, streamed, waiting, animate, isLatest, onQuote, onDelete, onRetry, onSpeak, speakKey, speakingKey, busyKey, showIdentity = true, onRemember, onCollectMemory, collected, onShowBasis }: Props) {
  const fontSize = useSettingsStore(s => s.chatFontSize);
  const isUser = message.role === 'user';
  // 历史消息也走同一层清洗，避免旧数据里的换行继续破坏手机端气泡。
  const displayContent = useMemo(() => normalizeBubbleText(message.content), [message.content]);
  const displayReply = useMemo(() => message.replyToContent ? normalizeBubbleText(message.replyToContent) : '', [message.replyToContent]);
  const [copied, setCopied] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  useEffect(() => {
    if (!menu && !previewImage) return;
    const handleBack = (event: Event) => {
      if (event.defaultPrevented || document.querySelector('[aria-modal="true"]')) return;
      event.preventDefault(); setPreviewImage(null); setMenu(null);
    };
    window.addEventListener('vg:back-request', handleBack);
    return () => window.removeEventListener('vg:back-request', handleBack);
  }, [menu, previewImage]);
  const [voicePlaying, setVoicePlaying] = useState(false);
  /** AI 语音消息：转文字是否展开 */
  const [showTranscript, setShowTranscript] = useState(message.showAudioTranscript ?? false);

  const closeMenu = useCallback(() => {
    setMenu(null);
    setConfirmDelete(false);
  }, []);

  useEffect(() => {
    if (!menu) return;
    closeActiveMessageMenu?.();
    closeActiveMessageMenu = closeMenu;
    const handler = () => closeMenu();
    document.addEventListener('click', handler);
    return () => {
      document.removeEventListener('click', handler);
      if (closeActiveMessageMenu === closeMenu) closeActiveMessageMenu = null;
    };
  }, [menu, closeMenu]);

  const handleCopy = async () => {
    if (copied) return;
    await ipc.clipboard.writeText(message.content);
    setCopied(true);
    setMenu(null);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    if (streaming) return;
    if (!menu) confirm(true);
    closeActiveMessageMenu?.();
    closeActiveMessageMenu = null;
    // Keep the action sheet inside the viewport on narrow Android screens.
    // Long-press coordinates are often close to an edge, where the old menu
    // could be clipped and force a second tap to dismiss it.
    const menuWidth = 198;
    const menuHeight = 360;
    const maxX = Math.max(8, window.innerWidth - menuWidth - 8);
    const maxY = Math.max(8, window.innerHeight - menuHeight - 8);
    setMenu({
      x: Math.min(Math.max(8, e.clientX + 4), maxX),
      y: Math.min(Math.max(8, e.clientY + 4), maxY),
    });
  };

  return (
    <div className={`vg-chat-message-row group flex items-start gap-2 mb-2.5 ${showIdentity ? 'is-first-in-streak' : 'is-continuation'} ${isUser ? 'is-user flex-row-reverse' : 'is-character flex-row'} ${
      animate ? 'animate-message-in' : ''
    } ${waiting ? 'vg-typing-row' : ''}`} data-message-id={message.id} data-streamed={streaming || streamed || undefined}
      role={waiting ? 'status' : undefined} aria-label={waiting ? '正在准备回复' : undefined}>
      <div className="vg-chat-identity relative w-8 shrink-0 flex flex-col items-center">
        <Avatar avatar={avatar} size="sm" className={isUser ? 'ring-1 ring-white/20' : 'ring-1 ring-life-cyan/35 shadow-[0_0_14px_rgba(0,206,201,.16)]'} />
      </div>
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
      <div className="vg-chat-message-content relative max-w-[82%]">

        {/* 角色当前心情小表情（AI 消息，气泡角上） */}
        <div
          onContextMenu={handleContextMenu}
          data-streaming={streamingActive || undefined}
          data-waiting={waiting || undefined}
          data-length={displayContent.length > 80 ? 'long' : 'short'}
          style={{ '--vg-chat-font-size': `${fontSize}px` } as React.CSSProperties}
          className={`vg-message-bubble ${isUser ? 'is-user-bubble' : 'is-character-bubble'} transition-shadow ${isLatest && !isUser ? 'animate-message-sweep' : ''}`}
        >
          {message.replyToContent && (
            <div
              className={`text-xs mb-1.5 line-clamp-1 border-l-2 pl-2 ${
                isUser ? 'border-white/40 text-white/70' : 'border-gray-300 text-gray-500'
              }`}
            >
              {displayReply}
            </div>
          )}
          {message.image && (
            <img
              src={message.image}
              alt="图片"
              role="button"
              tabIndex={0}
              aria-label="查看消息图片"
              onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); setPreviewImage(message.image!); } }}
              onClick={(e) => {
                e.stopPropagation();
                setPreviewImage(message.image!);
              }}
              className={`max-w-[220px] max-h-[260px] rounded-xl object-cover cursor-zoom-in ${
            displayContent ? 'mb-2' : ''
              }`}
            />
          )}
          {message.audio && !message.showAudioTranscript ? (
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
                      className="text-xs text-gray-400 hover:text-ink transition-colors"
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
            <>
              <span className={`vg-message-text${streaming && !waiting ? ' vg-stream-text-arrive' : ''}`}>{waiting
                ? <span className="vg-reply-waiting-dots" aria-hidden="true"><i /><i /><i /></span>
                : displayContent}{streamingActive && !waiting && <span className="vg-stream-caret vg-stream-orb" aria-hidden="true"><SoulOrb size={20} emotion="working" fallbackLabel={false} /></span>}</span>
              {message.audio && message.showAudioTranscript && (
                <div className="vg-stream-voice">
                  {message.audio.dataUrl ? <button type="button" aria-label={voicePlaying ? '暂停语音' : '播放语音'} onClick={(e) => {
                    e.stopPropagation();
                    toggleVoice(message.id, message.audio!.dataUrl, () => setVoicePlaying(true), () => setVoicePlaying(false));
                  }}>
                    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">{voicePlaying ? <path d="M6 5h4v14H6zm8 0h4v14h-4z" /> : <path d="m7 4 14 8-14 8z" />}</svg>
                    <WaveBars seed={message.id} active={voicePlaying} />
                    <span>{message.audio.duration}″</span>
                  </button> : <span role="status">语音生成中…</span>}
                </div>
              )}
            </>
          )}
        </div>
        {isUser && message.secretaryDispatch && <p className="mt-1 text-[11px] text-sub">由{message.secretaryDispatch.assistantName}代发</p>}
        {/* 朗读按钮（仅 AI 消息；常显，触屏可点；播放中变青色/显示停止）。
            阻止冒泡：避免误触发滚动容器/气泡的点击聚焦行为 */}
        {!streaming && !isUser && onSpeak && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onSpeak(message);
            }}
            title={speakingKey === speakKey ? '停止朗读' : busyKey === speakKey ? '合成中…' : '朗读'}
            className={`absolute top-0 left-full ml-1.5 hidden sm:flex items-center justify-center w-7 h-7 rounded-lg bg-surface/90 border transition-all active:scale-90 ${
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
        {!streaming && <button
          onClick={(e) => {
            e.stopPropagation();
            handleCopy();
          }}
          title={copied ? '已复制' : '复制'}
          className={`absolute ${isUser ? 'top-1.5 right-full mr-1.5' : 'top-8 left-full ml-1.5'} hidden sm:flex items-center justify-center w-6 h-6 rounded-md bg-panel border border-line text-gray-400 hover:text-ink transition-all opacity-0 group-hover:opacity-100 ${
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
        </button>}
        {message.interrupted && <p className={`vg-message-generation-status${message.stopped ? ' is-stopped' : ' is-interrupted'}`} role="status"><svg aria-hidden="true" width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="10" cy="10" r="7" />{message.stopped ? <path d="M8 7v6m4-6v6" /> : <path d="M10 6v5m0 2v.5" />}</svg><span>{message.stopped ? '已停止生成' : '回复中断，已保留内容'}</span></p>}
      </div>

      {/* Context menu — rendered via portal so position:fixed is relative to the viewport,
          not the virtualized row's transform container */}
      {menu &&
        createPortal(
          <div
            className="vg-message-context-menu fixed vg-layer-popover min-w-[180px] max-h-[min(78vh,380px)] overflow-y-auto py-1.5 glass-card rounded-2xl shadow-2xl"
            style={{ left: menu.x, top: menu.y }}
            onClick={(e) => e.stopPropagation()}
          >
            {confirmDelete ? (
              <div className="vg-delete-confirmation">
                <p className="text-sm text-sub mb-1">删除这条消息？</p>
                <p className="text-xs text-gray-500 mb-3">删除后无法恢复这条消息。</p>
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
                    复制
                </button>
                <button
                  onClick={() => {
                    onQuote?.(message);
                    setMenu(null);
                  }}
                  className="w-full flex items-center gap-2 px-4 py-2 text-sm text-sub hover:bg-surface transition-colors"
                >
                    引用
                </button>
                {!isUser && onSpeak && (
                  <button
                    onClick={() => {
                      onSpeak(message);
                      setMenu(null);
                    }}
                    className="w-full flex items-center gap-2 px-4 py-2 text-sm text-sub hover:bg-surface transition-colors"
                  >
                    {speakingKey === speakKey ? '停止朗读' : busyKey === speakKey ? '正在合成' : '朗读'}
                  </button>
                )}
                {onRemember && (
                  <button
                    onClick={() => {
                      onRemember(message);
                      setMenu(null);
                    }}
                    className="w-full flex items-center gap-2 px-4 py-2 text-sm text-sub hover:bg-surface transition-colors"
                  >
                    记住
                  </button>
                )}
                {/* 收藏为共同记忆：4.x 的「记住」存的是"关于用户的事实"，
                    这里存的是"你们一起经历过的事"——两者互不替代 */}
                {onCollectMemory && (
                  collected ? (
                    <div className="w-full flex items-center gap-2 px-4 py-2 text-sm text-life-cyan/70">
                      已是共同记忆
                    </div>
                  ) : (
                    <button
                      onClick={() => {
                        onCollectMemory(message);
                        setMenu(null);
                      }}
                      className="w-full flex items-center gap-2 px-4 py-2 text-sm text-sub hover:bg-surface transition-colors"
                    >
                      收藏为共同记忆
                    </button>
                  )
                )}
                {onShowBasis && (
                  (message.contextTrace?.memoryIds?.length ?? 0) > 0 ||
                  (message.contextTrace?.continuityThreadIds?.length ?? 0) > 0 ||
                  (message.contextTrace?.sharedEventIds?.length ?? 0) > 0 ||
                  (message.contextTrace?.sharedMemoryIds?.length ?? 0) > 0 ||
                  (message.contextTrace?.diaryIds?.length ?? 0) > 0 ||
                  (message.contextTrace?.sceneIds?.length ?? 0) > 0 ||
                  (message.contextTrace?.pulseEventIds?.length ?? 0) > 0
                ) && (
                  <button
                    onClick={() => {
                      onShowBasis(message);
                      setMenu(null);
                    }}
                    className="w-full flex items-center gap-2 px-4 py-2 text-sm text-sub hover:bg-surface transition-colors"
                  >
                    查看记忆依据
                  </button>
                )}
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
                >
                  删除
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
            className="fixed inset-0 vg-layer-viewer bg-black/90 flex items-center justify-center"
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
});
