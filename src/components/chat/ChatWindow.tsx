import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useChatStore } from '../../store/chat-store';
import { useAuthStore, DEFAULT_USER_AVATAR } from '../../store/auth-store';
import { useEmotionStore } from '../../store/emotion-store';
import { useSettingsStore } from '../../store/settings-store';
import { MessageBubble } from './MessageBubble';
import { Avatar } from '../ui/Avatar';
import { ChatInput } from './ChatInput';
import type { ChatInputHandle } from './ChatInput';
import { BalanceBanner, type ChatError } from './BalanceBanner';
import { ChatHeaderMoreMenu } from './ChatHeaderMoreMenu';
import { SwipeBackView } from '../ui/SwipeBackView';
import { IS_MOBILE } from '../../lib/platform';
import { messageRepo } from '../../db/message-repo';
import { sessionRepo } from '../../db/session-repo';
import { memoryRepo } from '../../db/memory-repo';
import { emotionRepo } from '../../db/emotion-repo';
import { diaryRepo, todayStr } from '../../db/diary-repo';
import { stateRepo } from '../../db/state-repo';
import { ipc } from '../../lib/ipc-client';
import { buildTimeContext, buildRelationshipContext, buildUserEmotionContext } from '../../lib/chat-context';
import { checkReplyQuality } from '../../lib/reply-quality';
import { DIARY_MOODS } from '../../lib/diary-utils';
import { useNotificationStore } from '../../store/notification-store';
import { useUIStore } from '../../store/ui-store';
import { useTTS } from '../../lib/tts';
import { DEFAULT_VOICE, ALL_VOICES } from '../../lib/voice-map';
import { resolveModel, findModel } from '../../lib/ai/llm';
import { ModelPickModal } from './ModelPickModal';
import type { Message } from '../../db/index';

const FIVE_MINUTES = 5 * 60 * 1000;
/** 会话保留窗口：最近 30 条消息原样保留，更早的滚动压缩为摘要 */
const SUMMARY_WINDOW = 30;
/** 摘要再生成阈值：滚动出窗口的消息累积到该数量才重新压缩 */
const SUMMARY_REGENERATE_THRESHOLD = 10;
/** 分条回复的逐条发出间隔（ms），模拟真人打字节奏 */
const PART_DELAY_MS = 600;

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

interface ChatWindowProps {
  emotionToggle?: React.ReactNode;
}

