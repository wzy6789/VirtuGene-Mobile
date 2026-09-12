import Dexie, { type Table } from 'dexie';

export interface User {
  id: string;
  username: string;
  avatar?: string;
  passwordHash: string;
  passwordSalt: string;
  /** 旧版 BYOK 用户的本地加密凭据；网关账号可以为空。 */
  apiKeyIv?: string;
  apiKeyCiphertext?: string;
  /** 成年用户确认时间；当前服务不向未成年人开放。 */
  adultConfirmedAt?: number;
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
  /** 声线（AI 判定，Edge-TTS 音色 + 语速/音调；与桌面版同构，备份互通） */
  voice?: { voice: string; band?: 'male-deep' | 'male-mature' | 'male-young' | 'female-soft' | 'female-bright' | 'female-clear'; sid?: number; rate: string; pitch: string };
  /** 角色指定对话模型（不设则用全局默认；如 { provider: 'qwen', model: 'qwen3.7-plus' }） */
  model?: { provider: string; model: string };
  /** 口头禅（用户可设置；角色偶尔自然地使用，注入语气） */
  catchphrase?: string;
  /** 互动边界（用户明确设定的禁区与退出方式） */
  boundaries?: string;
}

/** 用户设定的角色间故事关系。保存于各自的生命状态中，因而只属于当前用户的世界。 */
export interface StoryRelation {
  targetCharacterId: string;
  label: string;
  description?: string;
  createdAt: number;
}

export interface RelationMilestone {
  level: string;
  reachedAt: number;
}

/**
 * 未完成事件（生命连续性）：用户与角色之间「说好了、但还没发生完」的事。
 * 只记录对话里明确出现的约定 / 计划 / 悬而未决的话题 / 冲突 / 提醒，寒暄闲聊绝不入库。
 */
