import { create } from 'zustand';
import { db, type Character, type Session, type Message } from '../db/index';
import { characterRepo } from '../db/character-repo';
import { sessionRepo } from '../db/session-repo';
import { messageRepo, MESSAGE_PAGE_SIZE } from '../db/message-repo';
import { memoryRepo } from '../db/memory-repo';
import { stateRepo } from '../db/state-repo';
import { useAuthStore } from './auth-store';
import { useCharacterStateStore } from './character-state-store';
import { deriveProactivity, GREETING_PROACTIVITY_THRESHOLD } from '../lib/personality';
import { ipc } from '../lib/ipc-client';
import { useNotificationStore } from './notification-store';
import { useDiaryStore } from './diary-store';
import { assignVoice } from '../lib/ai/voice-assigner';
import { sanitizeVoiceProfile, completeVoiceProfile, ALL_VOICES, type VoiceProfile } from '../lib/voice-map';

/** 角色声线：创建/首次进入时由 AI 按形象判定并固定（幂等，只执行一次；失败静默不影响聊天） */
async function assignVoiceIfNeeded(characterId: string, userId: string): Promise<void> {
  try {
    const apiKey = useAuthStore.getState().apiKey;
    if (!apiKey) return;
    const char = await characterRepo.getById(characterId);
    if (!char || char.voice) return; // 已有声线则跳过（手机端无本地音色，无需补 sid）
    const r = await assignVoice({
      apiKey,
      characterId,
      character: { name: char.name, systemPrompt: char.systemPrompt, tags: char.tags },
    });
    if (r.voice) {
      const full = completeVoiceProfile(sanitizeVoiceProfile(r.voice), characterId);
      await characterRepo.update(characterId, { voice: full });
      // 同步内存中的角色
      useChatStore.setState((s) => ({
        characters: s.characters.map((c) => (c.id === characterId ? { ...c, voice: full } : c)),
      }));
    }
  } catch {
    /* 声线判定失败不影响聊天 */
  }
}

interface CharPreview {
  content: string;
  createdAt: number;
}

interface ChatState {
  selectedCharacterId: string | null;
  currentSessionId: string | null;
  characters: Character[];
  messages: Message[];
  charPreviews: Record<string, CharPreview | null>;
  unreadByCharacter: Record<string, number>;
  /** 当前会话是否还有更早的消息未加载（分页） */
  hasMoreMessages: boolean;
  /** 「把日记发给角色」：切到目标会话后，待发送的日记文本（由 ChatWindow 消费并触发 AI 回复） */
  pendingDiarySend: { sessionId: string; text: string } | null;

  loadCharacters: () => Promise<void>;
  selectCharacter: (id: string) => Promise<void>;
  /** 确保角色有声线：无则后台 AI 判定补分配（幂等；供点 🔊 时兜底调用） */
  ensureCharacterVoice: (id: string) => Promise<void>;
  /** 手动设置角色声线（方言切换等；落库并同步内存） */
  setCharacterVoice: (id: string, voice: VoiceProfile) => Promise<void>;
  loadEarlierMessages: () => Promise<void>;
  addMessage: (msg: Message) => void;
  updateMessage: (id: string, patch: Partial<Message>) => void;
  addProactiveMessage: (characterId: string, content: string) => Promise<void>;
  refreshPreviews: () => Promise<void>;
  fetchUnreadCounts: () => Promise<void>;
  createCharacter: (data: Omit<Character, 'id' | 'createdAt' | 'proactivity'> & { proactivity?: number }) => Promise<Character>;
  updateCharacter: (id: string, updates: Partial<Character>) => Promise<void>;
  deleteCharacterWithSessions: (id: string) => Promise<void>;
  deleteCharacter: (id: string) => Promise<void>;
  deleteMessage: (id: string) => Promise<void>;
  /** 清除某角色的全部会话与消息（保留角色、记忆、关系）——微信式「删除会话」 */
  clearSessionsForCharacter: (id: string) => Promise<void>;
  /** 标为已读（不清除选中态，不进聊天） */
  markCharacterRead: (id: string) => Promise<void>;
  togglePin: (id: string) => Promise<void>;
  /** 从聊天会话列表隐藏该角色（仅隐藏列表项，角色与消息数据全部保留） */
  hideFromChatList: (id: string) => Promise<void>;
  /** 恢复显示被隐藏的聊天列表项 */
  unhideFromChatList: (id: string) => Promise<void>;
  deleteAccount: () => Promise<void>;
  triggerProactive: () => Promise<void>;
  /** 把一段文本（如日记）作为用户消息发给指定角色，切到该会话并等待 ChatWindow 触发 AI 回复 */
  shareDiaryToCharacter: (characterId: string, text: string) => Promise<void>;
  /** ChatWindow 消费掉待发送的日记文本 */
  consumeDiarySend: () => void;
  reset: () => void;
}