/** 每日快速心情打卡：一键把今天的心情写进手账（不写正文） */
function MoodCheckIn() {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);

  const checkIn = async (mood: number) => {
    const userId = useAuthStore.getState().userId ?? '';
    const today = todayStr();
    try {
      const list = await diaryRepo.getByDate(userId, today);
      if (list.length > 0) {
        await diaryRepo.update(list[0].id, { mood });
      } else {
        await diaryRepo.create({ userId, date: today, title: '', content: '', mood, tags: ['心情打卡'] });
      }
      setOpen(false);
      setDone(true);
      setTimeout(() => setDone(false), 1800);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        title="记录今天的心情"
        className="px-2 py-1.5 rounded-lg text-sm text-gray-400 hover:bg-surface hover:text-ink transition-colors"
      >
        {done ? '✅ 已打卡' : '😊 打卡'}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-50 min-w-[180px] px-3 py-2.5 glass-card rounded-xl shadow-xl animate-fade-in">
            <p className="text-[10px] text-gray-400 mb-1.5">今天的心情</p>
            <div className="flex items-center gap-1.5">
              {DIARY_MOODS.map((m) => (
                <button
                  key={m.value}
                  onClick={() => void checkIn(m.value)}
                  title={m.label}
                  className="w-8 h-8 rounded-full flex items-center justify-center text-lg hover:bg-surface transition-all hover:scale-110"
                >
                  {m.emoji}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export function ChatWindow({ emotionToggle }: ChatWindowProps) {
  const messages = useChatStore((s) => s.messages);
  const currentSessionId = useChatStore((s) => s.currentSessionId);
  const selectedCharacterId = useChatStore((s) => s.selectedCharacterId);
  const characters = useChatStore((s) => s.characters);
  const addMessage = useChatStore((s) => s.addMessage);
  const updateMessage = useChatStore((s) => s.updateMessage);
  const deleteMessage = useChatStore((s) => s.deleteMessage);
  const hasMoreMessages = useChatStore((s) => s.hasMoreMessages);
  const loadEarlierMessages = useChatStore((s) => s.loadEarlierMessages);
  const apiKey = useAuthStore((s) => s.apiKey);
  const userId = useAuthStore((s) => s.userId) ?? '';
  const userAvatar = useAuthStore((s) => s.avatar) ?? DEFAULT_USER_AVATAR;
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<ChatInputHandle>(null);

  const [sending, setSending] = useState(false);
  const [error, setError] = useState<ChatError>(null);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  /** 图片识别失败自动降级为文字模式时的提示 */
  const [degradeNotice, setDegradeNotice] = useState<string | null>(null);
  /** 首次进入聊天：会话未锁定模型时弹出模型选择（选定后聊天中不可改） */
  const [showModelPick, setShowModelPick] = useState(false);
  /** 会话元信息：当前模型 + 累计消耗（右上角设置展示） */
  const [sessionMeta, setSessionMeta] = useState<{ modelLabel: string; cost?: { calls: number; inputTokens: number; outputTokens: number; cost: number } }>({ modelLabel: '' });
  /** TTS 朗读（用户主动点击才发声；Edge-TTS 直连，失败自动回退系统语音） */
  const { speakingKey, busyKey, speak, stop } = useTTS();
  const ttsEnabled = useSettingsStore((s) => s.ttsEnabled);
  const ttsSpeed = useSettingsStore((s) => s.ttsSpeed);

  const character = characters.find((c) => c.id === selectedCharacterId);

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
      if (!voice) voice = DEFAULT_VOICE; // Edge 默认音色（晓晓），系统语音只做 Edge 彻底失败的最后兜底
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
    setSending(false);
    setError(null);
  }, [currentSessionId, stop]);

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
    const result: { key: string; divider: string | null; message: Message; avatar: string }[] = [];
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      const prev = messages[i - 1];
      const showDivider = !prev || msg.createdAt - prev.createdAt > FIVE_MINUTES;
      result.push({
        key: msg.id,
        divider: showDivider ? formatTimeLabel(msg.createdAt) : null,
        message: msg,
        avatar: msg.role === 'user' ? userAvatar : character?.avatar ?? '🧬',
      });
    }
    return result;
  }, [messages, userAvatar, character]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 72,
    overscan: 8,
    getItemKey: (index) => rows[index].key,
  });

  // Keep scrolled to the latest message on new messages / session switch /
  // "对方正在输入"出现。以最后一条消息 id 为键：前插（加载更早消息）不会触发滚底。
  const lastRowKey = rows.length > 0 ? rows[rows.length - 1].key : null;

  const scrollToLatest = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const toBottom = () => {
      el.scrollTop = el.scrollHeight;
    };
    toBottom();
    // 虚拟滚动对行高的测量是异步完成的：再补两帧 + 延时，
    // 确保滚到的是"测量完成后的真实最新位置"，而不是估算高度
    const raf1 = requestAnimationFrame(toBottom);
    const raf2 = requestAnimationFrame(toBottom);
    const timer = setTimeout(toBottom, 120);
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      clearTimeout(timer);
    };
  }, []);

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
    if (!sessionId || !character || !apiKey) return;

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
    };
    await messageRepo.create(userMsg);
    addMessage(userMsg);
    await sessionRepo.touch(sessionId);
    setReplyingTo(null);

    await performSend(text, apiMessage, userMsg);
  };

  /** 发送图片消息（微信式：图片为主，文字可选） */
  const handleSendImage = async (dataUrl: string) => {
    const sessionId = currentSessionId;
    if (!sessionId || !character || !apiKey) return;
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
    await messageRepo.create(userMsg);
    addMessage(userMsg);
    await sessionRepo.touch(sessionId);
    setReplyingTo(null);
    // 图片消息触发 AI 回复：真实图片交给视觉模型（角色真正看得到图）
    await performSend('[图片]', '[图片]', userMsg, dataUrl);
  };

  /** 发送语音消息（微信式）：录音转文字作为 content 发给 AI（AI 理解文字），音频存消息可回听 */
  const handleSendVoice = async (voice: { dataUrl: string; duration: number; text: string }) => {
    const sessionId = currentSessionId;
    if (!sessionId || !character || !apiKey) return;
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
    await messageRepo.create(userMsg);
    addMessage(userMsg);
    await sessionRepo.touch(sessionId);
    setReplyingTo(null);
    // 语音内容（转文字）正常走 AI 回复管线
    await performSend(text, text, userMsg);
  };

  /** 微信式重发：点击失败消息的红色感叹号，重发原内容（复用同一消息记录） */
  const handleRetry = async (failedMsg: Message) => {
    if (!currentSessionId || !character || !apiKey || sending) return;
    if (failedMsg.sessionId !== currentSessionId) return;
    const apiMessage = failedMsg.replyToContent
      ? `（你在引用这条消息：「${failedMsg.replyToContent}」）\n${failedMsg.content}`
      : failedMsg.content;
    await performSend(failedMsg.content, apiMessage, failedMsg);
  };

  /** 核心发送管线：构建上下文 → 调 API（带自检重试）→ 落库/上屏；失败则把用户消息标记为失败态 */
  const performSend = async (text: string, apiMessage: string, userMsg: Message, image?: string) => {
    const sessionId = userMsg.sessionId;
    if (!character || !apiKey) return;

    // 新一轮发送开始：清掉上次的降级提示（若本次又降级会重新出现）
    setDegradeNotice(null);

    // 重发场景：先清除失败标记
    if (userMsg.failed) {
      await messageRepo.markFailed(userMsg.id, false);
      updateMessage(userMsg.id, { failed: false });
    }

    // Build history from last messages.
    // 注意：allMsgs 已包含刚发送的 userMsg，history 需排除最后一条，
    // 否则模型会看到同一条用户消息两遍（deepseek.ts 会再 append 一次）。
    const allMsgs = useChatStore.getState().messages;
    const history = allMsgs.slice(-21, -1).map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
      image: m.image,
    }));

    // Inject character memories into system prompt (最近 15 条，避免上下文膨胀)
    const memories = await memoryRepo.getRecentByCharacter(character.id, userId, 15);
    const memoryContext = memories.length > 0
      ? '\n\n[关于用户的长期记忆]\n' + memories.map((m) => `- ${m.content}`).join('\n')
      : '';

    // 时间感知：现在几点、距上次聊天多久（上一轮消息 = allMsgs 倒数第二条）
    const prevMessage = allMsgs.length >= 2 ? allMsgs[allMsgs.length - 2] : undefined;
    const timeContext = '\n\n' + buildTimeContext(prevMessage?.createdAt);

    // 关系状态文字化：档位描述替代数字
    const state = await stateRepo.getOrCreate(character.id, userId);
    const relationshipContext = buildRelationshipContext(state.affinity, state.mood);

    // 用户情绪感知：最近一次结算感知到的用户情绪
    const latestSnapshot = await emotionRepo.getLatest(sessionId);
    const userEmotionContext = buildUserEmotionContext(latestSnapshot?.userEmotion);

    // 日记心情联动：今天日记记下低落/开心 → 影响回复语气（读取失败不影响发送）
    let diaryMoodContext = '';
    try {
      const todayDiary = await diaryRepo.getByDate(userId, todayStr());
      if (todayDiary.length > 0) {
        const avg = todayDiary.reduce((s, d) => s + (d.mood ?? 3), 0) / todayDiary.length;
        if (avg <= 2) {
          diaryMoodContext = '\n\n[补充] 用户今天在日记里记下了低落的心情。你的回应要更体贴、更耐心，先安抚情绪。';
        } else if (avg >= 4) {
          diaryMoodContext = '\n\n[补充] 用户今天在日记里记下了不错的心情。你的回应可以更轻快、更有活力。';
        }
      }
    } catch {
      /* ignore */
    }

    // 角色可见日记（默认关闭）：开启后注入最近日记片段，角色可自然提及
    let diaryShareContext = '';
    if (useSettingsStore.getState().diarySharedWithCharacters) {
      try {
        const recentDiaries = (await diaryRepo.getByUser(userId))
          .filter((d) => d.content.trim().length > 0)
          .sort((a, b) => b.date.localeCompare(a.date))
          .slice(0, 5);
        if (recentDiaries.length > 0) {
          diaryShareContext =
            '\n\n[用户的日记（角色可见已开启，可自然提及，但不要生硬复述）]\n' +
            recentDiaries.map((d) => `【${d.date}】${d.title ? `《${d.title}》` : ''}\n${d.content.slice(0, 200)}`).join('\n\n');
        }
      } catch {
        /* ignore */
      }
    }

    // 长会话滚动摘要：早期对话压缩，角色不用逐条回忆
    const sessionData = await sessionRepo.getById(sessionId);
    const sessionModel = sessionData?.model ?? null;
    // 临时视觉窗口：发图且所选模型不支持视觉 → 用 DeepSeek 视觉模型兜底识图，
    // 发图轮 + 之后 1 轮（共 2 轮）后自动换回原模型
    let forceVision = false;
    let tempRounds = sessionData?.tempVisionRounds ?? 0;
    const currentModel = resolveModel(character, sessionData?.model ?? null);
    if (image && currentModel.vision !== true) {
      tempRounds = 1;
      forceVision = true;
    } else if (tempRounds > 0) {
      forceVision = true;
      tempRounds -= 1;
    }
    if ((sessionData?.tempVisionRounds ?? 0) !== tempRounds) {
      await sessionRepo.update(sessionId, { tempVisionRounds: tempRounds });
    }
    const summaryContext = sessionData?.summary
      ? `\n\n[早前对话摘要（更早的内容已压缩，不必逐条回忆，若与当前话题相关可自然提及）]\n${sessionData.summary}`
      : '';

    const enrichedPrompt =
      character.systemPrompt + memoryContext + timeContext + relationshipContext + userEmotionContext + diaryMoodContext + diaryShareContext + summaryContext;

    // 动态温度：按角色主动倾向微调——高冷/疏离用低温度（更克制稳定），活泼/话痨用高温度（更跳脱）
    const temperature = 0.6 + (character.proactivity ?? 0.5) * 0.3;

    // Call DeepSeek，带回复质量自检重试（静默重试，最多 2 次修正）
    const startedAt = Date.now();
    setSending(true);
    const lastAssistantContent = [...allMsgs].reverse().find((m) => m.role === 'assistant')?.content;
    // 发送期间用户可能已切走：错误横幅只显示在仍处于该会话时
    const stillCurrent = () => useChatStore.getState().currentSessionId === sessionId;
    try {
      let result: {
        content?: string;
        error?: string;
        truncated?: boolean;
        degraded?: boolean;
        usage?: { inputTokens: number; outputTokens: number };
        modelId?: string;
      } = { error: 'server:error' };
      let retryHint: string | undefined;
      let retries = 0;
      const MAX_RETRIES = 2;

      for (;;) {
        result = await ipc.chat.send({
          apiKey,
          systemPrompt: enrichedPrompt,
          message: apiMessage,
          image,
          history,
          retryHint,
          temperature,
          character,
          sessionModel,
          forceVision,
        });

        if (result.error || !result.content) break;

        const check = checkReplyQuality(result.content, text, lastAssistantContent);
        if (check.ok || retries >= MAX_RETRIES) break;
        retries += 1;
        retryHint = check.retryHint;
      }

      // 兜底/降级提示：发图轮显示图片识别文案；文字轮显示模型兜底文案
      if (result.degraded) {
        setDegradeNotice(
          image
            ? '图片识别失败，已自动切换为文字模式继续对话'
            : '对话模型不可用，已自动切换为兜底模型（DeepSeek Flash）继续对话',
        );
      }

      // 成功回复 → 累计该会话的 API 消耗（token + 预估费用）
      if (result.content?.trim() && result.usage) {
        const s = await sessionRepo.getById(sessionId);
        const prev = s?.cost ?? { calls: 0, inputTokens: 0, outputTokens: 0, cost: 0 };
        const cost =
          (result.usage.inputTokens * (findModel(result.modelId ?? '')?.pricing?.in ?? 0) +
            result.usage.outputTokens * (findModel(result.modelId ?? '')?.pricing?.out ?? 0)) /
          1_000_000;
        const next = {
          calls: prev.calls + 1,
          inputTokens: prev.inputTokens + result.usage.inputTokens,
          outputTokens: prev.outputTokens + result.usage.outputTokens,
          cost: prev.cost + cost,
        };
        await sessionRepo.update(sessionId, { cost: next });
        setSessionMeta((meta) => ({ ...meta, cost: next }));
      }

      // 保证「对方正在输入…」至少展示约 0.7s，避免秒回一闪而过
      const elapsed = Date.now() - startedAt;
      if (elapsed < 700) {
        await new Promise((r) => setTimeout(r, 700 - elapsed));
      }

      if (result.error) {
        if (stillCurrent()) {
          setError(result.error as ChatError);
        }        // 微信式：发送失败 → 消息标记为失败态，显示红色感叹号可点击重发
        await messageRepo.markFailed(userMsg.id, true);
        updateMessage(userMsg.id, { failed: true });
      } else if (result.content?.trim()) {
        // Split multi-message responses on "---"，逐条延迟发出，模拟真人打字
        const parts = result.content.split('---').map((p: string) => p.trim()).filter((p: string) => p.length > 0);
        for (let i = 0; i < parts.length; i++) {
          // 被 max_tokens 截断时，最后一条补「…」（真人发整条，但偶尔也像话没说完）
          const isLast = i === parts.length - 1;
          const content = isLast && result.truncated ? parts[i] + '…' : parts[i];
          const aiMsg: Message = {
            id: crypto.randomUUID(),
            sessionId,
            role: 'assistant',
            content,
            createdAt: Date.now() + i, // ensure unique timestamps for ordering
            isProactive: false,
          };
          await messageRepo.create(aiMsg);
          addMessage(aiMsg);
          if (!isLast) {
            await new Promise((r) => setTimeout(r, PART_DELAY_MS));
          }
        }
        await sessionRepo.touch(sessionId);

        // 回复到达时用户已切到别的会话：不上屏，改弹应用内流体云提醒
        if (!stillCurrent()) {
          useNotificationStore.getState().push({
            characterId: character.id,
            characterName: character.name,
            avatar: character.avatar,
            preview: parts[0] ?? result.content,
          });
        }

        // 每 5 条用户消息合并结算一次：情绪 + 记忆 + 好感度（单次 API 调用）。
        // 注意：allMsgs 在 addMessage(userMsg) 之后读取，已包含刚发的这条，不能再 +1
        const userMsgCount = allMsgs.filter((m) => m.role === 'user').length;
        if (userMsgCount > 0 && userMsgCount % 5 === 0) {
          void useEmotionStore.getState().settle(character.id, sessionId, character.name);
        }

        // 长会话滚动摘要（后台静默执行）
        void maybeSummarize(sessionId);
      } else {
        // 兜底：无错误但也没有内容（异常空回复）→ 不静默，标记失败让用户可重发
        if (stillCurrent()) {
          setError('server:error');
        }
        await messageRepo.markFailed(userMsg.id, true);
        updateMessage(userMsg.id, { failed: true });
      }
    } catch {
      if (stillCurrent()) {
        setError('server:error');
      }
      await messageRepo.markFailed(userMsg.id, true);
      updateMessage(userMsg.id, { failed: true });
    } finally {
      setSending(false);
    }
  };

  /** 长会话滚动摘要：超出保留窗口的早期对话压缩成摘要，持久化到会话 */
  const maybeSummarize = async (sessionId: string) => {
    if (!apiKey) return;
    try {
      const msgs = await messageRepo.getBySession(sessionId);
      if (msgs.length <= SUMMARY_WINDOW) return;

      const oldMsgs = msgs.slice(0, msgs.length - SUMMARY_WINDOW);
      const sessionData = await sessionRepo.getById(sessionId);
      const lastCovered = sessionData?.summaryUpdatedAt ?? 0;
      const uncovered = oldMsgs.filter((m) => m.createdAt > lastCovered);
      if (uncovered.length < SUMMARY_REGENERATE_THRESHOLD) return;

      const history = oldMsgs.slice(-200).map((m) => ({ role: m.role, content: m.content }));
      const result = await ipc.context.summarize({ apiKey, history });
      if (result.summary) {
        await sessionRepo.updateSummary(sessionId, result.summary);
      }
    } catch {
      // 摘要失败是 best-effort，静默忽略
    }
  };

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
      void performSend(text, text, userMsg);
    }, 80);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingDiarySend, currentSessionId]);

  /** 微信式返回：聊天 → 回到上一级。
   *  从会话列表推入的（chatFromList）→ 回到会话列表（不跳「角色」页）；
   *  从角色页推入的（chatFromCharacters）→ 回到角色列表；
   *  直接点底部「聊天」tab 进入的 → 回会话列表。 */
  const backToCharacters = () => {
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
      enabled={IS_MOBILE && !!character}
      onBack={backToCharacters}
    >
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="h-12 flex items-center gap-1 px-3 sm:px-4 border-b border-line shrink-0">
        {/* 手机端返回角色页（微信式）：聊天 → 回到选人界面 */}
        {IS_MOBILE && (
          <button
            onClick={backToCharacters}
            title="返回角色列表"
            className="shrink-0 w-8 h-8 -ml-1 flex items-center justify-center rounded-lg text-gray-500 hover:bg-surface hover:text-ink active:bg-surface-strong transition-colors"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
        )}
        {character && (
          <div key={selectedCharacterId} className="animate-fade-in flex items-center gap-2 min-w-0">
            {character.avatar.startsWith('data:') ? (
              <img src={character.avatar} alt={character.name} className="w-7 h-7 rounded-lg object-cover shrink-0" />
            ) : (
              <span className="text-lg shrink-0">{character.avatar}</span>
            )}
            <span className="text-sm font-medium text-ink truncate">{character.name}</span>
            {sending && <span className="text-xs text-gray-500 shrink-0 hidden sm:inline">对方正在输入…</span>}
          </div>
        )}
        <div className="flex-1 min-w-0" />
        {IS_MOBILE ? (
          <ChatHeaderMoreMenu character={character} modelLabel={sessionMeta.modelLabel} cost={sessionMeta.cost} />
        ) : (
          <>
            {emotionToggle}
            <MoodCheckIn />
          </>
        )}
      </div>

      {/* Messages — 桌面端点击空白聚焦输入（像微信）；
          手机端不全局聚焦：只有点输入框才弹键盘（避免点喇叭/气泡误弹） */}
      <div key={currentSessionId} ref={scrollRef} className="animate-message-in flex-1 overflow-y-auto px-4 py-3" onClick={IS_MOBILE ? undefined : () => inputRef.current?.focus()}>
        {messages.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <p className="text-xs text-gray-600">
              {character ? '聊点什么吧' : '去「角色」页选一个角色，开始对话吧'}
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
            {virtualizer.getVirtualItems().map((vi) => {
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
                    animate={Date.now() - row.message.createdAt < 800}
                    isLatest={vi.index === rows.length - 1}
                    onQuote={setReplyingTo}
                    onDelete={(m) => void deleteMessage(m.id)}
                    onRetry={(m) => void handleRetry(m)}
                    onSpeak={row.message.role === 'assistant' && ttsEnabled ? handleSpeak : undefined}
                    speakKey={row.message.id}
                    speakingKey={speakingKey}
                    busyKey={busyKey}
                  />
                </div>
              );
            })}
            </div>
          </>
        )}
        {sending && (
          <div className="flex items-start gap-2 mb-4 animate-message-in">
            <Avatar avatar={character?.avatar ?? '🧬'} size="sm" />
            <div className="bg-msgai text-gray-400 text-sm px-4 py-3 rounded-2xl rounded-bl-md border-l-2 border-life-cyan flex items-center gap-1.5">
              <span>对方正在输入</span>
              <span className="typing-glow inline-flex gap-1 rounded-full">
                <span className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </span>
            </div>
          </div>
        )}
      </div>

      <BalanceBanner error={error} />

      {/* 首次进入聊天：选择对话模型（选定后锁定，聊天中不可改） */}
      {showModelPick && currentSessionId && (
        <ModelPickModal
          onClose={() => {
            // 关闭也标记已问过（避免每次进入都弹）
            void sessionRepo.update(currentSessionId!, { modelAsked: true });
            setShowModelPick(false);
          }}
          onPick={(m) => {
            void sessionRepo.update(currentSessionId!, { model: m ?? undefined, modelAsked: true });
            setShowModelPick(false);
          }}
        />
      )}

      {/* 图片识别失败/模型兜底提示 */}
      {degradeNotice && (
        <div className="flex items-center gap-2 px-4 py-2 bg-amber-500/10 border-t border-amber-500/30 animate-fade-in">
          <span className="text-xs text-amber-600 dark:text-amber-400 flex-1">{degradeNotice}</span>
          <button
            onClick={() => setDegradeNotice(null)}
            className="text-[11px] text-amber-500 hover:text-amber-700 shrink-0"
          >
            知道了
          </button>
        </div>
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

      <ChatInput ref={inputRef} onSend={handleSend} onSendImage={IS_MOBILE ? handleSendImage : undefined} onSendVoice={IS_MOBILE ? handleSendVoice : undefined} disabled={sending} />
    </div>
    </SwipeBackView>
  );
}
