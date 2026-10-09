/**
 * 私聊的轻量节奏状态。
 *
 * 这不是另一套记忆库，也不保存原始对话；它只回答“这轮该怎么聊”——
 * 当前话题、用户是否想换题、用户偏好的回复方式，以及最近已经用过的回复动作。
 * 状态写在当前 Session 上，因此天然按用户和角色隔离。
 */

import { assessExpressionSignals } from './chat-expression-guidance';
import { isDirectAffection, isViewExchange } from './chat-expression-boundary';
import { hasExplicitTopicShift, isStandaloneClosing, isTopicClarification,requestsRepetition,isDirectTimeAnswer } from './chat-turn-cues';

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
  /** Successful replies in this session. Older sessions simply start at zero. */
  turnCount?: number;
  lastUserTurnAt?: number;
  userWantsToShift: boolean;
  preferences: ChatPreferences;
  /** A listening request for the current subject, not an enduring preference. */
  topicAdvice?: 'listen';
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
  return hasExplicitTopicShift(text);
}

const CONTINUATION = /^(?:那|然后|接着|所以|因为|可是|但是|但(?:也|我|这|那|又|有|好像|觉得|感觉)|不过|哈哈+[，,。！!呀啊\s]*(?:$|我(?:也|都|真|好|想|觉得)|这(?:也|可|个)|那(?:也|可|就))|这里|那里|这个|那个|这件事|他|她|它|刚才|还有|为什么|怎么了|真的吗)/u;
const GENERIC_GRAMS = new Set(['我想', '我们', '你们', '现在', '今天', '这个', '那个', '什么', '怎么', '觉得', '一下', '还是', '可以', '然后', '因为', '所以', '就是', '有点', '知道', '说过', '事情', '问题']);

/** A small, conservative signal for a natural topic change; it never erases history. */
export function topicTerms(text: string): Set<string> {
  const terms = new Set<string>();
  const clean = text.normalize('NFKC').toLocaleLowerCase();
  for (const chunk of clean.match(/[\u4e00-\u9fff]{2,}|[a-z0-9]{3,}/gu) ?? []) {
    if (/^[a-z0-9]/.test(chunk)) { terms.add(chunk); continue; }
    for (let i = 0; i < chunk.length - 1; i += 1) {
      const gram = chunk.slice(i, i + 2);
      if (!GENERIC_GRAMS.has(gram)) terms.add(gram);
    }
  }
  return terms;
}

export function isTopicRelated(current: string, context: string): boolean {
  const terms = topicTerms(current);
  if (!terms.size) return false;
  const known = topicTerms(context);
  for (const term of terms) if (known.has(term)) return true;
  return false;
}

export function detectTopicMove(current: string, previous = ''): boolean {
  if (isTopicShift(current)) return true;
  const value = compact(current);
  if (value.length < 4 || compact(previous).length < 4 || CONTINUATION.test(value) || isTopicClarification(value)||isDirectTimeAnswer(value,previous)) return false;
  const currentTerms = topicTerms(value);
  const oldTerms = topicTerms(previous);
  if (!currentTerms.size || !oldTerms.size) return false;
  for (const term of currentTerms) if (oldTerms.has(term)) return false;
  return true;
}

function isClosing(text: string): boolean {
  return isStandaloneClosing(text);
}

export function detectChatIntent(text: string): ChatIntent {
  const value = compact(text);
  if (!value) return 'casual';
  if (isClosing(value)) return 'closing';
  const expression=assessExpressionSignals(value);
  if(isViewExchange(value)) return 'question';
  if(expression.request||requestsRepetition(value)) return 'request';
  if (isTopicShift(value)) return 'topic-shift';
  if (isDirectAffection(value)||expression.emotionConfidence>=.8||/不想说|没事吧|怎么办/u.test(value)) return 'emotional';
  if (/[?？]|^(为什么|怎么|怎样|什么|哪儿|哪里|谁|几时|多久|能不能|可以吗|是不是|有没有|要不要)/u.test(value)) return 'question';
  return 'casual';
}