async function getOrCreateSession(characterId: string, userId: string): Promise<Session> {
  const sessions = await sessionRepo.getByCharacter(characterId, userId);
  if (sessions.length > 0) return sessions[0];

  const now = Date.now();
  const session: Session = {
    id: crypto.randomUUID(),
    characterId,
    userId,
    title: '新对话',
    createdAt: now,
    updatedAt: now,
    unreadCount: 0,
  };
  await sessionRepo.create(session);
  return session;
}

async function getLastMessage(characterId: string, userId: string): Promise<CharPreview | null> {
  const sessions = await sessionRepo.getByCharacter(characterId, userId);
  if (sessions.length === 0) return null;
  const last = await messageRepo.getLast(sessions[0].id);
  if (!last) return null;
  return { content: last.content, createdAt: last.createdAt };
}

function proactivityOf(c: Character): number {
  return c.proactivity ?? deriveProactivity(c.tags, c.systemPrompt);
}

/** 新会话时，按角色主动倾向决定是否先发开场白 */
async function seedGreeting(characterId: string, sessionId: string): Promise<void> {
  const char = await characterRepo.getById(characterId);
  if (!char?.greeting) return;
  if (proactivityOf(char) < GREETING_PROACTIVITY_THRESHOLD) return;

  const msg: Message = {
    id: crypto.randomUUID(),
    sessionId,
    role: 'assistant',
    content: char.greeting,
    createdAt: Date.now(),
    isProactive: false,
  };
  await messageRepo.create(msg);
}

/** 按 proactivity² 加权随机选择角色，主动倾向越强越容易被选中 */
function weightedPick(chars: Character[]): Character {
  const weights = chars.map((c) => {
    const p = proactivityOf(c);
    return p * p;
  });
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < chars.length; i++) {
    r -= weights[i];
    if (r <= 0) return chars[i];
  }
  return chars[chars.length - 1];
}

