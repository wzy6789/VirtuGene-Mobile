import { create } from 'zustand';
import { db, type Group, type Session, type Message } from '../db/index';
import { groupRepo } from '../db/group-repo';
import { sessionRepo } from '../db/session-repo';
import { messageRepo } from '../db/message-repo';
import { characterRepo } from '../db/character-repo';
import { memoryRepo } from '../db/memory-repo';
import { useAuthStore } from './auth-store';
import { useNotificationStore } from './notification-store';
import { ipc } from '../lib/ipc-client';
import { notifyLocal } from '../lib/notify';
import { IS_MOBILE } from '../lib/platform';
import { generateGroupTurn, type GroupMemberBrief, type GroupTurn } from '../lib/ai/group-chat';
import { extractMemories } from '../lib/ai/memory-consolidator';

/** 主动发言触发：距上一条消息超过该时长（且在群聊页停留时）触发一次 */
const PROACTIVE_AFTER_MS = 5 * 60_000;
/** 主动发言冷却：距上次主动发言至少该时长，避免刷屏 */
const PROACTIVE_COOLDOWN_MS = 15 * 60_000;
/** 后台主动发言冷却（离开群聊页时更长：省 token） */
const PROACTIVE_BG_COOLDOWN_MS = 30 * 60_000;
/** 长会话滚动摘要窗口：超过该条数的早期消息压缩成摘要 */
const SUMMARY_WINDOW = 60;
/** 摘要增量重建阈值：新增未覆盖消息数达到该值才重新生成 */
const SUMMARY_REGENERATE_THRESHOLD = 20;

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

  loadGroups: () => Promise<void>;
  createGroup: (name: string, characterIds: string[]) => Promise<Group | null>;
  selectGroup: (groupId: string) => Promise<void>;
  sendGroupMessage: (text: string, opts?: { image?: string; quoteId?: string; quoteContent?: string }) => Promise<void>;
  /** 成员主动开口：用户长时间没说话时触发（有冷却与防刷屏保护） */
  proactiveGroupTurn: () => Promise<void>;
  /** 后台主动发言：离开群聊页后由 App 定时器触发（挑最久没动静的群，30 分钟冷却，省 token） */
  proactiveBackground: () => Promise<void>;
  deleteGroupMessage: (messageId: string) => Promise<void>;
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

/** 构建群聊上下文：成员人设（含单聊记忆 + 最近私聊原话） */
async function buildBriefs(group: Group, userId: string): Promise<GroupMemberBrief[]> {
  const members = (await Promise.all(group.characterIds.map((id) => characterRepo.getById(id)))).filter(
    (c): c is NonNullable<typeof c> => !!c,
  );
  return Promise.all(
    members.map(async (c) => {
      const memories = await memoryRepo.getRecentByCharacter(c.id, userId, 10);
      const memText = memories.map((m) => m.content.slice(0, 80)).join('；').slice(0, 300);
      let privateChat: string | undefined;
      try {
        const sessions = await sessionRepo.getByCharacter(c.id, userId);
        const latest = sessions[0];
        if (latest) {
          const lastMsgs = (await messageRepo.getBySession(latest.id)).slice(-6);
          if (lastMsgs.length > 0) {
            privateChat = lastMsgs
              .map((m) => (m.role === 'user' ? `我：${m.content}` : `${c.name}：${m.content}`))
              .join('\n')
              .slice(0, 500);
          }
        }
      } catch {
        /* 私聊记录取不到不影响群聊 */
      }
      return {
        id: c.id,
        name: c.name,
        persona: c.signature || c.systemPrompt.slice(0, 60),
        memory: memText || undefined,
        privateChat,
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
    /* 摘要失败是 best-effort */
  }
}

/** 群聊记忆双向：把群里聊到的用户关键事实沉淀为每个成员的记忆（每 3 条用户消息触发一次） */
async function maybeExtractGroupMemories(sessionId: string, memberIds: string[], apiKey: string): Promise<void> {
  try {
    const userId = useAuthStore.getState().userId ?? '';
    const msgs = await messageRepo.getBySession(sessionId);
    const userCount = msgs.filter((m) => m.role === 'user').length;
    if (userCount < 3 || userCount % 3 !== 0) return;
    const history = msgs.slice(-30).map((m) => ({ role: m.role, content: m.content }));
    const result = await extractMemories({ apiKey, history });
    if (!result.memories || result.memories.length === 0) return;
    for (const charId of memberIds) {
      const existing = await memoryRepo.getByCharacter(charId, userId);
      const existingContents = new Set(existing.map((m) => m.content.trim()));
      const fresh = result.memories
        .map((c) => c.trim())
        .filter((c) => c.length > 0 && !existingContents.has(c))
        .slice(0, 10);
      if (fresh.length > 0) {
        const now = Date.now();
        await memoryRepo.createMany(
          fresh.map((content, i) => ({
            id: crypto.randomUUID(),
            characterId: charId,
            userId,
            content,
            type: 'auto' as const,
            createdAt: now + i,
          })),
        );
      }
    }
  } catch {
    /* 记忆提取失败不影响群聊 */
  }
}

/** 生成一轮"成员主动开口"的群聊回合（页内 + 后台共用，省 token：1~2 条短句） */
async function generateProactiveTurn(
  group: Group,
  sessionId: string,
  apiKey: string,
  userId: string,
): Promise<{ turns: GroupTurn[]; error?: string }> {
  const members = (await Promise.all(group.characterIds.map((id) => characterRepo.getById(id)))).filter(
    (c): c is NonNullable<typeof c> => !!c,
  );
  // 鲁棒性：成员不足不调 API
  if (members.length < 2) return { turns: [], error: '群成员不足' };
  const briefs = await buildBriefs(group, userId);
  const all = await messageRepo.getPage(sessionId, { limit: 20 });
  const history = all
    .map((m) => ({
      senderName: m.senderId ? members.find((c) => c.id === m.senderId)?.name : undefined,
      role: m.role as 'user' | 'assistant',
      content: m.content || (m.image ? '[图片]' : ''),
    }));
  const session = await sessionRepo.getById(sessionId);
  return generateGroupTurn({
    apiKey,
    groupName: group.name,
    members: briefs,
    history,
    mode: 'proactive',
    summary: session?.summary,
  });
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
      const briefs = await buildBriefs(group, userId);
      const history = (await messageRepo.getPage(sessionId, { limit: 20 }))
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
        summary: sessionData?.summary,
        // 热闹模式：一轮最多 5 条（默认 3，省 token）
        maxTurns: group.lively ? 5 : 3,
      });

      // 落库群回复序列
      const now = Date.now();
      const msgs: Message[] = turns.map((t, i) => ({
        id: crypto.randomUUID(),
        sessionId,
        role: 'assistant',
        content: t.content,
        senderId: t.senderId,
        createdAt: now + i,
        isProactive: false,
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
      void maybeSummarizeGroup(sessionId, apiKey);
      void maybeExtractGroupMemories(sessionId, members.map((c) => c.id), apiKey);
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
      const { turns, error } = await generateProactiveTurn(group, currentSessionId, apiKey, userId);

      const now2 = Date.now();
      const msgs: Message[] = turns.map((t, i) => ({
        id: crypto.randomUUID(),
        sessionId: currentSessionId,
        role: 'assistant',
        content: t.content,
        senderId: t.senderId,
        createdAt: now2 + i,
        isProactive: true,
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

      const { turns, error } = await generateProactiveTurn(best.group, best.sessionId, apiKey, userId);
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
