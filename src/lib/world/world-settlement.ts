/**
 * World Settlement（5.0.0 Living World §28 / §29 / §30 / §44）
 *
 * 一句话：**不是每一轮都结算**。
 * "你好"不该产生三个世界事件；只有真正值得留下的事情才结算：
 * 明确承诺、关系明显变化、创建新地点、改世界规则、重要互动、新秘密、
 * 重要冲突、重要决定、用户主动要求记住。
 *
 * 数据流（§30，LLM 永远不能直接改数据库）：
 *   LLM Proposal → Schema 校验 → 业务规则校验 → 事务 → 持久化
 * 解析失败 ⇒ 世界保持原状态（绝不写半截）。
 *
 * 复用（extend, don't duplicate）：关系 / 共同记忆 / 未完成事件这三块沿用
 * Phase 3 就已经过验收的 `validateSettlement`——分面白名单、±10 夹取、
 * 必须带原因、场外的人丢弃、**不接受模型指定认知归属**这些规则一条都不重写。
 * 本模块只新增 §29 要求的另外几类：worldEvents / worldFactChanges / characterStateChanges。
 */
import { db, type WorldEventType, type WorldFactCategory } from '../../db/index';
import { worldEventRepo } from '../../db/world-event-repo';
import { sharedMemoryRepo } from '../../db/shared-memory-repo';
import { knowledgeRepo } from '../../db/knowledge-repo';
import { relationshipRepo } from '../../db/relationship-repo';
import { continuityRepo } from '../../db/continuity-repo';
import { upsertWorldFactWithReconcile } from './world-facts';
import { stateRepo } from '../../db/state-repo';
import { safeParseObject } from '../ai/safe-json';
import { worldChat, type WorldLlmCaller } from './world-ai-client';
import { renderWorldBrief, type WorldContext } from './world-context';
import { validateSettlement, type SettlementRelationshipChange, type SettlementUnresolved } from './scene-consequences';
import { characterRef, stableId, userRef } from './subjects';

/** 结算可以写的事件类型白名单（`life_trace` / `knowledge` 由程序派生，不接受模型指定） */
const SETTLEMENT_EVENT_TYPES: WorldEventType[] = ['interaction', 'shared_memory', 'stage', 'relationship', 'continuity', 'reality'];

export const SETTLEMENT_INSTRUCTION = `你是一段共同生活的记录者。请阅读刚刚发生的这一拍，输出**只包含 JSON** 的结算建议：

{"summary":"这一拍真正发生了什么（一句话，给时间线用）",
 "worldEvents":[{"type":"interaction|shared_memory|stage|relationship|continuity|reality","title":"发生了什么（一句话）","summary":"细节（可省略）","participants":["角色名","用户"],"importance":0.6}],
 "sharedMemories":[{"title":"值得一起记住的一件事（一句话）","summary":"细节（可省略）"}],
 "relationshipChanges":[{"a":"角色名或「用户」","b":"角色名或「用户」","facets":{"trust":3,"conflict":-2},"reason":"为什么变了（人话，一句）"}],
 "continuityChanges":[{"who":"角色名","kind":"promise|plan|topic|conflict|reminder","title":"还没做完/没说清的一件事","detail":"细节（可省略）"}],
 "worldFactChanges":[{"category":"rule|location|atmosphere|history|shared_knowledge|character_fact|custom","content":"这个世界的长期设定（一句自然语言）"}],
 "characterStateChanges":[{"character":"角色名","affinityDelta":3,"moodDelta":0,"lifeFocus":"TA 现在最在意的事","reason":"为什么（人话，一句）"}]}

要求：
- **只写这一拍里真的发生过的事**。没有就留空数组，不要编造。
- 寒暄、打招呼、日常闲聊**不要**写任何东西（worldEvents 也留空）。
- facets 只允许 trust / dependency / conflict / familiarity（-10~10 的增量），**不要写 affinity**。
- 每条 relationshipChanges 必须带 reason；没有原因的不要写。
- **关系不应该每句话都变**：只有真正有意义的事件才写 relationshipChanges / characterStateChanges。
- affinityDelta 只在关系发生**明显**变化时给（-5~5），并且必须带 reason。
- worldFactChanges 只写"这个世界的长期设定"（"这里以后每年这个时候都会下雨"），
  一次性的天气变化不要写在这里。
- participants 只填上面给出的角色名与「用户」。
- 不要输出 JSON 以外的任何文字。`;

