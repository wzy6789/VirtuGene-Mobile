import type { WorldScene, WorldSceneEntry, WorldSceneState } from '../../db/index';
import type { CSSProperties } from 'react';

/**
 * 每一拍都会携带的视觉状态。它不是装饰数据：地点、时段、天气和
 * 当前情绪共同决定世界流的背景与过渡，因此离开再回来时仍然一致。
 */
export interface WorldVisualState {
  primary: string;
  secondary: string;
  glow: string;
  particle: 'none' | 'dust' | 'rain' | 'snow' | 'embers' | 'fireflies';
  density: number;
  light: 'dawn' | 'day' | 'dusk' | 'night';
  weather?: string;
  intensity: number;
  updatedAt: number;
}

/**
 * 用于避免角色像客服一样反复兜圈子的本地会话状态。
 * 只保存短标签和计数，不保存完整聊天正文。
 */
export interface WorldConversationState {
  currentTopic?: string;
  previousTopics: string[];
  exhaustedMotifs: string[];
  unansweredQuestions: string[];
  lastSpeakerId?: string;
  lastUserTurnAt?: number;
  userWantsToShift: boolean;
  turnsSinceTopicShift: number;
  lastProactiveTopicAt?: number;
}

export interface WorldBeatMeta {
  beatId: string;
  layer: 'environment' | 'action' | 'dialogue' | 'choice' | 'system';
  sequence: number;
  revealAfterMs?: number;
  camera?: 'wide' | 'focus' | 'close' | 'follow' | 'still';
  visual?: Partial<WorldVisualState>;
}

const TOPIC_STOP = new Set(['这个', '那个', '一下', '现在', '然后', '就是', '我们', '你们', '可以', '什么', '怎么']);
const TOPIC_WORDS = /[一-鿿]{2,8}/g;

function topicOf(text: string): string | undefined {
  const words = (text.match(TOPIC_WORDS) ?? [])
    .map((word) => word.trim())
    .filter((word) => !TOPIC_STOP.has(word));
  return words.sort((a, b) => b.length - a.length)[0]?.slice(0, 12);
}

function looksLikeShift(text: string): boolean {
  return /换个话题|说点别的|先不说这个|不聊这个|对了|突然想起|另外|顺便问|聊聊别的/.test(text);
}

function motifOf(entries: WorldSceneEntry[]): string | undefined {
  const recent = entries.filter((entry) => entry.kind === 'dialogue').slice(-8).map((entry) => topicOf(entry.content)).filter(Boolean) as string[];
  if (recent.length < 3) return undefined;
  const counts = new Map<string, number>();
  for (const value of recent) counts.set(value, (counts.get(value) ?? 0) + 1);
  const repeated = [...counts.entries()].find(([, count]) => count >= 3);
  return repeated?.[0];
}

export function emptyConversationState(): WorldConversationState {
  return { previousTopics: [], exhaustedMotifs: [], unansweredQuestions: [], userWantsToShift: false, turnsSinceTopicShift: 0 };
}

export function updateConversationState(
  previous: WorldConversationState | undefined,
  userText: string,
  entries: WorldSceneEntry[],
  now = Date.now(),
): WorldConversationState {
  const state = { ...emptyConversationState(), ...(previous ?? {}) };
  const nextTopic = topicOf(userText);
  const shifted = looksLikeShift(userText) || Boolean(nextTopic && state.currentTopic && nextTopic !== state.currentTopic && state.turnsSinceTopicShift >= 2);
  const currentTopic = nextTopic ?? state.currentTopic;
  const previousTopics = currentTopic && currentTopic !== state.currentTopic
    ? [state.currentTopic, ...state.previousTopics].filter(Boolean).slice(0, 8) as string[]
    : state.previousTopics.slice(0, 8);
  const exhausted = new Set(state.exhaustedMotifs);
  const repeated = motifOf(entries);
  if (repeated) exhausted.add(repeated);
  return {
    ...state,
    ...(currentTopic ? { currentTopic } : {}),
    previousTopics,
    exhaustedMotifs: [...exhausted].slice(-12),
    userWantsToShift: shifted,
    turnsSinceTopicShift: shifted ? 0 : state.turnsSinceTopicShift + 1,
    lastUserTurnAt: now,
  };
}

