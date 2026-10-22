import { useVoiceCallUIStore } from '../../store/voice-call-ui-store';
import { useVoiceCallStore } from '../../store/voice-call-store';
import { callOrbPresence } from '../../lib/voice-call/orb-presence';
import { lazyFeature } from '../ui/lazyFeature';
import { ActionCabinLauncher } from '../todo/ActionCabinLauncher';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, lazy, Suspense } from 'react';
import { useVirtualizer,elementScroll } from '@tanstack/react-virtual';
import { useLatestMessageScroll,type HistoryScrollSnapshot } from '../ui/useLatestMessageScroll';
import { useChatStore } from '../../store/chat-store';
import { beginSoulHandoff, soulElement } from '../../lib/soul-handoff';
import { confirm } from '../../lib/haptics';
import { useFeedback } from '../../lib/feedback';
import { useAuthStore, DEFAULT_USER_AVATAR } from '../../store/auth-store';
import { useSettingsStore } from '../../store/settings-store';
import { MessageBubble } from './MessageBubble';
import { StreamingReply } from './StreamingReply';
import { useReplyWaiting } from './useReplyWaiting';
import { ChatReplyStream } from '../../lib/chat-stream';
import { Avatar } from '../ui/Avatar';
import { ChatInput } from './ChatInput';
import type { ChatInputHandle } from './ChatInput';
import { BalanceBanner, type ChatError } from './BalanceBanner';
import { ChatHeaderMoreMenu } from './ChatHeaderMoreMenu';
import { useChatAtmosphere, useChatAtmosphereRest } from './useChatAtmosphere';
import { ChatBackgroundLayer } from './ChatBackgroundLayer';
import { SwipeBackView } from '../ui/SwipeBackView';
import { IS_MOBILE } from '../../lib/platform';
import { messageRepo, sameMessageFailureSource } from '../../db/message-repo';
import { sessionRepo } from '../../db/session-repo';
import { memoryRepo } from '../../db/memory-repo';
import { publishMemoryWrite } from '../../lib/memory-write-events';
import { stateRepo } from '../../db/state-repo';
import { sharedMemoryRepo } from '../../db/shared-memory-repo';
import { worldRepo } from '../../db/world-repo';
import { collectMessageAsSharedMemory, MEMORY_SOURCE_TYPE } from '../../lib/world/world-writer';
import { useUIStore } from '../../store/ui-store';
import { useTTS } from '../../lib/tts';
import { DEFAULT_VOICE, DEFAULT_MALE_VOICE, ALL_VOICES } from '../../lib/voice-map';
import { resolveModel } from '../../lib/ai/llm';
import { useAiAvailability } from '../settings/useAiAvailability';
import { prepareMemoryMetadata } from '../../lib/memory-engine';
import { db } from '../../db/index';
import { ModelPickModal } from './ModelPickModal';
import { SecretaryQuickActions } from '../secretary/SecretaryQuickActions';
import { secretaryFailureMessage } from '../../lib/secretary/failure';
import type { Message } from '../../db/index';
import { sendRoleChatReply, type ChatRequest } from '../../lib/chat/send-service';
import { withChatSessionLock } from '../../lib/chat/request-coordinator';
import { Icon } from '../ui/Icon';


import { CharacterSoulOrb } from './CharacterSoulOrb';
const SecretaryMoreMenu = lazyFeature(() => import('../secretary/SecretaryMoreMenu').then(m => ({default:m.SecretaryMoreMenu})));
const SecretaryTaskCards = lazyFeature(() => import('./SecretaryTaskCards').then(m => ({ default: m.SecretaryTaskCards })));
const SecretaryPersonalityModal = lazyFeature(() => import('../secretary/SecretaryPersonalityModal').then(m => ({ default: m.SecretaryPersonalityModal })));
const SecretaryInboxModal = lazyFeature(() => import('../secretary/SecretaryInboxModal').then(m => ({ default: m.SecretaryInboxModal })));
const SecretaryDailyReviewModal = lazyFeature(() => import('../secretary/SecretaryDailyReviewModal').then(m => ({ default: m.SecretaryDailyReviewModal })));

// 记忆依据弹窗只在长按菜单里用到：与手账/群聊同一套按需加载策略，不进首屏主包
const MemoryBasisModal = lazy(() => import('./MemoryBasisModal').then((m) => ({ default: m.MemoryBasisModal })));
const ReviewedSpeechModal = lazy(() => import('./ReviewedSpeechModal').then(m => ({ default: m.ReviewedSpeechModal })));
const CharacterProfileModal=lazyFeature(()=>import('../character/CharacterProfileModal').then(m=>({default:m.CharacterProfileModal})));

const FIVE_MINUTES = 5 * 60 * 1000;