export interface SettlementWorldEvent {
  type: WorldEventType;
  title: string;
  summary: string;
  /** SubjectRef 列表（已解析） */
  participants: string[];
  importance: number;
}

export interface SettlementWorldFact {
  category: WorldFactCategory;
  content: string;
  /** 模型提出"这条新设定替换掉了哪一条旧设定"（原文；程序按精确匹配停用旧那条，§101） */
  replaces?: string;
}

export interface SettlementCharacterState {
  characterId: string;
  affinityDelta?: number;
  moodDelta?: number;
  lifeFocus?: string;
  reason: string;
}

export interface WorldSettlementProposal {
  summary?: string;
  /** 兼容旧字段（= memories[0]） */
  memory?: { title: string; summary?: string };
  /** 一次结算可以留下多段共同经历 */
  memories: { title: string; summary?: string }[];
  relationshipChanges: SettlementRelationshipChange[];
  unresolved: SettlementUnresolved[];
  worldEvents: SettlementWorldEvent[];
  worldFacts: SettlementWorldFact[];
  characterStates: SettlementCharacterState[];
  /** 被丢弃的内容（如实记录，便于验收与排查） */
  dropped: string[];
}

export interface SettlementContext {
  userId: string;
  /** 这一拍在场的角色（只有他们能被写进世界层） */
  characterIds: string[];
  /** 角色名 → id */
  resolveCharacter: (name: string) => string | undefined;
  /** 用户这一轮明确在做"世界设定"吗（决定新事实的默认可见性） */
  userIsSettingWorldFact?: boolean;
}

function asString(value: unknown, max: number): string {
  return (typeof value === 'string' ? value.trim() : '').slice(0, max);
}

/** 把"用户"/"你"识别成用户主体；否则按角色名解析（与 relation 校验同一口径） */
function resolveSubject(rawName: string, ctx: SettlementContext): string | null {
  const name = rawName.trim();
  if (!name) return null;
  if (['用户', '你', 'user', 'User'].includes(name)) return userRef(ctx.userId);
  const id = ctx.resolveCharacter(name);
  return id ? characterRef(id) : null;
}

/**
 * Schema + 业务校验。**不接受**任何模型指定的认知归属（§20 的规则由程序决定）。
 * 解析失败时返回空 proposal + dropped，调用方据此"世界保持原状态"。
 */
