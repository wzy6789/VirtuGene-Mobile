import { create } from 'zustand';
import { db, type Group, type Session, type Message } from '../db/index';
import { groupRepo } from '../db/group-repo';
import { sessionRepo } from '../db/session-repo';
import { messageRepo } from '../db/message-repo';
import { characterRepo } from '../db/character-repo';
import { memoryRepo } from '../db/memory-repo';
import { todoRepo } from '../db/todo-repo';
import { worldRepo } from '../db/world-repo';
import { recallCharacterMemory } from '../lib/character-memory';
import { useAuthStore } from './auth-store';
import { useNotificationStore } from './notification-store';
import { stateRepo } from '../db/state-repo';
import { ipc } from '../lib/ipc-client';
import { notifyLocal } from '../lib/notify';
import { IS_MOBILE } from '../lib/platform';
import { generateGroupTurn, type GroupMemberBrief, type GroupTurn } from '../lib/ai/group-chat';
import { extractMemories } from '../lib/ai/memory-consolidator';
import { prepareMemoryMetadata } from '../lib/memory-engine';
import { buildSummaryBatch, findUncoveredSummaryMessages } from '../lib/ai/summary-batches';
import { boundAuxiliaryHistory } from '../lib/ai/history-window';

/** 主动发言触发：距上一条消息超过该时长（且在群聊页停留时）触发一次 */
const PROACTIVE_AFTER_MS = 5 * 60_000;
/** 主动发言冷却：距上次主动发言至少该时长，避免刷屏 */
const PROACTIVE_COOLDOWN_MS = 15 * 60_000;
/** 后台主动发言冷却（离开群聊页时更长：省 token） */
const PROACTIVE_BG_COOLDOWN_MS = 30 * 60_000;
/** 群聊自运转冷却（成员间私下闲聊，4 小时一次足够，省 token） */
const BANTER_COOLDOWN_MS = 4 * 60 * 60_000;
/** 每天最多自运转次数（localStorage 按日期计数） */
const BANTER_DAILY_MAX = 3;
/** 长会话滚动摘要窗口：超过该条数的早期消息压缩成摘要 */
const SUMMARY_WINDOW = 36;
/** 摘要增量重建阈值：新增未覆盖消息数达到该值才重新生成 */
const SUMMARY_REGENERATE_THRESHOLD = 12;
const groupMemoryInFlight = new Set<string>();

interface GroupState {
  groups: Group[];
  currentGroupId: string | null;
  currentGroup: Group | null;
  currentSessionId: string | null;
  groupMessages: Message[];
  groupSending: boolean;
  groupError: string | null;
  /** 群预览（会话列表用）：最后消息 + 时间 + 未读 */
  groupPreviews: Record<string, { content: string; createdAt: number; unread: number }>;
  /** 上次主动发言时间戳（冷却判定） */
  lastProactiveAt: number;
  /** 上次群聊自运转时间戳 */
  lastBanterAt: number;

  loadGroups: () => Promise<void>;
  createGroup: (name: string, characterIds: string[]) => Promise<Group | null>;
  selectGroup: (groupId: string) => Promise<void>;
  sendGroupMessage: (text: string, opts?: { image?: string; quoteId?: string; quoteContent?: string }) => Promise<void>;
  /** 成员主动开口：用户长时间没说话时触发（有冷却与防刷屏保护） */
  proactiveGroupTurn: () => Promise<void>;
  /** 后台主动发言：离开群聊页后由 App 定时器触发（挑最久没动静的群，30 分钟冷却，省 token） */
  proactiveBackground: () => Promise<void>;
  /** 群聊自运转：用户不在时，成员之间私下闲聊几句（限频，可回看） */
  backgroundGroupBanter: () => Promise<void>;
  deleteGroupMessage: (messageId: string) => Promise<void>;
  /** 长按"记住"：把群消息存进所有成员的记忆 */
  rememberGroupMessage: (messageId: string) => Promise<void>;
  setMemberNickname: (groupId: string, characterId: string, nickname: string) => Promise<void>;
  updateGroup: (id: string, patch: Partial<Group>) => Promise<void>;
  removeMember: (groupId: string, characterId: string) => Promise<void>;
  deleteGroup: (groupId: string) => Promise<void>;
}

async function getOrCreateGroupSession(groupId: string, userId: string): Promise<Session> {
  const existing = await db.sessions.where('groupId').equals(groupId).toArray();
  if (existing.length > 0) return existing[0];
  const now = Date.now();
  const session: Session = {
    id: crypto.randomUUID(),
    characterId: '',
    userId,
    title: '',
    type: 'group',
    groupId,
    createdAt: now,
    updatedAt: now,
    unreadCount: 0,
  };
  await db.sessions.add(session);
  return session;
}