function formatTimeLabel(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const msgDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());

  const time = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

  if (msgDay.getTime() === today.getTime()) return time;
  if (msgDay.getTime() === yesterday.getTime()) return `昨天 ${time}`;
  if (now.getTime() - ts < 7 * 86400000) {
    const days = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
    return `${days[d.getDay()]} ${time}`;
  }
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${time}`;
}

/** 最近已经被提示词用过的记忆进入冷却，避免角色像背书一样反复提同一件事。 */


interface ChatWindowProps {
  emotionToggle?: React.ReactNode;
  /** Optional sample palette. Production uses this reading layout with saved role colors. */
  surface?: 'light-paper';
  workspace?: { onInbox: () => void; onManage: () => void; onReview: () => void; draft?: { id: number; text: string }; onBusy: (busy: boolean) => void; onWaiting?: (waiting: boolean) => void; onReplyVisible?: (visible: boolean) => void; todoContext?: import('../../lib/secretary/workspace-todo').SecretaryTodoContext; onTodoHandled?: (results: import('../../lib/secretary/types').SecretaryResult[]) => Promise<void> };
}

/** 心情 → 小表情（气泡角上显示） */
function moodEmoji(mood: number): string {
  if (mood >= 75) return '😊';
  if (mood >= 55) return '🙂';
  if (mood >= 40) return '😐';
  if (mood >= 25) return '😕';
  return '😠';
}

/** Subscribe only to visible call state; capture levels never redraw the chat page. */
function ChatCallNotice({ userId, characterId, sessionId }: { userId: string; characterId: string; sessionId: string }) {
  const visible = useVoiceCallUIStore(s => s.minimized && s.target?.userId === userId && s.target.character.id === characterId && s.target.sessionId === sessionId);
  const owned = useVoiceCallStore(s => s.owner?.userId === userId && s.owner.characterId === characterId && s.owner.sessionId === sessionId);
  const phase = useVoiceCallStore(s => s.view?.phase);
  const inputMode = useVoiceCallStore(s => s.view?.inputMode);
  const inputModePending = useVoiceCallStore(s => s.view?.inputModePending);
  const muted = useVoiceCallStore(s => s.view?.muted);
  const finishing = useVoiceCallStore(s => s.finishing);
  if (!visible) return null;
  const status = owned && finishing ? ({ saving: '正在保存交流文字', summary: '通话已结束，正在整理摘要', memory: '通话已结束，正在检查记忆' })[finishing]
    : callOrbPresence(owned && phase ? { phase, inputMode, inputModePending, muted } : undefined).label;
  return <div data-chat-call-status className="relative z-20 px-3 pt-2 shrink-0"><div className="vg-feedback-card" data-tone="info" style={{ flexWrap: 'nowrap' }}>
    <span className="vg-feedback-copy" role="status" aria-atomic="true" style={{ flexBasis: 'auto' }}>{`语音通话 · ${status}`}</span>
    <div className="vg-feedback-actions"><button type="button" onClick={() => {
      const ui = useVoiceCallUIStore.getState(), target = ui.target;
      if (useAuthStore.getState().userId !== userId || target?.userId !== userId || target.character.id !== characterId || target.sessionId !== sessionId) return;
      const key = `${userId}:${characterId}:${sessionId}`;
      beginSoulHandoff(key, soulElement(key, 'call-capsule'), 'call'); ui.restore();
    }}>返回通话</button></div>
  </div></div>;
}

export function ChatWindow({ emotionToggle, workspace, surface }: ChatWindowProps) {

  const messages = useChatStore((s) => s.messages);
  const currentSessionId = useChatStore((s) => s.currentSessionId);
  const showVoiceCall = useVoiceCallUIStore(s => s.blocksChat && s.target?.sessionId === currentSessionId);
  const callTarget = useVoiceCallUIStore(s => s.target);
  const selectedCharacterId = useChatStore((s) => s.selectedCharacterId);
  const characters = useChatStore((s) => s.characters);
  const addMessage = useChatStore((s) => s.addMessage);
  const updateMessage = useChatStore((s) => s.updateMessage);
  const deleteMessage = useChatStore((s) => s.deleteMessage);
  const feedback = useFeedback();
  const hasMoreMessages = useChatStore((s) => s.hasMoreMessages);
  const loadEarlierMessages = useChatStore((s) => s.loadEarlierMessages);
  const apiKey = useAuthStore((s) => s.apiKey);
  const userId = useAuthStore((s) => s.userId) ?? '';
  const userAvatar = useAuthStore((s) => s.avatar) ?? DEFAULT_USER_AVATAR;
  /** 角色当前心情（气泡角上的小表情） */
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollController=useRef<ReturnType<typeof useLatestMessageScroll>|null>(null);
  const roomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<ChatInputHandle>(null);
  useEffect(() => { if (workspace?.draft) inputRef.current?.setDraft(workspace.draft.text); }, [workspace?.draft?.id]);

  const [sending, setSending] = useState(false);
  const [settlingReply, setSettlingReply] = useState(false);
  useEffect(() => { workspace?.onBusy(sending || settlingReply); }, [sending, settlingReply, workspace?.onBusy]);
  const requestsRef = useRef(new Map<string, ChatRequest>());
  // Preview and virtualized history have different parents. Do not replay their
  // entrance/sweep when an already-visible streaming bubble is saved.
  const streamedReplyIdsRef = useRef(new Set<string>());
  const mountedRef = useRef(true);
  const [streamingReply, setStreamingReply] = useState<ChatReplyStream | null>(null);
  const [replyVisible, setReplyVisible] = useState(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestsRef.current.forEach(request => request.controller.abort());
    };
  }, []);
  useEffect(() => () => {
    requestsRef.current.forEach(request => { if (request.userId === userId) request.controller.abort(); });
  }, [userId]);
  const [error, setError] = useState<ChatError>(null);
  const [secretaryError, setSecretaryError] = useState<string | null>(null);
  const replyWaiting = useReplyWaiting(sending && !replyVisible && !error && !secretaryError, `${userId}:${currentSessionId}`);
  useEffect(() => { workspace?.onWaiting?.(replyWaiting); }, [replyWaiting, workspace?.onWaiting]);
  useEffect(() => () => workspace?.onWaiting?.(false), [workspace?.onWaiting]);
  useEffect(() => { workspace?.onReplyVisible?.(replyVisible); }, [replyVisible, workspace?.onReplyVisible]);
  useEffect(() => () => workspace?.onReplyVisible?.(false), [workspace?.onReplyVisible]);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  /** 记忆依据（长按消息 → 查看这条回复参考了哪些本地记忆/未完成事件/共同事件） */
  const [basisMessage, setBasisMessage] = useState<Message | null>(null);
  const [speechMessage, setSpeechMessage] = useState<Message | null>(null);
  /** 已收藏为共同记忆的消息 id（长按菜单据此显示"已是共同记忆"） */
  const [collectedIds, setCollectedIds] = useState<Set<string>>(() => new Set());
  /** 收藏后的明确反馈（世界层是另一个页面，没有反馈用户会以为没生效） */
  const [collectNotice, setCollectNotice] = useState<'created' | 'exists' | 'failed' | null>(null);
  /** 首次进入聊天：会话未锁定模型时弹出模型选择（选定后聊天中不可改） */
  const [showModelPick, setShowModelPick] = useState(false);
  const [showProfile,setShowProfile]=useState(false);
  useEffect(()=>setShowProfile(false),[selectedCharacterId,currentSessionId,userId]);
  const [showSecretaryPersonality, setShowSecretaryPersonality] = useState(false);
  const [showSecretaryInbox, setShowSecretaryInbox] = useState(false);
  const [showSecretaryDailyReview, setShowSecretaryDailyReview] = useState(false);
  useEffect(() => { setShowSecretaryPersonality(false); setShowSecretaryInbox(false); setShowSecretaryDailyReview(false); }, [selectedCharacterId, userId]);
  /** 会话元信息：当前模型 + 累计消耗（右上角设置展示） */
  const [sessionMeta, setSessionMeta] = useState<{ modelLabel: string; cost?: import('../../db').Session['cost'] }>({ modelLabel: '' });
  const [sessionSelection, setSessionSelection] = useState<{ id: string; model: { provider: string; model: string } | null } | null>(null);
  /** TTS 朗读（用户主动点击才发声；Edge-TTS 直连，失败自动回退系统语音） */
  const { speakingKey, busyKey, speak, stop } = useTTS();
  useEffect(() => { if (showVoiceCall) stop(); }, [showVoiceCall, stop]);
  const ttsEnabled = useSettingsStore((s) => s.ttsEnabled);
  const ttsSpeed = useSettingsStore((s) => s.ttsSpeed);

  const character = characters.find((c) => c.id === selectedCharacterId);
  const atmosphere = useChatAtmosphere(character, userId);
  const roleAvatar = atmosphere.config.roleVisual?.avatar?.image || character?.avatar || '🧬';
  const reportBackgroundImageError = useCallback((message:string) => feedback(message,{tone:'error'}),[feedback]);
  useChatAtmosphereRest(roomRef, `${userId}:${currentSessionId}`,atmosphere.config);
  const hasAiAccess = useAiAvailability(resolveModel(character, sessionSelection?.id === currentSessionId ? sessionSelection.model : null));
  const callLabel = callTarget ? `返回与${callTarget.character.name}的语音通话` : character ? `与${character.name}语音通话` : '语音通话';
  const callDisabled = !callTarget && (sending || settlingReply || !currentSessionId);
  const openVoiceCall = character && currentSessionId ? () => {
    const current = useChatStore.getState(), ui = useVoiceCallUIStore.getState();
    if (useAuthStore.getState().userId !== userId || current.currentSessionId !== currentSessionId || current.selectedCharacterId !== character.id) return;
    if (ui.target) {
      if (ui.target.userId !== userId) return;
      const key = `${userId}:${ui.target.character.id}:${ui.target.sessionId}`;
      beginSoulHandoff(key, soulElement(key, 'call-capsule'), 'call'); ui.restore(); return;
    }
    if (sending || settlingReply) return;
    beginSoulHandoff(`${userId}:${character.id}:${currentSessionId}`, soulElement(`role-orb:${character.id}`, 'chat'), 'call');
    ui.open({ character, sessionId: currentSessionId, userId });
  } : undefined;

  useEffect(() => {
    if (character?.agentProfile !== 'secretary' || character.secretaryStatus === 'dismissed' || !currentSessionId || !userId) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const recover = async () => {
      try {
        const { recoverSecretaryTasks } = await import('../../lib/secretary/agent');
        const { recoverCharacterDispatches } = await import('../../lib/secretary/character-messaging');
        const dispatchLease = await recoverCharacterDispatches(userId, character.id);
        const result = await recoverSecretaryTasks(userId, character.id, currentSessionId);
        if (dispatchLease) result.nextLease = Math.min(result.nextLease ?? Infinity, dispatchLease);
        if (!alive || useAuthStore.getState().userId !== userId) return;
        for (const id of result.failedMessageIds) updateMessage(id, { failed: true });
        for (const task of result.tasks) {
          const id = `secretary-reply:${task.messageId}`;
          const reply = await messageRepo.getById(id);
          if (!alive || useAuthStore.getState().userId !== userId || useChatStore.getState().currentSessionId !== currentSessionId) return;
          if (reply?.role !== 'assistant' || reply.sessionId !== currentSessionId || reply.secretaryTaskId !== task.id) continue;
          if (useChatStore.getState().messages.some(m => m.id === id)) updateMessage(id, { content: reply.content, revision: reply.revision });
          else addMessage(reply);
        }
        if (result.nextLease && alive) timer = setTimeout(() => void recover(), Math.max(1000, result.nextLease - Date.now() + 50));
      } catch { /* A later entry can recover interrupted work. */ }
    };
    void recover();
    return () => { alive = false; if (timer) clearTimeout(timer); };
  }, [character?.id, character?.agentProfile, character?.secretaryStatus, character?.secretaryEmploymentId, currentSessionId, userId]);

  useEffect(() => {
    if (character?.agentProfile !== 'secretary' || !currentSessionId) return;
    let alive = true;
    const refreshReceipt = async (event: Event) => {
      const detail = (event as CustomEvent<{ userId: string; taskId: string }>).detail;
      if (detail?.userId !== userId) return;
      const task = await db.secretaryTasks.get(detail.taskId);
      if (task?.userId !== userId || task.sessionId !== currentSessionId || task.characterId !== character.id) return;
      const reply = await messageRepo.getById(`secretary-reply:${task.messageId}`);
      if (alive && reply?.role === 'assistant' && reply.secretaryTaskId === task.id && useAuthStore.getState().userId === userId && useChatStore.getState().currentSessionId === currentSessionId) {
        if (useChatStore.getState().messages.some(m => m.id === reply.id)) updateMessage(reply.id, { content: reply.content, revision: reply.revision });
        else if (task.status === 'failed' && !task.results.length) addMessage(reply);
      }
    };
    const listener = (event: Event) => { void refreshReceipt(event).catch(() => undefined); };
    window.addEventListener('virtugene:secretary-updated', listener);
    return () => { alive = false; window.removeEventListener('virtugene:secretary-updated', listener); };
  }, [character?.id, character?.agentProfile, currentSessionId, userId, updateMessage, addMessage]);

  /** 朗读一条 AI 消息：优先角色声线（Edge 音色）；声线缺失/非法时现场分配性别正确的声线再播，
   *  分配超时才用默认音色兜底（保证点喇叭一定有声音，且默认兜底也是 Edge 音色而非系统音） */
  const handleSpeak = async (m: Message) => {
    if (!ttsEnabled) return;
    if (speakingKey === m.id) {
      stop();
      return;
    }
    const char = character;
    if (!char || !m.content.trim()) return;
    let voice = char.voice;
    if (!voice || !ALL_VOICES.some((v) => v.voice === voice?.voice)) {
      // 现场分配/修复（AI 先判性别再选音色），最多等 4s；超时/失败再默认音色兜底
      await Promise.race([
        useChatStore.getState().ensureCharacterVoice(char.id),
        new Promise((r) => setTimeout(r, 4000)),
      ]);
      const updated = useChatStore.getState().characters.find((c) => c.id === char.id);
      voice =
        updated?.voice && ALL_VOICES.some((v) => v.voice === updated.voice!.voice) ? updated.voice : undefined;
      if (!voice) voice = char.agentProfile === 'secretary' && char.secretaryAppearance === 'male' ? DEFAULT_MALE_VOICE : DEFAULT_VOICE;
    }
    // 语速/音调格式非法时回退默认（Edge 接口对非法 prosody 会拒单）
    const baseRate = /^[+-]\d+%$/.test(voice.rate) ? parseFloat(voice.rate) : 0;
    const combined = Math.round(baseRate * ttsSpeed);
    const rate = `${combined >= 0 ? '+' : ''}${combined}%`;
    const pitch = /^[+-]\d+Hz$/.test(voice.pitch) ? voice.pitch : DEFAULT_VOICE.pitch;
    void speak(m.id, m.content.trim().slice(0, 800), voice.voice, rate, pitch);
  };

  // Clear the reply banner when switching conversations, and reset the sending
  // state: 旧会话的"正在输入"与输入锁定不能带到新会话，否则切走后无法在新会话输入；
  // 同时停掉正在播放的语音（切角色/退出的旧句不再继续播）
  useEffect(() => {
    stop();
    setReplyingTo(null);
    const candidate = currentSessionId ? requestsRef.current.get(currentSessionId) : undefined;
    const pending = candidate?.userId === userId ? candidate : undefined;
    const settling = !!pending?.stopped && !pending.stream.published;
    setSending(!!pending && !settling);
    setSettlingReply(settling);
    setStreamingReply(pending?.stream.published && !pending.completed ? pending.stream : null);
    setReplyVisible(pending?.stream.published ?? false);
    setError(null);
    setSecretaryError(null);
  }, [currentSessionId, userId, stop]);

  // 首次进入单聊会话：会话未锁定模型 → 弹模型选择（选定后聊天中不可改）
  useEffect(() => {
    if (!currentSessionId) return;
    let cancelled = false;
    void (async () => {
        const s = await sessionRepo.getById(currentSessionId);
        if (cancelled || !s) return;
        if (s.type === 'group') return; // 群聊用全局默认，不弹
        // 只弹一次：选了具体模型（s.model）或选了"使用全局默认"（modelAsked）后都不再问
        if (!s.model && !s.modelAsked) setShowModelPick(true);
        // 刷新右上角「当前模型 + 消耗」元信息
        const m = resolveModel(character, s.model ?? null);
        setSessionSelection({ id: currentSessionId, model: s.model ?? null });
        setSessionMeta({ modelLabel: m.label, cost: s.cost });
      })();
      return () => {
        cancelled = true;
      };
    }, [currentSessionId, character]);

    // Focus the input when switching characters so the user can type immediately
    // （手机端不自动聚焦：由用户点击输入框进入聊天状态）
    useEffect(() => {
      if (IS_MOBILE) return;
      inputRef.current?.focus();
    }, [selectedCharacterId]);

    // Re-focus after sending finishes so the user can keep typing without clicking
    // （手机端不自动重新聚焦）
    useEffect(() => {
      if (IS_MOBILE) return;
      if (!sending) inputRef.current?.focus();
    }, [sending]);

    const rows = useMemo(() => {
      const result: { key: string; divider: string | null; message: Message; avatar: string; showIdentity: boolean }[] = [];
      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        const prev = messages[i - 1];
        const showDivider = !prev || msg.createdAt - prev.createdAt > FIVE_MINUTES;
        result.push({
          key: msg.id,
          divider: showDivider ? formatTimeLabel(msg.createdAt) : null,
          message: msg,
          avatar: msg.role === 'user' ? userAvatar : roleAvatar,
          // 每条消息都是独立的聊天气泡：连续发送时也重复显示头像，
          // 避免多条消息被误读成一整段合并文本。
          showIdentity: true,
        });
      }
      return result;
    }, [messages, userAvatar, character, roleAvatar]);

    const virtualizer = useVirtualizer({
      count: rows.length,
      getScrollElement: () => scrollRef.current,
      // 头像始终显示且连续气泡保留间距；提高初始估算，避免新消息尚未测量时互相覆盖。
      estimateSize: () => 84,
      overscan: 8,
      getItemKey: (index: number) => rows[index].key,
      // The installed virtualizer owns ID/measurement anchoring. Navigation
      // to appended output remains owned by useLatestMessageScroll below.
      anchorTo:'end',
      followOnAppend:false,
      scrollToFn:(offset,options,instance)=>{
        elementScroll(offset,options,instance);
        scrollController.current?.recognizeProgrammaticScroll(instance.scrollElement);
      },
    });

    // Keep scrolled to the latest message on new messages / session switch /
    // "对方正在输入"出现。以最后一条消息 id 为键：前插（加载更早消息）不会触发滚底。
    const lastRowKey = rows.length > 0 ? rows[rows.length - 1].key : null;

    const [followingLatest, setFollowingLatest] = useState(true);
    const scrollScope=JSON.stringify([userId,currentSessionId]);
    const scrollToLatest = useLatestMessageScroll(scrollRef, scrollScope, setFollowingLatest);
    scrollController.current=scrollToLatest;
    const [historyStatus,setHistoryStatus]=useState<{scope:string;loading:boolean;error:boolean}>();
    const historyRequest=useRef<{scope:string;ownership:HistoryScrollSnapshot;anchorId?:string;offset:number;loading:boolean}|null>(null);
    const historyFrame=useRef(0);
    useEffect(()=>()=>cancelAnimationFrame(historyFrame.current),[]);

    useEffect(() => {
      if (!lastRowKey) return;
      return scrollToLatest();
    }, [lastRowKey, scrollToLatest]);

    // 发送后「对方正在输入」出现在列表底部（虚拟列表之外的兄弟节点），
    // 新消息 id 没变，必须单独在 sending 变为 true 时再滚一次到底
    useEffect(() => {
      if (!sending || !lastRowKey) return;
      return scrollToLatest();
    }, [sending, lastRowKey, scrollToLatest]);

    // 输入框编辑时，键盘调整继续跟随最新消息；工具区展开则保留历史阅读位置。

    /** Preserve a visible identity, never replay an obsolete whole-list height. */
    const handleLoadEarlier = async () => {
      if(historyRequest.current?.scope===scrollScope&&historyRequest.current.loading)return;
      const ownership=scrollToLatest.captureHistory();if(!ownership)return;
      const el=ownership.element,box=el.getBoundingClientRect();
      const anchor=[...el.querySelectorAll<HTMLElement>('[data-message-id]')].find(node=>{const rect=node.getBoundingClientRect();return rect.bottom>box.top+1&&rect.top<box.bottom;});
      const request={scope:scrollScope,ownership,anchorId:anchor?.dataset.messageId,offset:anchor?anchor.getBoundingClientRect().top-box.top:0,loading:true};
      historyRequest.current=request;cancelAnimationFrame(historyFrame.current);
      setHistoryStatus({scope:scrollScope,loading:true,error:false});
      const owned=()=>historyRequest.current===request&&mountedRef.current&&useAuthStore.getState().userId===userId&&useChatStore.getState().currentSessionId===currentSessionId&&scrollRef.current===el&&el.isConnected;
      let failed=false;
      try{await loadEarlierMessages();}catch{failed=true;}
      finally{
        request.loading=false;
        if(owned()){
          setHistoryStatus({scope:scrollScope,loading:false,error:failed});
          historyFrame.current=requestAnimationFrame(()=>{
            historyFrame.current=0;
            if(!owned()||!scrollToLatest.historyCurrent(ownership)||!request.anchorId)return;
            const node=[...el.querySelectorAll<HTMLElement>('[data-message-id]')].find(row=>row.dataset.messageId===request.anchorId);
            if(!node)return; // Removed/unrendered anchors have no guessed fallback.
            const delta=node.getBoundingClientRect().top-el.getBoundingClientRect().top-request.offset;
            if(Math.abs(delta)>.75)scrollToLatest.restoreHistory(ownership,el.scrollTop+delta);
          });
        }
      }
    };

    const handleSend = async (text: string) => {
      const sessionId = currentSessionId;
      if (!sessionId || !character || !hasAiAccess && character.agentProfile !== 'secretary') return;
      if (character.agentProfile === 'secretary' && character.secretaryStatus === 'dismissed') { setShowSecretaryPersonality(true); return; }

      setError(null);

      const replyTarget = replyingTo;
      const apiMessage = replyTarget
        ? `（你在引用这条消息：「${replyTarget.content}」）\n${text}`
        : text;

      // Save user message
      const userMsg: Message = {
        id: crypto.randomUUID(),
        sessionId,
        role: 'user',
        content: text,
        createdAt: Date.now(),
        isProactive: false,
        ...(replyTarget ? { replyToId: replyTarget.id, replyToContent: replyTarget.content } : {}),
        ...(workspace?.todoContext ? { secretaryTodoContext: workspace.todoContext } : {}),
      };
      await performSendSafely(text, apiMessage, userMsg, undefined, true);
    };

    /** 发送图片消息（微信式：图片为主，文字可选） */
    const handleSendImage = async (dataUrl: string) => {
      const sessionId = currentSessionId;
      if (!sessionId || !character || !hasAiAccess) return;
      setError(null);
      const userMsg: Message = {
        id: crypto.randomUUID(),
        sessionId,
        role: 'user',
        content: '',
        image: dataUrl,
        createdAt: Date.now(),
        isProactive: false,
      };
      // 图片消息触发 AI 回复：真实图片交给视觉模型（角色真正看得到图）
      await performSendSafely('[图片]', '[图片]', userMsg, dataUrl, true);
    };

    /** 发送语音消息（微信式）：录音转文字作为 content 发给 AI（AI 理解文字），音频存消息可回听 */
    const handleSendVoice = async (voice: { dataUrl: string; duration: number; text: string }) => {
      const sessionId = currentSessionId;
      if (!sessionId || !character || !hasAiAccess) return;
      const text = voice.text.trim();
      if (!text) return;
      setError(null);
      const userMsg: Message = {
        id: crypto.randomUUID(),
        sessionId,
        role: 'user',
        content: text,
        audio: voice,
        createdAt: Date.now(),
        isProactive: false,
      };
      // 语音内容（转文字）正常走 AI 回复管线
      await performSendSafely(text, text, userMsg, undefined, true);
    };

    /** 微信式重发：点击失败消息的红色感叹号，重发原内容（复用同一消息记录） */
    const handleRetry = async (failedMsg: Message) => {
      if (!currentSessionId || !character || !hasAiAccess || sending) return;
      if (failedMsg.sessionId !== currentSessionId) return;
      if (failedMsg.secretaryDispatch) {
        const { updateCharacterDispatch } = await import('../../lib/secretary/character-messaging');
        const task = await db.secretaryTasks.get(failedMsg.secretaryDispatch.taskId);
        if (!task || task.userId !== userId) { setError('server:error'); return; }
        setSending(true);
        try { await updateCharacterDispatch(userId, task.id, task.updatedAt, { send: true }); }
        catch { if (mountedRef.current && useChatStore.getState().currentSessionId === failedMsg.sessionId) setError('server:error'); }
        finally { if (mountedRef.current && useAuthStore.getState().userId === userId && useChatStore.getState().currentSessionId === failedMsg.sessionId) setSending(false); }
        return;
      }
      const apiMessage = failedMsg.replyToContent
        ? `（你在引用这条消息：「${failedMsg.replyToContent}」）\n${failedMsg.content}`
        : failedMsg.content;
      await performSendSafely(failedMsg.content, apiMessage, failedMsg, failedMsg.image);
    };

    /** 长按"记住"：把消息内容存入角色记忆（用户显式想让角色记住） */
    const rememberLock = useRef(false);
    const handleRemember = async (m: Message) => {
      if (!character || !currentSessionId || rememberLock.current || m.sessionId !== currentSessionId) return;
      const actor = character.id, session = currentSessionId, owner = userId;
      const current = () => mountedRef.current && useAuthStore.getState().userId === owner
        && useChatStore.getState().currentSessionId === session && useChatStore.getState().selectedCharacterId === actor;
      rememberLock.current = true;
      try {
        const now = Date.now();
        const receipt = await memoryRepo.remember({
          id: crypto.randomUUID(),
          characterId: character.id,
          userId,
          content: m.content.slice(0, 200),
          type: 'auto',
          pinned: true,
          ...prepareMemoryMetadata(m.content.slice(0, 200), { kind: 'episode', pinned: true, stability: 'stable', confidence: 1 }),
          createdAt: now,
          // 溯源：用户手动记住的记忆，明确指向这一条消息
          sourceSessionId: currentSessionId,
          sourceMessageIds: [m.id],
          sourceMessageRevisions: { [m.id]: m.revision ?? 1 },
          confidence: 1,
          updatedAt: now,
        }, current);
        if (current()) publishMemoryWrite(receipt);
      } catch {
        if (current()) feedback('这条记忆没有保存，请重试。', { tone: 'error' });
      } finally { rememberLock.current = false; }
    };

    /**
     * 长按"收藏为共同记忆"（5.0）：把这条消息变成你们**共同经历过**的事。
     *
     * 与「记住」的分工：记住 = 关于用户的事实（memories）；收藏 = 你们之间发生的事（sharedMemories）。
     * 写入全部在世界层完成（world-writer 的纯本地事务），**不产生任何 AI 调用**。
     */
    const handleCollectMemory = async (m: Message) => {
      if (!character || !userId) return;
      try {
        const result = await collectMessageAsSharedMemory({
          userId,
          characterId: character.id,
          message: m,
        });
        setCollectedIds((prev) => new Set(prev).add(m.id));
        setCollectNotice(result.created ? 'created' : 'exists');
      } catch {
        // 记忆没存上要如实告诉用户（不能假装成功）
        setCollectNotice('failed');
      }
    };

    // Keep row callbacks stable while forwarding to the latest committed
    // session/character handlers. Scrolling must not rerender every bubble,
    // and actions must never capture an obsolete account or sending state.
    const messageActionsRef = useRef({ retry: handleRetry, remember: handleRemember, collect: handleCollectMemory, speak: handleSpeak });
    useLayoutEffect(() => {
      messageActionsRef.current = { retry: handleRetry, remember: handleRemember, collect: handleCollectMemory, speak: handleSpeak };
    });
    const messageActions = useMemo(() => ({
      retry: (m: Message) => { void messageActionsRef.current.retry(m); },
      remember: (m: Message) => { void messageActionsRef.current.remember(m); },
      collect: (m: Message) => { void messageActionsRef.current.collect(m); },
      speak: (m: Message) => { void messageActionsRef.current.speak(m); },
    }), []);
    const deleteBubbleMessage = useCallback((m: Message) => {
      void deleteMessage(m.id).then(() => feedback('消息已删除', { tone: 'success' })).catch(() => feedback('消息未能删除，请重试', { tone: 'error' }));
    }, [deleteMessage, feedback]);

    // 已收藏的消息 id：进入某个角色的会话时读一次（一次查询，不逐条查）
    useEffect(() => {
      if (!userId || !character) return;
      let alive = true;
    void (async () => {
        try {
          const world = await worldRepo.ensureDefaultWorld(userId);
          const ids = await sharedMemoryRepo.listSourceIds(userId, world.id, MEMORY_SOURCE_TYPE);
          if (alive) setCollectedIds(new Set(ids));
        } catch {
          /* 世界层读不到不影响聊天：菜单只是少一个"已收藏"标记 */
        }
      })();
      return () => { alive = false; };
    }, [userId, character]);

    // 收藏反馈自动消失（留足时间让用户点「去世界看看」）
    useEffect(() => {
      if (!collectNotice) return;
      const timer = setTimeout(() => setCollectNotice(null), 4000);
      return () => clearTimeout(timer);
    }, [collectNotice]);

    /** 核心发送管线：构建上下文 → 调 API（带自检重试）→ 落库/上屏；失败则把用户消息标记为失败态 */
    const performSend = async (text: string, apiMessage: string, userMsg: Message, image: string | undefined, request: ChatRequest) => {
      const sessionId = userMsg.sessionId;
      if (!character || !hasAiAccess && character.agentProfile !== 'secretary') return;

      // 进入发送管线的第一刻就锁住输入区。上下文读取包含多次本地数据库查询，
      // 如果等到 API 即将发出才设置 sending，用户会在这段空档里重复提交同一条消息。
      setSending(true);

      // 重发场景：先清除失败标记
      if (userMsg.failed) {
        await messageRepo.markFailed(userMsg.id, false);
        updateMessage(userMsg.id, { failed: false });
      }

      if (character.agentProfile === 'secretary') {
        const { runSecretaryRequest, secretaryReply } = await import('../../lib/secretary/agent');
        const task = await runSecretaryRequest(userId, character.id, userMsg);
        if (useAuthStore.getState().userId !== userId) return;
        await workspace?.onTodoHandled?.(task.results);
        const id = `secretary-reply:${userMsg.id}`;
        const existing = await messageRepo.getById(id);
        if (!existing) {
          const reply: Message = { id, sessionId, role: 'assistant', content: secretaryReply(task), createdAt: Date.now(), isProactive: false, secretaryTaskId: task.id };
          await messageRepo.create(reply);
          addMessage(reply);
        }
        else if (useChatStore.getState().currentSessionId === sessionId && !useChatStore.getState().messages.some(m => m.id === id)) addMessage(existing);
        await sessionRepo.touch(sessionId);
        return;
      }

      await sendRoleChatReply(character, userMsg, request, {
        userId, text, apiMessage, image,
        observer: { isMounted: () => mountedRef.current,
          onError: error => setError(error as ChatError),
          onCost: cost => setSessionMeta(meta => ({ ...meta, cost })),
          onComplete: () => { setStreamingReply(null); setReplyVisible(true); },
        },
      });
};

// 本地上下文读取也属于发送流程：如果数据库读取或状态同步在调用模型前失败，
// 统一收口到失败消息，避免输入框一直保持“发送中”而无法重试。
const performSendSafely = async (text: string, apiMessage: string, userMsg: Message, image?: string, saveUser = false) => {
    const sessionId = userMsg.sessionId;
    if (requestsRef.current.has(sessionId)) return;
    const request: ChatRequest = { controller: new AbortController(), userId, stopped: false, completed: false,
      stream: new ChatReplyStream(sessionId, () => {
        request.stream.ids.forEach(id => streamedReplyIdsRef.current.add(id));
        if (mountedRef.current && useAuthStore.getState().userId === userId && useChatStore.getState().currentSessionId === sessionId) {
          setStreamingReply(request.stream); setReplyVisible(true);
        }
      }) };
    requestsRef.current.set(sessionId, request); // Synchronous lock, before the first DB await.
    setSecretaryError(null);
    setSettlingReply(false);
    setSending(true); setReplyVisible(false); setStreamingReply(null);
    // Show the sender's message before local persistence/model preparation.
    // A failed write stays visible and can be persisted again on retry.
    if (saveUser) { addMessage(userMsg); scrollToLatest(true); }
    let userSaved = !saveUser;
    try {
      await withChatSessionLock(sessionId, async () => {
      if (request.controller.signal.aborted || useAuthStore.getState().userId !== userId) return;
      if (saveUser || !await messageRepo.getById(userMsg.id)) {
        await messageRepo.create(userMsg);
        userSaved = true;
        if (mountedRef.current && useAuthStore.getState().userId === userId && !request.controller.signal.aborted) confirm();
        await sessionRepo.touch(sessionId);
        if (useChatStore.getState().currentSessionId === sessionId) setReplyingTo(null);
      }
      if (useAuthStore.getState().userId !== userId || request.controller.signal.aborted) return;
      await performSend(text, apiMessage, userMsg, image, request);
      });
    } catch (cause) {
      if (useAuthStore.getState().userId !== userId) return;
      if (request.controller.signal.aborted && userSaved) return;
      const sameAccount=()=>useAuthStore.getState().userId===userId;
      const marked=!!character&&await messageRepo.markFailedIfUnchanged(userMsg,userId,character.id,sameAccount).catch(()=>false);
      // An input whose first local write failed still needs its retry button.
      // This fallback changes only the matching local bubble, never a replaced
      // database row or a newer message revision already shown in the UI.
      const unsavedLocal=!userSaved&&!marked&&await messageRepo.getById(userMsg.id).then(row=>!row,()=>true);
      const shown=useChatStore.getState().messages.find(message=>message.id===userMsg.id);
      if(!(marked||unsavedLocal)||!sameAccount()||!sameMessageFailureSource(shown,userMsg))return;
      updateMessage(userMsg.id, { failed: true });
      if (!request.controller.signal.aborted && mountedRef.current && useChatStore.getState().currentSessionId === userMsg.sessionId) {
        if (character?.agentProfile === 'secretary') { setError(null); setSecretaryError(secretaryFailureMessage(cause)); }
        else setError('server:error');
      }
    } finally {
      request.stream.dispose();
      if (requestsRef.current.get(sessionId) === request) requestsRef.current.delete(sessionId);
      if (mountedRef.current && useAuthStore.getState().userId === userId && useChatStore.getState().currentSessionId === sessionId) {
        setSending(false); setSettlingReply(false); setStreamingReply(null); setReplyVisible(false);
      }
    }
};

/** 长会话滚动摘要：超出保留窗口的早期对话压缩成摘要，持久化到会话 */


// 「把日记发给角色」：日记文本已作为用户消息落库（shareDiaryToCharacter），
// 这里在当前会话匹配时触发 AI 回复管线，然后消费掉标记。
const pendingDiarySend = useChatStore((s) => s.pendingDiarySend);
const consumeDiarySend = useChatStore((s) => s.consumeDiarySend);
useEffect(() => {
    if (!pendingDiarySend) return;
    const { sessionId, text } = pendingDiarySend;
    if (sessionId !== currentSessionId) return;
    const userMsg = messages.find((m) => m.sessionId === sessionId && m.role === 'user' && m.content === text);
    if (!userMsg) return;
    consumeDiarySend();
    // 下一帧再触发，让消息先渲染上屏
    const t = setTimeout(() => {
      void performSendSafely(text, text, userMsg);
    }, 80);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
}, [pendingDiarySend, currentSessionId]);

/** 微信式返回：聊天 → 回到上一级。
 *  从会话列表推入的（chatFromList）→ 回到会话列表（不跳「角色」页）；
 *  从角色页推入的（chatFromCharacters）→ 回到角色列表；
 *  直接点底部「聊天」tab 进入的 → 回会话列表。 */
const backToCharacters = () => {
    if (character) beginSoulHandoff(`avatar:${character.id}`,soulElement(`avatar:${character.id}`,'chat'),'list');
    const ui = useUIStore.getState();
    if (ui.chatFromCharacters) {
      ui.setChatFromCharacters(false);
    } else {
      ui.setChatFromList(false);
      ui.setMobileTab('chat');
    }
};

return (
    <SwipeBackView
      enabled={IS_MOBILE && !!character && !workspace}
      onBack={backToCharacters}
    >
    <div ref={roomRef} className={`chat-room vg-chat-atmosphere h-full flex flex-col${character?.agentProfile === 'secretary' ? ' vg-secretary-room' : ' vg-chat-paper'}${surface === 'light-paper' && character?.agentProfile !== 'secretary' ? ' vg-light-paper' : ''}`} data-paper-material={surface === 'light-paper' && atmosphere.config.mode === 'clean' ? 'true' : undefined} data-chat-atmosphere={atmosphere.primary} data-chat-motion={atmosphere.motion} data-chat-phase={sending ? replyVisible ? 'streaming' : 'waiting' : 'idle'} style={atmosphere.style}>
      {character && <ChatBackgroundLayer key={`background:${userId}:${character.id}`} config={atmosphere.config} userId={userId} onImageError={reportBackgroundImageError}/>}
      {/* Header */}
      {!workspace && <div className="chat-header relative z-30 min-h-14 py-2 flex items-center gap-1 px-3 sm:px-4 border-b border-line shrink-0 bg-gradient-to-r from-gene-purple/[0.07] via-transparent to-life-cyan/[0.05]">
        <div className="absolute bottom-0 left-4 right-4 h-px bg-gradient-to-r from-transparent via-gene-purple/45 to-transparent" />
        {/* 手机端返回角色页（微信式）：聊天 → 回到选人界面 */}
        {IS_MOBILE && (
          <button
            onClick={backToCharacters}
            title="返回"
            aria-label="返回"
            className="shrink-0 w-11 h-11 -ml-1 flex items-center justify-center rounded-lg text-gray-500 hover:bg-surface hover:text-ink active:bg-surface-strong transition-colors"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
        )}
        {character && (
          <button type="button" aria-label={`查看${character.name}的角色详情`} onClick={()=>character.agentProfile==='secretary'?setShowSecretaryPersonality(true):setShowProfile(true)} key={`title-${selectedCharacterId}`} style={{ minWidth: 0 }} className={`chat-header-title min-w-0 ${character.agentProfile==='secretary'?'absolute left-1/2 max-w-[calc(100%-14rem)] -translate-x-1/2 text-center':'relative flex-1 text-left'} animate-fade-in`}>
            {IS_MOBILE && <span className="vg-chat-avatar-frame"><Avatar avatar={roleAvatar} size="sm" loading="eager" fallback={character.name.slice(0,1)||'TA'} className="vg-chat-identity-avatar !w-8 !h-8 !text-base" soulKey={`avatar:${character.id}`} soulRole="chat" /></span>}
            <div className="vg-chat-identity-copy min-w-0 overflow-hidden"><div role="heading" aria-level={1} title={character.name} className="text-base sm:text-lg font-semibold leading-tight text-ink truncate">{character.name}</div>
            {IS_MOBILE ? <div className={`vg-chat-presence${replyWaiting ? ' is-responding' : ''}${sending && replyVisible ? ' is-streaming' : ''}`}>
              {replyWaiting ? <span role="status" aria-label="正在回应">正在回应</span> : <span>{character.agentProfile === 'secretary' ? character.secretaryStatus === 'dismissed' ? '助理空缺 · 记录保留' : '生活助理' : '陪伴聊天'}</span>}
            </div> : replyWaiting && <div role="status" aria-label="正在回应" className="mt-0.5 text-xs text-life-cyan">正在回应</div>}</div>
          </button>
        )}
        {character?.agentProfile === 'secretary' && <div className="flex-1 min-w-0" />}
        {character && character.agentProfile !== 'secretary' && openVoiceCall && <button type="button" aria-label={callLabel} title={callLabel} disabled={callDisabled} onClick={openVoiceCall} className="shrink-0 flex h-11 w-11 items-center justify-center rounded-xl text-sub hover:bg-surface disabled:opacity-40"><Icon name="phone" size={21}/></button>}
        {character?.agentProfile === 'secretary' && <ActionCabinLauncher from="chat" compact emotion={sending?'thinking':'idle'} />}
        {character?.agentProfile === 'secretary' ? <SecretaryMoreMenu key={character.id} onInbox={() => setShowSecretaryInbox(true)} onReview={() => setShowSecretaryDailyReview(true)} onManage={() => setShowSecretaryPersonality(true)} disabled={sending || character.secretaryStatus === 'dismissed'} /> : (
          <ChatHeaderMoreMenu key={`${userId}:${selectedCharacterId}:${currentSessionId}`} character={character} sessionId={currentSessionId ?? undefined} modelLabel={sessionMeta.modelLabel} cost={sessionMeta.cost} callDisabled={callDisabled} callLabel={callLabel} onVoiceCall={openVoiceCall} />
        )}
      </div>}

      {character && currentSessionId && character.agentProfile !== 'secretary' && <ChatCallNotice userId={userId} characterId={character.id} sessionId={currentSessionId}/>}

      {/* Messages — 桌面端点击空白聚焦输入（像微信）；
          手机端不全局聚焦：只有点输入框才弹键盘（避免点喇叭/气泡误弹） */}
      {character?.agentProfile === 'secretary' && <SecretaryQuickActions embedded={!!workspace} key={`actions-${character.id}`} busy={sending} vacant={character.secretaryStatus === 'dismissed'} onDraft={draft => { inputRef.current?.setDraft(draft); inputRef.current?.focus(); }} onSend={request => { void handleSend(request); }} onInbox={workspace?.onInbox ?? (() => setShowSecretaryInbox(true))} onManage={workspace?.onManage ?? (() => setShowSecretaryPersonality(true))} onReview={workspace?.onReview ?? (() => setShowSecretaryDailyReview(true))} />}
      {showSecretaryPersonality && character?.agentProfile === 'secretary' && <SecretaryPersonalityModal key={`management-${character.id}`} character={character} open onClose={() => setShowSecretaryPersonality(false)} />}
      {showSecretaryInbox && character?.agentProfile === 'secretary' && <SecretaryInboxModal key={`inbox-${character.id}`} character={character} open busy={sending} onClose={() => setShowSecretaryInbox(false)} onDraft={request => { setShowSecretaryInbox(false); inputRef.current?.setDraft(request); inputRef.current?.focus(); }} />}
      {showSecretaryDailyReview && character?.agentProfile === 'secretary' && <SecretaryDailyReviewModal key={`review-${character.id}`} character={character} open onClose={() => setShowSecretaryDailyReview(false)} />}

      <div key={`thread:${currentSessionId}`} ref={scrollRef} role="region" aria-label="聊天记录" tabIndex={-1} className="chat-thread immersive-chat-scroll animate-message-in flex-1 overflow-y-auto px-4 py-3" onClick={IS_MOBILE ? undefined : () => inputRef.current?.focus()}>
        {messages.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            {character && (
              <div className={`opening-scene max-w-sm text-center px-7 py-8${character.agentProfile === 'secretary' ? ' vg-secretary-opening' : ''}`}>
                <div className="opening-orbit mx-auto mb-5"><Avatar avatar={roleAvatar} size="lg" className="h-full w-full" /></div>
                <p className="text-xs text-sub">{character.agentProfile === 'secretary' ? '你的生活助理' : '陪伴聊天'}</p>
                <h2 className="mt-2 text-lg font-semibold text-ink">{character.name}</h2>
                <p className="mt-3 text-[13px] leading-7 text-gray-500">{character.greeting || '你来了。'}</p>
                <button onClick={() => character.agentProfile === 'secretary' && character.secretaryStatus === 'dismissed' ? setShowSecretaryPersonality(true) : inputRef.current?.focus()} className="mt-5 opening-action">{character.agentProfile === 'secretary' ? character.secretaryStatus === 'dismissed' ? '聘用新的助理' : '交代第一件事' : '和 TA 说句话'}</button>
              </div>
            )}
            <p className={character ? 'hidden' : 'text-xs text-gray-600'}>
              {character ? '从一句真实的话开始，让这段连接慢慢生长。' : '去「角色」页选一个角色，开始一段新的连接。'}
            </p>
          </div>
        ) : (
          <>
            {(hasMoreMessages||historyStatus?.scope===scrollScope)&&(
              <div className="vg-chat-history-load">
                {hasMoreMessages?<>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleLoadEarlier();
                  }}
                  disabled={historyStatus?.scope===scrollScope&&historyStatus.loading}
                  aria-busy={historyStatus?.scope===scrollScope&&historyStatus.loading}
                  data-read-error={historyStatus?.scope===scrollScope&&historyStatus.error?'true':undefined}
                >
                  <Icon name="clock" size={16}/>{historyStatus?.scope===scrollScope&&historyStatus.loading?'正在读取…':historyStatus?.scope===scrollScope&&historyStatus.error?'读取失败，重试':'加载更早的消息'}
                </button>
                {historyStatus?.scope===scrollScope&&historyStatus.error&&<span className="sr-only" role="alert">更早的消息暂时没有读到，已显示的聊天仍保留，可重试。</span>}
                </>:<span role="status">已到最早的消息</span>}
              </div>
            )}
            <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
            {virtualizer.getVirtualItems().map((vi: { index: number; start: number }) => {
              const row = rows[vi.index];
              return (
                <div
                  key={row.key}
                  data-index={vi.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${vi.start}px)`,
                  }}
                >
                  {row.divider && (
                    <div className="flex justify-center my-3">
                      <span className="text-xs text-gray-500 bg-panel px-3 py-0.5 rounded-full">
                        {row.divider}
                      </span>
                    </div>
                  )}
                  <MessageBubble
                    message={row.message}
                    avatar={row.avatar}
                    streamed={streamedReplyIdsRef.current.has(row.message.id)}
                    animate={!streamedReplyIdsRef.current.has(row.message.id) && Date.now() - row.message.createdAt < 800}
                    isLatest={!streamedReplyIdsRef.current.has(row.message.id) && vi.index === rows.length - 1}
                    onQuote={setReplyingTo}
                    onReviewSpeech={character && !character.isPreset && !character.published && character.createdBy === userId && character.agentProfile !== 'secretary' ? setSpeechMessage : undefined}
                    onDelete={deleteBubbleMessage}
                    onRetry={messageActions.retry}
                    onSpeak={row.message.role === 'assistant' && ttsEnabled ? messageActions.speak : undefined}
                    speakKey={row.message.id}
                    speakingKey={speakingKey}
                    busyKey={busyKey}
                    showIdentity={row.showIdentity}
                    onRemember={character?.agentProfile === 'secretary' ? undefined : messageActions.remember}
                    onCollectMemory={character?.agentProfile === 'secretary' ? undefined : messageActions.collect}
                    collected={collectedIds.has(row.message.id)}
                    onShowBasis={character?.agentProfile === 'secretary' ? undefined : setBasisMessage}
                  />
                  {row.message.secretaryTaskId && character?.agentProfile === 'secretary' && <Suspense fallback={null}><SecretaryTaskCards taskId={row.message.secretaryTaskId} busy={sending} onAnswer={answer => { void handleSend(answer); }} /></Suspense>}
                </div>
              );
            })}
            </div>
          </>
        )}
        {character?.agentProfile !== 'secretary' && streamingReply?.sessionId === currentSessionId && <StreamingReply key={currentSessionId} stream={streamingReply} avatar={roleAvatar} />}
      </div>

      {character?.agentProfile === 'secretary' && secretaryError ? <div role="alert" className="mx-4 mb-2 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-2 text-sm text-red-400 break-words">{secretaryError}</div> : <BalanceBanner error={error} />}
      {rows.length > 0 && <div className="vg-latest-message-anchor" data-visible={!followingLatest} aria-hidden={followingLatest} inert={followingLatest}><button type="button" tabIndex={followingLatest ? -1 : 0} className="vg-latest-message-button" aria-label="回到最新消息" onClick={event => { if (event.detail === 0) scrollRef.current?.focus({ preventScroll: true }); scrollToLatest(true, 'smooth'); }}><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14m-6-6 6 6 6-6" /></svg>回到最新</button></div>}

      {showProfile&&character&&<Suspense fallback={null}><CharacterProfileModal character={character} userId={userId} sessionId={currentSessionId} onClose={()=>setShowProfile(false)} onChat={()=>setShowProfile(false)}/></Suspense>}

      {/* 收藏反馈：世界层在另一个页面，必须让用户知道"真的记住了"并给一条去路 */}
      {collectNotice && (
        <div className="fixed bottom-24 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-2xl border border-life-cyan/30 bg-panel/95 px-4 py-2.5 shadow-2xl backdrop-blur-xl animate-fade-in">
          <span className="text-xs text-ink">
            {collectNotice === 'created' && '已收藏为共同记忆'}
            {collectNotice === 'exists' && '这条已经是你们的共同记忆'}
            {collectNotice === 'failed' && '没能存下来，稍后再试'}
          </span>
          {collectNotice !== 'failed' && (
            <button
              type="button"
              onClick={() => {
                setCollectNotice(null);
                // 与底部一级导航 switchTab('world') 同一套语义：
                // 清掉"从列表/角色页推入聊天"的标记并复位覆盖页，确保真的落到世界页
                const ui = useUIStore.getState();
                ui.setChatFromList(false);
                ui.setChatFromCharacters(false);
                ui.setActiveView('chat');
                ui.setMobileTab('world');
              }}
              className="shrink-0 text-xs font-medium text-life-cyan"
            >
              去世界看看 →
            </button>
          )}
        </div>
      )}

      {/* 记忆依据：只展示本机真实注入过的数据（已删除的条目会显示为"已不存在"） */}
      {speechMessage && character && speechMessage.sessionId === currentSessionId && character.createdBy === userId && <Suspense fallback={null}><ReviewedSpeechModal key={`${userId}:${character.id}:${speechMessage.id}`} character={character} message={speechMessage} onClose={() => setSpeechMessage(null)} /></Suspense>}
      {basisMessage && (
        <Suspense fallback={null}>
          <MemoryBasisModal
            open
            onClose={() => setBasisMessage(null)}
            trace={basisMessage.contextTrace}
            characterName={character?.name ?? ''}
          />
        </Suspense>
      )}

      {/* 首次进入聊天：选择对话模型（选定后锁定，聊天中不可改） */}
      {showModelPick && currentSessionId && (
        <ModelPickModal
          onClose={() => {
            // 关闭也标记已问过（避免每次进入都弹）
            void sessionRepo.update(currentSessionId!, { modelAsked: true });
            setShowModelPick(false);
          }}
          onPick={(m) => {
            setSessionSelection({ id: currentSessionId!, model: m });
            setSessionMeta(meta => ({ ...meta, modelLabel: resolveModel(character, m).label }));
            void sessionRepo.update(currentSessionId!, { model: m ?? undefined, modelAsked: true });
            setShowModelPick(false);
          }}
        />
      )}

      {/* Reply banner */}
      {replyingTo && (
        <div className="flex items-center gap-2 pl-4 pr-2 border-t border-line bg-panel">
          <span className="text-xs text-life-cyan">引用</span>
          <span className="text-sm text-sub flex-1 truncate">{replyingTo.content}</span>
          <button
            type="button"
            onClick={() => setReplyingTo(null)}
            className="w-11 h-11 shrink-0 flex items-center justify-center rounded-xl text-sub hover:text-ink hover:bg-surface transition-colors"
            title="取消引用"
            aria-label="取消引用"
          >
            <Icon name="close" size={18} />
          </button>
        </div>
      )}

      <div className="vg-chat-composer-dock shrink-0">
        {character&&character.agentProfile!=='secretary'&&<div className="vg-chat-orb-dock"><CharacterSoulOrb character={character} sending={sending} streaming={replyVisible} failed={!!error} quiet={sending&&replyVisible}/></div>}
      <ChatInput key={JSON.stringify([userId, currentSessionId])} draftOwnerId={userId} draftSessionId={currentSessionId ?? undefined} ref={inputRef} onSend={handleSend} onSendImage={IS_MOBILE ? handleSendImage : undefined} onSendVoice={IS_MOBILE ? handleSendVoice : undefined}
        onStop={sending && character?.agentProfile !== 'secretary' ? () => { const request = currentSessionId ? requestsRef.current.get(currentSessionId) : undefined; if (request) { request.stopped = true; request.controller.abort(); if (!request.stream.published) { setSending(false); setSettlingReply(true); } } } : undefined}
        sendBlocked={settlingReply}
        disabled={sending || showVoiceCall || character?.secretaryStatus === 'dismissed'} onFocusInput={() => scrollToLatest()} />
      </div>
    </div>
    </SwipeBackView>
);
}