export function validateWorldSettlement(raw: unknown, ctx: SettlementContext): WorldSettlementProposal {
  const parsed = typeof raw === 'string' ? safeParseObject(raw) : { via: 'json' as const, value: raw, raw: '' };
  const empty: WorldSettlementProposal = {
    relationshipChanges: [], unresolved: [], worldEvents: [], worldFacts: [], characterStates: [], memories: [],
    dropped: parsed.via === 'none' ? ['无法解析结算 JSON'] : [],
  };
  if (parsed.via === 'none' || !parsed.value || typeof parsed.value !== 'object') return empty;
  const obj = parsed.value as Record<string, unknown>;

  // 1) 复用 Phase 3 已验收的关系 / 记忆 / 未完成事件校验（同一份 JSON 对象）
  const { proposal: base, dropped } = validateSettlement(obj, {
    userId: ctx.userId,
    characterIds: ctx.characterIds,
    resolveCharacter: ctx.resolveCharacter,
  });

  const result: WorldSettlementProposal = {
    relationshipChanges: base.relationshipChanges,
    unresolved: base.unresolved,
    memories: base.memories,
    worldEvents: [],
    worldFacts: [],
    characterStates: [],
    dropped: [...empty.dropped, ...dropped],
  };
  if (base.summary) result.summary = base.summary;
  if (base.memory) result.memory = base.memory;

  // 2) 世界事件：类型白名单 + 参与者必须在场 + 必须有标题
  const allowedSubjects = new Set([userRef(ctx.userId), ...ctx.characterIds.map(characterRef)]);
  for (const item of Array.isArray(obj.worldEvents) ? obj.worldEvents : []) {
    const row = (item ?? {}) as Record<string, unknown>;
    const title = asString(row.title, 120);
    if (!title) {
      result.dropped.push('世界事件缺标题');
      continue;
    }
    const typeRaw = asString(row.type, 30);
    if (!(SETTLEMENT_EVENT_TYPES as string[]).includes(typeRaw)) {
      result.dropped.push(`不允许的事件类型:${typeRaw || '(空)'}`);
      continue;
    }
    const participants: string[] = [];
    for (const rawName of Array.isArray(row.participants) ? row.participants : []) {
      const ref = resolveSubject(asString(rawName, 40), ctx);
      if (ref && allowedSubjects.has(ref) && !participants.includes(ref)) participants.push(ref);
    }
    if (participants.length === 0) {
      result.dropped.push(`世界事件没有在场参与者:${title}`);
      continue;
    }
    const importanceRaw = typeof row.importance === 'number' && Number.isFinite(row.importance) ? row.importance : 0.6;
    result.worldEvents.push({
      type: typeRaw as WorldEventType,
      title,
      summary: asString(row.summary, 300),
      participants,
      importance: Math.max(0, Math.min(1, importanceRaw)),
    });
  }

  // 3) 世界设定：分类白名单 + 必须有内容
  const FACT_CATEGORIES: WorldFactCategory[] = ['rule', 'location', 'atmosphere', 'history', 'shared_knowledge', 'character_fact', 'custom'];
  for (const item of Array.isArray(obj.worldFactChanges) ? obj.worldFactChanges : []) {
    const row = (item ?? {}) as Record<string, unknown>;
    const content = asString(row.content, 300);
    if (!content) {
      result.dropped.push('世界设定缺内容');
      continue;
    }
    const categoryRaw = asString(row.category, 30);
    const category = (FACT_CATEGORIES as string[]).includes(categoryRaw) ? (categoryRaw as WorldFactCategory) : 'custom';
    const replaces = asString(row.replaces, 300);
    result.worldFacts.push({ category, content, ...(replaces ? { replaces } : {}) });
  }

  // 4) 角色状态：必须在场 + 必须带原因（§44：只有真正有意义的事件才改）
  for (const item of Array.isArray(obj.characterStateChanges) ? obj.characterStateChanges : []) {
    const row = (item ?? {}) as Record<string, unknown>;
    const characterId = ctx.resolveCharacter(asString(row.character, 40));
    if (!characterId || !ctx.characterIds.includes(characterId)) {
      result.dropped.push(`角色状态变化的人不在场:${asString(row.character, 20)}`);
      continue;
    }
    const reason = asString(row.reason, 200);
    if (!reason) {
      result.dropped.push('角色状态变化缺原因');
      continue;
    }
    const affinityRaw = typeof row.affinityDelta === 'number' && Number.isFinite(row.affinityDelta) ? row.affinityDelta : 0;
    const moodRaw = typeof row.moodDelta === 'number' && Number.isFinite(row.moodDelta) ? row.moodDelta : 0;
    const change: SettlementCharacterState = {
      characterId,
      reason,
      // 好感度增量再夹一层：单拍最多 ±5，防止模型把关系一次拉爆
      ...(affinityRaw !== 0 ? { affinityDelta: Math.max(-5, Math.min(5, Math.round(affinityRaw))) } : {}),
      ...(moodRaw !== 0 ? { moodDelta: Math.max(-3, Math.min(3, Math.round(moodRaw))) } : {}),
    };
    const focus = asString(row.lifeFocus, 48);
    if (focus) change.lifeFocus = focus;
    if (change.affinityDelta == null && change.moodDelta == null && !change.lifeFocus) {
      result.dropped.push('角色状态变化没有任何实际变化');
      continue;
    }
    result.characterStates.push(change);
  }

  // 模型想直接指定"谁知道什么"：**拒绝**，认知由参与者规则决定（与会话/场景同一口径）
  if ('knowledge' in obj || 'knowledgeChanges' in obj) {
    result.dropped.push('模型不得指定认知归属（已忽略；认知按参与者规则授予）');
  }
  return result;
}

