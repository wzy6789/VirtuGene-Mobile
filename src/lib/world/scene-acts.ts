/**
 * 幕次推进规则（Phase 3c：节奏）
 *
 * 为什么是**本地规则**而不是让模型决定：
 *  - "现在该进下一幕了吗"是**结构化状态的真相**，不该由一次生成随口决定（§"LLM 负责演，VirtuGene 负责记"）；
 *  - 本地规则可解释、可验收、不花钱（推进本身 0 次调用）。
 *
 * 规则（自下而上，第一条命中即推进）：
 *  1. **张力到位**：本幕张力达到阈值，且本幕已有足够多的正文（不是刚开场就翻幕）
 *  2. **节奏兜底**：剧情一直平，但本幕已经很长了，也必须往前推（避免永远停在第一幕）
 * 幕数上限固定，走到最后一幕就不再推进（留给"结束这场戏"）。
 */
import type { WorldSceneEntry, WorldSceneState } from '../../db/index';

/** 最多几幕 */
export const MAX_ACTS = 4;
/** 张力阈值：本幕张力达到它 + 正文条数够 ⇒ 推进 */
export const ACT_ADVANCE_TENSION = 0.65;
/** 本幕至少要有这么多条正文才允许因张力推进（避免开场就翻幕） */
export const ACT_MIN_ENTRIES = 6;
/** 节奏兜底：本幕正文多到这个数，即使张力不足也推进 */
export const ACT_FORCE_ENTRIES = 12;

const ACT_LABELS = ['第一幕', '第二幕', '第三幕', '第四幕', '第五幕', '第六幕'];

export function actLabel(act: number): string {
  const index = Math.max(1, Math.round(act)) - 1;
  return ACT_LABELS[index] ?? `第 ${act} 幕`;
}

/** 本幕的正文条数（不算 system 标记，也不算"选择提示"本身——选择由用户回答，属于下一拍的引子） */
export function countActEntries(entries: WorldSceneEntry[], act: number): number {
  return entries.filter((e) => e.act === act && e.kind !== 'system').length;
}

export type ActAdvanceReason = 'tension' | 'pace';

export interface ActAdvanceDecision {
  advance: boolean;
  reason: ActAdvanceReason | null;
  /** 下一个幕次（不推进时等于当前幕） */
  nextAct: number;
}

export function shouldAdvanceAct(params: {
  state: Pick<WorldSceneState, 'currentAct' | 'currentTension'>;
  entries: WorldSceneEntry[];
  maxActs?: number;
}): ActAdvanceDecision {
  const currentAct = Math.max(1, params.state.currentAct);
  const maxActs = params.maxActs ?? MAX_ACTS;
  const stay: ActAdvanceDecision = { advance: false, reason: null, nextAct: currentAct };
  if (currentAct >= maxActs) return stay;

  const count = countActEntries(params.entries, currentAct);
  if (count >= ACT_MIN_ENTRIES && params.state.currentTension >= ACT_ADVANCE_TENSION) {
    return { advance: true, reason: 'tension', nextAct: currentAct + 1 };
  }
  if (count >= ACT_FORCE_ENTRIES) {
    return { advance: true, reason: 'pace', nextAct: currentAct + 1 };
  }
  return stay;
}

/** 推进后写下的可见标记（用户能看见"翻幕了"，不是悄悄改状态） */
export function actMarkerContent(act: number): string {
  return `—— ${actLabel(act)} ——`;
}

/**
 * 校验"选择分支"：只接受 2~3 个不重复、长度合理的选项。
 * 不合法就**降级成旁白**（绝不出现"只有一个选项"或空选项这种假选择）。
 */
export function validateChoiceOptions(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const options: string[] = [];
  for (const item of raw) {
    const text = typeof item === 'string' ? item.trim().slice(0, 60) : '';
    if (!text) continue;
    if (options.includes(text)) continue;
    options.push(text);
    if (options.length >= 3) break;
  }
  return options.length >= 2 ? options : null;
}
