import Dexie, { type Table } from 'dexie';
import { runWorldMigration } from '../lib/world/migrate-4x';
import type { ChatConversationState } from '../lib/chat-conversation-state';

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
  /** 5.0：如果这条未完成故事来自某场 World Stage / 某条世界事件，记录来源 */
  sourceSceneId?: string;
  sourceWorldEventId?: string;
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

// ===========================================================================
// 5.0.0 Living World 数据层（Dexie version 16）
// ---------------------------------------------------------------------------
// 原则：LLM 负责演，VirtuGene 负责记。
// 这里只解决"世界记住了什么"，不解决"世界怎么演"（演在 Phase 3）。
// 所有主表都带 worldId：5.0.0 每用户只有一个默认世界，但结构上为
// 多世界 / 平行世界线 / 世界模板 / 世界导入复制预留，避免将来整层重迁移。
// ===========================================================================

/** 主体可见性：private=只有用户；selected=只有 visibleTo 里的角色；world=世界内可见 */
export type WorldVisibility = 'private' | 'selected' | 'world';

/** 世界（Living World 的容器实体） */
export interface World {
  id: string;
  userId: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  /** 5.0.0 每用户恰好一个默认世界；用户暂不需要在 UI 管理多个世界 */
  isDefault: boolean;
  description?: string;
  theme?: string;
  /** 世界逻辑时钟。没有这个字段的旧世界会在 v19 升级时补齐。 */
  clock?: WorldClock;
  /** 现实锚点的位置 id（默认是「我的生活」）。 */
  realityLocationId?: string;
  /** 最近一次把离线时间折算为世界变化的时间。 */
  lastPulseAt?: number;
}

/** 世界时间与真实时间分离：应用关闭时不假装在后台运行，重新打开时再结算间隔。 */
export interface WorldClock {
  /** 逻辑世界时间的起点（毫秒时间戳）。 */
  worldAt: number;
  /** 上一次读取/结算时的真实时间。 */
  lastReconciledAt: number;
  /** 当前版本只支持与现实同步，后续可扩展为世界时间倍率。 */
  pace: 'realtime';
}

/** 世界中的稳定地点。场景是地点上的一次发生，地点本身不会随场景结束消失。 */
export interface WorldLocation {
  id: string;
  userId: string;
  worldId: string;
  name: string;
  type: 'reality' | 'place' | 'transit';
  description?: string;
  active: boolean;
  sourceType: 'system' | 'scene' | 'user';
  sourceId?: string;
  createdAt: number;
  updatedAt: number;
}

/** 角色在世界中的物理位置；同一世界同一角色始终只有一条当前位置。 */
export interface WorldPresence {
  id: string;
  userId: string;
  worldId: string;
  characterId: string;
  locationId: string;
  status: 'present' | 'traveling' | 'away';
  sinceWorldTime: number;
  note?: string;
  updatedAt: number;
}

/** 角色的世界级自主状态，与私聊中的情绪/记忆分开。 */
export interface WorldAgentState {
  id: string;
  userId: string;
  worldId: string;
  characterId: string;
  autonomy: 'quiet' | 'normal' | 'active';
  currentGoal?: string;
  nextIntent?: string;
  lastPulseAt?: number;
  lastActionAt?: number;
  updatedAt: number;
}

/** 一次把世界时间向前结算的记录。 */
export interface WorldPulse {
  id: string;
  userId: string;
  worldId: string;
  reason: 'resume' | 'manual' | 'scheduled';
  fromWorldTime: number;
  toWorldTime: number;
  status: 'pending' | 'completed' | 'failed';
  eventIds: string[];
  summary?: string;
  error?: string;
  createdAt: number;
  completedAt?: number;
}

/** A tangible detail in a Living World location. Objects are deliberately
 * small, user-scoped records: they make a place discoverable without turning
 * the world into a second inventory system. */