function witnessedByAll(message: Message, memberIds: string[]): boolean {
  return memberIds.length > 0 && memberIds.every((id) => message.witnessedBy?.includes(id));
}

function groupSummaryFor(session: Session | undefined, memberIds: string[]): string | undefined {
  if (!session?.summary || !session.summaryWitnessedBy) return undefined;
  const current = [...new Set(memberIds)].sort();
  const summarized = [...new Set(session.summaryWitnessedBy)].sort();
  return current.length === summarized.length && current.every((id, index) => id === summarized[index])
    ? session.summary
    : undefined;
}

function groupPromptTrace(briefs: GroupMemberBrief[], session: Session | undefined, memberIds: string[], sessionId: string): Message['contextTrace'] | undefined {
  const references = [...new Map(briefs.flatMap((brief) => brief.memoryReferences ?? []).map((reference) => [`${reference.source}:${reference.id}`, reference])).values()];
  const summary = groupSummaryFor(session, memberIds) && session?.summaryUpdatedAt
    ? { sessionId, updatedAt: session.summaryUpdatedAt }
    : undefined;
  if (!references.length && !summary) return undefined;
  return {
    ...(references.length ? { crossChannelReferences: references } : {}),
    ...(summary ? { groupSummary: summary } : {}),
    at: Date.now(),
  };
}

/** 构建群聊上下文：成员人设（含经当前全体成员见证的跨场景记忆） */
async function buildBriefs(group: Group, userId: string, query = ''): Promise<GroupMemberBrief[]> {
  const world = await worldRepo.ensureDefaultWorld(userId).catch(() => null);
  const members = (await Promise.all(group.characterIds.map((id) => characterRepo.getById(id)))).filter(
    (c): c is NonNullable<typeof c> => !!c,
  );
  return Promise.all(
    members.map(async (c) => {
      const [shared, personal, personalTodos] = await Promise.all([
        // The director may see only memories that every current group member is
        // allowed to know. These are the only memories included in its prompt.
        recallCharacterMemory({ userId, characterId: c.id, query, audience: group.characterIds, sources: ['world', 'moment', 'todo'], budget: 1800 }),
        // Each speaker gets a separate, actor-scoped context later. Never place
        // this text in the shared director prompt.
        recallCharacterMemory({
          userId, characterId: c.id, query, audience: [c.id],
          ...(world ? { worldId: world.id } : {}),
          sources: ['chat', 'group', 'world', 'moment', 'todo', 'diary'],
          includePrivateCharacterLifeEvents: true,
          budget: 1800,
        }),
        todoRepo.visibleOccurrencesForCharacter(userId, c.id, 4, true).catch(() => []),
      ]);
      const personalTodoText = personalTodos.length
        ? `\n\n【只分享给你的未完成事项，供你自己记得】\n${personalTodos.map(({ todo, occurrence }) => `- ${todo.title}${occurrence.dueDate !== '9999-12-31' ? `（${occurrence.dueDate}${todo.dueTime ? ` ${todo.dueTime}` : ''}）` : ''}${todo.note ? `：${todo.note.slice(0, 80)}` : ''}`).join('\n')}`
        : '';
      return {
        id: c.id,
        name: c.name,
        // Keep enough of the authored persona for stable voice and boundaries.
        // The old 60-character fallback silently discarded almost all of it.
        persona: (c.systemPrompt || c.signature || '').slice(0, 6000),
        publicPersona: [c.signature, ...(c.tags ?? []).slice(0, 5)].filter(Boolean).join('；').slice(0, 220),
        memory: shared.text || undefined,
        memoryReferences: shared.references.map(({ source, id }) => ({ source, id })),
        privateMemory: `${personal.text}${personalTodoText}`.trim() || undefined,
      };
    }),
  );
}

/** 从文本里解析 @成员（只保留确实是群成员的；去掉名字后的标点/冒号等装饰） */
function parseAtNames(text: string, members: { id: string; name: string }[]): string[] {
  const names = [...text.matchAll(/@([^\s@，,。！!？?]+)/g)]
    .map((m) => m[1].trim().replace(/[：:。，,！!？?、）)]+$/, '').trim())
    .filter(Boolean);
  return names.filter((n) => members.some((m) => m.name.includes(n) || n.includes(m.name)));
}

