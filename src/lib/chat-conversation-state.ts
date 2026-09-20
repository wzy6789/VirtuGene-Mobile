/**
 * 私聊的轻量节奏状态。
 *
 * 这不是另一套记忆库，也不保存原始对话；它只回答“这轮该怎么聊”——
 * 当前话题、用户是否想换题、用户偏好的回复方式，以及最近已经用过的回复动作。
 * 状态写在当前 Session 上，因此天然按用户和角色隔离。
 */

export type ChatIntent = 'casual' | 'emotional' | 'question' | 'request' | 'topic-shift' | 'closing';
export type ChatTopicStatus = 'active' | 'paused' | 'closed';
export type ChatReplyAction = 'react' | 'answer' | 'comfort' | 'share' | 'ask' | 'joke' | 'advise' | 'close';

export interface ChatPreferences {
  brevity: 'short' | 'balanced' | 'detailed';
  questionTolerance: 'low' | 'normal';
  adviceStyle: 'listen' | 'mixed' | 'direct';
  confidence: number;
}

export interface ChatConversationState {
  currentTopic?: string;
  topicStatus: ChatTopicStatus;
  pausedTopics: string[];
  lastIntent?: ChatIntent;
  lastAction?: ChatReplyAction;
  recentActions: ChatReplyAction[];
  turnsSinceTopicShift: number;
  lastUserTurnAt?: number;
  userWantsToShift: boolean;
  preferences: ChatPreferences;
}

export const DEFAULT_CHAT_PREFERENCES: ChatPreferences = {
  brevity: 'balanced',
  questionTolerance: 'normal',
  adviceStyle: 'mixed',
  confidence: 0,
};

export function emptyChatConversationState(): ChatConversationState {
  return {
    topicStatus: 'closed',
    pausedTopics: [],
    recentActions: [],
    turnsSinceTopicShift: 0,
    userWantsToShift: false,
    preferences: { ...DEFAULT_CHAT_PREFERENCES },
  };
}