export const useChatStore = create<ChatState>((set, get) => ({
  selectedCharacterId: null,
  currentSessionId: null,
  characters: [],
  messages: [],
  charPreviews: {},
  unreadByCharacter: {},
  hasMoreMessages: false,
  pendingDiarySend: null,

  loadCharacters: async () => {
    const userId = useAuthStore.getState().userId ?? '';
    const all = await characterRepo.getAll();
    // Sidebar shows only the user's own characters. Presets and others' published
    // genes live in the gene pool and are cloned in when the user adds them.
    const visible = all.filter((c) => c.createdBy === userId);
    // 并行加载预览与未读数，避免 N+1 串行查询
    const [previewList, unreadList] = await Promise.all([
      Promise.all(visible.map((c) => getLastMessage(c.id, userId))),
      Promise.all(visible.map((c) => sessionRepo.getUnreadByCharacter(c.id, userId))),
    ]);
    const charPreviews: Record<string, CharPreview | null> = {};
    const unreadByCharacter: Record<string, number> = {};
    visible.forEach((c, i) => {
      charPreviews[c.id] = previewList[i];
      unreadByCharacter[c.id] = unreadList[i];
    });
    set({ characters: visible, charPreviews, unreadByCharacter });
    const { selectedCharacterId } = get();
    const stillSelected = visible.some((c) => c.id === selectedCharacterId);
    if (stillSelected) return;
    if (visible.length > 0) {
      await get().selectCharacter(visible[0].id);
    } else {
      set({ selectedCharacterId: null, currentSessionId: null, messages: [], hasMoreMessages: false });
    }
  },

  selectCharacter: async (id) => {
    const userId = useAuthStore.getState().userId ?? '';
    // 重新进入某角色聊天 → 自动从「已删除列表」恢复显示（删除仅隐藏，重新聊天即重现）
    const char = await characterRepo.getById(id);
    if (char?.chatListHidden) {
      await characterRepo.update(id, { chatListHidden: false });
    }
    const existing = await sessionRepo.getByCharacter(id, userId);
    const session = await getOrCreateSession(id, userId);
    if (existing.length === 0) {
      await seedGreeting(id, session.id);
    }
    // 只加载最近 MESSAGE_PAGE_SIZE 条，更早消息按需加载
    const msgs = await messageRepo.getPage(session.id, { limit: MESSAGE_PAGE_SIZE });
    const total = await messageRepo.countBySession(session.id);
    // Clear unread for this character (user's own sessions only)
    for (const s of existing) {
      await sessionRepo.clearUnread(s.id);
    }
    const { unreadByCharacter } = get();
    unreadByCharacter[id] = 0;
    set({
      selectedCharacterId: id,
      currentSessionId: session.id,
      messages: msgs,
      hasMoreMessages: total > msgs.length,
      unreadByCharacter: { ...unreadByCharacter },
    });
    // 首次进入该角色：无声线 → AI 判定；已有声线但音色已失效 → 净化（幂等）
    void get().ensureCharacterVoice(id);
  },

  ensureCharacterVoice: async (id) => {
    const char = await characterRepo.getById(id);
    if (!char) return;
    if (char.voice) {
      // 已有声线但音色名非法（备份导入/旧数据/已下线音色）→ 净化落库，避免 Edge 合成被拒
      // （用 ALL_VOICES 校验：用户手动选择的方言音色是合法的，不会被误覆盖）
      if (!ALL_VOICES.some((v) => v.voice === char.voice!.voice)) {
        const fixed = completeVoiceProfile(sanitizeVoiceProfile(char.voice), id);
        await characterRepo.update(id, { voice: fixed });
        useChatStore.setState((s) => ({
          characters: s.characters.map((c) => (c.id === id ? { ...c, voice: fixed } : c)),
        }));
      }
      return;
    }
    await assignVoiceIfNeeded(id, useAuthStore.getState().userId ?? '');
  },

  setCharacterVoice: async (id, voice) => {
    await characterRepo.update(id, { voice });
    useChatStore.setState((s) => ({
      characters: s.characters.map((c) => (c.id === id ? { ...c, voice } : c)),
    }));
  },

  loadEarlierMessages: async () => {
    const { currentSessionId, messages } = get();
    if (!currentSessionId || messages.length === 0) return;
    const oldest = messages[0].createdAt;
    const earlier = await messageRepo.getPage(currentSessionId, { limit: MESSAGE_PAGE_SIZE, before: oldest });
    if (earlier.length === 0) {
      set({ hasMoreMessages: false });
      return;
    }
    set({
      messages: [...earlier, ...messages],
      hasMoreMessages: earlier.length === MESSAGE_PAGE_SIZE,
    });
  },

  addMessage: (msg) => {
    const { currentSessionId, selectedCharacterId } = get();
    // 关键守卫：回复到达时用户可能已切到别的会话/角色，
    // 绝不把消息追加进错误的会话（只刷新预览 + 由调用方上流体云提醒）
    if (currentSessionId && msg.sessionId !== currentSessionId) {
      void get().refreshPreviews();
      return;
    }
    set((s) => ({
      messages: [...s.messages, msg],
      charPreviews: {
        ...s.charPreviews,
        [selectedCharacterId!]: { content: msg.content, createdAt: msg.createdAt },
      },
    }));
  },

  updateMessage: (id, patch) => {
    set((s) => ({
      messages: s.messages.map((m) => (m.id === id ? { ...m, ...patch } : m)),
    }));
  },

  addProactiveMessage: async (characterId, content) => {
    const userId = useAuthStore.getState().userId ?? '';
    const session = await getOrCreateSession(characterId, userId);
    const msg: Message = {
      id: crypto.randomUUID(),
      sessionId: session.id,
      role: 'assistant',
      content,
      createdAt: Date.now(),
      isProactive: true,
    };
    await messageRepo.create(msg);
    await sessionRepo.touch(session.id);

    const { selectedCharacterId, unreadByCharacter } = get();
    // If this character is currently selected, add to message list (不计数未读)
    if (selectedCharacterId === characterId) {
      set((s) => ({
        messages: [...s.messages, msg],
        charPreviews: {
          ...s.charPreviews,
          [characterId]: { content, createdAt: msg.createdAt },
        },
      }));
    } else {
      // 不在当前会话才增加未读数
      await sessionRepo.incrementUnread(session.id);
      // Just update preview and unread count
      const count = (unreadByCharacter[characterId] ?? 0) + 1;
      set({
        charPreviews: {
          ...get().charPreviews,
          [characterId]: { content, createdAt: msg.createdAt },
        },
        unreadByCharacter: { ...unreadByCharacter, [characterId]: count },
      });
      // 应用内流体云提醒（角色主动发消息，但用户没在看 TA 的会话）
      const char = get().characters.find((c) => c.id === characterId);
      if (char) {
        useNotificationStore.getState().push({
          characterId,
          characterName: char.name,
          avatar: char.avatar,
          preview: content,
        });
      }
    }
  },

  fetchUnreadCounts: async () => {
    const { characters } = get();
    const userId = useAuthStore.getState().userId ?? '';
    const counts: Record<string, number> = {};
    for (const c of characters) {
      counts[c.id] = await sessionRepo.getUnreadByCharacter(c.id, userId);
    }
    set({ unreadByCharacter: counts });
  },

  triggerProactive: async () => {
    const { characters } = get();
    const apiKey = useAuthStore.getState().apiKey;
    const userId = useAuthStore.getState().userId ?? '';
    if (!apiKey || characters.length === 0) return;

    // 只有主动倾向足够强的角色才会主动发消息（冰冷角色不会）
    const eligible = characters.filter((c) => proactivityOf(c) >= 0.15);
    if (eligible.length === 0) return;

    // 按 proactivity² 加权选择目标角色；50% 偏向当前选中角色
    const selectedId = get().selectedCharacterId;
    let targetChar: Character;
    if (selectedId && Math.random() < 0.5) {
      targetChar = eligible.find((c) => c.id === selectedId) ?? weightedPick(eligible);
    } else {
      targetChar = weightedPick(eligible);
    }

    try {
      // Get recent messages for context
      const session = await getOrCreateSession(targetChar.id, userId);
      const msgs = await messageRepo.getBySession(session.id);

      // 连续未被回应的主动消息条数
      let unansweredProactive = 0;
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].isProactive) unansweredProactive += 1;
        else break;
      }
      // 用户一直没回复时，主动消息最多发 3 条，不再继续刷
      if (unansweredProactive >= 3) {
        return;
      }

      // 上一条主动消息未被回应 → 好感度/心情下滑
      const last = msgs[msgs.length - 1];
      if (last && last.isProactive) {
        await useCharacterStateStore.getState().bump(targetChar.id, -3, -5);
      }

      // 读取最新关系状态，注入主动消息语气
      const state = await stateRepo.getOrCreate(targetChar.id, userId);

      const lastMessages = msgs.slice(-10).map((m) => ({
        role: m.role,
        content: m.content,
      }));
      const lastMessageAt = msgs.length > 0 ? msgs[msgs.length - 1].createdAt : undefined;

      const result = await ipc.proactive.generate({
        apiKey,
        systemPrompt: targetChar.systemPrompt,
        characterName: targetChar.name,
        lastMessages,
        affinity: state.affinity,
        mood: state.mood,
        lastMessageAt,
      });

      if (result.content) {
        await get().addProactiveMessage(targetChar.id, result.content);
      } else if (result.error) {
        console.warn('[proactive] generate error:', result.error);
      }
    } catch (err) {
      console.warn('[proactive] unexpected error:', err);
    }
  },

  refreshPreviews: async () => {
    const { characters } = get();
    const userId = useAuthStore.getState().userId ?? '';
    const previewList = await Promise.all(characters.map((c) => getLastMessage(c.id, userId)));
    const charPreviews: Record<string, CharPreview | null> = {};
    characters.forEach((c, i) => {
      charPreviews[c.id] = previewList[i];
    });
    set({ charPreviews });
  },

  createCharacter: async (data) => {
    const now = Date.now();
    const userId = useAuthStore.getState().userId ?? '';
    const character: Character = {
      ...data,
      id: crypto.randomUUID(),
      published: (data as any).published ?? false,
      createdBy: userId,
      proactivity: data.proactivity ?? deriveProactivity(data.tags ?? [], data.systemPrompt ?? ''),
      createdAt: now,
    };
    await characterRepo.create(character);
    await get().loadCharacters();
    get().selectCharacter(character.id);
    // 新角色创建后由 AI 判定声线并固定
    void assignVoiceIfNeeded(character.id, userId);
    return character;
  },

  updateCharacter: async (id, updates) => {
    const userId = useAuthStore.getState().userId ?? '';
    const char = await characterRepo.getById(id);
    if (!char || char.isPreset || char.createdBy !== userId) return;
    const nextUpdates: Partial<Character> = { ...updates };
    if (updates.systemPrompt !== undefined || updates.tags !== undefined) {
      nextUpdates.proactivity = deriveProactivity(
        updates.tags ?? char.tags,
        updates.systemPrompt ?? char.systemPrompt,
      );
    }
    await characterRepo.update(id, nextUpdates);
    await get().loadCharacters();
  },

  deleteCharacter: async (id) => {
    const userId = useAuthStore.getState().userId ?? '';
    const char = await characterRepo.getById(id);
    if (!char || char.isPreset || char.createdBy !== userId) return;
    await get().deleteCharacterWithSessions(id);
  },

  deleteMessage: async (id) => {
    await messageRepo.deleteById(id);
    set((s) => ({ messages: s.messages.filter((m) => m.id !== id) }));
    await get().refreshPreviews();
  },

  clearSessionsForCharacter: async (id) => {
    const userId = useAuthStore.getState().userId ?? '';
    const sessions = await sessionRepo.getByCharacter(id, userId);
    const sessionIds = sessions.map((s) => s.id);
    if (sessionIds.length > 0) {
      // 删除情绪快照（按会话关联）
      await db.emotionSnapshots.where('sessionId').anyOf(sessionIds).delete();
    }
    for (const sid of sessionIds) {
      await sessionRepo.deleteById(sid); // 级联删除消息
    }
    // 若当前正与该角色聊天，清除选中态
    if (get().selectedCharacterId === id) {
      set({ selectedCharacterId: null, currentSessionId: null, messages: [], hasMoreMessages: false });
    }
    await get().refreshPreviews();
  },

  markCharacterRead: async (id) => {
    const userId = useAuthStore.getState().userId ?? '';
    const sessions = await sessionRepo.getByCharacter(id, userId);
    for (const s of sessions) {
      await sessionRepo.clearUnread(s.id);
    }
    const { unreadByCharacter } = get();
    unreadByCharacter[id] = 0;
    set({ unreadByCharacter: { ...unreadByCharacter } });
  },

  togglePin: async (id) => {
    const char = await characterRepo.getById(id);
    if (!char) return;
    // 聊天列表置顶：所有角色（含预设）都可置顶；仅自定义角色在角色库侧边栏也有置顶语义
    if (!char.isPreset) {
      const userId = useAuthStore.getState().userId ?? '';
      if (char.createdBy !== userId) return;
    }
    await characterRepo.update(id, { pinned: !char.pinned });
    await get().loadCharacters();
  },

  hideFromChatList: async (id) => {
    const char = await characterRepo.getById(id);
    if (!char) return;
    await characterRepo.update(id, { chatListHidden: true });
    await get().loadCharacters();
    // 若当前正与该角色聊天，清除选中态（该角色已从列表隐藏，不应停留在它的聊天）
    if (get().selectedCharacterId === id) {
      set({ selectedCharacterId: null, currentSessionId: null, messages: [], hasMoreMessages: false });
    }
  },

  unhideFromChatList: async (id) => {
    await characterRepo.update(id, { chatListHidden: false });
    await get().loadCharacters();
  },

  deleteCharacterWithSessions: async (id) => {
    const userId = useAuthStore.getState().userId ?? '';
    const sessions = await sessionRepo.getByCharacter(id, userId);
    const sessionIds = sessions.map((s) => s.id);
    if (sessionIds.length > 0) {
      await db.emotionSnapshots.where('sessionId').anyOf(sessionIds).delete();
    }
    for (const sid of sessionIds) {
      await sessionRepo.deleteById(sid);
    }
    await characterRepo.deleteById(id);
    await memoryRepo.clearForCharacter(id, userId);
    await stateRepo.deleteByCharacter(id, userId);

    const { selectedCharacterId } = get();
    const all = await characterRepo.getAll();
    const visible = all.filter((c) => c.createdBy === userId);
    const previewList = await Promise.all(visible.map((c) => getLastMessage(c.id, userId)));
    const charPreviews: Record<string, CharPreview | null> = {};
    visible.forEach((c, i) => {
      charPreviews[c.id] = previewList[i];
    });
    set({ characters: visible, charPreviews });

    if (selectedCharacterId === id) {
      if (visible.length > 0) {
        get().selectCharacter(visible[0].id);
      } else {
        set({ selectedCharacterId: null, currentSessionId: null, messages: [], hasMoreMessages: false });
      }
    }
  },

  deleteAccount: async () => {
    const userId = useAuthStore.getState().userId ?? '';

    // Delete this user's sessions along with their messages + emotion snapshots
    const sessions = await db.sessions.where('userId').equals(userId).toArray();
    const sessionIds = sessions.map((s) => s.id);
    if (sessionIds.length > 0) {
      await db.emotionSnapshots.where('sessionId').anyOf(sessionIds).delete();
    }
    for (const s of sessions) {
      await sessionRepo.deleteById(s.id);
    }

    // Delete this user's memories, relationship state, and custom characters
    await db.memories.where('userId').equals(userId).delete();
    const states = await db.characterStates.toArray();
    for (const st of states) {
      if (st.userId === userId) {
        await db.characterStates.delete([st.characterId, st.userId]);
      }
    }
    await db.characters.where('createdBy').equals(userId).delete();
    // 注销账号一并删除该用户的日记（含回收站）
    await db.diaries.where('userId').equals(userId).delete();
    await db.users.delete(userId);

    set({
      selectedCharacterId: null,
      currentSessionId: null,
      characters: [],
      messages: [],
      charPreviews: {},
      unreadByCharacter: {},
      hasMoreMessages: false,
    });
    // 手账内存态一并清空
    useDiaryStore.getState().reset();
  },

  /** 把日记文本作为用户消息发给指定角色：先切到 TA 的会话，再标记待发送 */
  shareDiaryToCharacter: async (characterId, text) => {
    const userId = useAuthStore.getState().userId ?? '';
    await get().selectCharacter(characterId);
    const sessionId = get().currentSessionId;
    if (!sessionId) return;
    // 直接把日记作为用户消息落库（ChatWindow 会立即触发 AI 回复）
    const msg: Message = {
      id: crypto.randomUUID(),
      sessionId,
      role: 'user',
      content: text,
      createdAt: Date.now(),
      isProactive: false,
    };
    await messageRepo.create(msg);
    await sessionRepo.touch(sessionId);
    // 追加到当前消息列表
    set((s) => ({
      messages: [...s.messages, msg],
      charPreviews: {
        ...s.charPreviews,
        [characterId]: { content: text, createdAt: msg.createdAt },
      },
      // 标记待发送：ChatWindow 消费后触发 AI 回复
      pendingDiarySend: { sessionId, text },
    }));
  },

  consumeDiarySend: () => set({ pendingDiarySend: null }),

  reset: () => {
    set({
      selectedCharacterId: null,
      currentSessionId: null,
      characters: [],
      messages: [],
      charPreviews: {},
      unreadByCharacter: {},
      hasMoreMessages: false,
      pendingDiarySend: null,
    });
  },
}));