export interface SettlementApplyResult {
  worldEventIds: string[];
  memoryIds: string[];
  relationshipEventIds: string[];
  threadIds: string[];
  factIds: string[];
  /** 因冲突被停用的旧设定（撤销时恢复启用） */
  deactivatedFactIds: string[];
  /** 为"为什么变了"写下的生命轨迹 id（撤销时精确回收） */
  lifeEventIds: string[];
  /** 施加在 4.x 角色状态上的增量（撤销时反向回退） */
  stateDeltas: { characterId: string; affinityDelta: number; moodDelta: number }[];
  appliedDropped: string[];
}

/**
 * 把校验后的建议写进世界层（一个事务里）。
 *
 * 幂等：全部用确定性 id（本轮 turnId + 序号），因此重试/重复结算不会产生重复行。
 */
export async function applyWorldSettlement(params: {
  userId: string;
  worldId: string;
  sceneId: string;
  /** 幂等键的根：世界轮次 id */
  turnId: string;
  proposal: WorldSettlementProposal;
  /** 授予认知的角色（这一拍的参与者，亲身经历 ⇒ full + 可提及） */
  characterIds: string[];
  timestamp?: number;
}): Promise<SettlementApplyResult> {
  const { userId, worldId, turnId, proposal } = params;
  const now = params.timestamp ?? Date.now();
  const result: SettlementApplyResult = {
    worldEventIds: [], memoryIds: [], relationshipEventIds: [], threadIds: [], factIds: [],
    deactivatedFactIds: [], lifeEventIds: [], stateDeltas: [],
    appliedDropped: [...proposal.dropped],
  };

  const participantsAll = [userRef(userId), ...params.characterIds.map(characterRef)];

  await db.transaction(
    'rw',
    [db.worldEvents, db.sharedMemories, db.characterKnowledge, db.relationshipStates, db.relationshipEvents, db.worldFacts, db.continuityThreads, db.memorySourceTombstones],
    async () => {
      // 1) 世界事件（每个事件一条，id 由 userId+worldId+sourceType+sourceId 确定性生成 ⇒ 幂等）
      for (let i = 0; i < proposal.worldEvents.length; i += 1) {
        const event = proposal.worldEvents[i];
        const id = await worldEventRepo.create({
          userId,
          worldId,
          type: event.type,
          title: event.title,
          summary: event.summary,
          participants: event.participants,
          timestamp: now,
          importance: event.importance,
          sourceType: 'turn',
          sourceId: `${turnId}:${i}`,
          // 世界事件是"你们之间发生的事"：只让在场的人知道，不擅自扩散到全世界
          visibility: 'selected',
          visibleTo: params.characterIds,
          resolved: true,
          tags: ['你们共同经历的'],
          meta: { turnId, sceneId: params.sceneId },
        });
        result.worldEventIds.push(id);
        // 认知：**亲身经历 ⇒ 参与者获得**（不接受模型指定）
        for (const ref of event.participants) {
          if (!ref.startsWith('c:')) continue;
          const characterId = ref.slice(2);
          if (!params.characterIds.includes(characterId)) continue;
          await knowledgeRepo.grantForEvent({ userId, worldId, characterId, eventId: id, knowledgeLevel: 'full', canMention: true });
        }
      }

      // 2) 共同记忆（与事件互相引用；id 同样是确定性的）
      const memories = proposal.memories.length > 0
        ? proposal.memories
        : (proposal.memory ? [proposal.memory] : []);
      if (memories.length > 0) {
        for (let i = 0; i < memories.length; i += 1) {
          const memory = memories[i];
          const id = await sharedMemoryRepo.create({
            userId,
            worldId,
            title: memory.title,
            summary: memory.summary ?? '',
            participants: participantsAll,
            sourceType: 'turn',
            // 一段记忆一个来源 id（`turnId` / `turnId:1`…），因此同一轮的多段记忆不会互相覆盖
            sourceId: i === 0 ? turnId : `${turnId}:${i}`,
            importance: 0.7,
            visibility: 'selected',
            visibleTo: params.characterIds,
            tags: ['你们一起经历的'],
            createdAt: now,
          });
          result.memoryIds.push(id);
        }
        if (result.worldEventIds.length > 0) {
          await worldEventRepo.update(result.worldEventIds[0], { memoryIds: result.memoryIds });
        }
      }

      // 3) 关系分面（每条带原因；数值已被校验层夹过）
      for (let i = 0; i < proposal.relationshipChanges.length; i += 1) {
        const change = proposal.relationshipChanges[i];
        try {
          const applied = await relationshipRepo.applyEvent({
            userId,
            worldId,
            a: change.a,
            b: change.b,
            facets: change.facets,
            reason: change.reason,
            ...(result.worldEventIds[i] ? { sourceEventId: result.worldEventIds[i] } : {}),
            sourceType: 'turn',
            idempotencyKey: `${turnId}:rel:${i}`,
            createdAt: now,
          });
          if (applied.applied) result.relationshipEventIds.push(applied.event.id);
        } catch {
          result.appliedDropped.push('关系变化写入失败');
        }
      }

      // 4) 未完成的事（挂到具体角色上）
      for (const item of proposal.unresolved) {
        try {
          const before = await continuityRepo.getOpenByCharacter(item.characterId, userId);
          if (before.some((t) => t.title === item.title)) continue;
          await continuityRepo.create({
            characterId: item.characterId,
            userId,
            kind: item.kind,
            title: item.title,
            ...(item.detail ? { detail: item.detail } : {}),
            origin: 'ai',
            sourceWorldEventId: result.worldEventIds[0],
          });
          // 无论创建前是否已满 8 条都要追踪新线索：满了时最旧的会被自动归档，
          // 但新线索本身仍然存在，撤销时若漏掉它的 id 就回收不干净。
          const after = await continuityRepo.getOpenByCharacter(item.characterId, userId);
          const created = after.find((t) => t.title === item.title);
          if (created) result.threadIds.push(created.id);
        } catch {
          result.appliedDropped.push('未完成事件写入失败');
        }
      }

      // 5) 世界设定（长期规则 / 地点 / 角色事实……）
      for (let i = 0; i < proposal.worldFacts.length; i += 1) {
        const fact = proposal.worldFacts[i];
        const written = await upsertWorldFactWithReconcile({
          userId,
          worldId,
          category: fact.category,
          content: fact.content,
          // 规则与地点是这个世界的客观设定（世界可见）；角色事实/氛围保守处理（只给在场的人）
          visibility: fact.category === 'rule' || fact.category === 'location' || fact.category === 'history' ? 'world' : 'selected',
          ...(fact.category === 'rule' || fact.category === 'location' || fact.category === 'history'
            ? {}
            : { visibleTo: params.characterIds }),
          sourceType: 'settlement',
          sourceId: `${turnId}:fact:${i}`,
          ...(fact.replaces ? { replaces: fact.replaces } : {}),
        });
        result.factIds.push(written.factId);
        result.deactivatedFactIds.push(...written.deactivated);
      }
    },
  );

  // 6) 角色状态（4.x 的 CharacterState 是**好感度的唯一来源**，R7）：事务外调用，便于复用既有里程碑逻辑
  for (const change of proposal.characterStates) {
    try {
      const affinityDelta = change.affinityDelta ?? 0;
      const moodDelta = change.moodDelta ?? 0;
      if (affinityDelta || moodDelta) {
        await stateRepo.adjust(change.characterId, userId, affinityDelta, moodDelta);
      }
      // 把"为什么变了"写成生命轨迹（世界层据此派生一条带原因的关系变化史）。
      // 用确定性 id ⇒ 撤销时能精确删掉这一条，而不会误删用户自己的轨迹。
      const lifeEventId = stableId('le', turnId, change.characterId);
      await stateRepo.recordLifeEvent(change.characterId, userId, {
        id: lifeEventId,
        type: 'relationship',
        title: change.lifeFocus ?? change.reason.slice(0, 48),
        detail: change.reason,
        source: 'chat',
      });
      result.lifeEventIds.push(lifeEventId);
      if (affinityDelta || moodDelta) {
        result.stateDeltas.push({ characterId: change.characterId, affinityDelta, moodDelta });
      }
    } catch {
      result.appliedDropped.push('角色状态写入失败');
    }
  }

  return result;
}

