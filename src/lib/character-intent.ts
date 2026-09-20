import type { Character } from '../db/index';
import type { ChatConversationState, ChatReplyAction, ChatIntent } from './chat-conversation-state';
import { detectChatIntent, inferReplyAction } from './chat-conversation-state';
import { detectHumanTurn, chooseConversationAction, type ConversationAction } from './chat-humanizer';

export interface CharacterIntentPlan {
  intent: ChatIntent;
  need: '被听见' | '获得答案' | '陪伴' | '新鲜感' | '完成事情' | '留一点空间';
  action: ConversationAction;
  targetLength: '极短' | '短' | '正常' | '详细';
  mayAskQuestion: boolean;
  avoidTopics: string[];
  rationale: string;
}

function compact(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

function recentAssistantQuestionCount(history: Array<{ role: string; content: string }>): number {
  return history
    .filter((item) => item.role === 'assistant')
    .slice(-2)
    .filter((item) => /[?？]\s*$/u.test(item.content.trim()))
    .length;
}

function needFor(intent: ChatIntent, action: ConversationAction): CharacterIntentPlan['need'] {
  if (intent === 'emotional') return '陪伴';
  if (intent === 'question') return '获得答案';
  if (intent === 'request') return '完成事情';
  if (intent === 'closing') return '留一点空间';
  if (action === 'fresh-angle' || action === 'share-life') return '新鲜感';
  return '被听见';
}

function targetLength(text: string, state?: Partial<ChatConversationState>): CharacterIntentPlan['targetLength'] {
  const brevity = state?.preferences?.brevity;
  if (brevity === 'short' || text.length <= 8) return '短';
  if (brevity === 'detailed' || text.length >= 180) return '详细';
  return text.length >= 55 ? '正常' : '短';
}

/** 在本地为模型选择本轮唯一重点，避免每一轮都重新解释整套规则。 */
export function planCharacterIntent(
  userText: string,
  history: Array<{ role: string; content: string }>,
  state: Partial<ChatConversationState> | undefined,
  character?: Pick<Character, 'proactivity'> | null,
): CharacterIntentPlan {
  const text = compact(userText);
  const intent = detectChatIntent(text);
  const recentUsers = history.filter((item) => item.role === 'user').map((item) => item.content).slice(-5);
  const signals = detectHumanTurn(text, recentUsers);
  const action = chooseConversationAction(text, history, character ? { name: '', tags: [], proactivity: character.proactivity ?? 0.5, signature: '', greeting: '', catchphrase: '', boundaries: '', systemPrompt: '' } : undefined, {});
  const questionBlocked = (state?.preferences?.questionTolerance === 'low') || recentAssistantQuestionCount(history) >= 1;
  const mayAskQuestion = !questionBlocked && intent !== 'closing' && intent !== 'request' && intent !== 'topic-shift' && action !== 'short-close';
  const avoidTopics = (state?.pausedTopics ?? []).filter(Boolean).slice(0, 3);
  const rationale = signals.topicShift
    ? '用户正在换题，旧话题暂停。'
    : intent === 'emotional'
      ? '用户带着情绪，先陪伴再处理。'
      : intent === 'question'
        ? '用户在等核心答案，先回答再展开。'
        : action === 'fresh-angle'
          ? '最近表达出现重复，换一个具体角度。'
          : '保持自然来回，给用户留下接话空间。';
  return {
    intent,
    need: needFor(intent, action),
    action,
    targetLength: targetLength(text, state),
    mayAskQuestion,
    avoidTopics,
    rationale,
  };
}

export function buildCharacterIntentContext(plan: CharacterIntentPlan): string {
  const actions: Record<ConversationAction, string> = {
    'follow-topic': '跟随用户的新话题',
    'stay-present': '陪在情绪里',
    'answer-directly': '直接回答',
    'finish-request': '完成眼前的请求',
    'share-life': '分享角色自己的一个具体细节',
    'fresh-angle': '换一个新角度',
    'short-close': '顺势收住',
    react: '自然回应',
  };
  const question = plan.mayAskQuestion ? '可以在自然需要时问一个问题' : '本轮不要用问题收尾';
  const avoid = plan.avoidTopics.length > 0 ? `暂时不要主动拉回：${plan.avoidTopics.map((item) => `「${item}」`).join('、')}。` : '';
  return [
    '[人物心意：这一轮想怎样回应]',
    `交流需要：${plan.need}；本轮动作：${actions[plan.action]}；回复长度：${plan.targetLength}。`,
    `${question}。${avoid}`,
    `判断依据：${plan.rationale}`,
    '只完成一个小节拍；不要把这段内部提示说给用户。',
  ].join('\n');
}

/** 将实际回复归因到可持久化的动作，兼容旧会话。 */
export function inferCharacterResponseAction(userText: string, assistantText: string): ChatReplyAction {
  return inferReplyAction(userText, assistantText);
}
