import type { EmotionDimensions } from '../db/index';

export interface RelationLevel {
  name: string;
  min: number;
  desc: string;
  tone: string;
}

export const RELATION_LEVELS: RelationLevel[] = [
  { name: '初识', min: 0, desc: '彼此陌生', tone: '疏离、防备、惜字如金' },
  { name: '熟悉', min: 20, desc: '开始熟络', tone: '客气、试探' },
  { name: '亲近', min: 40, desc: '关系升温', tone: '自然、放松' },
  { name: '挚友', min: 60, desc: '交心', tone: '亲近、温和' },
  { name: '知己', min: 80, desc: '灵魂契合', tone: '默契、无话不谈' },
  // 好感度无上限：100 以上继续进阶（等阶名可自定义）
  { name: '灵魂共鸣', min: 100, desc: '超越言语的默契', tone: '心照不宣' },
  { name: '生命同频', min: 150, desc: '灵魂逐渐交织', tone: '无需多言' },
  { name: '永恒羁绊', min: 220, desc: '跨越时间的连接', tone: '融为一体' },
];

const OTHER_DIM_KEYS = ['valence', 'arousal', 'engagement', 'expressiveness', 'stability'] as const;

/** 每 3 条结算一次的好感度变化量，公式：+1（轮次） + (亲密度−5)×0.8 + Σ(其余5维−5)×0.3，四舍五入取整 */
export function computeAffinityDelta(dims: EmotionDimensions): number {
  const roundBonus = 1;
  const intimacy = (dims.intimacy - 5) * 0.8;
  const others = OTHER_DIM_KEYS.reduce((sum, k) => sum + (dims[k] - 5) * 0.3, 0);
  return Math.round(roundBonus + intimacy + others);
}

export function getRelationLevel(affinity: number): { level: RelationLevel; next: RelationLevel | null; index: number } {
  let index = 0;
  for (let i = 0; i < RELATION_LEVELS.length; i++) {
    if (affinity >= RELATION_LEVELS[i].min) index = i;
  }
  const level = RELATION_LEVELS[index];
  const next = RELATION_LEVELS[index + 1] ?? null;
  return { level, next, index };
}

/** 当前等级内进度（到下一级的百分比）；最高等级显示在最终阶内的成长（每 80 点一段） */
export function levelProgress(affinity: number, level: RelationLevel, next: RelationLevel | null): number {
  if (!next) {
    return Math.max(0, Math.min(100, ((affinity - level.min) / 80) * 100));
  }
  const span = next.min - level.min;
  return Math.max(0, Math.min(100, ((affinity - level.min) / span) * 100));
}