function compact(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

function topicLabel(text: string): string {
  const normalized = compact(text)
    .replace(/^(?:对了|另外|先不说这个|说点别的|换个话题|算了)[，,、:：\s]*/u, '')
    .replace(/[。！？!?]+$/u, '');
  return normalized.slice(0, 42);
}

const ACTION_LABELS: Record<ChatReplyAction, string> = {
  react: '自然回应',
  answer: '直接回答',
  comfort: '陪伴情绪',
  share: '分享自己的近况',
  ask: '轻轻追问',
  joke: '接梗或开个小玩笑',
  advise: '给出具体建议',
  close: '顺势收住',
};

function isTopicShift(text: string): boolean {
  const value = compact(text);
  return /(?:换个话题|换个问题|说点别的|先不说这个|不聊这个了|对了|另外|话说回来)/u.test(value) || /^算了[，,、:：\s]+.{3,}/u.test(value);
}

function isClosing(text: string): boolean {
  const value = compact(text);
  if (isTopicShift(value)) return false;
  return /^(?:嗯|好|行|算了|先这样|晚安|拜拜)(?:[呀啦哦嗯喽。！!，,\s]|$)/u.test(value) && value.length <= 12;
}

export function detectChatIntent(text: string): ChatIntent {
  const value = compact(text);
  if (!value) return 'casual';
  if (isTopicShift(value)) return 'topic-shift';
  if (isClosing(value)) return 'closing';
  if (/难过|难受|委屈|生气|烦|累|焦虑|害怕|紧张|孤单|失望|崩溃|想哭|不想说/u.test(value)) return 'emotional';
  if (/[?？]|^(为什么|怎么|怎样|什么|哪儿|哪里|谁|几时|多久|能不能|可以吗|是不是|有没有|要不要)/u.test(value)) return 'question';
  if (/^(帮我|请你|请帮|能帮|给我|替我|写一个|写段|整理|解释|分析|教我|告诉我|推荐|设计|制定)/u.test(value)) return 'request';
  return 'casual';
}

export function inferReplyAction(userText: string, assistantText: string): ChatReplyAction {
  const intent = detectChatIntent(userText);
  if (intent === 'closing') return 'close';
  if (intent === 'emotional') return 'comfort';
  if (intent === 'question') return 'answer';
  if (intent === 'request') return 'advise';
  const answer = compact(assistantText);
  if (/[?？]/u.test(answer)) return 'ask';
  if (/笑|哈哈|逗|好玩|有点离谱/u.test(answer)) return 'joke';
  if (/我也|我最近|我刚|我发现|我在想/u.test(answer)) return 'share';
  return 'react';
}

function updatePreferences(previous: ChatPreferences, text: string): ChatPreferences {
  const value = compact(text);
  const next = { ...previous };
  let signal = false;
  if (/短一点|简单点|别说太多|少说点|一句就好|简短/u.test(value)) {
    next.brevity = 'short'; signal = true;
  } else if (/详细一点|展开说|多说一点|讲清楚|写长一点/u.test(value)) {
    next.brevity = 'detailed'; signal = true;
  }
  if (/别问我|不要再问|少问点|别一直问|不想回答/u.test(value)) {
    next.questionTolerance = 'low'; signal = true;
  } else if (/你可以问|多问一点|问我吧/u.test(value)) {
    next.questionTolerance = 'normal'; signal = true;
  }
  if (/先听我说|只听我说|别急着给建议|不用分析/u.test(value)) {
    next.adviceStyle = 'listen'; signal = true;
  } else if (/给我建议|告诉我怎么办|直接说怎么做/u.test(value)) {
    next.adviceStyle = 'direct'; signal = true;
  }
  if (signal) next.confidence = Math.min(1, next.confidence + 0.35);
  return next;
}

export function updateChatConversationState(
  previous: Partial<ChatConversationState> | undefined,
  userText: string,
  assistantText = '',
  action?: ChatReplyAction,
  now = Date.now(),
): ChatConversationState {
  const base = { ...emptyChatConversationState(), ...(previous ?? {}) };
  const previousPreferences = { ...DEFAULT_CHAT_PREFERENCES, ...(previous?.preferences ?? {}) };
  const intent = detectChatIntent(userText);
  const rawLabel = topicLabel(userText);
  const label = rawLabel.length >= 3 ? rawLabel : '';
  const shifting = intent === 'topic-shift';
  const oldTopic = base.currentTopic?.trim();
  const pausedTopics = [...(base.pausedTopics ?? [])];

  if (shifting && oldTopic && oldTopic !== label) {
    pausedTopics.unshift(oldTopic);
  }
  // 同一主题内的后续短句不覆盖主题锚点；只有明确换题，或首次建立会话时才更新。
  const nextTopic = shifting ? (label || undefined) : (!oldTopic ? (label || oldTopic) : oldTopic);
  const nextStatus: ChatTopicStatus = intent === 'closing'
    ? 'closed'
    : shifting || !oldTopic
      ? (nextTopic ? 'active' : base.topicStatus)
      : base.topicStatus === 'closed' ? 'active' : base.topicStatus;
  const boundedPaused = [...new Set(pausedTopics.filter(Boolean).map((item) => item.slice(0, 42)))].slice(0, 5);
  const nextAction = action ?? base.lastAction;
  const recentActions = nextAction
    ? [...(base.recentActions ?? []), nextAction].slice(-5)
    : (base.recentActions ?? []).slice(-5);
  // assistantText 仅保留在接口中，方便未来按角色回复更新主题摘要；
  // 当前不保存整段回复，避免会话状态膨胀。
  void assistantText;

  return {
    currentTopic: nextTopic,
    topicStatus: nextStatus,
    pausedTopics: boundedPaused,
    lastIntent: intent,
    lastAction: nextAction,
    recentActions,
    turnsSinceTopicShift: shifting ? 0 : Math.min(99, (base.turnsSinceTopicShift ?? 0) + 1),
    lastUserTurnAt: now,
    userWantsToShift: shifting,
    preferences: updatePreferences(previousPreferences, userText),
  };
}

/** 把状态压成隐藏指令，避免把内部状态展示到 UI。 */
export function buildChatConversationStateContext(state: Partial<ChatConversationState> | undefined): string {
  const current = { ...emptyChatConversationState(), ...(state ?? {}) };
  const prefs = { ...DEFAULT_CHAT_PREFERENCES, ...(current.preferences ?? {}) };
  const lines = ['[本会话的连续注意力]'];
  if (current.currentTopic && current.topicStatus !== 'closed') {
    lines.push(`当前话题只作为背景参考：「${current.currentTopic}」。用户已经换题时，以用户的新话题为准。`);
  }
  if (current.pausedTopics.length > 0) {
    lines.push(`暂时搁置的话题：${current.pausedTopics.slice(0, 3).map((item) => `「${item}」`).join('、')}。除非用户主动提起，不要自行拉回。`);
  }
  if (current.userWantsToShift) lines.push('用户刚刚明确想转向。旧话题暂停，本轮不要追问旧事。');
  if (prefs.brevity === 'short') lines.push('用户偏好短回复，先说最重要的一句。');
  if (prefs.brevity === 'detailed') lines.push('用户最近明确希望展开，可以比普通聊天多说一些，但仍保持口语。');
  if (prefs.questionTolerance === 'low') lines.push('用户不喜欢连续被提问，每两轮最多问一个必要问题。');
  if (prefs.adviceStyle === 'listen') lines.push('用户更希望先被听见，未经请求不要立刻给解决方案。');
  if (prefs.adviceStyle === 'direct') lines.push('用户在需要建议时偏好直接、具体的判断。');
  if (current.recentActions.length > 0) {
    lines.push(`最近已经用过的回复动作：${current.recentActions.map((action) => ACTION_LABELS[action] ?? action).join('、')}。下一轮换一个合适的动作，不要机械重复。`);
  }
  return lines.length > 1 ? lines.join('\n') : '';
}

