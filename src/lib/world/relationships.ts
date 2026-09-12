/**
 * 关系网络的"可解释化"读取逻辑（纯函数，便于验收）
 *
 * 设计原则（§27）：
 * - **状态与历史严格分开**：现在是什么关系只读 `relationshipStates`；
 *   为什么会这样只读 `relationshipEvents`（禁止现场把所有事件累加成状态）。
 * - **不显示任何内部数值**：分面（trust/affinity/dependency/conflict/familiarity）只翻译成
 *   语义等级（很信任 / 有些摩擦 …），UI 上不出现数字。
 * - 没有记录就不编：拿不到证据时如实说"还没有记录到变化"。
 */
import type { RelationshipEvent, RelationshipFacet, RelationshipState } from '../../db/index';

/** 分面 → 人话标签（注意：**没有"好感度/亲密"**——那是 4.x 的等阶，唯一来源在 CharacterState） */
export const FACET_LABEL: Record<RelationshipFacet, string> = {
  trust: '信任',
  dependency: '依赖',
  conflict: '摩擦',
  familiarity: '熟悉',
};

/** 分面在三个强度档上的说法（只讲感受，不讲数值） */
const FACET_WORDING: Record<RelationshipFacet, { high: string; mid: string; low: string }> = {
  trust: { high: '很信任对方', mid: '在慢慢信任', low: '刚开始信任' },
  dependency: { high: '很依赖对方', mid: '有些依赖', low: '偶尔会依靠' },
  conflict: { high: '摩擦比较多', mid: '有些摩擦', low: '偶尔有点别扭' },
  familiarity: { high: '非常熟悉', mid: '越来越熟', low: '渐渐熟悉' },
};

export type FacetStrength = 'none' | 'low' | 'mid' | 'high';

/** 分面强度分档：0 = 没有记录（**不显示**，避免"信任：无"这种噪音） */
export function facetStrength(value: number): FacetStrength {
  if (!Number.isFinite(value) || value <= 0) return 'none';
  if (value < 34) return 'low';
  if (value < 67) return 'mid';
  return 'high';
}

/** 该分面的人话说法；没有记录时返回 null（调用方据此不渲染） */
export function describeFacet(facet: RelationshipFacet, value: number): string | null {
  const strength = facetStrength(value);
  if (strength === 'none') return null;
  return FACET_WORDING[facet][strength];
}

export interface FacetReading {
  facet: RelationshipFacet;
  label: string;
  text: string;
  strength: Exclude<FacetStrength, 'none'>;
}

/** 有记录的分面人话（按强度从高到低；最多 limit 条） */
export function describeFacets(state: RelationshipState | undefined, limit = 3): FacetReading[] {
  if (!state) return [];
  const readings: FacetReading[] = [];
  for (const facet of Object.keys(FACET_LABEL) as RelationshipFacet[]) {
    const value = state[facet];
    const text = describeFacet(facet, value);
    if (!text) continue;
    readings.push({ facet, label: FACET_LABEL[facet], text, strength: facetStrength(value) as Exclude<FacetStrength, 'none'> });
  }
  const order: Record<Exclude<FacetStrength, 'none'>, number> = { high: 3, mid: 2, low: 1 };
  return readings
    .sort((a, b) => order[b.strength] - order[a.strength] || b.facet.localeCompare(a.facet))
    .slice(0, Math.max(0, limit));
}

/** 这一对的人话标题：你 ↔ 角色 / 角色 ↔ 角色 */
export function pairTitle(state: Pick<RelationshipState, 'subjectA' | 'subjectB'>, userId: string, nameOf: (id: string) => string): string {
  const label = (ref: string) => {
    if (ref.startsWith('u:')) return ref.slice(2) === userId ? '你' : '某人';
    if (ref.startsWith('c:')) return nameOf(ref.slice(2));
    return '某人';
  };
  return `${label(state.subjectA)} 和 ${label(state.subjectB)}`;
}

/** 一条变化的人话原因（只用 reason；内部字段一律不外泄） */
export function reasonText(event: Pick<RelationshipEvent, 'reason'>): string {
  return (event.reason ?? '').trim();
}

/**
 * 变化历史：新 → 旧，最多 limit 条（只保留有原因的）。
 * 注意：**不在这里累加数值**——这里只负责"讲故事"。
 */
export function recentReasons(events: RelationshipEvent[], limit = 3): RelationshipEvent[] {
  return [...events]
    .filter((e) => reasonText(e).length > 0)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, Math.max(0, limit));
}

/**
 * 这一对是否有任何可解释的记录。
 * 状态行存在但分面全 0、也没有变化史 ⇒ 视为"还没有记录"（不硬编故事）。
 */
export function hasExplainableRecord(state: RelationshipState | undefined, events: RelationshipEvent[]): boolean {
  if (recentReasons(events, 1).length > 0) return true;
  return describeFacets(state, 1).length > 0;
}
