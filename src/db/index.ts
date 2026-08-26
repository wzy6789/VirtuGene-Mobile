import Dexie, { type Table } from 'dexie';

export interface User {
  id: string;
  username: string;
  avatar?: string;
  passwordHash: string;
  passwordSalt: string;
  apiKeyIv: string;
  apiKeyCiphertext: string;
  createdAt: number;
}

export interface Character {
  id: string;
  name: string;
  avatar: string;
  systemPrompt: string;
  tags: string[];
  isPreset: boolean;
  isCustom: boolean;
  published: boolean;
  createdBy: string;
  createdAt: number;
  /** 主动倾向 0-1，决定该角色是否会主动发消息及频率 */
  proactivity: number;
  /** 一句话签名 */
  signature: string;
  /** 示例开场白（TA 主动开口说的第一句话） */
  greeting: string;
  /** 克隆自哪个预设的 id（用于「添加到我」去重） */
  sourcePresetId?: string;
  /** 是否置顶（侧边栏会话列表，仅用户自有角色使用） */
  pinned?: boolean;
  /** 是否从聊天会话列表隐藏（仅隐藏列表项，角色与消息数据保留） */
  chatListHidden?: boolean;
}

export interface RelationMilestone {
  level: string;
  reachedAt: number;
}

export interface CharacterState {
  characterId: string;
  userId: string;
  affinity: number;
  mood: number;
  milestones: RelationMilestone[];
  updatedAt: number;
}

export interface Session {
  id: string;
  characterId: string;
  userId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  unreadCount: number;
  /** 长会话滚动摘要（早期对话的压缩文本，超出保留窗口后生成） */
  summary?: string;
  /** 摘要覆盖到的时间点（早于该时间戳的消息均已纳入摘要） */
  summaryUpdatedAt?: number;
}

export interface Message {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: number;
  isProactive: boolean;
  /** 图片消息（压缩后的 dataURL）；有值且 content 为空时气泡只显示图片 */
  image?: string;
  /** 引用回复的目标消息 id */
  replyToId?: string;
  /** 引用回复的目标消息内容（用于气泡内展示） */
  replyToContent?: string;
  /** 发送失败标记（微信式：失败消息显示红色感叹号，点击重发） */
  failed?: boolean;
}

export interface MemoryItem {
  id: string;
  characterId: string;
  userId: string;
  content: string;
  type: 'auto' | 'summary';
  createdAt: number;
}

export interface EmotionDimensions {
  valence: number;
  arousal: number;
  intimacy: number;
  engagement: number;
  expressiveness: number;
  stability: number;
}

export interface EmotionSnapshot {
  id: string;
  characterId: string;
  sessionId: string;
  dimensions: EmotionDimensions;
  dominantEmotion: string;
  /** 结算时感知到的用户情绪（如"开心""低落"），用于注入下次回复 */
  userEmotion?: string;
  summary: string;
  messageCount: number;
  createdAt: number;
}

export interface Diary {
  id: string;
  userId: string;
  /** 归属日期 YYYY-MM-DD（本地时区） */
  date: string;
  title: string;
  content: string;
  /** 心情 1-5：1=很差 2=低落 3=一般 4=开心 5=很棒 */
  mood: number;
  tags: string[];
  /** 关联角色（可选，仅引用展示） */
  characterId?: string;
  /** 天气（正式日记格式用，如 ☀️ ⛅ ☁️ 🌧️ ❄️） */
  weather?: string;
  /** 插图（dataURL 列表，按插入顺序） */
  images?: string[];
  /** AI 回信/批注（翻旧日记时异步生成，每条日记最多一条） */
  aiNote?: string;
  /** 批注生成时间戳 */
  aiNoteAt?: number;
  /** 软删除时间戳：非空表示在回收站（7 天后自动清除） */
  deletedAt?: number;
  createdAt: number;
  updatedAt: number;
}

export class VirtuGeneDB extends Dexie {
  users!: Table<User, string>;
  characters!: Table<Character, string>;
  sessions!: Table<Session, string>;
  messages!: Table<Message, string>;
  memories!: Table<MemoryItem, string>;
  emotionSnapshots!: Table<EmotionSnapshot, string>;
  characterStates!: Table<CharacterState, [string, string]>;
  diaries!: Table<Diary, string>;