/** 长会话滚动摘要：早期对话压缩成摘要存到会话（与单聊一致，best-effort） */
async function maybeSummarizeGroup(sessionId: string, apiKey: string): Promise<void> {
  try {
    const sessionData = await sessionRepo.getById(sessionId);
    if (!sessionData?.groupId) return;
    if (sessionData.summaryAttemptedAt && Date.now() - sessionData.summaryAttemptedAt < 60_000) return;
    const group = await groupRepo.getById(sessionData.groupId);
    if (!group || group.userId !== sessionData.userId || group.characterIds.length < 2) return;
    const members = [...new Set(group.characterIds)];
    const msgs = await messageRepo.getBySession(sessionId);
    if (msgs.length <= SUMMARY_WINDOW) return;
    const oldMsgs = msgs.slice(0, msgs.length - SUMMARY_WINDOW).filter((message) => witnessedByAll(message, members));
    const previousSummary = groupSummaryFor(sessionData, members);
    const lastCovered = previousSummary ? sessionData.summaryUpdatedAt ?? 0 : 0;
    const priorSourceIds = previousSummary ? sessionData.summarySourceMessageIds ?? [] : [];
    const legacyCovered = previousSummary && priorSourceIds.length === 0
      ? oldMsgs.filter((message) => message.createdAt <= lastCovered)
      : [];
    const cursor = {
      sourceMessageIds: [...priorSourceIds, ...legacyCovered.map((message) => message.id)],
      sourceMessageRevisions: {
        ...(previousSummary ? sessionData.summarySourceMessageRevisions ?? {} : {}),
        ...Object.fromEntries(legacyCovered.map((message) => [message.id, message.revision ?? 1])),
      },
      sourceMessageOffsets: {
        ...(previousSummary ? sessionData.summarySourceMessageOffsets ?? {} : {}),
        ...Object.fromEntries(legacyCovered.map((message) => [message.id, Math.min(message.content.length, 1_200)])),
      },
    };
    const uncovered = findUncoveredSummaryMessages(oldMsgs, cursor);
    if (uncovered.length < SUMMARY_REGENERATE_THRESHOLD && !uncovered.some((message) => message.content.length > 1_200)) return;
    // 单次只发送 12 个 1200 字片段，给旧摘要留出网关 20k 请求上限空间；
    // 超长群消息按字符偏移分批，不能因被截断而误标为已总结。
    const segments = buildSummaryBatch(uncovered, cursor);
    if (segments.length === 0) return;
    const history = segments.map(({ message, content }) => ({ role: message.role, content: (message.senderId ? '群成员：' : '') + content }));
    await sessionRepo.markSummaryAttempt(sessionId);
    const result = await ipc.context.summarize({
      apiKey,
      history,
      previousSummary: previousSummary?.slice(0, 2_500),
    });
    if (result.summary && result.complete === true) {
      const sourceMessageIds = [...new Set([
        ...priorSourceIds,
        ...legacyCovered.map((message) => message.id),
        ...segments.map(({ message }) => message.id),
      ])];
      const sourceMessageRevisions = Object.fromEntries([
        ...(previousSummary ? Object.entries(sessionData.summarySourceMessageRevisions ?? {}) : []),
        ...legacyCovered.map((message) => [message.id, message.revision ?? 1] as const),
        ...segments.map(({ message }) => [message.id, message.revision ?? 1] as const),
      ]);
      const sourceMessageOffsets = {
        ...cursor.sourceMessageOffsets,
        ...Object.fromEntries(segments.map(({ message, endOffset }) => [message.id, endOffset])),
      };
      await sessionRepo.updateSummary(sessionId, result.summary, members, sourceMessageIds, sourceMessageRevisions, sourceMessageOffsets);
    }
  } catch {
    /* 摘要失败是 best-effort */
  }
}