export function inferReplyAction(userText: string, assistantText: string): ChatReplyAction {
  const intent = detectChatIntent(userText);
  if (intent === 'closing') return 'close';
  if (intent === 'emotional') {
    // Joy and affection are not evidence that the reply was consolation.
    // Preserve distress/mixed support, but describe positive responses by
    // their actual lightweight form rather than importing a counselling frame.
    if (isDirectAffection(userText)||assessExpressionSignals(userText).situation==='celebration') {
      if (/[?？]/u.test(assistantText)) return 'ask';
      if (/笑|哈哈|逗|好玩/u.test(assistantText)) return 'joke';
      return 'react';
    }
    return 'comfort';
  }
  if (intent === 'question') return 'answer';
  if (intent === 'request') return 'advise';
  const answer = compact(assistantText);
  if (/[?？]/u.test(answer)) return 'ask';
  if (/笑|哈哈|逗|好玩|有点离谱/u.test(answer)) return 'joke';
  if (/我也|我最近|我刚|我发现|我在想/u.test(answer)) return 'share';
  return 'react';
}

/** Keep instructions about authored text out of the user's chat preferences. */
function preferenceClauses(text: string): string[] {
  const unquoted = text.replace(/[“「『"][^”」』"]*[”」』"]/gu, '');
  if (/^(?:如果|假如|假设|比如|例如)/u.test(unquoted.trim())) return [];
  return unquoted.split(/[。！？!?\n]/u)
    // A comma does not end a writing request: its following recipient and
    // content clauses still belong to the material the user wants composed.
    .filter(sentence => !/(?:帮我|请你|替我|给我)(?:写|改写|翻译)|(?:^|[，,；;])\s*(?:现在|这次|先)?(?:写一句|写一段|翻译|改写)/u.test(sentence))
    .flatMap(sentence => sentence.split(/[，,；;]/u))
    .map(clause => clause.trim())
    .filter(clause => !/^(?:他|她|朋友|同事|主角|如果|假如|假设|比如|例如|帮我写|请你写|写一句|翻译|改写)/u.test(clause));
}

function updatePreferences(previous: ChatPreferences, text: string): ChatPreferences {
  const next = { ...previous };
  let signal = false;
  for(const clause of preferenceClauses(text)) {
    const found:Array<{index:number;field:'brevity'|'questionTolerance'|'adviceStyle';value:string}>=[];
    const scan=(pattern:RegExp,field:'brevity'|'questionTolerance'|'adviceStyle',value:string)=>{
      for(const match of clause.matchAll(new RegExp(pattern.source,'gu'))) {
        // A negated positive directive is not consent to that style. Negative
        // directives such as “别说太多” are matched including their negation.
        if(/(?:别|不要|不用|不必|不需要|不想|不是|无需).{0,5}$/u.test(clause.slice(0,match.index)))continue;
        found.push({index:match.index,field,value});
      }
    };
    scan(/短一点|简单点|别说太多|少说点|一句就好|简短/u,'brevity','short');
    scan(/详细一点|展开说|多说一点|讲清楚|写长一点/u,'brevity','detailed');
    scan(/别问我|不要再问|少问点|少问一点|别一直问|不想回答/u,'questionTolerance','low');
    scan(/你可以问|多问一点|问我吧/u,'questionTolerance','normal');
    scan(/先听我说|只听我说|(?:我)?不想听(?:你)?(?:的)?建议|(?:先)?(?:别|不要|不用|不必)(?:急着)?(?:再)?给(?:我)?建议|(?:不用|不要|别)分析|(?:别|不要|不用)(?:给我|跟我)?(?:讲|说|解释)(?:怎么(?:处理|做|办)|该怎么做)/u,'adviceStyle','listen');
    scan(/给我建议|告诉我怎么办|直接说怎么做/u,'adviceStyle','direct');
    for(const preference of found.sort((a,b)=>a.index-b.index)) {
      if(preference.field==='brevity')next.brevity=preference.value as ChatPreferences['brevity'];
      else if(preference.field==='questionTolerance')next.questionTolerance=preference.value as ChatPreferences['questionTolerance'];
      else next.adviceStyle=preference.value as ChatPreferences['adviceStyle'];
      signal=true;
    }
  }
  if (signal) next.confidence = Math.min(1, next.confidence + 0.35);
  return next;
}

function adviceForCurrentTopic(text: string): 'listen' | 'direct' | undefined {
  let advice: 'listen' | 'direct' | undefined;
  for (const clause of preferenceClauses(text)) {
    const directives = [...clause.matchAll(/不是(?:想|要|来)(?:听|让你给|让你提)?建议|不想(?:要|听)(?:你的|你给的)?建议|(?:我)?(?:只是|就是|只想)吐槽(?:一下)?|给我建议|告诉我怎么办|直接说怎么做/gu)];
    for (const match of directives) {
      if (/(?:别|不要|不用|不是|不想).{0,5}$/u.test(clause.slice(0, match.index))) continue;
      advice = /^(?:给我建议|告诉我怎么办|直接说怎么做)$/u.test(match[0]) ? 'direct' : 'listen';
    }
  }
  return advice;
}

export function updateChatConversationState(
  previous: Partial<ChatConversationState> | undefined,
  userText: string,
  assistantText = '',
  action?: ChatReplyAction,
  now = Date.now(),
  previousUserText = '',
): ChatConversationState {
  const base = { ...emptyChatConversationState(), ...(previous ?? {}) };
  const previousPreferences = { ...DEFAULT_CHAT_PREFERENCES, ...(previous?.preferences ?? {}) };
  const intent = detectChatIntent(userText);
  const preferences = updatePreferences(previousPreferences, userText);
  const topicAdvice = adviceForCurrentTopic(userText);
  const rawLabel = topicLabel(userText);
  const label = rawLabel.length >= 3 ? rawLabel : '';
  const shifting = detectTopicMove(userText, previousUserText);
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
  const recentActions = action
    ? [...(base.recentActions ?? []), action].slice(-5)
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
    turnCount: Math.min(100_000, (base.turnCount ?? 0) + 1),
    lastUserTurnAt: now,
    userWantsToShift: shifting,
    preferences,
    topicAdvice: topicAdvice === 'listen' && intent !== 'request'
      ? 'listen'
      : topicAdvice !== 'direct' && !shifting && intent !== 'closing' && intent !== 'request'
        ? base.topicAdvice
        : undefined,
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
  if (current.userWantsToShift) lines.push('当前话题有转向线索，以用户原话为准；不自动追问旧事。');
  if (prefs.brevity === 'short') lines.push('用户偏好短回复，先说最重要的一句。');
  if (prefs.brevity === 'detailed') lines.push('用户最近明确希望展开，可以比普通聊天多说一些，但仍保持口语。');
  if (prefs.questionTolerance === 'low') lines.push('用户不喜欢连续被提问，优先回应，确实需要时再补问。');
  if (prefs.adviceStyle === 'listen') lines.push('用户更希望先被听见，未经请求不要立刻给解决方案。');
  if (prefs.adviceStyle === 'direct' && current.topicAdvice !== 'listen') lines.push('用户在需要建议时偏好直接、具体的判断。');
  if (current.topicAdvice === 'listen') lines.push('这件事用户只想吐槽，不是在求建议；就已说出的事情表达你的反应，不替用户分析心理，也不追加休息、放松或处理步骤。用户换题时跟随，后来明确求助时再提供办法。');
  if (current.recentActions.length > 0) {
    lines.push(`最近的交流：${current.recentActions.map((action) => ACTION_LABELS[action] ?? action).join('、')}。只作为上下文，不强制轮换反应或语气。`);
  }
  return lines.length > 1 ? lines.join('\n') : '';
}