  constructor() {
    super('virtugene');
    this.version(1).stores({
      users: 'id,username',
      characters: 'id,isPreset',
    });
    this.version(2).stores({
      users: 'id,username',
      characters: 'id,isPreset',
      sessions: 'id,characterId,updatedAt',
      messages: 'id,sessionId,createdAt',
    });
    this.version(3).stores({
      users: 'id,username',
      characters: 'id,isPreset,published,createdBy',
      sessions: 'id,characterId,updatedAt',
      messages: 'id,sessionId,createdAt',
    }).upgrade(async (tx) => {
      await tx.table('characters').toCollection().modify((char) => {
        char.published = char.published ?? false;
        char.createdBy = char.createdBy ?? '';
      });
    });
    this.version(4).stores({
      users: 'id,username',
      characters: 'id,isPreset,published,createdBy',
      sessions: 'id,characterId,updatedAt',
      messages: 'id,sessionId,createdAt',
    }).upgrade(async (tx) => {
      await tx.table('sessions').toCollection().modify((s) => {
        s.unreadCount = s.unreadCount ?? 0;
      });
      await tx.table('messages').toCollection().modify((m) => {
        m.isProactive = m.isProactive ?? false;
      });
    });
    this.version(5).stores({
      users: 'id,username',
      characters: 'id,isPreset,published,createdBy',
      sessions: 'id,characterId,updatedAt',
      messages: 'id,sessionId,createdAt',
      memories: 'id,characterId,createdAt',
    });
    this.version(6).stores({
      users: 'id,username',
      characters: 'id,isPreset,published,createdBy',
      sessions: 'id,characterId,updatedAt',
      messages: 'id,sessionId,createdAt',
      memories: 'id,characterId,createdAt',
      emotionSnapshots: 'id,sessionId,characterId,createdAt',
    });
    this.version(7).stores({
      users: 'id,username',
      characters: 'id,isPreset,published,createdBy',
      sessions: 'id,characterId,updatedAt',
      messages: 'id,sessionId,createdAt',
      memories: 'id,characterId,createdAt',
      emotionSnapshots: 'id,sessionId,characterId,createdAt',
      characterStates: 'characterId',
    }).upgrade(async (tx) => {
      await tx.table('characters').toCollection().modify((char) => {
        char.proactivity = char.proactivity ?? 0.5;
      });
    });
    this.version(8).stores({
      users: 'id,username',
      characters: 'id,isPreset,published,createdBy',
      sessions: 'id,characterId,userId,updatedAt',
      messages: 'id,sessionId,createdAt',
      memories: 'id,characterId,userId,createdAt',
      emotionSnapshots: 'id,sessionId,characterId,createdAt',
      characterStates: 'characterId',
    }).upgrade(async (tx) => {
      // Pre-multi-user data has no userId and cannot be attributed to any account.
      // Clear conversation-scoped data once; users and characters are preserved.
      await tx.table('sessions').clear();
      await tx.table('messages').clear();
      await tx.table('memories').clear();
      await tx.table('emotionSnapshots').clear();
      await tx.table('characterStates').clear();
    });
    this.version(9).stores({
      users: 'id,username',
      characters: 'id,isPreset,published,createdBy',
      sessions: 'id,characterId,userId,updatedAt',
      messages: 'id,sessionId,createdAt',
      memories: 'id,characterId,userId,createdAt',
      emotionSnapshots: 'id,sessionId,characterId,createdAt',
      characterStates: '[characterId+userId]',
    });
    this.version(10).stores({
      users: 'id,username',
      characters: 'id,isPreset,published,createdBy',
      sessions: 'id,characterId,userId,updatedAt',
      messages: 'id,sessionId,createdAt',
      memories: 'id,characterId,userId,createdAt',
      emotionSnapshots: 'id,sessionId,characterId,createdAt',
      characterStates: '[characterId+userId]',
    }).upgrade(async (tx) => {
      await tx.table('characters').toCollection().modify((char) => {
        char.signature = char.signature ?? '';
        char.greeting = char.greeting ?? '';
      });
    });
    this.version(11).stores({
      users: 'id,username',
      characters: 'id,isPreset,published,createdBy',
      sessions: 'id,characterId,userId,updatedAt',
      messages: 'id,sessionId,createdAt',
      memories: 'id,characterId,userId,createdAt',
      emotionSnapshots: 'id,sessionId,characterId,createdAt',
      characterStates: '[characterId+userId]',
    }).upgrade(async (tx) => {
      // 关系系统：好感度改为 0 起步，并初始化里程碑数组
      await tx.table('characterStates').toCollection().modify((st) => {
        st.milestones = st.milestones ?? [];
        st.affinity = 0;
      });
    });
    // v12: 复合索引 — 消息按 [sessionId+createdAt] 高效取最近 N 条 / 末条；
    //      会话按 [characterId+userId] 免去 JS 过滤。纯索引变更，无数据升级。
    this.version(12).stores({
      users: 'id,username',
      characters: 'id,isPreset,published,createdBy',
      sessions: 'id,characterId,userId,[characterId+userId],updatedAt',
      messages: 'id,sessionId,[sessionId+createdAt]',
      memories: 'id,characterId,userId,createdAt',
      emotionSnapshots: 'id,sessionId,characterId,createdAt',
      characterStates: '[characterId+userId]',
    });
    // v13: 日记（用户日记，本地存储）
    this.version(13).stores({
      users: 'id,username',
      characters: 'id,isPreset,published,createdBy',
      sessions: 'id,characterId,userId,[characterId+userId],updatedAt',
      messages: 'id,sessionId,[sessionId+createdAt]',
      memories: 'id,characterId,userId,createdAt',
      emotionSnapshots: 'id,sessionId,characterId,createdAt',
      characterStates: '[characterId+userId]',
      diaries: 'id,userId,date,[userId+date]',
    });
  }
}

export const db = new VirtuGeneDB();
