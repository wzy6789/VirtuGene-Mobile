import { useSettingsStore } from '../../store/settings-store';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Message } from '../../db/index';
import { Avatar } from '../ui/Avatar';
import { SoulOrb } from '../ui/SoulOrb';
import { confirm } from '../../lib/haptics';
import { ipc } from '../../lib/ipc-client';
import { normalizeBubbleText } from '../../lib/chat-pacing';
import { Modal } from '../ui/Modal';
import { ImagePreview } from '../ui/ImagePreview';
import { Icon, type IconName } from '../ui/Icon';
import { useAuthStore } from '../../store/auth-store';
import { useFeedback } from '../../lib/feedback';
import { MessageText } from './MessageText';

/* ---- 语音播放（模块级单例：同一时刻只播一条，微信式） ---- */
let activeVoice: { id: string; owner: string | null; sessionId: string; audio: HTMLAudioElement; onEnd: () => void } | null = null;

// Context menus are rendered in a portal, so each bubble needs to explicitly
// close the menu owned by the previous bubble.  Keeping one closer at module
// scope also works with virtualized message lists where rows mount/unmount.
let closeActiveMessageMenu: (() => void) | null = null;

function stopActiveVoice() {
  if (activeVoice) {
    const { audio, onEnd } = activeVoice;
    activeVoice = null;
    audio.onended = null;
    audio.onerror = null;
    audio.pause();
    onEnd();
  }
}

/** 点击语音气泡：同一条切换播放/停止；不同条先停旧的再播新的 */
function toggleVoice(id: string, dataUrl: string, onStart: () => void, onEnd: () => void, onError: () => void, owner: string | null, sessionId: string) {
  if (useAuthStore.getState().userId !== owner) return;
  if (activeVoice?.id === id && activeVoice.owner === owner && activeVoice.sessionId === sessionId) {
    stopActiveVoice();
    return;
  }
  stopActiveVoice();
  let audio: HTMLAudioElement;
  try { audio = new Audio(dataUrl); } catch { onEnd(); onError(); return; }
  const clip = { id, owner, sessionId, audio, onEnd };
  activeVoice = clip;
  const finish = (failed = false) => {
    if (activeVoice !== clip) return;
    stopActiveVoice();
    if (failed) onError();
  };
  audio.onended = () => finish();
  audio.onerror = () => finish(true);
  onStart();
  try { void audio.play()?.catch(() => finish(true)); } catch { finish(true); }
}

const unsubscribeVoiceOwner = useAuthStore.subscribe((state, previous) => {
  if (state.userId !== previous.userId) stopActiveVoice();
});
const stopHiddenVoice = () => { if (document.hidden) stopActiveVoice(); };
if (typeof document !== 'undefined') document.addEventListener('visibilitychange', stopHiddenVoice);
if (typeof window !== 'undefined') window.addEventListener('pagehide', stopActiveVoice);
if (import.meta.hot) import.meta.hot.dispose(() => {
  unsubscribeVoiceOwner(); stopActiveVoice();
  document.removeEventListener('visibilitychange', stopHiddenVoice);
  window.removeEventListener('pagehide', stopActiveVoice);
});

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
          className={`w-[3px] rounded-full bg-current ${active ? 'animate-pulse' : 'opacity-85'}`}
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
  onReviewSpeech?: (message: Message) => void;
}