export interface SettleTurnResult {
  proposal: WorldSettlementProposal;
  applied: SettlementApplyResult;
  llmCalls: number;
  error?: string;
}

/**
 * 一次结算调用 + 校验 + 落库（§29）。
 * 调用方负责决定"这一轮到底要不要结算"（§28：由 Director 的 shouldSettle / worldChanges 决定）。
 */
export async function settleWorldTurn(params: {
  ctx: WorldContext;
  actionText: string;
  /** 这一拍实际呈现给用户的内容（结算的唯一依据） */
  transcript: string;
  turnId: string;
  call?: WorldLlmCaller;
}): Promise<SettleTurnResult> {
  const { ctx } = params;
  const nameOf = ctx.nameOf;
  const ctxForValidation: SettlementContext = {
    userId: ctx.userId,
    characterIds: ctx.presence,
    resolveCharacter: (name) => ctx.presence.find((id) => nameOf(id) === name),
  };

  try {
    const res = await worldChat({
      messages: [
        { role: 'system', content: `${SETTLEMENT_INSTRUCTION}\n\n${renderWorldBrief(ctx, 12)}\n\n在场角色：${ctx.presence.map((id) => nameOf(id)).join('、') || '（无）'}（用户也在场）` },
        { role: 'user', content: `用户说的是：${params.actionText}\n\n这一拍实际发生的内容：\n${params.transcript.slice(-6000)}` },
      ],
      temperature: 0.3,
      disableThinking: true,
      jsonMode: true,
      maxTokens: 1200,
      timeoutMs: 90_000,
    }, params.call);

    const proposal = validateWorldSettlement(res.content ?? '', ctxForValidation);
    const applied = await applyWorldSettlement({
      userId: ctx.userId,
      worldId: ctx.worldId,
      sceneId: ctx.sceneId,
      turnId: params.turnId,
      proposal,
      characterIds: ctx.presence,
    });
    return { proposal, applied, llmCalls: 1 };
  } catch (err) {
    // 结算失败**不影响**用户已经看到的内容（§58）；世界保持原状态
    const empty: WorldSettlementProposal = {
      relationshipChanges: [], unresolved: [], worldEvents: [], worldFacts: [], characterStates: [], memories: [], dropped: [],
    };
    return {
      proposal: empty,
      applied: {
        worldEventIds: [], memoryIds: [], relationshipEventIds: [], threadIds: [], factIds: [],
        deactivatedFactIds: [], lifeEventIds: [], stateDeltas: [], appliedDropped: [],
      },
      llmCalls: 1,
      error: (err as Error)?.message ?? 'server:error',
    };
  }
}
