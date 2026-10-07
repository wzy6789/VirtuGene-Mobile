import { lazyFeature } from '../ui/lazyFeature';
import { ActionCabinLauncher } from '../todo/ActionCabinLauncher';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, lazy, Suspense } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useLatestMessageScroll } from '../ui/useLatestMessageScroll';
import { AnimatedValue } from '../ui/AnimatedValue';
import { useChatStore } from '../../store/chat-store';
import { beginSoulHandoff, soulElement } from '../../lib/soul-handoff';
import { confirm } from '../../lib/haptics';
import { useCharacterStateStore } from '../../store/character-state-store';
import { useFeedback } from '../../lib/feedback';
import { useAuthStore, DEFAULT_USER_AVATAR } from '../../store/auth-store';
import { useSettingsStore } from '../../store/settings-store';
import { MessageBubble } from './MessageBubble';
import { StreamingReply } from './StreamingReply';
import { ChatReplyStream } from '../../lib/chat-stream';
import { Avatar } from '../ui/Avatar';
import { ChatInput } from './ChatInput';
import type { ChatInputHandle } from './ChatInput';
import { BalanceBanner, type ChatError } from './BalanceBanner';
import { ChatHeaderMoreMenu } from './ChatHeaderMoreMenu';
import { getRelationLevel } from '../../lib/affinity';
import { SwipeBackView } from '../ui/SwipeBackView';
import { IS_MOBILE } from '../../lib/platform';
import { messageRepo } from '../../db/message-repo';
import { sessionRepo } from '../../db/session-repo';
import { memoryRepo } from '../../db/memory-repo';
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
import { CharacterSoulOrb } from './CharacterSoulOrb';
import { useOrbAttention } from '../../lib/use-orb-attention';

const ImmersiveSceneCard = lazyFeature(() => import('./ImmersiveSceneCard').then(m => ({ default: m.ImmersiveSceneCard })));
const SecretaryMoreMenu = lazyFeature(() => import('../secretary/SecretaryMoreMenu').then(m => ({default:m.SecretaryMoreMenu})));
const SecretaryTaskCards = lazyFeature(() => import('./SecretaryTaskCards').then(m => ({ default: m.SecretaryTaskCards })));
const SecretaryPersonalityModal = lazyFeature(() => import('../secretary/SecretaryPersonalityModal').then(m => ({ default: m.SecretaryPersonalityModal })));
const SecretaryInboxModal = lazyFeature(() => import('../secretary/SecretaryInboxModal').then(m => ({ default: m.SecretaryInboxModal })));
const SecretaryDailyReviewModal = lazyFeature(() => import('../secretary/SecretaryDailyReviewModal').then(m => ({ default: m.SecretaryDailyReviewModal })));

// 记忆依据弹窗只在长按菜单里用到：与手账/群聊同一套按需加载策略，不进首屏主包
const MemoryBasisModal = lazy(() => import('./MemoryBasisModal').then((m) => ({ default: m.MemoryBasisModal })));

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
  workspace?: { onInbox: () => void; onManage: () => void; onReview: () => void; draft?: { id: number; text: string }; onBusy: (busy: boolean) => void; todoContext?: import('../../lib/secretary/workspace-todo').SecretaryTodoContext; onTodoHandled?: (results: import('../../lib/secretary/types').SecretaryResult[]) => Promise<void> };
}

/** 心情 → 小表情（气泡角上显示） */
function moodEmoji(mood: number): string {
  if (mood >= 75) return '😊';
  if (mood >= 55) return '🙂';
  if (mood >= 40) return '😐';
  if (mood >= 25) return '😕';
  return '😠';
}