export const MessageBubble = memo(function MessageBubble({ message, avatar, streaming, streamingActive = streaming, streamed, animate, isLatest, onQuote, onDelete, onRetry, onSpeak, speakKey, speakingKey, busyKey, showIdentity = true, onRemember, onCollectMemory, collected, onShowBasis, onReviewSpeech }: Props) {
  const fontSize = useSettingsStore(s => s.chatFontSize);
  const isUser = message.role === 'user';
  // 历史消息也走同一层清洗，避免旧数据里的换行继续破坏手机端气泡。
  const displayContent = useMemo(() => normalizeBubbleText(message.content), [message.content]);
  const displayReply = useMemo(() => message.replyToContent ? normalizeBubbleText(message.replyToContent) : '', [message.replyToContent]);
  const [copied, setCopied] = useState(false);
  const copying = useRef(false);
  const owner = useAuthStore(s => s.userId);
  const feedback = useFeedback();
  const [menu, setMenu] = useState<{ owner: string | null; messageId: string; sessionId: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [previewImage, setPreviewImage] = useState<{ src: string; owner: string | null; messageId: string } | null>(null);
  const visibleMenu = !streaming && !!menu && menu.owner === owner && menu.messageId === message.id && menu.sessionId === message.sessionId;
  const menuAccessible = () => visibleMenu && useAuthStore.getState().userId === menu?.owner;
  const showImage = () => setPreviewImage({ src: message.image!, owner, messageId: message.id });
  const [voicePlaying, setVoicePlaying] = useState(false);
  useEffect(() => () => {
    if (activeVoice?.id === message.id && activeVoice.owner === owner && activeVoice.sessionId === message.sessionId) stopActiveVoice();
  }, [owner, message.id, message.sessionId]);
  /** AI 语音消息：转文字是否展开 */
  const [showTranscript, setShowTranscript] = useState(message.showAudioTranscript ?? false);

  const closeMenu = useCallback(() => {
    setMenu(null);
    setConfirmDelete(false);
  }, []);
  useEffect(() => { closeMenu(); setPreviewImage(null); }, [owner, message.id, message.sessionId, closeMenu]);
  useEffect(() => { if (streaming) closeMenu(); }, [streaming, closeMenu]);

  useEffect(() => {
    if (!menu) return;
    closeActiveMessageMenu?.();
    closeActiveMessageMenu = closeMenu;
    return () => {
      if (closeActiveMessageMenu === closeMenu) closeActiveMessageMenu = null;
    };
  }, [menu, closeMenu]);

  const handleCopy = async () => {
    if (copying.current || copied || streaming || useAuthStore.getState().userId !== owner) return;
    const requestOwner = owner;
    copying.current = true;
    try {
      const success = await ipc.clipboard.writeText(message.content);
      if (useAuthStore.getState().userId !== requestOwner) return;
      if (!success) throw new Error('Clipboard unavailable');
      setCopied(true); closeMenu();
      feedback('已复制消息', { tone: 'success' });
      setTimeout(() => setCopied(false), 1500);
    } catch { if (useAuthStore.getState().userId === requestOwner) feedback('消息未能复制，请重试', { tone: 'error' }); }
    finally { copying.current = false; }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    if (streaming) return;
    if (!menu) confirm(true);
    closeActiveMessageMenu?.();
    closeActiveMessageMenu = null;
    (e.currentTarget as HTMLElement).focus({ preventScroll: true });
    setMenu({ owner, messageId: message.id, sessionId: message.sessionId });
  };
  const runMenuAction = (action?: (message: Message) => void) => {
    if (!menuAccessible()) return;
    closeMenu(); action?.(message);
  };
  const menuAction = (label: string, icon: IconName, action: () => void, danger = false) =>
    <button type="button" onClick={action} style={{ justifyContent: 'flex-start' }} className={`vg-button w-full ${danger ? 'vg-button-danger' : 'vg-button-secondary'}`}><Icon name={icon} />{label}</button>;

  return (
    <div className={`vg-chat-message-row group flex items-start gap-2 mb-2.5 ${showIdentity ? 'is-first-in-streak' : 'is-continuation'} ${isUser ? 'is-user flex-row-reverse' : 'is-character flex-row'} ${
      animate ? 'animate-message-in' : ''
    }`} data-message-id={message.id} data-streamed={streaming || streamed || undefined}
      >
      <div className="vg-chat-identity relative w-8 shrink-0 flex flex-col items-center">
        <Avatar avatar={avatar} size="sm" />
      </div>
      {isUser && message.failed && (
        <button
          onClick={() => onRetry?.(message)}
          title="发送失败，点击重发"
          aria-label="重新发送失败的消息"
          className="vg-message-retry shrink-0 w-11 h-11 flex items-center justify-center rounded-full text-red-400 hover:bg-red-500/10 transition-colors"
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
          tabIndex={streaming ? undefined : 0}
          aria-haspopup={streaming ? undefined : 'dialog'}
          aria-expanded={visibleMenu || undefined}
          aria-keyshortcuts="Shift+F10"
          onKeyDown={event => {
            if (event.target !== event.currentTarget || streaming) return;
            if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
              event.preventDefault(); event.currentTarget.focus({ preventScroll: true });
              closeActiveMessageMenu?.(); confirm(true);
              setMenu({ owner, messageId: message.id, sessionId: message.sessionId });
            }
          }}
          data-streaming={streamingActive || undefined}

          data-length={displayContent.length > 80 ? 'long' : 'short'}
          style={{ '--vg-chat-font-size': `${fontSize}px` } as React.CSSProperties}
          className={`vg-message-bubble ${isUser ? 'is-user-bubble' : 'is-character-bubble'} transition-shadow ${isLatest && !isUser ? 'animate-message-sweep' : ''}`}
        >
          {message.replyToContent && (
            <div
              className="vg-message-quote text-xs mb-1.5 line-clamp-1 border-l-2 pl-2"
            >
              {displayReply}
            </div>
          )}
          {message.image && (
            <img
              src={message.image}
              width={220}
              height={165}
              alt="图片"
              role="button"
              tabIndex={0}
              aria-label="查看消息图片"
              onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); showImage(); } }}
              onClick={(e) => {
                e.stopPropagation();
                showImage();
              }}
              className={`vg-message-image cursor-zoom-in ${
            displayContent ? 'mb-2' : ''
              }`}
            />
          )}
          {message.audio && !message.showAudioTranscript ? (
            /* 微信式语音消息：波形 + 时长 + 点击播放；AI 语音合成中显示占位，不闪文字 */
            <div>
              {message.audio.dataUrl ? (
                <button
                  type="button"
                  aria-label={voicePlaying ? '暂停语音消息' : '播放语音消息'}
                  aria-pressed={voicePlaying}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleVoice(
                      message.id,
                      message.audio!.dataUrl,
                      () => setVoicePlaying(true),
                      () => setVoicePlaying(false),
                      () => feedback('这条语音暂时无法播放，请重试。', { tone: 'error' }), owner, message.sessionId,
                    );
                  }}
                  className={`vg-message-audio flex items-center gap-2.5 cursor-pointer select-none py-0.5 ${
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
                </button>
              ) : (
                /* AI 语音合成中：占位气泡（不显示文字，避免先文字后气泡闪烁） */
                <div className={`flex items-center gap-2.5 py-0.5 ${isUser ? 'text-white' : 'text-sub'}`}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" className="shrink-0 opacity-60">
                    <polygon points="6 3 20 12 6 21 6 3" />
                  </svg>
                  <WaveBars seed={message.id} active={false} />
                  <span className="text-xs">语音发送中…</span>
                </div>
              )}
              {message.audio.text &&
                (isUser ? (
                  <p className="mt-1 text-xs leading-relaxed text-white">{message.audio.text}</p>
                ) : (
                  /* AI 语音消息：默认不显示文字，点「转文字」主动展开（微信式） */
                  <div className="mt-1">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowTranscript((v) => !v);
                      }}
                      className="text-xs text-sub hover:text-ink transition-colors"
                    >
                      {showTranscript ? '收起文字' : '转文字'}
                    </button>
                    {showTranscript && (
                      <p className="mt-0.5 text-xs leading-relaxed text-ink">{message.audio.text}</p>
                    )}
                  </div>
                ))}
            </div>
          ) : (
            <>
              <MessageText raw={message.content} plain={displayContent} streaming={streaming} suffix={streamingActive ? <span className="vg-stream-caret vg-stream-orb" aria-hidden="true"><SoulOrb size={16} emotion="working" motionContext="reading" fallbackLabel={false} /></span> : undefined} />
              {message.audio && message.showAudioTranscript && (
                <div className="vg-stream-voice">
                  {message.audio.dataUrl ? <button type="button" aria-label={voicePlaying ? '暂停语音' : '播放语音'} onClick={(e) => {
                    e.stopPropagation();
                    toggleVoice(message.id, message.audio!.dataUrl, () => setVoicePlaying(true), () => setVoicePlaying(false), () => feedback('这条语音暂时无法播放，请重试。', { tone: 'error' }), owner, message.sessionId);
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
        {isUser && message.secretaryDispatch && <p className="mt-1 text-xs text-sub">由{message.secretaryDispatch.assistantName}代发</p>}
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

      <Modal presentation="dialog" open={visibleMenu} title={confirmDelete ? '删除这条消息？' : '消息操作'} width="max-w-sm"
        onClose={closeMenu} canSnapshotOnExit={() => false}>
        <div className="vg-dialog-actions p-4 space-y-2" data-message-actions>
          {confirmDelete ? <div className="space-y-4">
            <p className="text-sm leading-7 text-sub">删除后无法恢复这条消息。</p>
            <div className="flex flex-wrap gap-3 justify-end">
              <button type="button" onClick={closeMenu} className="vg-button vg-button-secondary">取消</button>
              <button type="button" onClick={() => runMenuAction(onDelete)} className="vg-button vg-button-danger"><Icon name="trash" />删除</button>
            </div>
          </div> : <>
            {menuAction('复制', 'copy', () => { void handleCopy(); })}
            {menuAction('引用', 'moment', () => runMenuAction(onQuote))}
            {!isUser && onSpeak && menuAction(speakingKey === speakKey ? '停止朗读' : busyKey === speakKey ? '正在合成' : '朗读', 'volume', () => runMenuAction(onSpeak))}
            {onRemember && menuAction('记住', 'flag', () => runMenuAction(onRemember))}
            {!isUser && !message.interrupted && !message.isProactive && onReviewSpeech && menuAction('表达样本', 'diary', () => runMenuAction(onReviewSpeech))}
            {onCollectMemory && (collected ? <p className="min-h-11 flex items-center gap-3 px-4 text-sm text-life-cyan"><Icon name="check" />已是共同记忆</p>
              : menuAction('收藏为共同记忆', 'heart', () => runMenuAction(onCollectMemory)))}
            {onShowBasis && ((message.contextTrace?.memoryIds?.length ?? 0) > 0 || (message.contextTrace?.continuityThreadIds?.length ?? 0) > 0 ||
              (message.contextTrace?.sharedEventIds?.length ?? 0) > 0 || (message.contextTrace?.sharedMemoryIds?.length ?? 0) > 0 ||
              (message.contextTrace?.diaryIds?.length ?? 0) > 0 || (message.contextTrace?.sceneIds?.length ?? 0) > 0 ||
              (message.contextTrace?.pulseEventIds?.length ?? 0) > 0) && menuAction('查看记忆依据', 'database', () => runMenuAction(onShowBasis))}
            {menuAction('删除', 'trash', () => { if (menuAccessible()) setConfirmDelete(true); }, true)}
          </>}
        </div>
      </Modal>

      {previewImage?.owner === owner && previewImage.messageId === message.id && <ImagePreview images={[previewImage.src]} onClose={() => setPreviewImage(null)} />}

    </div>
  );
});