function lightFor(timeLabel: string): WorldVisualState['light'] {
  if (/清晨|早上|黎明/.test(timeLabel)) return 'dawn';
  if (/上午|中午|下午|白天/.test(timeLabel)) return 'day';
  if (/黄昏|傍晚/.test(timeLabel)) return 'dusk';
  return 'night';
}

/** 从世界语义生成稳定的视觉调色板，避免每轮随机导致画面跳变。 */
export function deriveWorldVisualState(scene: Pick<WorldScene, 'place' | 'timeLabel' | 'mood'>, previous?: WorldVisualState, now = Date.now()): WorldVisualState {
  const text = `${scene.place} ${scene.mood}`;
  const light = lightFor(scene.timeLabel);
  const rainy = /雨|潮湿|雾|阴/.test(text);
  const snowy = /雪|冰/.test(text);
  const warm = /炉|灯|火|篝|暖|黄昏|傍晚/.test(text);
  const particle: WorldVisualState['particle'] = snowy ? 'snow' : rainy ? 'rain' : warm ? 'embers' : /森林|花|星|夜/.test(text) ? 'fireflies' : 'dust';
  const palette = light === 'dawn'
    ? { primary: '#27385d', secondary: '#d68a92', glow: '#ffc1a6' }
    : light === 'day'
      ? { primary: '#1e4260', secondary: '#3ca7a0', glow: '#9ff8e8' }
      : light === 'dusk'
        ? { primary: '#39294f', secondary: '#bd6a82', glow: '#ffbb91' }
        : { primary: '#111936', secondary: '#51499b', glow: '#83e8e3' };
  const next: WorldVisualState = {
    ...palette,
    particle,
    density: rainy || snowy ? 0.62 : warm ? 0.38 : 0.24,
    light,
    ...(rainy ? { weather: '雨' } : snowy ? { weather: '雪' } : {}),
    intensity: Math.max(0.2, Math.min(1, previous?.intensity ?? 0.55)),
    updatedAt: now,
  };
  return next;
}

export function visualCss(state: WorldVisualState): CSSProperties {
  return {
    '--vg-world-primary': state.primary,
    '--vg-world-secondary': state.secondary,
    '--vg-world-glow': state.glow,
    '--vg-world-particle-density': String(state.density),
    '--vg-world-intensity': String(state.intensity),
  } as CSSProperties;
}

export function revealDelayFor(entry: Pick<WorldSceneEntry, 'kind' | 'content' | 'speakerId'>, previousSpeaker?: string): number {
  const length = entry.content.trim().length;
  if (entry.kind === 'narration') return Math.min(520, 120 + length * 3);
  if (entry.kind !== 'dialogue' && entry.kind !== 'action') return 0;
  const changed = Boolean(entry.speakerId && previousSpeaker && entry.speakerId !== previousSpeaker);
  const base = changed ? 760 : entry.kind === 'action' ? 280 : 420;
  return Math.min(1_450, base + Math.min(420, length * 4));
}

export function directorConversationHints(state: WorldConversationState | undefined): string {
  if (!state) return '';
  const lines = [
    state.currentTopic ? `当前话题：${state.currentTopic}` : '',
    state.userWantsToShift ? '用户正在换话题：立刻跟随新话题，不要把上一件事拉回来。' : '',
    state.exhaustedMotifs.length ? `近期已经反复出现、不要再用同一意象绕圈：${state.exhaustedMotifs.slice(-5).join('、')}` : '',
    state.turnsSinceTopicShift >= 4 ? '已经连续几轮对话：可以由角色主动抛出一个与现场有关的新话题，但只给一个小切口。' : '',
  ];
  return lines.filter(Boolean).join('\n');
}

export type ImmersionStatePatch = Pick<WorldSceneState, 'visual' | 'conversation'>;
