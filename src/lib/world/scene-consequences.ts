/**
 * 场景后果的**校验层**（Phase 3：LLM 负责演，VirtuGene 负责记）
 *
 * 结算调用会返回一份"建议"，但它**不是数据库真相**：
 * - 分面名必须在白名单里（`affinity` 已按 R7 裁定移除，出现即丢弃）
 * - 关系变化的两端必须是**在场的人**（用户或本场参与者），否则丢弃
 * - 每条关系变化**必须带原因**（没有原因的关系变化会破坏"可解释"）
 * - 未完成事件只能挂在**在场角色**上
 * - **认知（谁知道了什么）不接受模型指定**：参与者亲身经历 ⇒ 由我们的规则授予
 * - 数值一律夹到合法区间；文本一律截断
 *
 * 被丢弃的内容会如实记录在 `dropped` 里（便于验收与排查），绝不"猜一个"。
 */
import { RELATIONSHIP_FACETS, type RelationshipFacet } from '../../db/index';
import { characterRef, userRef } from './subjects';

export interface SettlementRelationshipChange {
  a: string;
  b: string;
  facets: Partial<Record<RelationshipFacet, number>>;
  reason: string;
}

export interface SettlementUnresolved {
  characterId: string;
  kind: 'promise' | 'plan' | 'topic' | 'conflict' | 'reminder';
  title: string;
  detail?: string;
}

export interface SceneSettlementProposal {
  summary?: string;
  memory?: { title: string; summary?: string };
  relationshipChanges: SettlementRelationshipChange[];
  unresolved: SettlementUnresolved[];
}

export interface SettlementContext {
  userId: string;
  /** 本场参与者（角色 id） */
  characterIds: string[];
  /** 角色名 → id（模型只会给名字） */
  resolveCharacter: (name: string) => string | undefined;
}

const UNRESOLVED_KINDS = ['promise', 'plan', 'topic', 'conflict', 'reminder'] as const;

function asString(value: unknown, max: number): string {
  const s = typeof value === 'string' ? value.trim() : '';
  return s.slice(0, max);
}

/** 把"用户"/"你"之类的称呼识别成用户主体；否则按角色名解析 */
function resolveSubject(rawName: string, ctx: SettlementContext): string | null {
  const name = rawName.trim();
  if (!name) return null;
  if (['用户', '你', 'user', 'User'].includes(name)) return userRef(ctx.userId);
  const id = ctx.resolveCharacter(name);
  return id ? characterRef(id) : null;
}

/** 只统计合法分面的增量；非法分面（含 affinity）直接丢弃并记名 */
function readFacets(raw: unknown, dropped: string[]): Partial<Record<RelationshipFacet, number>> {
  const out: Partial<Record<RelationshipFacet, number>> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!RELATIONSHIP_FACETS.includes(key as RelationshipFacet)) {
      dropped.push(`未知分面:${key}`);
      continue;
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      dropped.push(`非法分面值:${key}`);
      continue;
    }
    // 单次场景的增量再夹一层（防止模型给 ±999 把关系拉爆）
    out[key as RelationshipFacet] = Math.max(-10, Math.min(10, Math.round(value)));
  }
  return out;
}

export function validateSettlement(
  raw: unknown,
  ctx: SettlementContext,
): { proposal: SceneSettlementProposal; dropped: string[] } {
  const dropped: string[] = [];
  const proposal: SceneSettlementProposal = { relationshipChanges: [], unresolved: [] };
  let data: unknown = raw;
  if (typeof raw === 'string') {
    try {
      const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
      data = JSON.parse((fenced ? fenced[1] : raw).trim());
    } catch {
      return { proposal, dropped: ['无法解析结算 JSON'] };
    }
  }
  if (!data || typeof data !== 'object') return { proposal, dropped: ['结算内容为空'] };
  const obj = data as Record<string, unknown>;

  const summary = asString(obj.summary, 300);
  if (summary) proposal.summary = summary;

  const memoryRaw = (obj.memory ?? null) as Record<string, unknown> | null;
  if (memoryRaw && typeof memoryRaw === 'object') {
    const title = asString(memoryRaw.title, 120);
    if (title) {
      const memSummary = asString(memoryRaw.summary, 400);
      proposal.memory = { title, ...(memSummary ? { summary: memSummary } : {}) };
    } else {
      dropped.push('共同记忆缺标题');
    }
  }

  const changes = Array.isArray(obj.relationshipChanges) ? obj.relationshipChanges : [];
  for (const item of changes) {
    const row = (item ?? {}) as Record<string, unknown>;
    const a = resolveSubject(asString(row.a, 40), ctx);
    const b = resolveSubject(asString(row.b, 40), ctx);
    if (!a || !b || a === b) {
      dropped.push(`关系变化参与方不在场:${asString(row.a, 20)}/${asString(row.b, 20)}`);
      continue;
    }
    // 两端都必须在场：用户 + 本场角色
    const allowed = new Set([userRef(ctx.userId), ...ctx.characterIds.map(characterRef)]);
    if (!allowed.has(a) || !allowed.has(b)) {
      dropped.push('关系变化涉及场外的人');
      continue;
    }
    const reason = asString(row.reason, 240);
    if (!reason) {
      dropped.push('关系变化缺原因');
      continue;
    }
    const facets = readFacets(row.facets, dropped);
    if (Object.keys(facets).length === 0) {
      dropped.push('关系变化没有任何合法分面');
      continue;
    }
    proposal.relationshipChanges.push({ a, b, facets, reason });
  }

  const unresolved = Array.isArray(obj.unresolved) ? obj.unresolved : [];
  for (const item of unresolved) {
    const row = (item ?? {}) as Record<string, unknown>;
    const who = asString(row.who, 40);
    const characterId = ctx.resolveCharacter(who);
    if (!characterId || !ctx.characterIds.includes(characterId)) {
      dropped.push(`未完成事件的角色不在场:${who}`);
      continue;
    }
    const title = asString(row.title, 120);
    if (!title) {
      dropped.push('未完成事件缺标题');
      continue;
    }
    const kindRaw = asString(row.kind, 20);
    const kind = (UNRESOLVED_KINDS as readonly string[]).includes(kindRaw)
      ? (kindRaw as SettlementUnresolved['kind'])
      : 'topic';
    const detail = asString(row.detail, 200);
    proposal.unresolved.push({ characterId, kind, title, ...(detail ? { detail } : {}) });
  }

  // 明确不接受模型指定"谁知道什么"（认知由参与者规则决定）
  if ('knowledge' in obj) dropped.push('模型不得指定认知归属（已忽略）');
  if ('affinity' in obj) dropped.push('模型给出了 affinity（R7 已移除该分面，已忽略）');

  return { proposal, dropped };
}