/** 群聊记忆双向：把群里聊到的用户关键事实沉淀为每个成员的记忆（每 3 条用户消息触发一次） */
async function maybeExtractGroupMemories(sessionId: string, memberIds: string[], apiKey: string): Promise<void> {
  if (groupMemoryInFlight.has(sessionId)) return;
  groupMemoryInFlight.add(sessionId);
  try {
    const userId = useAuthStore.getState().userId ?? '';
    const members = [...new Set(memberIds)];
    if (!userId || members.length < 2) return;
    const session = await sessionRepo.getById(sessionId);
    if (!session || session.userId !== userId || session.type !== 'group') return;
    const msgs = (await messageRepo.getBySession(sessionId)).filter((message) => !message.failed && witnessedByAll(message, members));
    const userCount = msgs.filter((m) => m.role === 'user').length;
    if (userCount < 6) return;
    // Migration-safe bootstrap: existing groups get one recent backfill; later
    // calls resume from a durable checkpoint. An unsuccessful request never
    // advances the cursor, so the next group turn retries it.
    const currentAudience = [...members].sort();
    const previousAudience = [...(session.groupMemoryWitnessedBy ?? [])].sort();
    const checkpoint = previousAudience.length > 0 && previousAudience.join('|') === currentAudience.join('|')
      ? session.lastGroupMemoryUserMessageCount ?? 0
      : 0;
    if (userCount - checkpoint < 6) return;
    const allUsers = msgs.filter((message) => message.role === 'user');
    const batchUsers = allUsers.slice(checkpoint, checkpoint + 6);
    const firstIndex = msgs.findIndex((message) => message.id === batchUsers[0]?.id);
    const sixthIndex = msgs.findIndex((message) => message.id === batchUsers[batchUsers.length - 1]?.id);
    if (firstIndex < 0 || sixthIndex < 0) return;
    const priorContext = msgs.slice(Math.max(0, firstIndex - 6), firstIndex);
    let endIndex = sixthIndex + 1;
    while (endIndex < msgs.length && msgs[endIndex].role !== 'user') endIndex += 1;
    // Every pending user message is processed in order; the cursor advances by
    // exactly six only after a successful extraction and write.
    const sourceMessages = [...priorContext, ...msgs.slice(firstIndex, endIndex)];
    const history = boundAuxiliaryHistory(await Promise.all(sourceMessages.map(async (m) => ({
      role: m.role,
      content: m.role === 'user'
        ? '用户：' + m.content.slice(0, 1200)
        : ((await characterRepo.getById(m.senderId ?? ''))?.name ?? '群成员') + '：' + m.content.slice(0, 1200),
    }))));
    const result = await extractMemories({ apiKey, history });
    if (result.error) return;
    if (result.memories && result.memories.length > 0) {
      for (const charId of memberIds) {
        const existing = await memoryRepo.getByCharacter(charId, userId);
        const existingContents = new Set(existing.filter((m) => (m.status ?? 'active') === 'active').map((m) => m.content.trim()));
        const fresh = result.memories
          .map((c) => c.trim())
          .filter((c) => c.length > 0 && !existingContents.has(c))
          .slice(0, 10);
        if (fresh.length > 0) {
          const now = Date.now();
          const rows = fresh.map((content, i) => ({
            id: crypto.randomUUID(),
            characterId: charId,
            userId,
            content,
            type: 'auto' as const,
            ...prepareMemoryMetadata(content, { confidence: 0.75 }),
            createdAt: now + i,
            sourceSessionId: sessionId,
            sourceMessageIds: sourceMessages.map((message) => message.id),
            confidence: 0.75,
            updatedAt: now + i,
          }));
          const ids = await memoryRepo.createMany(rows);
          for (const row of rows) {
            const id = ids[rows.indexOf(row)];
            await memoryRepo.supersedeLikelyCorrections(charId, userId, { ...row, id });
          }
        }
      }
    }
    // Empty extraction is a successful result; errors above remain retryable.
    await sessionRepo.update(sessionId, {
      lastGroupMemoryUserMessageCount: checkpoint + batchUsers.length,
      groupMemoryWitnessedBy: currentAudience,
    });
  } catch {
    /* 记忆提取失败不影响群聊 */
  } finally {
    groupMemoryInFlight.delete(sessionId);
  }
}

/** 生成一轮"成员主动开口/私下闲聊"的群聊回合（页内 + 后台共用，省 token） */
async function generateProactiveTurn(
  group: Group,
  sessionId: string,
  apiKey: string,
  userId: string,
  mode: 'proactive' | 'banter' = 'proactive',
): Promise<{ turns: GroupTurn[]; error?: string; contextTrace?: Message['contextTrace'] }> {
  const members = (await Promise.all(group.characterIds.map((id) => characterRepo.getById(id)))).filter(
    (c): c is NonNullable<typeof c> => !!c,
  );
  // 鲁棒性：成员不足不调 API
  if (members.length < 2) return { turns: [], error: '群成员不足' };
  const briefs = await buildBriefs(group, userId);
  const all = await messageRepo.getPage(sessionId, { limit: 20 });
  const history = all.filter((message) => witnessedByAll(message, group.characterIds))
    .map((m) => ({
      senderName: m.senderId ? members.find((c) => c.id === m.senderId)?.name : undefined,
      role: m.role as 'user' | 'assistant',
      content: m.content || (m.image ? '[图片]' : ''),
    }));
  const session = await sessionRepo.getById(sessionId);
  const generated = await generateGroupTurn({
    apiKey,
    groupName: group.name,
    members: briefs,
    history,
    mode,
    summary: groupSummaryFor(session, group.characterIds),
    // banter（成员间闲聊）更省：最多 2 条
    maxTurns: mode === 'banter' ? 2 : undefined,
  });
  return { ...generated, contextTrace: groupPromptTrace(briefs, session, group.characterIds, sessionId) };
}