export interface ContinuityThread {
  id: string;
  characterId: string;
  userId: string;
  /** promise=承诺约定 plan=共同计划 topic=悬而未决的话题 conflict=未化解的分歧 reminder=提醒事项 */
  kind: 'promise' | 'plan' | 'topic' | 'conflict' | 'reminder';
  title: string;
  detail?: string;
  /**
   * open=还挂着；
   * done=已完成；
   * dropped=用户自己说了「稍后再说」（不再主动提起，AI 也不会去动它）；
   * archived=因为超过同时挂 8 件的上限被系统自动收起（仍然算真实发生过的事，
   *          对话里明确做完时允许被标记完成，也可以由用户重新挂起）。
   */
  status: 'open' | 'done' | 'dropped' | 'archived';
  /** 约定的时间点（可空） */
  dueAt?: number;
  /** 这条线索来自哪些消息（真实存在的消息 id；未知时为空数组，绝不编造） */
  sourceMessageIds?: string[];
  /** 由谁创建：ai=自动分析产生 user=用户手动添加 */
  origin?: 'ai' | 'user';
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

/** 人物之间的共同事件（角色↔角色）：与群聊无关，两个角色之间的独立故事线。 */
export interface SharedStoryEvent {
  id: string;
  userId: string;
  /** 两个角色 id，始终按字典序存放，保证同一对人只有一种键 */
  characterIds: [string, string];
  type: '相识' | '约定' | '分歧' | '离别' | '重逢' | '转折';
  title: string;
  detail?: string;
  /** 各方视角（key=角色 id）：同一件事在两人眼里不一样，保留差异 */
  viewpoints?: Record<string, string>;
  /** 由谁创建：user=用户手动添加 ai=由角色关系/群聊沉淀 */
  origin?: 'ai' | 'user';
  createdAt: number;
  updatedAt: number;
}

/** 角色生命轨迹中的一个可回看的变化节点。 */
export interface LifeEvent {
  id: string;
  type: 'interaction' | 'memory' | 'relationship' | 'goal';
  title: string;
  detail?: string;
  createdAt: number;
}

export interface CharacterState {
  characterId: string;
  userId: string;
  /** 好感度（无上限，只保底不为负） */
  affinity: number;
  mood: number;
  milestones: RelationMilestone[];
  /** 角色此刻最在意的事情，由共同经历逐步形成。 */
  lifeFocus?: string;
  /** 用户与角色共同经历后留下的成长轨迹。 */
  lifeEvents?: LifeEvent[];
  /** 创建角色时建立的故事关系，与后续聊天和群聊无关。 */
  storyRelations?: StoryRelation[];
  /** 自定义等阶名（key=默认等阶名 → 用户自定义名；等阶名可随便改） */
  tierNames?: Record<string, string>;
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
  /** 会话类型：单聊（默认）/ 群聊 */
  type?: 'single' | 'group';
  /** 群聊时关联的群 id（type=group 时必有） */
  groupId?: string;
  /** 会话锁定的对话模型（首次进入聊天时选择，聊天中不可改；空则回退角色/全局默认） */
  model?: { provider: string; model: string };
  /** 该会话累计的 API 消耗（token 用量 + 预估费用，仅本会话统计） */
  cost?: { calls: number; inputTokens: number; outputTokens: number; cost: number };
  /** 临时视觉窗口剩余轮数：发图且所选模型不支持视觉时用 DeepSeek 视觉模型兜底，几轮后自动换回原模型 */
  tempVisionRounds?: number;
  /** 是否已弹过模型选择（选了具体模型或"使用默认"都不再弹） */
  modelAsked?: boolean;
  /** 长会话滚动摘要（早期对话的压缩文本，超出保留窗口后生成） */
  summary?: string;
  /** 摘要覆盖到的时间点（早于该时间戳的消息均已纳入摘要） */
  summaryUpdatedAt?: number;
}

/** 角色群（微信式群聊）：用户 + 多个角色 */
export interface Group {
  id: string;
  userId: string;
  name: string;
  /** 群成员角色 id 列表（2~5 个） */
  characterIds: string[];
  createdAt: number;
  updatedAt: number;
  /** 群内昵称备注（仅群聊窗口显示用，不改角色本名；key=角色 id） */
  memberNicknames?: Record<string, string>;
  /** 热闹模式：一轮生成最多 5 条、成员多接几句（默认关，省 token） */
  lively?: boolean;
}

export interface Message {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: number;
  isProactive: boolean;
  /** 群聊中该条消息的发言人角色 id（单聊为空；role=assistant 时用于区分是谁说的） */
  senderId?: string;
  /** 图片消息（压缩后的 dataURL）；有值且 content 为空时气泡只显示图片 */
  image?: string;
  /** 语音消息（微信式）：录音音频 dataURL（webm/opus）+ 时长秒 + 转文字（AI 通过 text 理解内容） */
  audio?: { dataUrl: string; duration: number; text: string };
  /** 引用回复的目标消息 id */
  replyToId?: string;
  /** 引用回复的目标消息内容（用于气泡内展示） */
  replyToContent?: string;
  /** 发送失败标记（微信式：失败消息显示红色感叹号，点击重发） */
  failed?: boolean;
  /**
   * 本机上下文溯源：生成这条消息时，真正被注入的本地数据 id。
   * 只记录实际注入的条目（不是整段 prompt），记忆被删除后这里不再指向任何内容。
   */
  contextTrace?: {
    memoryIds?: string[];
    continuityThreadIds?: string[];
    sharedEventIds?: string[];
    /** 记录时间 */
    at: number;
  };
}

export interface MemoryItem {
  id: string;
  characterId: string;
  userId: string;
  content: string;
  type: 'auto' | 'summary';
  createdAt: number;
  /** 这条记忆来自哪个会话（可空：早期数据或用户手动添加） */
  sourceSessionId?: string;
  /** 这条记忆来自哪些消息（真实消息 id；未知时为空，绝不靠文本相似度猜测） */
  sourceMessageIds?: string[];
  /** 提取置信度 0~1（有消息依据时更高） */
  confidence?: number;
  updatedAt?: number;
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
  groups!: Table<Group, string>;
  continuityThreads!: Table<ContinuityThread, string>;
  sharedStoryEvents!: Table<SharedStoryEvent, string>;

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
    // v14: 角色群聊（groups 表；Session 增加 type/groupId，Message 增加 senderId）
    this.version(14).stores({
      users: 'id,username',
      characters: 'id,isPreset,published,createdBy',
      sessions: 'id,characterId,userId,[characterId+userId],updatedAt,groupId',
      messages: 'id,sessionId,[sessionId+createdAt]',
      memories: 'id,characterId,userId,createdAt',
      emotionSnapshots: 'id,sessionId,characterId,createdAt',
      characterStates: '[characterId+userId]',
      diaries: 'id,userId,date,[userId+date]',
      groups: 'id,userId',
    }).upgrade(async (tx) => {
      await tx.table('sessions').toCollection().modify((s) => {
        s.type = s.type ?? 'single';
      });
    });
    // v15: 生命连续性 —— 未完成事件（continuityThreads）+ 人物共同事件（sharedStoryEvents）。
    //      纯新增表，不动任何既有数据；MemoryItem 的溯源字段与 Message.contextTrace 均为可选字段。
    this.version(15).stores({
      users: 'id,username',
      characters: 'id,isPreset,published,createdBy',
      sessions: 'id,characterId,userId,[characterId+userId],updatedAt,groupId',
      messages: 'id,sessionId,[sessionId+createdAt]',
      memories: 'id,characterId,userId,createdAt',
      emotionSnapshots: 'id,sessionId,characterId,createdAt',
      characterStates: '[characterId+userId]',
      diaries: 'id,userId,date,[userId+date]',
      groups: 'id,userId',
      continuityThreads: 'id,characterId,userId,[characterId+userId],[characterId+status],status,createdAt',
      sharedStoryEvents: 'id,userId,*characterIds,createdAt',
    });
    // User-scoped world reads need an index; the compound key cannot index its second field alone.
    this.version(16).stores({ characterStates: '[characterId+userId],userId' });
  }
}

export const db = new VirtuGeneDB();
