import type { WorldScene } from '../../db/index';
import type { CSSProperties } from 'react';
import { hourOfWorldTime } from './world-time';

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

export function emptyConversationState(): WorldConversationState {
  return { previousTopics: [], exhaustedMotifs: [], unansweredQuestions: [], userWantsToShift: false, turnsSinceTopicShift: 0 };
}

function lightFor(timeLabel: string): WorldVisualState['light'] {
  const clock = hourOfWorldTime(timeLabel);
  if (clock) return clock.hour < 5 ? 'night' : clock.hour < 8 ? 'dawn' : clock.hour < 17 ? 'day' : clock.hour < 19 ? 'dusk' : 'night';
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