export const useGroupStore = create<GroupState>((set, get) => ({
  groups: [],
  currentGroupId: null,
  currentGroup: null,
  currentSessionId: null,
  groupMessages: [],
  groupSending: false,
  groupError: null,
  groupPreviews: {},
  lastProactiveAt: 0,
  lastBanterAt: 0,

  loadGroups: async () => {
    const userId = useAuthStore.getState().userId ?? '';
    const groups = await groupRepo.getByUser(userId);
    // 群预览：每个群会话的最后消息 + 未读（会话列表显示）
    const groupPreviews: Record<string, { content: string; createdAt: number; unread: number }> = {};
    for (const g of groups) {
      const sessions = await db.sessions.where('groupId').equals(g.id).toArray();
      const session = sessions[0];
      if (!session) continue;
      const last = await messageRepo.getLast(session.id);
      groupPreviews[g.id] = {
        content: last?.content ?? '',
        createdAt: last?.createdAt ?? session.updatedAt,
        unread: session.unreadCount ?? 0,
      };
    }
    set({ groups, groupPreviews });
    const { currentGroupId } = get();
    if (currentGroupId && !groups.some((g) => g.id === currentGroupId)) {
      set({ currentGroupId: null, currentGroup: null, currentSessionId: null, groupMessages: [] });
    }
  },

  createGroup: async (name, characterIds) => {
    const userId = useAuthStore.getState().userId ?? '';
    if (characterIds.length < 2 || characterIds.length > 5) return null;
    const now = Date.now();
    const group: Group = { id: crypto.randomUUID(), userId, name: name.trim() || '角色群', characterIds, createdAt: now, updatedAt: now };
    await groupRepo.create(group);
    await Promise.all(characterIds.map((characterId) => stateRepo.recordLifeEvent(characterId, userId, {
      type: 'relationship',
      title: `进入共同场域「${group.name}」`,
      detail: '一个新的多角色关系开始形成。',
      // 5.0：建群是**功能操作**，不是"关系变化" ⇒ 标记来源为 group，
      // 世界层据此排除该来源（见 lib/world/world-writer.ts 的来源白名单）
      source: 'group',
    })));
    await get().loadGroups();
    return group;
  },

  selectGroup: async (groupId) => {
    const userId = useAuthStore.getState().userId ?? '';
    const group = await groupRepo.getById(groupId);
    if (!group) return;
    const session = await getOrCreateGroupSession(groupId, userId);
    const msgs = await messageRepo.getBySession(session.id);
    set({ currentGroupId: groupId, currentGroup: group, currentSessionId: session.id, groupMessages: msgs, groupError: null });
    await sessionRepo.clearUnread(session.id);
  },

  sendGroupMessage: async (text, opts) => {
    const trimmed = text.trim();
    const { currentGroup, currentSessionId } = get();
    const apiKey = useAuthStore.getState().apiKey;
    const userId = useAuthStore.getState().userId ?? '';
    if ((!trimmed && !opts?.image) || !currentGroup || !currentSessionId || !apiKey) return;
    // 鲁棒性：同步置位发送中，堵住"快速连点两次"的竞态（第二个请求进来时已为 true）
    if (get().groupSending) return;
    set({ groupSending: true, groupError: null });

    const sessionId = currentSessionId;
    const userMsg: Message = {
      id: crypto.randomUUID(),
      sessionId,
      role: 'user',
      content: trimmed,
      createdAt: Date.now(),
      isProactive: false,
      image: opts?.image,
      replyToId: opts?.quoteId,
      replyToContent: opts?.quoteContent,
    };
    try {
      await messageRepo.create(userMsg);
      set((s) => ({ groupMessages: [...s.groupMessages, userMsg] }));

      // 构建群聊上下文：成员人设（含 TA 在个人聊天里的记忆 + 最近私聊）+ 最近历史
      const group = await groupRepo.getById(currentGroup.id);
      if (!group) {
        set({ groupSending: false, groupError: '群已被删除' });
        return;
      }
      const members = (await Promise.all(group.characterIds.map((id) => characterRepo.getById(id)))).filter(
        (c): c is NonNullable<typeof c> => !!c,
      );
      // 鲁棒性：成员不足（角色被删光/只剩 1 个）不调 API，直接提示（省 token + 防死循环）
      if (members.length < 2) {
        set({ groupSending: false, groupError: '群成员不足（至少需要 2 个成员）' });
        return;
      }
      const briefs = await buildBriefs(group, userId, trimmed);
      const history = (await messageRepo.getPage(sessionId, { limit: 40 }))
        .filter((message) => witnessedByAll(message, group.characterIds))
        .slice(-17, -1)
        .map((m) => ({
          senderName: m.senderId ? members.find((c) => c.id === m.senderId)?.name : undefined,
          role: m.role as 'user' | 'assistant',
          // 图片消息没有文字 → 给 AI 一个占位，避免空内容混入上下文
          content: m.content || (m.image ? '[图片]' : ''),
        }));
      const sessionData = await sessionRepo.getById(sessionId);
      const atMembers = parseAtNames(trimmed, members);

      const { turns, error } = await generateGroupTurn({
        apiKey,
        groupName: group.name,
        members: briefs,
        history,
        userMessage: trimmed,
        atMembers,
        image: opts?.image,
        summary: groupSummaryFor(sessionData, group.characterIds),
        // 热闹模式：一轮最多 5 条（默认 3，省 token）
        maxTurns: group.lively ? 5 : 3,
      });

      // 落库群回复序列
      const now = Date.now();
      const contextTrace = groupPromptTrace(briefs, sessionData, group.characterIds, sessionId);
      const msgs: Message[] = turns.map((t, i) => ({
        id: crypto.randomUUID(),
        sessionId,
        role: 'assistant',
        content: t.content,
        senderId: t.senderId,
        createdAt: now + i,
        isProactive: false,
        ...(contextTrace ? { contextTrace } : {}),
      }));
      for (const msg of msgs) {
        await messageRepo.create(msg);
      }
      await sessionRepo.touch(sessionId);
      set((s) => ({ groupMessages: [...s.groupMessages, ...msgs], groupSending: false }));
      if (turns.length === 0) {
        // 透出具体失败原因，便于定位（模型/Key/超时/解析）
        console.warn('[group-chat] 生成失败:', error);
        set({ groupError: error ? `群聊生成失败：${error.slice(0, 120)}` : '群聊生成失败，请重试' });
      }

      // 后台增强（不影响主流程）：长会话摘要 + 群聊记忆沉淀（只写给现存成员）
      // Serialize background language-model work for this turn. Concurrent
      // summary + memory extraction competed for quota and both could fail.
      void maybeSummarizeGroup(sessionId, apiKey)
        .finally(() => maybeExtractGroupMemories(sessionId, members.map((c) => c.id), apiKey));
    } catch (err) {
      console.warn('[group-chat] 异常:', err);
      set({ groupSending: false, groupError: '基因链接中断，请重试' });
    }
  },

  proactiveGroupTurn: async () => {
    const { currentGroup, currentSessionId, groupSending, lastProactiveAt } = get();
    const apiKey = useAuthStore.getState().apiKey;
    const userId = useAuthStore.getState().userId ?? '';
    if (!currentGroup || !currentSessionId || !apiKey || groupSending) return;
    const now = Date.now();
    // 防刷屏：距上次主动发言至少冷却时长
    if (now - lastProactiveAt < PROACTIVE_COOLDOWN_MS) return;
    try {
      const session = await sessionRepo.getById(currentSessionId);
      if (!session) return;
      const lastMsg = await messageRepo.getLast(currentSessionId);
      // 群里至少有 1 条消息（新群不主动打扰），且距最后一条消息足够久
      if (!lastMsg || Date.now() - lastMsg.createdAt < PROACTIVE_AFTER_MS) return;

      const group = await groupRepo.getById(currentGroup.id);
      if (!group) return;
      const { turns, error, contextTrace } = await generateProactiveTurn(group, currentSessionId, apiKey, userId);

      const now2 = Date.now();
      const msgs: Message[] = turns.map((t, i) => ({
        id: crypto.randomUUID(),
        sessionId: currentSessionId,
        role: 'assistant',
        content: t.content,
        senderId: t.senderId,
        createdAt: now2 + i,
        isProactive: true,
        ...(contextTrace ? { contextTrace } : {}),
      }));
      for (const msg of msgs) {
        await messageRepo.create(msg);
      }
      await sessionRepo.touch(currentSessionId);
      set((s) => ({
        groupMessages: [...s.groupMessages, ...msgs],
        groupSending: false,
        lastProactiveAt: Date.now(),
      }));
      // 同步群预览（聊天列表最后消息/时间）
      const last = await messageRepo.getLast(currentSessionId);
      const cgId = get().currentGroupId;
      if (cgId) {
        set((s) => ({
          groupPreviews: {
            ...s.groupPreviews,
            [cgId]: { content: last?.content ?? '', createdAt: last?.createdAt ?? Date.now(), unread: s.groupPreviews[cgId]?.unread ?? 0 },
          },
        }));
      }
      if (turns.length === 0) {
        console.warn('[group-chat] 主动发言失败:', error);
      }
    } catch (err) {
      console.warn('[group-chat] 主动发言异常:', err);
      set({ groupSending: false });
    }
  },

  proactiveBackground: async () => {
    const { groups, groupSending, lastProactiveAt, currentGroupId } = get();
    const apiKey = useAuthStore.getState().apiKey;
    const userId = useAuthStore.getState().userId ?? '';
    if (!apiKey || groupSending || groups.length === 0) return;
    const now = Date.now();
    // 省 token：后台冷却更长（30 分钟），且每次最多挑一个群
    if (now - lastProactiveAt < PROACTIVE_BG_COOLDOWN_MS) return;
    try {
      // 挑最久没动静的候选群（跳过正在群聊页看的群——页内定时器负责）
      let best: { group: Group; sessionId: string; lastAt: number } | null = null;
      for (const g of groups) {
        if (g.id === currentGroupId) continue;
        const sessions = await db.sessions.where('groupId').equals(g.id).toArray();
        const session = sessions[0];
        if (!session) continue;
        const lastMsg = await messageRepo.getLast(session.id);
        // 群里至少 1 条消息（用户开过口）且足够久没动静
        if (!lastMsg || Date.now() - lastMsg.createdAt < PROACTIVE_AFTER_MS) continue;
        if (!best || lastMsg.createdAt < best.lastAt) best = { group: g, sessionId: session.id, lastAt: lastMsg.createdAt };
      }
      if (!best) return;

      const { turns, error, contextTrace } = await generateProactiveTurn(best.group, best.sessionId, apiKey, userId);
      if (turns.length === 0) {
        console.warn('[group-chat] 后台主动发言失败:', error);
        return;
      }
      const now2 = Date.now();
      const msgs: Message[] = turns.map((t, i) => ({
        id: crypto.randomUUID(),
        sessionId: best.sessionId,
        role: 'assistant',
        content: t.content,
        senderId: t.senderId,
        createdAt: now2 + i,
        isProactive: true,
        ...(contextTrace ? { contextTrace } : {}),
      }));
      for (const msg of msgs) {
        await messageRepo.create(msg);
      }
      await sessionRepo.touch(best.sessionId);
      await sessionRepo.incrementUnread(best.sessionId);
      set((s) => ({ lastProactiveAt: Date.now() }));
      await get().loadGroups(); // 刷新预览 + 未读
      // 通知：应用内流体云 + 手机系统本地通知（省 token：只推第一条）
      const preview = turns[0].content.slice(0, 40);
      useNotificationStore.getState().push({
        characterId: '',
        characterName: best.group.name,
        avatar: '👥',
        preview,
      });
      if (IS_MOBILE) {
        void notifyLocal(`💬 ${best.group.name}`, preview);
      }
    } catch (err) {
      console.warn('[group-chat] 后台主动发言异常:', err);
    }
  },

  backgroundGroupBanter: async () => {
    const { groups, groupSending, lastBanterAt, currentGroupId } = get();
    const apiKey = useAuthStore.getState().apiKey;
    const userId = useAuthStore.getState().userId ?? '';
    if (!apiKey || groupSending || groups.length === 0) return;
    const now = Date.now();
    // 群聊自运转限频：4 小时冷却 + 每天最多 BANTER_DAILY_MAX 次（省 token）
    if (now - lastBanterAt < BANTER_COOLDOWN_MS) return;
    const dateKey = new Date().toISOString().slice(0, 10);
    const countKey = `virtugene-banter-count-${dateKey}`;
    const todayCount = Number(localStorage.getItem(countKey) ?? '0');
    if (todayCount >= BANTER_DAILY_MAX) return;
    try {
      // 挑候选群：跳过正在看的群；群里 ≥1 条消息且安静超过 40 分钟
      let best: { group: Group; sessionId: string } | null = null;
      for (const g of groups) {
        if (g.id === currentGroupId) continue;
        const sessions = await db.sessions.where('groupId').equals(g.id).toArray();
        const session = sessions[0];
        if (!session) continue;
        const last = await messageRepo.getLast(session.id);
        if (!last || Date.now() - last.createdAt < 40 * 60_000) continue;
        if (!best) best = { group: g, sessionId: session.id };
      }
      if (!best) return;

      const { turns, error, contextTrace } = await generateProactiveTurn(best.group, best.sessionId, apiKey, userId, 'banter');
      if (turns.length === 0) {
        console.warn('[group-chat] 群聊自运转失败:', error);
        return;
      }
      const now2 = Date.now();
      const msgs: Message[] = turns.map((t, i) => ({
        id: crypto.randomUUID(),
        sessionId: best.sessionId,
        role: 'assistant',
        content: t.content,
        senderId: t.senderId,
        createdAt: now2 + i,
        isProactive: true,
        ...(contextTrace ? { contextTrace } : {}),
      }));
      for (const msg of msgs) {
        await messageRepo.create(msg);
      }
      await sessionRepo.touch(best.sessionId);
      await sessionRepo.incrementUnread(best.sessionId);
      localStorage.setItem(countKey, String(todayCount + 1));
      set({ lastBanterAt: Date.now() });
      await get().loadGroups();
      const preview = turns[0].content.slice(0, 40);
      useNotificationStore.getState().push({
        characterId: '',
        characterName: best.group.name,
        avatar: '👥',
        preview: `（成员闲聊）${preview}`,
      });
      if (IS_MOBILE) {
        void notifyLocal(`💬 ${best.group.name}`, `成员们聊了几句：${preview}`);
      }
    } catch (err) {
      console.warn('[group-chat] 群聊自运转异常:', err);
    }
  },

  deleteGroupMessage: async (messageId) => {
    const { currentSessionId } = get();
    await messageRepo.deleteById(messageId);
    set((s) => ({ groupMessages: s.groupMessages.filter((m) => m.id !== messageId) }));
    if (currentSessionId) {
      await sessionRepo.touch(currentSessionId);
      // 预览同步为新的最后一条
      const last = await messageRepo.getLast(currentSessionId);
      set((s) => ({
        groupPreviews: s.currentGroupId
          ? { ...s.groupPreviews, [s.currentGroupId]: { content: last?.content ?? '', createdAt: last?.createdAt ?? Date.now(), unread: s.groupPreviews[s.currentGroupId!]?.unread ?? 0 } }
          : s.groupPreviews,
      }));
    }
  },

  rememberGroupMessage: async (messageId) => {
    const { currentGroup, currentSessionId } = get();
    const userId = useAuthStore.getState().userId ?? '';
    if (!currentGroup || !currentSessionId) return;
    try {
      const msgs = await messageRepo.getBySession(currentSessionId);
      const m = msgs.find((x) => x.id === messageId);
      if (!m || !m.content) return;
      const now = Date.now();
      const speakerName = m.role === 'user' ? '用户' : (await characterRepo.getById(m.senderId ?? ''))?.name ?? '群成员';
      const rememberedContent = `${speakerName}在群里说过：${m.content}`.slice(0, 240);
      for (const charId of currentGroup.characterIds) {
        // 显式记住也不能把角色没有见过的旧群消息补成“共同经历”。
        if (!m.witnessedBy?.includes(charId)) continue;
        await memoryRepo.create({
          id: crypto.randomUUID(),
          characterId: charId,
          userId,
          content: rememberedContent,
          type: 'auto',
          ...prepareMemoryMetadata(rememberedContent, { kind: 'episode', pinned: true, stability: 'stable', confidence: 1 }),
          createdAt: now,
          sourceSessionId: currentSessionId,
          sourceMessageIds: [m.id],
          confidence: 1,
          updatedAt: now,
        });
      }
    } catch {
      /* 静默 */
    }
  },

  setMemberNickname: async (groupId, characterId, nickname) => {
    const g = await groupRepo.getById(groupId);
    if (!g) return;
    const trimmed = nickname.trim();
    const nicknames = { ...(g.memberNicknames ?? {}) };
    if (trimmed) nicknames[characterId] = trimmed.slice(0, 12);
    else delete nicknames[characterId];
    await get().updateGroup(groupId, { memberNicknames: nicknames });
  },

  updateGroup: async (id, patch) => {
    await groupRepo.update(id, { ...patch, updatedAt: Date.now() });
    await get().loadGroups();
    if (get().currentGroupId === id) {
      const g = await groupRepo.getById(id);
      set({ currentGroup: g });
    }
  },

  removeMember: async (groupId, characterId) => {
    const g = await groupRepo.getById(groupId);
    if (!g) return;
    const ids = g.characterIds.filter((id) => id !== characterId);
    await get().updateGroup(groupId, { characterIds: ids });
  },

  deleteGroup: async (groupId) => {
    const userId = useAuthStore.getState().userId ?? '';
    const sessions = await db.sessions.where('groupId').equals(groupId).toArray();
    for (const s of sessions) {
      await sessionRepo.deleteById(s.id); // 级联删消息
    }
    await groupRepo.deleteById(groupId);
    await get().loadGroups();
    if (get().currentGroupId === groupId) {
      set({ currentGroupId: null, currentGroup: null, currentSessionId: null, groupMessages: [], groupError: null });
    }
  },
}));

// 供 UI 使用的常量（主动发言触发/冷却时长）
export { PROACTIVE_AFTER_MS, PROACTIVE_COOLDOWN_MS };
