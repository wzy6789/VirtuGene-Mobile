import { create } from 'zustand';
import { db, type Group, type Session, type Message } from '../db/index';
import { groupRepo } from '../db/group-repo';
import { sessionRepo } from '../db/session-repo';
import { messageRepo } from '../db/message-repo';
import { characterRepo } from '../db/character-repo';
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

  loadGroups: async () => {
    const userId = useAuthStore.getState().userId ?? '';
    const groups = await groupRepo.getByUser(userId);
    set({ groups });
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
      // 构建群聊上下文：成员人设 + 最近历史
      const group = await groupRepo.getById(currentGroup.id);
      const members = (await Promise.all(group!.characterIds.map((id) => characterRepo.getById(id)))).filter(
        (c): c is NonNullable<typeof c> => !!c,
      );
      const briefs: GroupMemberBrief[] = members.map((c) => ({
        id: c.id,
        name: c.name,
        persona: c.signature || c.systemPrompt.slice(0, 60),
      }));
      const all = await messageRepo.getBySession(sessionId);
      const history = all
        .slice(-17, -1)
        .map((m) => ({
          senderName: m.senderId ? members.find((c) => c.id === m.senderId)?.name : undefined,
          role: m.role as 'user' | 'assistant',
          content: m.content,
        }));

      const turns = await generateGroupTurn({
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
        set({ groupError: '群聊生成失败，请重试' });
      }
    } catch {
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
