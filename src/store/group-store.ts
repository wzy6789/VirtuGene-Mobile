import { create } from 'zustand';
import { db, type Group, type Session, type Message } from '../db/index';
import { groupRepo } from '../db/group-repo';
import { sessionRepo } from '../db/session-repo';
import { messageRepo } from '../db/message-repo';
import { characterRepo } from '../db/character-repo';
import { memoryRepo } from '../db/memory-repo';
import { useAuthStore } from './auth-store';
import { generateGroupTurn, type GroupMemberBrief } from '../lib/ai/group-chat';

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

  loadGroups: () => Promise<void>;
  createGroup: (name: string, characterIds: string[]) => Promise<Group | null>;
  selectGroup: (groupId: string) => Promise<void>;
  sendGroupMessage: (text: string) => Promise<void>;
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

export const useGroupStore = create<GroupState>((set, get) => ({
  groups: [],
  currentGroupId: null,
  currentGroup: null,
  currentSessionId: null,
  groupMessages: [],
  groupSending: false,
  groupError: null,
  groupPreviews: {},

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

  sendGroupMessage: async (text) => {
    const trimmed = text.trim();
    const { currentGroup, currentSessionId } = get();
    const apiKey = useAuthStore.getState().apiKey;
    const userId = useAuthStore.getState().userId ?? '';
    if (!trimmed || !currentGroup || !currentSessionId || !apiKey) return;
    if (get().groupSending) return;

    const sessionId = currentSessionId;
    const userMsg: Message = {
      id: crypto.randomUUID(),
      sessionId,
      role: 'user',
      content: trimmed,
      createdAt: Date.now(),
      isProactive: false,
    };
    await messageRepo.create(userMsg);
    set((s) => ({ groupMessages: [...s.groupMessages, userMsg], groupError: null, groupSending: true }));

    try {
      // 构建群聊上下文：成员人设（含 TA 在个人聊天里的记忆）+ 最近历史
      const group = await groupRepo.getById(currentGroup.id);
      const members = (await Promise.all(group!.characterIds.map((id) => characterRepo.getById(id)))).filter(
        (c): c is NonNullable<typeof c> => !!c,
      );
      // 每个成员注入与该用户的单聊记忆（角色在群里也能想起之前的事；10 条更全）。
      // 记忆截断到 80 字/条、总 300 字：防止大提示词挤占输出空间导致 JSON 被截断。
      // 另外注入「最近私聊记录」（该成员最新单聊会话的最后 6 条）——记忆提取是延迟+有损的，
      // 私聊原话直接带上，保证用户私下刚说的事群里立刻知道（知识跟着角色走）。
      const briefs: GroupMemberBrief[] = await Promise.all(
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
      const all = await messageRepo.getBySession(sessionId);
      const history = all
        .slice(-17, -1)
        .map((m) => ({
          senderName: m.senderId ? members.find((c) => c.id === m.senderId)?.name : undefined,
          role: m.role as 'user' | 'assistant',
          content: m.content,
        }));

      const { turns, error } = await generateGroupTurn({
        apiKey,
        groupName: group!.name,
        members: briefs,
        history,
        userMessage: trimmed,
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
    } catch (err) {
      console.warn('[group-chat] 异常:', err);
      set({ groupSending: false, groupError: '基因链接中断，请重试' });
    }
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