export function ChatWindow({ emotionToggle, workspace }: ChatWindowProps) {
  const messages = useChatStore((s) => s.messages);
  const currentSessionId = useChatStore((s) => s.currentSessionId);
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
  const charMood = useCharacterStateStore((s) => s.mood);
  const affinity = useCharacterStateStore((s) => s.affinity);
  const scrollRef = useRef<HTMLDivElement>(null);
  const roomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<ChatInputHandle>(null);
  useEffect(() => { if (workspace?.draft) inputRef.current?.setDraft(workspace.draft.text); }, [workspace?.draft?.id]);
  const fillSceneDraft = useCallback((text: string) => inputRef.current?.setDraft(text), []);

  const [sending, setSending] = useState(false);
  useEffect(() => { workspace?.onBusy(sending); }, [sending, workspace?.onBusy]);
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
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  /** 记忆依据（长按消息 → 查看这条回复参考了哪些本地记忆/未完成事件/共同事件） */
  const [basisMessage, setBasisMessage] = useState<Message | null>(null);
  /** 已收藏为共同记忆的消息 id（长按菜单据此显示"已是共同记忆"） */
  const [collectedIds, setCollectedIds] = useState<Set<string>>(() => new Set());
  /** 收藏后的明确反馈（世界层是另一个页面，没有反馈用户会以为没生效） */
  const [collectNotice, setCollectNotice] = useState<'created' | 'exists' | 'failed' | null>(null);
  /** 首次进入聊天：会话未锁定模型时弹出模型选择（选定后聊天中不可改） */
  const [showModelPick, setShowModelPick] = useState(false);
  const [showSecretaryPersonality, setShowSecretaryPersonality] = useState(false);
  const [showSecretaryInbox, setShowSecretaryInbox] = useState(false);
  const [showSecretaryDailyReview, setShowSecretaryDailyReview] = useState(false);
  useEffect(() => { setShowSecretaryPersonality(false); setShowSecretaryInbox(false); setShowSecretaryDailyReview(false); }, [selectedCharacterId, userId]);
  /** 会话元信息：当前模型 + 累计消耗（右上角设置展示） */
  const [sessionMeta, setSessionMeta] = useState<{ modelLabel: string; cost?: { calls: number; inputTokens: number; outputTokens: number; cost: number } }>({ modelLabel: '' });
  const [sessionSelection, setSessionSelection] = useState<{ id: string; model: { provider: string; model: string } | null } | null>(null);
  /** TTS 朗读（用户主动点击才发声；Edge-TTS 直连，失败自动回退系统语音） */
  const { speakingKey, busyKey, speak, stop } = useTTS();
  const ttsEnabled = useSettingsStore((s) => s.ttsEnabled);
  const ttsSpeed = useSettingsStore((s) => s.ttsSpeed);

  const character = characters.find((c) => c.id === selectedCharacterId);
  const orbAttention=useOrbAttention(replyVisible?`${userId}:${selectedCharacterId}:${currentSessionId}:${streamingReply?.ids[0]??'reply'}`:undefined,roomRef,()=>scrollRef.current);
  const hasAiAccess = useAiAvailability(resolveModel(character, sessionSelection?.id === currentSessionId ? sessionSelection.model : null));
  const relationName = getRelationLevel(affinity).level.name;

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
    setSending(!!pending);
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
          avatar: msg.role === 'user' ? userAvatar : character?.avatar ?? '🧬',
          // 每条消息都是独立的聊天气泡：连续发送时也重复显示头像，
          // 避免多条消息被误读成一整段合并文本。
          showIdentity: true,
        });
      }
      return result;
    }, [messages, userAvatar, character]);

    const virtualizer = useVirtualizer({
      count: rows.length,
      getScrollElement: () => scrollRef.current,
      // 头像始终显示且连续气泡保留间距；提高初始估算，避免新消息尚未测量时互相覆盖。
      estimateSize: () => 84,
      overscan: 8,
      getItemKey: (index: number) => rows[index].key,
    });

    // Keep scrolled to the latest message on new messages / session switch /
    // "对方正在输入"出现。以最后一条消息 id 为键：前插（加载更早消息）不会触发滚底。
    const lastRowKey = rows.length > 0 ? rows[rows.length - 1].key : null;

    const [followingLatest, setFollowingLatest] = useState(true);
    const scrollToLatest = useLatestMessageScroll(scrollRef, currentSessionId, setFollowingLatest);

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

    /** 加载更早消息：记录滚动位置，插入后补偿高度差，保持当前视野不跳变 */
    const handleLoadEarlier = async () => {
      const el = scrollRef.current;
      const prevScrollTop = el?.scrollTop ?? 0;
      const prevScrollHeight = el?.scrollHeight ?? 0;
      await loadEarlierMessages();
      requestAnimationFrame(() => {
        if (!el) return;
        el.scrollTop = prevScrollTop + (el.scrollHeight - prevScrollHeight);
      });
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
    const handleRemember = async (m: Message) => {
      if (!character || !currentSessionId) return;
      try {
        const now = Date.now();
        await memoryRepo.create({
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
          confidence: 1,
          updatedAt: now,
        });
        await stateRepo.recordLifeEvent(character.id, userId, {
          type: 'memory',
          title: '你把一段话郑重地留在了记忆里',
          detail: m.content.slice(0, 180),
        });
      } catch {
        /* 静默：保存失败不影响聊天 */
      }
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
    setSending(true); setReplyVisible(false); setStreamingReply(null);
    try {
      await withChatSessionLock(sessionId, async () => {
      if (request.controller.signal.aborted || useAuthStore.getState().userId !== userId) return;
      if (saveUser) {
        await messageRepo.create(userMsg);
        addMessage(userMsg);
        if (mountedRef.current && useAuthStore.getState().userId === userId && !request.controller.signal.aborted) confirm();
        await sessionRepo.touch(sessionId);
        if (useChatStore.getState().currentSessionId === sessionId) setReplyingTo(null);
      }
      if (useAuthStore.getState().userId !== userId || request.controller.signal.aborted) return;
      await performSend(text, apiMessage, userMsg, image, request);
      });
    } catch (cause) {
      if (request.controller.signal.aborted || useAuthStore.getState().userId !== userId) return;
      if (mountedRef.current && useChatStore.getState().currentSessionId === userMsg.sessionId) {
        if (character?.agentProfile === 'secretary') { setError(null); setSecretaryError(secretaryFailureMessage(cause)); }
        else setError('server:error');
      }
      await messageRepo.markFailed(userMsg.id, true).catch(() => undefined);
      updateMessage(userMsg.id, { failed: true });
    } finally {
      request.stream.dispose();
      if (requestsRef.current.get(sessionId) === request) requestsRef.current.delete(sessionId);
      if (mountedRef.current && useAuthStore.getState().userId === userId && useChatStore.getState().currentSessionId === sessionId) {
        setSending(false); setStreamingReply(null); setReplyVisible(false);
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
    <div ref={roomRef} className={`chat-room h-full flex flex-col${character?.agentProfile === 'secretary' ? ' vg-secretary-room' : ''}`}>
      {/* Header */}
      {!workspace && <div className="chat-header relative z-30 h-14 flex items-center gap-1 px-3 sm:px-4 border-b border-line shrink-0 bg-gradient-to-r from-gene-purple/[0.07] via-transparent to-life-cyan/[0.05]">
        <div className="absolute bottom-0 left-4 right-4 h-px bg-gradient-to-r from-transparent via-gene-purple/45 to-transparent" />
        {/* 手机端返回角色页（微信式）：聊天 → 回到选人界面 */}
        {IS_MOBILE && (
          <button
            onClick={backToCharacters}
            title="返回"
            aria-label="返回"
            className="shrink-0 w-8 h-8 -ml-1 flex items-center justify-center rounded-lg text-gray-500 hover:bg-surface hover:text-ink active:bg-surface-strong transition-colors"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
        )}
        {character && (
          <div key={`title-${selectedCharacterId}`} className={`chat-header-title absolute left-1/2 min-w-0 ${character.agentProfile==='secretary'?'max-w-[calc(100%-14rem)]':'max-w-[calc(100%-12rem)]'} -translate-x-1/2 text-center animate-fade-in`}>
            {IS_MOBILE && <Avatar avatar={character.avatar} size="sm" className="vg-chat-identity-avatar !w-8 !h-8 !text-base" soulKey={`avatar:${character.id}`} soulRole="chat" />}
            <div className="vg-chat-identity-copy"><div className="text-base sm:text-lg font-semibold leading-tight text-ink truncate">{character.name}</div>
            {IS_MOBILE ? <div className={`vg-chat-presence${sending ? ' is-responding' : ''}`}>
              <span className="vg-presence-signal" aria-hidden="true"><i /><i /><i /></span>
              <span role={sending ? 'status' : undefined}><AnimatedValue value={sending ? character.agentProfile === 'secretary' ? '正在为你处理' : '正在回应你' : character.agentProfile === 'secretary' ? character.secretaryStatus === 'dismissed' ? '助理空缺 · 记录保留' : '生活助理 · 在职' : relationName} /></span>
            </div> : sending && <div className="mt-0.5 text-xs text-life-cyan animate-pulse">正在回应你</div>}</div>
          </div>
        )}
        <div className="flex-1 min-w-0" />
        {character && character.agentProfile !== 'secretary' && <CharacterSoulOrb character={character} sending={sending} streaming={replyVisible} failed={!!error} attention={orbAttention} soulKey={`role-orb:${character.id}`} soulRole="chat" />}
        {character?.agentProfile === 'secretary' && <ActionCabinLauncher from="chat" compact emotion={sending?'thinking':'idle'} />}
        {character?.agentProfile === 'secretary' ? <SecretaryMoreMenu key={character.id} onInbox={() => setShowSecretaryInbox(true)} onReview={() => setShowSecretaryDailyReview(true)} onManage={() => setShowSecretaryPersonality(true)} disabled={sending || character.secretaryStatus === 'dismissed'} /> : (
          <ChatHeaderMoreMenu character={character} modelLabel={sessionMeta.modelLabel} cost={sessionMeta.cost} />
        )}
      </div>}

      {/* Messages — 桌面端点击空白聚焦输入（像微信）；
          手机端不全局聚焦：只有点输入框才弹键盘（避免点喇叭/气泡误弹） */}
      {character && character.agentProfile !== 'secretary' && (
        <ImmersiveSceneCard
          key={selectedCharacterId}
          character={character}
          userId={userId}
          sessionId={currentSessionId}
          affinity={affinity}
          mood={charMood}
          lastMessageAt={messages.length > 0 ? messages[messages.length - 1].createdAt : undefined}
          onPrompt={fillSceneDraft}
        />
      )}
      {character?.agentProfile === 'secretary' && <SecretaryQuickActions embedded={!!workspace} key={`actions-${character.id}`} busy={sending} vacant={character.secretaryStatus === 'dismissed'} onDraft={draft => { inputRef.current?.setDraft(draft); inputRef.current?.focus(); }} onSend={request => { void handleSend(request); }} onInbox={workspace?.onInbox ?? (() => setShowSecretaryInbox(true))} onManage={workspace?.onManage ?? (() => setShowSecretaryPersonality(true))} onReview={workspace?.onReview ?? (() => setShowSecretaryDailyReview(true))} />}
      {showSecretaryPersonality && character?.agentProfile === 'secretary' && <SecretaryPersonalityModal key={`management-${character.id}`} character={character} open onClose={() => setShowSecretaryPersonality(false)} />}
      {showSecretaryInbox && character?.agentProfile === 'secretary' && <SecretaryInboxModal key={`inbox-${character.id}`} character={character} open busy={sending} onClose={() => setShowSecretaryInbox(false)} onDraft={request => { setShowSecretaryInbox(false); inputRef.current?.setDraft(request); inputRef.current?.focus(); }} />}
      {showSecretaryDailyReview && character?.agentProfile === 'secretary' && <SecretaryDailyReviewModal key={`review-${character.id}`} character={character} open onClose={() => setShowSecretaryDailyReview(false)} />}

      <div key={currentSessionId} ref={scrollRef} role="region" aria-label="聊天记录" tabIndex={-1} className="chat-thread immersive-chat-scroll animate-message-in flex-1 overflow-y-auto px-4 py-3" onClick={IS_MOBILE ? undefined : () => inputRef.current?.focus()}>
        {messages.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            {character && (
              <div className={`opening-scene max-w-sm text-center px-7 py-8${character.agentProfile === 'secretary' ? ' vg-secretary-opening' : ''}`}>
                <div className="opening-orbit mx-auto mb-5"><Avatar avatar={character.avatar} size="lg" className="h-full w-full" /></div>
                <p className="text-xs tracking-[0.16em] uppercase text-life-cyan/70">{character.agentProfile === 'secretary' ? '你的生活助理' : relationName}</p>
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
            {hasMoreMessages && (
              <div className="flex justify-center py-2">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleLoadEarlier();
                  }}
                  className="text-xs text-life-cyan hover:underline"
                >
                  ↑ 加载更早的消息
                </button>
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
        {character?.agentProfile !== 'secretary' && (streamingReply?.sessionId === currentSessionId || (sending && !replyVisible)) && <StreamingReply key={currentSessionId} stream={streamingReply?.sessionId === currentSessionId ? streamingReply : null} avatar={character?.avatar ?? '🧬'} />}
        {character?.agentProfile === 'secretary' && sending && !replyVisible && (
          <div className="vg-typing-row flex items-start gap-2 mb-2.5 animate-message-in" role="status" aria-label="正在准备回复">
            <Avatar avatar={character?.avatar ?? '🧬'} size="sm" />
            <div className="vg-typing-bubble bg-msgai text-gray-400 text-sm px-4 py-3.5 rounded-2xl rounded-bl-md border border-line/70 flex items-center gap-1.5">
              <span className="typing-glow inline-flex gap-1 rounded-full" aria-hidden="true">
                <span className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </span>
            </div>
          </div>
        )}
      </div>

      {character?.agentProfile === 'secretary' && secretaryError ? <div role="alert" className="mx-4 mb-2 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-2 text-sm text-red-400 break-words">{secretaryError}</div> : <BalanceBanner error={error} />}
      {rows.length > 0 && <div className="vg-latest-message-anchor" data-visible={!followingLatest} aria-hidden={followingLatest} inert={followingLatest}><button type="button" tabIndex={followingLatest ? -1 : 0} className="vg-latest-message-button" aria-label="回到最新消息" onClick={event => { if (event.detail === 0) scrollRef.current?.focus({ preventScroll: true }); scrollToLatest(true, 'smooth'); }}><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14m-6-6 6 6 6-6" /></svg>回到最新</button></div>}

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
        <div className="flex items-center gap-2 px-4 py-2 border-t border-line bg-panel">
          <span className="text-xs text-life-cyan">引用</span>
          <span className="text-xs text-gray-500 flex-1 truncate">{replyingTo.content}</span>
          <button
            onClick={() => setReplyingTo(null)}
            className="w-6 h-6 flex items-center justify-center rounded-md text-gray-400 hover:text-ink hover:bg-surface transition-colors"
            title="取消引用"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      <ChatInput ref={inputRef} onSend={handleSend} onSendImage={IS_MOBILE ? handleSendImage : undefined} onSendVoice={IS_MOBILE ? handleSendVoice : undefined}
        onStop={sending && character?.agentProfile !== 'secretary' ? () => { const request = currentSessionId ? requestsRef.current.get(currentSessionId) : undefined; if (request) { request.stopped = true; request.controller.abort(); } } : undefined}
        disabled={sending || character?.secretaryStatus === 'dismissed'} onFocusInput={() => scrollToLatest(true)} />
    </div>
    </SwipeBackView>
);
}