export interface WorldObject {
  id: string;
  userId: string;
  worldId: string;
  locationId: string;
  sceneId?: string;
  name: string;
  description: string;
  kind: 'prop' | 'note' | 'door' | 'device';
  state: 'present' | 'held' | 'moved' | 'gone';
  /** 物件被带走时的持有者；旧数据没有此字段时按当前用户持有兼容。 */
  heldBy?: string;
  lastAction?: string;
  sourceType: 'scene' | 'user' | 'settlement';
  sourceId?: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * 世界事件类型（语义必须严格区分，禁止为了少写 enum 而混用）：
 * - reality        现实生活（来自"我的生活"/日记的主动授权）
 * - interaction    普通但有意义的互动（私聊/群聊里发生的事）
 * - shared_memory  共同记忆（用户与角色真正共同经历的重要片段）
 * - stage          World Stage 世界剧场的一次场景
 * - relationship   关系发生变化
 * - continuity     未完成的故事（承诺/计划/话题/分歧/提醒）
 * - knowledge      认知边界变化（谁知道了什么）
 * - life_trace     生命痕迹（一次场景留下的总结；指向其它事件）
 */
export type WorldEventType =
  | 'reality'
  | 'interaction'
  | 'shared_memory'
  | 'stage'
  | 'relationship'
  | 'continuity'
  | 'knowledge'
  | 'life_trace';

/** 世界层"发生过什么"的统一记录：年表 / 最近发生 / Life Trace 都读它 */
export interface WorldEvent {
  id: string;
  userId: string;
  worldId: string;
  type: WorldEventType;
  title: string;
  summary: string;
  /** SubjectRef 列表（'u:<userId>' / 'c:<characterId>'）——实际参与者 */
  participants: string[];
  timestamp: number;
  /** 重要度 0~1（影响年表排序与记忆召回） */
  importance: number;
  /** 来源类型：'chat' | 'group' | 'stage' | 'diary' | 'manual' | 'migration:lifeEvent' … */
  sourceType: string;
  sourceId: string;
  /** 事件发生的稳定地点（可选，旧事件没有时仍可正常显示）。 */
  locationId?: string;
  /** 世界逻辑时间；timestamp 仍保留为本机写入时间。 */
  worldTime?: number;
  /** 造成这件事的世界事件，供因果链读取。 */
  causeEventIds?: string[];
  visibility: WorldVisibility;
  /** visibility='selected' 时允许知道的角色 id */
  visibleTo?: string[];
  resolved: boolean;
  relatedEventIds: string[];
  /** 关联的共同记忆 id（sharedMemories.id） */
  memoryIds: string[];
  tags: string[];
  emotion?: string;
  /** 溯源用原始信息（如迁移前的 lifeEventType / threadStatus） */
  meta?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

/** 场景内某个角色的状态与目标（隐藏张力的载体：各角色目标不同才有真正的多角色互动） */
export interface SceneParticipantState {
  characterId: string;
  /** 进入场景时携带的上下文范围。 */
  entryMemoryMode?: 'memory' | 'present';
  /** 进入时间；present 角色只读取此刻之后的舞台正文。旧数据没有时兼容为全量。 */
  enteredAt?: number;
  /** 该角色本场想要什么 */
  goals: string[];
  /** 入场时已知道的事情（WorldEvent.id 列表） */
  knowsEventIds: string[];
  /** 本场隐瞒的事（自由文本；UI 不直接展示给用户） */
  secrets: string[];
  mood?: string;
  state?: string;
}

/**
 * 场景状态：必须结构化，不能只写进 Prompt。
 * 注意：**场景正文不放在这里**，正文在 worldSceneEntries（长场景/分页/断点恢复）。
 */
export interface WorldSceneState {
  sceneGoal?: string;
  currentAct: number;
  /** 当前张力 0~1 */
  currentTension: number;
  activeSecrets: string[];
  activeConflicts: string[];
  /** 已经发生、但后果尚未落地的变化 */
  pendingConsequences: string[];
  resolvedEventIds: string[];
  newEventIds: string[];
  participants: SceneParticipantState[];
  /**
   * 5.0.0 Living World（v18）：这一片段把世界时钟相对真实时间推了多久（毫秒）。
   * 「直接到第二天早上」这类时间跳跃只改这一个数 + `WorldScene.timeLabel`，
   * 不伪造任何历史事件，也不产生额外 AI 调用。
   */
  timeOffsetMs?: number;
  /** 最近一次世界状态变化的人话说明（仅内部/调试，UI 默认不展示数字） */
  lastWorldChange?: string;
  /** 新加入角色默认携带的上下文范围；单个参与者可覆盖。 */
  entryMemoryMode?: 'memory' | 'present';
  /** 5.2 Living World：不把短期对话节奏塞进世界正文，单独保存可压缩的导演状态。 */
  conversation?: {
    currentTopic?: string;
    previousTopics: string[];
    exhaustedMotifs: string[];
    unansweredQuestions: string[];
    lastSpeakerId?: string;
    lastUserTurnAt?: number;
    userWantsToShift: boolean;
    turnsSinceTopicShift: number;
    lastProactiveTopicAt?: number;
  };
  /** 5.2 Living World：地点与时段驱动的视觉状态，离开再回来保持一致。 */
  visual?: {
    primary: string;
    secondary: string;
    glow: string;
    particle: 'none' | 'dust' | 'rain' | 'snow' | 'embers' | 'fireflies';
    density: number;
    light: 'dawn' | 'day' | 'dusk' | 'night';
    weather?: string;
    intensity: number;
    updatedAt: number;
  };
}

/** 一场 World Stage（互动章节） */
export interface WorldScene {
  id: string;
  userId: string;
  worldId: string;
  title: string;
  place: string;
  timeLabel: string;
  mood: string;
  theme?: string;
  /** 参与者角色 id（用户恒在场景中，不入此数组） */
  characterIds: string[];
  status: 'draft' | 'active' | 'paused' | 'finished';
  state: WorldSceneState;
  templateId?: string;
  startedAt: number;
  finishedAt?: number;
  /** 场景结束后生成的 WorldEvent.id（年表条目） */
  worldEventId?: string;
  /** 场景发生的稳定地点；旧场景通过 place 文本懒同步。 */
  locationId?: string;
  /** 由某次世界脉冲产生的场景（预留给自主行动）。 */
  pulseId?: string;
  startedWorldTime?: number;
  endedWorldTime?: number;
  createdAt: number;
  updatedAt: number;
}

/**
 * 场景正文条目（独立表，禁止塞进 worldScenes.state）：
 * 支撑长场景、分页、断点恢复、暂停继续、单条重生成、幕次与旁白/对白/选择区分。
 */
export interface WorldSceneEntry {
  id: string;
  sceneId: string;
  /** 写入当刻在场的角色快照；晚入场且选择“此刻状态”的角色不能读取旧正文。 */
  witnessedBy?: string[];
  /** 场景内顺序（从 0 递增；配合 [sceneId+index] 复合索引分页） */
  index: number;
  /**
   * 世界流的内容形态（5.0.0 Living World 增补 action / suggestion）：
   * - narration   世界旁白（全宽、无气泡）
   * - dialogue    角色对白
   * - action      角色动作（**不是**气泡：与同一角色的对白合成一个视觉组）
   * - user_input  用户行动（轻量行动文本，不套聊天气泡）
   * - choice      选择/灵感建议（UI 只把 options 渲染成输入框上方的建议 chips）
   * - suggestion  灵感建议（v18 新增；`meta.options` 为建议文本，用户可无视）
   * - system      系统标记（地点/时间变化、幕次等）
   */
  kind: 'narration' | 'dialogue' | 'action' | 'user_input' | 'choice' | 'suggestion' | 'system';
  /** 所属幕次 */
  act: number;
  /** 说话角色 id（narration/system 为空） */
  speakerId?: string;
  content: string;
  /** 选择项等附加信息 */
  meta?: { options?: string[]; chosen?: string; rawNote?: string; [key: string]: unknown };
  createdAt: number;
}

/**
 * 角色认知边界：**"发生过" ≠ "某个角色知道"**。
 * 秘密（CharacterSecret）暂时合并进本表：isSecret + secretOwnerId 即可表达
 * "知道但不能主动说""这是某个角色的秘密"；复杂的秘密生命周期以后再独立建模。
 */
export interface CharacterKnowledge {
  id: string;
  userId: string;
  worldId: string;
  characterId: string;
  /** 认知挂在哪条世界事件上（WorldEvent.id） */
  eventId: string;
  knowledgeLevel: 'none' | 'hint' | 'partial' | 'full';
  /** 能否主动提起（false=知道但不主动说） */
  canMention: boolean;
  /** 是否秘密 */
  isSecret: boolean;
  /** 秘密归属：不愿说出口的角色 id（非秘密为空） */
  secretOwnerId?: string;
  /** 从谁那里得知（角色 id；亲身经历则为空） */
  sourceCharacterId?: string;
  /** 来源为可撤权的日记时，记录授予认知时的日记版本，防止旧备份复活授权。 */
  sourceRevision?: number;
  learnedAt: number;
  updatedAt: number;
}

/**
 * 共同记忆：用户与角色**真正共同经历**的重要片段。
 * 与 memories（关于用户的长期事实）严格分工，互不替代、互不迁移。
 */
export interface SharedMemory {
  id: string;
  userId: string;
  worldId: string;
  title: string;
  summary: string;
  /** 实际参与者（SubjectRef）——谁经历了这件事 */
  participants: string[];
  /** 涉及的角色 id（便于按角色检索；由 participants 派生） */
  characterIds: string[];
  createdAt: number;
  sourceType: string;
  sourceId: string;
  importance: number;
  visibility: WorldVisibility;
  /**
   * visibility='selected' 时允许知道这段记忆的角色 id。
   * 注意：visibleTo 与 participants **不是一回事**——
   * 参与者是"谁经历了"，visibleTo 是"谁被允许知道"。
   */
  visibleTo?: string[];
  relatedCharacters: string[];
  /** 关联的关系 pairKey 列表（subjectPairKey 形式） */
  relatedRelationships: string[];
  emotion?: string;
  tags: string[];
  updatedAt: number;
}

/**
 * 关系分面（内部数值；UI 只显示语义等级，不显示数字）
 *
 * ⚠️ **R7 裁定（5.0.0 Phase 2b-6）**：这里**没有 `affinity`**。
 * "用户 ↔ 角色 的好感度"的唯一来源是 4.x 的 `CharacterState.affinity`
 * （由既有结算写入、无上限语义）。世界层**不再保存**这个数字——
 * 否则会出现两套数值，迟早互相打架（旧的 `relationshipStates.affinity`
 * 只是升级那一刻的快照，已经过时）。
 *
 * 因此世界层只负责 4.x 根本没有的四个分面，并且**只能通过 `applyEvent`（带 reason 的事件）变化**：
 * 数值变了，就一定有可读的原因（这正是"关系网络可解释化"的基础）。
 */
export type RelationshipFacet = 'trust' | 'dependency' | 'conflict' | 'familiarity';

export const RELATIONSHIP_FACETS: RelationshipFacet[] = ['trust', 'dependency', 'conflict', 'familiarity'];

/**
 * 当前关系状态（A ↔ B 现在是什么关系）。
 * 同时支持"用户 ↔ 角色"与"角色 ↔ 角色"——后者是 5.0 的核心要求之一。
 * 关系页读当前状态只读这张表，**禁止现场累加全部 relationshipEvents**。
 * 好感度不在这张表里（见 `RelationshipFacet` 的说明）。
 */
export interface RelationshipState {
  id: string;
  userId: string;
  worldId: string;
  pairKey: string;
  subjectA: string;
  subjectB: string;
  /** [subjectA, subjectB]（multiEntry 索引用：一次查出与某主体相关的全部关系） */
  subjects: string[];
  trust: number;
  dependency: number;
  conflict: number;
  familiarity: number;
  updatedAt: number;
}

/** 关系变化历史：解释"为什么会变成现在这样" */
export interface RelationshipEvent {
  id: string;
  userId: string;
  worldId: string;
  pairKey: string;
  subjectA: string;
  subjectB: string;
  /** [subjectA, subjectB]（multiEntry 索引用） */
  subjects: string[];
  /** 只记录发生变化的分面增量 */
  facets: Partial<Record<RelationshipFacet, number>>;
  /** 变化原因（自然语言，直接给用户看） */
  reason: string;
  /** 来源世界事件（WorldEvent.id） */
  sourceEventId?: string;
  sourceType: string;
  createdAt: number;
}

/* ---------------------------------------------------------------------------
 * 5.0.0 Living World（v18）：世界事实 + 世界轮次
 * ------------------------------------------------------------------------- */

/** 世界事实的分类（决定它如何进入上下文，以及在世界设定页怎么分组） */
export type WorldFactCategory =
  | 'rule'
  | 'location'
  | 'atmosphere'
  | 'history'
  | 'shared_knowledge'
  | 'character_fact'
  | 'custom';

/**
 * 世界事实（World Fact）：这个世界的**长期设定**。
 *
 * 与其它表的严格分工：
 * - `WorldEvent`   "发生过什么"（时间线上的一件事）
 * - `SharedMemory` "你们共同经历了什么"（有情绪重量的片段）
 * - `WorldFact`    "这个世界是什么样"（规则 / 地点 / 氛围 / 历史 / 共识 / 角色事实）
 *
 * 它是"世界设定"页的唯一数据源，也是 World Canvas 里「这里以后一直是秋天」这类
 * 自然语言指令的落点：LLM 只提出建议，程序校验后才写这里（§30）。
 */
export interface WorldFact {
  id: string;
  userId: string;
  worldId: string;
  category: WorldFactCategory;
  /** 自然语言正文（用户看到的就是这一句，不做结构化表单） */
  content: string;
  visibility: WorldVisibility;
  visibleTo?: string[];
  /** 来源：'user'（用户在设定页/世界空间里说的）|'settlement'（世界结算沉淀的）|'migration:4x' */
  sourceType: string;
  sourceId?: string;
  /** 重要度 0~1：注入上下文时按它排序（规则类默认更高） */
  priority: number;
  /** 该事实是否生效（用户可"暂停"一条设定而不删除） */
  active: boolean;
  /** 结构化补充（例如 character_fact 的 characterId；仅供程序使用） */
  data?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

/** 一轮世界交互的状态机（§52）——用户输入先落库，AI 失败也不会丢 */
export type WorldTurnStatus =
  | 'pending'
  | 'interpreting'
  | 'planning'
  | 'responding'
  | 'settling'
  | 'completed'
  | 'failed'
  | 'undone';

/** 世界状态快照（撤销一轮时用来精确还原"此刻"） */
export interface WorldTurnSnapshot {
  place: string;
  timeLabel: string;
  mood: string;
  timeOffsetMs: number;
  characterIds: string[];
}

/**
 * 世界轮次：一次用户输入 = 一行。
 *
 * 存在的三个理由（缺一不可）：
 * 1. **失败恢复**：用户原话先落库，任何 AI 阶段失败都只是 status='failed'，
 *    原话与已产生的正文（若调用方已经写入）都还在，重试复用同一行、同一条正文。
 * 2. **Undo / Retcon**：记下这一轮写了哪些正文、哪些世界事件/记忆/关系/设定，
 *    撤销时按 id 精确回收，而不是"猜哪几条是这一轮的"。
 * 3. **事务队列**：下一轮必须等这一轮结算写完才能读状态，避免读到半完成状态（§58）。
 */
export interface WorldTurn {
  id: string;
  userId: string;
  worldId: string;
  sceneId: string;
  /** 用户原话（永不丢失、永不重复插入） */
  input: string;
  /** 用户这轮的动作来源：'text'（自己打的）|'suggestion'（点了灵感建议）|'control'（控制面板快捷方式） */
  origin: 'text' | 'suggestion' | 'control' | 'auto';
  /** 这一轮解析出的结构化意图（UI 不展示；解析失败为 undefined） */
  action?: import('../lib/world/world-actions').WorldAction;
  status: WorldTurnStatus;
  /** 用户输入落成的那条世界流正文 id（撤销时一并回收） */
  userEntryId?: string;
  /** 本轮新增的世界流正文 id（顺序即产生顺序） */
  entryIds: string[];
  /** 本轮结算写入的各类产物 id（撤销时精确回收） */
  settledEventIds: string[];
  settledMemoryIds: string[];
  settledRelationshipEventIds: string[];
  settledThreadIds: string[];
  /** 本轮**新写下**的世界设定（撤销时删除） */
  settledFactIds: string[];
  /** 本轮因冲突而**停用**的旧设定（撤销时恢复启用，绝不删除） */
  deactivatedFactIds: string[];
  /** 本轮结算写的生命轨迹 id（撤销时精确回收"为什么变了"那条记录） */
  settledLifeEventIds: string[];
  /** 本轮对 4.x 角色状态施加的增量（撤销时**反向回退**，而不是删库重来） */
  stateDeltas: { characterId: string; affinityDelta: number; moodDelta: number }[];
  /** 本轮涉及的角色（用于撤销时还原在场者） */
  characterIds: string[];
  /** 本轮开始前的"此刻"快照（撤销/重生成用） */
  before?: WorldTurnSnapshot;
  /** 结算是否已经后台完成（用户不必等它） */
  settled: boolean;
  /** 主轮以「保存这一刻」强制结算（§39）：重试路径必须还原同样的结算条件 */
  forceSettle?: boolean;
  /** 本轮实际发生的 AI 调用次数（成本可核对） */
  llmCalls: number;
  /** 失败信息（哪一步失败 + 原始错误码） */
  failure?: { stage: WorldTurnStatus; message: string };
  /** 重试次数（重试绝不新增用户输入） */
  retries: number;
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
  /**
   * 5.0：这条轨迹**从哪来**（可追溯用，也用于决定是否进世界层）。
   * - chat：私聊结算产生
   * - group：群聊相关（如"进入共同场域"）——**属于功能操作，不进世界层**
   * - manual：用户手动操作（长按记住/教记忆/分享照片等）
   * 旧数据没有该字段，按 chat 处理。
   */
  source?: 'chat' | 'group' | 'manual';
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
  /** 私聊连续注意力：当前话题、用户交流偏好与最近回复动作（仅本用户本会话）。 */
  conversation?: ChatConversationState;
  /** 摘要覆盖到的时间点（早于该时间戳的消息均已纳入摘要） */
  summaryUpdatedAt?: number;
  /** 群摘要覆盖的完整成员快照；不匹配时禁止注入该摘要。 */
  summaryWitnessedBy?: string[];
  /** 摘要据以生成的群消息来源；删除其中任一原消息时摘要必须失效。 */
  summarySourceMessageIds?: string[];
  /** 摘要引用的消息版本；备份恢复时用来阻止旧消息版本连带复活旧摘要。 */
  summarySourceMessageRevisions?: Record<string, number>;
  /** 本会话选择的叙事时段；只影响模型营造的氛围，不改变消息 createdAt。 */
  sceneTimeOfDay?: 'morning' | 'afternoon' | 'dusk' | 'night' | 'late-night';
  /** 本会话的叙事场域；只影响模型营造的氛围，不改变消息时间。 */
  scenePlace?: string;
  sceneAtmosphere?: 'daily' | 'quiet' | 'light' | 'serious' | 'close' | 'low';
  /** follow-now 随现实变化，fixed 固定在用户选择的时段。 */
  sceneMode?: 'follow-now' | 'fixed';
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
  /** 群消息产生时的听众快照；旧消息无快照时不推断谁听过。 */
  witnessedBy?: string[];
  id: string;
  /** 内容版本；编辑会递增，旧备份不能覆盖新内容。 */
  revision?: number;
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
  /** 同一轮 AI 连发消息的批次标识；只用于保持气泡顺序和视觉节奏。 */
  replyBatchId?: string;
  /** 该消息在连发批次中的序号（从 0 开始）。 */
  replyBatchIndex?: number;
  /** 该连发批次的消息总数。 */
  replyBatchSize?: number;
  /**
   * 本机上下文溯源：生成这条消息时，真正被注入的本地数据 id。
   * 只记录实际注入的条目（不是整段 prompt），记忆被删除后这里不再指向任何内容。
   */
  contextTrace?: {
    memoryIds?: string[];
    continuityThreadIds?: string[];
    sharedEventIds?: string[];
    /** 5.0 共同记忆（sharedMemories.id）：角色确实知道、且这一轮真的注入了的那些 */
    sharedMemoryIds?: string[];
    /** 5.0 日记（diaries.id）：用户显式允许这个角色知道、且这一轮真的注入了的那几页 */
    diaryIds?: string[];
    /** 5.0 世界舞台（worldScenes.id）：这个角色亲身参与过、且这一轮真的注入了的那几场戏 */
    sceneIds?: string[];
    /** 5.0 世界脉冲（worldEvents.id）：角色在用户离开时亲身参与、且这一轮真的注入的行动 */
    pulseEventIds?: string[];
    /** 朋友圈（moments.id）：角色实际看过且本轮真的注入的动态 */
    momentIds?: string[];
    /** 待办（todo.id）与发生实例（todoOccurrences.id）：本轮真正注入的内容 */
    todoIds?: string[];
    todoOccurrenceIds?: string[];
    /** 群摘要的会话快照版本；详细来源仍由本地 Session 保存，避免每条回复复制长列表。 */
    groupSummary?: { sessionId: string; updatedAt: number };
    crossChannelReferences?: { source: 'chat' | 'group' | 'world' | 'moment' | 'todo'; id: string }[];
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
  /** 用户明确要求记住的内容；压缩与数量清理时永远优先保留。 */
  pinned?: boolean;
  createdAt: number;
  /** 这条记忆来自哪个会话（可空：早期数据或用户手动添加） */
  sourceSessionId?: string;
  /** 这条记忆来自哪些消息（真实消息 id；未知时为空，绝不靠文本相似度猜测） */
  sourceMessageIds?: string[];
  /** 用户在创建角色时主动导入的背景；新角色知道这是用户分享的资料，不会冒称亲历。 */
  importedFromCharacterId?: string;
  importedFromMemoryId?: string;
  /** 提取置信度 0~1（有消息依据时更高） */
  confidence?: number;
  /** 记忆的语义层：事实、偏好、共同经历、约定、角色生活或压缩摘要。 */
  memoryKind?: 'fact' | 'preference' | 'episode' | 'promise' | 'relationship' | 'character-life' | 'summary';
  /** 稳定性：短期状态会自然衰减，稳定事实和明确记忆不会。 */
  stability?: 'temporary' | 'stable';
  /** 记忆生命周期。被纠正的旧事实保留来源，但不会再被召回。 */
  status?: 'active' | 'superseded' | 'withdrawn';
  supersededBy?: string;
  /** 最近被角色提起的时间与次数，用于重复冷却。 */
  lastMentionedAt?: number;
  mentionCount?: number;
  /** 用户确认事实的时间；不等同于创建时间。 */
  lastConfirmedAt?: number;
  updatedAt?: number;
}

/**
 * 仅存来源 id、版本和撤回状态；不保留私密正文。
 * 用于让旧备份/迟到同步不能把已删除、撤权或纠正的内容重新写活。
 */
export interface MemorySourceTombstone {
  id: string;
  userId: string;
  sourceType: 'memory' | 'message' | 'diary' | 'moment' | 'momentReaction' | 'todo' | 'todoOccurrence' | 'worldEvent' | 'sharedMemory' | 'worldFact' | 'worldScene' | 'worldSceneEntry' | 'worldTurn' | 'continuityThread' | 'relationshipEvent';
  sourceId: string;
  /** 被撤销的最高来源版本；更高版本代表用户后来重新授权或编辑。 */
  sourceRevision: number;
  status: 'withdrawn' | 'deleted' | 'superseded';
  updatedAt: number;
}

/** 朋友圈式动态的可见范围。规则与角色互动完全由 moments-repo 统一裁定。 */
export type MomentVisibility = 'all' | 'private' | 'selected' | 'excluded';

export interface Moment {
  id: string;
  userId: string;
  /** 角色代用户发布的动态；为空时表示用户本人发布。 */
  authorCharacterId?: string;
  /** 角色主动发布内容的来源，旧动态不带此字段。 */
  originType?: 'user' | 'autonomous' | 'chat' | 'world';
  /** 角色生活事件及其持续线索，用于跨动态追踪同一件事。 */
  originEventIds?: string[];
  lifeThreadId?: string;
  text: string;
  visibility: MomentVisibility;
  /** selected / excluded 使用的角色 id 快照；发布后新增角色不会自动看到旧动态。 */
  audienceCharacterIds: string[];
  visibilityRevision: number;
  mediaIds: string[];
  deleted?: boolean;
  createdAt: number;
  updatedAt: number;
}

/** 角色自己的生活片段。个人事件只归作者本人所有，发布后才允许进入朋友圈可见层。 */
export interface CharacterLifeEvent {
  id: string;
  userId: string;
  characterId: string;
  threadId: string;
  continuesFromId?: string;
  kind: 'routine' | 'hobby' | 'project' | 'social' | 'discovery' | 'reflection';
  title: string;
  summary: string;
  visibility: 'private' | 'shareable';
  status: 'active' | 'completed';
  occurredAt: number;
  createdAt: number;
  updatedAt: number;
}

/** 主动发帖计划按日和角色发帖位记录；用租约和状态保证前台多处触发时不会重复生成。 */
export interface MomentPostPlan {
  id: string;
  userId: string;
  characterId: string;
  dayKey: string;
  status: 'running' | 'published' | 'quiet' | 'failed';
  attempts: number;
  availableAt: number;
  leaseUntil?: number;
  eventId?: string;
  momentId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface MomentMedia {
  id: string;
  userId: string;
  momentId: string;
  /** 第一版本地图片管线使用压缩后的 data URL；原图不进入动态列表。 */
  dataUrl: string;
  width: number;
  height: number;
  mime: string;
  order: number;
  createdAt: number;
}

export interface MomentView {
  id: string;
  userId: string;
  momentId: string;
  characterId: string;
  viewedAt: number;
}

export type MomentReactionType = 'like' | 'comment';

export interface MomentReaction {
  id: string;
  userId: string;
  momentId: string;
  characterId?: string;
  type: MomentReactionType;
  content?: string;
  replyToId?: string;
  status: 'active' | 'withdrawn' | 'deleted';
  createdAt: number;
  updatedAt: number;
}

export interface MomentContact {
  id: string;
  userId: string;
  characterId: string;
  /** 不让他（她）看我的朋友圈：对方看不到新动态，也不参与未完成的互动 */
  blocked?: boolean;
  /** 不看他（她）的朋友圈：只过滤我这边的动态流，不影响对方能否互动 */
  muted?: boolean;
  updatedAt: number;
}

export interface MomentJob {
  id: string;
  userId: string;
  momentId: string;
  characterId: string;
  type: 'view' | 'react' | 'reply';
  replyToId?: string;
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
  visibilityRevision: number;
  attempts: number;
  availableAt: number;
  leaseUntil?: number;
  lastError?: string;
  createdAt: number;
  updatedAt: number;
}

export interface MomentNotification {
  id: string;
  userId: string;
  momentId: string;
  characterId?: string;
  type: 'like' | 'comment' | 'summary';
  preview: string;
  read: boolean;
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
  // ---- 5.0 Living World ----
  /**
   * 可见性（默认 private）：
   * - private  只有用户自己知道（**5.0.0 起既有日记升级后一律是这个值**）
   * - selected 只有 visibleTo 里的角色知道
   * - world    进入共同世界（世界内角色可以知道）
   */
  visibility?: WorldVisibility;
  /** visibility='selected' 时允许知道的角色 id */
  visibleTo?: string[];
  /** 本条日记授权进入世界层后对应的 WorldEvent.id（未授权为空） */
  worldEventId?: string;
  /** 可分享内容的修订号；更新正文/标题/日期后递增，派生引用必须同步。 */
  revision?: number;
  createdAt: number;
  updatedAt: number;
}

export type TodoStatus = 'todo' | 'completed' | 'cancelled' | 'deleted';
export type TodoPriority = 'normal' | 'important' | 'urgent';
export type TodoVisibility = 'private' | 'selected';
export type TodoRecurrence =
  | { kind: 'none' }
  | { kind: 'daily'; interval?: number }
  | { kind: 'weekdays' }
  | { kind: 'weekly'; weekdays: number[]; interval?: number }
  | { kind: 'monthly'; day: number; interval?: number }
  | { kind: 'interval'; days: number };

/** 现实待办：日期是本地生活日期，与世界的逻辑时间完全分离。 */
export interface Todo {
  id: string;
  userId: string;
  title: string;
  note?: string;
  subtasks?: { id: string; title: string; completed: boolean }[];
  listName?: string;
  tags?: string[];
  priority: TodoPriority;
  status: TodoStatus;
  dueDate?: string;
  dueTime?: string;
  timezone?: string;
  recurrence: TodoRecurrence;
  reminderMinutes?: number[];
  visibility: TodoVisibility;
  visibleTo?: string[];
  worldId?: string;
  source?: 'manual' | 'world' | 'chat';
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  deletedAt?: number;
}

export interface TodoOccurrence {
  id: string;
  userId: string;
  todoId: string;
  dueDate: string;
  dueTime?: string;
  status: 'todo' | 'completed' | 'skipped' | 'cancelled';
  originalDueDate: string;
  completedAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface TodoReminder {
  id: string;
  userId: string;
  todoId: string;
  occurrenceId: string;
  notificationId: number;
  remindAt: number;
  status: 'scheduled' | 'fired' | 'cancelled' | 'failed';
  error?: string;
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
  // 5.0 Living World（Dexie v16）
  worlds!: Table<World, string>;
  worldEvents!: Table<WorldEvent, string>;
  worldScenes!: Table<WorldScene, string>;
  worldSceneEntries!: Table<WorldSceneEntry, string>;
  characterKnowledge!: Table<CharacterKnowledge, string>;
  sharedMemories!: Table<SharedMemory, string>;
  relationshipStates!: Table<RelationshipState, string>;
  relationshipEvents!: Table<RelationshipEvent, string>;
  // 5.0.0 Living World（Dexie v18）：世界事实 + 世界轮次
  worldFacts!: Table<WorldFact, string>;
  worldTurns!: Table<WorldTurn, string>;
  // 5.1.0 Living World 2.0：地点、位置、角色自主状态与世界脉冲
  worldLocations!: Table<WorldLocation, string>;
  worldPresences!: Table<WorldPresence, string>;
  worldAgentStates!: Table<WorldAgentState, string>;
  worldPulses!: Table<WorldPulse, string>;
  worldObjects!: Table<WorldObject, string>;
  todos!: Table<Todo, string>;
  todoOccurrences!: Table<TodoOccurrence, string>;
  todoReminders!: Table<TodoReminder, string>;
  moments!: Table<Moment, string>;
  momentMedia!: Table<MomentMedia, string>;
  momentViews!: Table<MomentView, string>;
  momentReactions!: Table<MomentReaction, string>;
  momentContacts!: Table<MomentContact, string>;
  momentJobs!: Table<MomentJob, string>;
  momentNotifications!: Table<MomentNotification, string>;
  characterLifeEvents!: Table<CharacterLifeEvent, string>;
  momentPostPlans!: Table<MomentPostPlan, string>;
  memorySourceTombstones!: Table<MemorySourceTombstone, string>;

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
    // v17: 5.0.0 Living World 数据基础（Phase 1）。
    // 只新增 8 张表 + 由 migrate-4x 做幂等派生回填；既有 11 张表一律不改写、不删除。
    // 幂等键统一为 userId + worldId + sourceType + sourceId（并据此生成确定性 id）。
    this.version(17).stores({
      worlds: 'id,userId,isDefault',
      worldEvents: 'id,userId,worldId,type,[worldId+timestamp],[worldId+type],[worldId+sourceType+sourceId],sourceType,sourceId,timestamp',
      worldScenes: 'id,userId,worldId,status,[worldId+status],updatedAt',
      worldSceneEntries: 'id,sceneId,[sceneId+index],index',
      characterKnowledge: 'id,userId,worldId,characterId,eventId,[characterId+eventId],[worldId+characterId]',
      sharedMemories: 'id,userId,worldId,[worldId+createdAt],sourceType,sourceId,[worldId+sourceType+sourceId],*characterIds',
      relationshipStates: 'id,userId,worldId,pairKey,[worldId+pairKey],*subjects',
      relationshipEvents: 'id,userId,worldId,pairKey,[worldId+pairKey],*subjects,sourceEventId,createdAt',
    }).upgrade(async (tx) => {
      await runWorldMigration(tx);
    });
    /**
     * v18: 5.0.0 Living World 最终形态。
     * 只新增两张表（worldFacts 世界设定 / worldTurns 世界轮次状态机），
     * 既有 19 张表一律不改写、不删除、不清空——4.x 数据必须原样存活。
     * `worldSceneEntries.kind` 增加 'action' | 'suggestion' 属于**类型层面**的扩展，
     * 老行只可能是旧 kind，读回来仍然合法，因此不需要 upgrade 回填。
     */
    this.version(18).stores({
      worldFacts: 'id,userId,worldId,category,active,[worldId+category],[worldId+sourceType+sourceId],updatedAt',
      worldTurns: 'id,userId,worldId,sceneId,status,[worldId+createdAt],createdAt',
    });
    /**
     * v19：Living World 2.0 的世界内核基础。
     * 新表只保存真实状态，不会重写旧聊天、群聊、日记或世界事件；
     * 旧世界在升级时获得一个现实锚点与逻辑时钟，其他地点按需从场景同步。
     */
    this.version(19).stores({
      worlds: 'id,userId,isDefault',
      worldEvents: 'id,userId,worldId,type,[worldId+timestamp],[worldId+type],[worldId+sourceType+sourceId],sourceType,sourceId,timestamp,locationId,[worldId+worldTime]',
      worldScenes: 'id,userId,worldId,status,[worldId+status],updatedAt,locationId,pulseId',
      worldLocations: 'id,userId,worldId,type,active,[worldId+name],[worldId+type],updatedAt',
      worldPresences: 'id,userId,worldId,characterId,locationId,[worldId+characterId],[worldId+locationId],updatedAt',
      worldAgentStates: 'id,userId,worldId,characterId,[worldId+characterId],updatedAt',
      worldPulses: 'id,userId,worldId,status,[worldId+createdAt],createdAt',
    }).upgrade(async (tx) => {
      const worlds = tx.table('worlds');
      const locations = tx.table('worldLocations');
      const now = Date.now();
      const rows = await worlds.toArray();
      for (const world of rows) {
        const realityId = `reality:${world.id}`;
        const existing = await locations.get(realityId);
        if (!existing) {
          await locations.put({
            id: realityId,
            userId: world.userId,
            worldId: world.id,
            name: '我的生活',
            type: 'reality',
            description: '现实生活的锚点，所有共同世界从这里获得方向。',
            active: true,
            sourceType: 'system',
            sourceId: world.id,
            createdAt: world.createdAt ?? now,
            updatedAt: now,
          });
        }
        await worlds.put({
          ...world,
          clock: world.clock ?? { worldAt: world.createdAt ?? now, lastReconciledAt: now, pace: 'realtime' },
          realityLocationId: world.realityLocationId ?? realityId,
          lastPulseAt: world.lastPulseAt ?? now,
          updatedAt: world.updatedAt ?? now,
        });
      }
    });
    // v20: Living World locations can expose a few tactile, inspectable
    // objects. Keeping them separate from scene text lets the scene remain a
    // readable stream while objects survive leaving and returning.
    this.version(20).stores({
      worldObjects: 'id,userId,worldId,locationId,sceneId,state,[worldId+locationId],updatedAt',
    });
    // v21：现实待办与可重复日期实例。任务数据按用户隔离，世界时间不参与计算。
    this.version(21).stores({
      todos: 'id,userId,status,dueDate,[userId+dueDate],[userId+status],updatedAt',
      todoOccurrences: 'id,userId,todoId,dueDate,[userId+dueDate],[todoId+dueDate],status,updatedAt',
      todoReminders: 'id,userId,todoId,occurrenceId,remindAt,status,[userId+remindAt],notificationId,updatedAt',
    });
    // v22：朋友圈式生活动态。全部记录带 userId，角色互动与世界/聊天数据隔离。
    this.version(22).stores({
      moments: 'id,userId,createdAt,[userId+createdAt],visibility,updatedAt',
      momentMedia: 'id,userId,momentId,[momentId+order],createdAt',
      momentViews: 'id,userId,momentId,characterId,[momentId+characterId],[userId+characterId]',
      momentReactions: 'id,userId,momentId,characterId,type,[momentId+createdAt],[momentId+characterId],status',
      momentContacts: 'id,userId,characterId,[userId+characterId],blocked,updatedAt',
      momentJobs: 'id,userId,momentId,characterId,[momentId+characterId],status,[userId+availableAt],availableAt,updatedAt',
      momentNotifications: 'id,userId,momentId,createdAt,[userId+createdAt],read',
    });
    // v23：角色拥有独立生活事件与主动发帖计划；旧朋友圈记录保持原样。
    this.version(23).stores({
      characterLifeEvents: 'id,userId,characterId,threadId,[userId+characterId],[userId+characterId+createdAt],status,updatedAt',
      momentPostPlans: 'id,userId,characterId,dayKey,[userId+characterId],status,[userId+availableAt],availableAt,updatedAt',
    });
    // v24：仅含来源 id / 版本 / 状态的撤回墓碑，阻止旧备份复活隐私资料。
    this.version(24).stores({
      memorySourceTombstones: 'id,userId,sourceType,sourceId,[userId+sourceType+sourceId],updatedAt',
    });
  }
}

export const db = new VirtuGeneDB();
