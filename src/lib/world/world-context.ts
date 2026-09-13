/**
 * World Context Builder（5.0.0 Living World §22 Stage B / §59 Context Layers / §20 知识隔离）
 *
 * 这个模块解决两个**必须分开**的问题：
 *
 * 1. **Director / Narrator 知道世界全貌**（L0~L3、L5、L9）
 *    —— 但它们不扮演角色，所以拿到的是"世界事实层"的渲染结果。
 * 2. **Actor 只知道 TA 应该知道的**（§20）
 *    —— 每个角色单独构建一份私有上下文，四道数据闸门：
 *      · 世界设定：`worldFactRepo.listForCharacter`（visibility 硬过滤）
 *      · 共同记忆：`selectRecallableSharedMemories`（可见性 + 认知 + 相关度）
 *      · 日记：`listVisibleFor ∩ listMentionableDiaryIds`（与私聊完全同一口径）
 *      · 场景：`selectRecallableScenes`（参与过 + 认知 + 可见性）
 *    角色**不会**因为系统知道某件事就自动知道。
 *
 * 本模块**零 LLM 调用**：它只读数据库、拼字符串。
 *
 * 上下文分层（§59）与这里的对应关系：
 *   L0 World Rules / L1 地点·时间·氛围 / L2 当前人物 / L3 当前片段最近内容
 *   L4 角色自己的身份（Actor 侧注入）
 *   L5 关系状态 / L6 CharacterKnowledge / L7 Shared Memories
 *   L8 Continuity Threads / L9 World Events / L10 会话摘要（Actor 侧由既有 chat 上下文补）
 */
import type { Character, SharedMemory, WorldEvent, WorldFact, WorldScene, WorldSceneEntry, ContinuityThread, RelationshipState } from '../../db/index';
import { worldFactRepo } from '../../db/world-fact-repo';
import { worldEventRepo } from '../../db/world-event-repo';
import { worldSceneRepo } from '../../db/world-scene-repo';
import { knowledgeRepo } from '../../db/knowledge-repo';
import { continuityRepo } from '../../db/continuity-repo';
import { relationshipRepo } from '../../db/relationship-repo';
import { diaryRepo } from '../../db/diary-repo';
import { characterRef, userRef } from './subjects';
import { selectRecallableSharedMemories } from './recall';
import { selectRecallableScenes } from './scene-recall';
import { listMentionableDiaryIds } from './diary-visibility';
import { describeFacets, FACET_LABEL } from './relationships';

/** Context Builder 的输入（全部是已经取好的实体，避免在内部再查一遍角色） */
export interface WorldContextParams {
  userId: string;
  worldId: string;
  scene: WorldScene;
  /** 世界里的全部角色（用于名字解析；不在场的也可能被提到） */
  characters: Character[];
  /** 当前在场的角色 id（默认取 scene.characterIds） */
  presence?: string[];
  /** L3 取最近多少条世界流 */
  recentLimit?: number;
}

export interface CharacterMemory {
  characterId: string;
  name: string;
  /** TA 知道并且可以提起的共同记忆 */
  memories: SharedMemory[];
  /** TA 能看到的日记（已过认知闸门） */
  diaries: { id: string; date: string; title: string; content: string }[];
  /** TA 亲身参与过、且可以提起的已完成片段 */
  scenes: { id: string; title: string; place: string; summary: string }[];
  /** TA 知道的世界事实（可见性过滤后的设定） */
  facts: WorldFact[];
  /** TA 与用户之间当前的关系状态（自然语言渲染） */
  userRelation?: RelationshipState;
  /** TA 未完成的、与用户之间的事 */
  threads: ContinuityThread[];
}

export interface WorldContext {
  userId: string;
  worldId: string;
  sceneId: string;
  place: string;
  timeLabel: string;
  mood: string;
  /** 当前在场角色 id（顺序即用户看到的顺序） */
  presence: string[];
  /** 世界级设定（visibility='world'）——只有这一层是"世界共有"的 */
  worldFacts: WorldFact[];
  /** L3 最近世界流（新 → 旧） */
  recentEntries: WorldSceneEntry[];
  /** L9 最近世界事件 */
  recentEvents: WorldEvent[];
  /** L8 与在场角色相关的未完成的事 */
  openThreads: ContinuityThread[];
  /** 每个在场角色的私有上下文 */
  perCharacter: Record<string, CharacterMemory>;
  /** §27 一致性守护用：这个世界里存在的"秘密"（只有守门人能看到） */
  secrets: { ownerCharacterId: string; title: string }[];
  nameOf: (characterId: string) => string;
}

function presenceOf(scene: WorldScene, override?: string[]): string[] {
  const list = override ?? scene.characterIds;
  return [...new Set(list)];
}

/**
 * 构建一份世界上下文。**零 LLM 调用**。
 */
export async function buildWorldContext(params: WorldContextParams): Promise<WorldContext> {
  const { userId, worldId, scene } = params;
  const presence = presenceOf(scene, params.presence);
  const nameOf = (id: string) => params.characters.find((c) => c.id === id)?.name ?? '某人';

  const [worldFacts, entries, recentEvents, allThreads] = await Promise.all([
    worldFactRepo.listWorldLevel(worldId, 16),
    worldSceneRepo.listEntries(scene.id, { limit: Math.max(20, params.recentLimit ?? 60) }),
    worldEventRepo.getRecent(worldId, 12),
    continuityRepo.getOpenByUser(userId),
  ]);

  const recentEntries = [...entries].reverse();
  const openThreads = allThreads.filter((t) => presence.includes(t.characterId));

  const perCharacter: Record<string, CharacterMemory> = {};
  const secrets: { ownerCharacterId: string; title: string }[] = [];

  for (const characterId of presence) {
    const [facts, memories, scenes, diaryVisible, threads, relation] = await Promise.all([
      worldFactRepo.listForCharacter(worldId, characterId, 10),
      selectRecallableSharedMemories({ worldId, characterId, limit: 3 }),
      selectRecallableScenes({ worldId, characterId, limit: 2 }),
      diaryRepo.listVisibleFor(characterId, userId, 20),
      Promise.resolve(openThreads.filter((t) => t.characterId === characterId)),
      relationshipRepo.getStateFor(userRef(userId), characterRef(characterId), worldId),
    ]);

    // 日记：可见 ∩ 可提起（与私聊完全同一口径，避免"世界页能说、私聊不能说"）
    const mentionable = await listMentionableDiaryIds(userId, worldId, characterId);
    const diaries = diaryVisible
      .filter((d) => mentionable.has(d.id))
      .slice(0, 3)
      .map((d) => ({ id: d.id, date: d.date, title: d.title, content: d.content.slice(0, 400) }));

    perCharacter[characterId] = {
      characterId,
      name: nameOf(characterId),
      memories: memories.map((m) => m.memory),
      diaries,
      scenes: scenes.map((s) => ({
        id: s.scene.id,
        title: s.scene.title,
        place: s.scene.place,
        summary: s.event.summary || s.scene.title,
      })),
      facts,
      ...(relation ? { userRelation: relation } : {}),
      threads,
    };

    // 秘密：TA 守着不说的事（只有一致性守护看得到）
    const owned = await knowledgeRepo.listSecretsOwnedBy(characterId, worldId);
    for (const row of owned) {
      const event = await worldEventRepo.getById(row.eventId);
      if (event) secrets.push({ ownerCharacterId: characterId, title: event.title });
    }
  }

  return {
    userId,
    worldId,
    sceneId: scene.id,
    place: scene.place,
    timeLabel: scene.timeLabel,
    mood: scene.mood,
    presence,
    worldFacts,
    recentEntries,
    recentEvents,
    openThreads,
    perCharacter,
    secrets,
    nameOf,
  };
}

/* ------------------------------------------------------------------ *
 * 渲染：给 Director / Narrator 的"世界全貌"
 * ------------------------------------------------------------------ */

/** 世界流条目 → 一行可读文本（旁白/对白/动作/用户行动各有写法） */
export function entryLine(entry: WorldSceneEntry, nameOf: (id: string) => string): string {
  switch (entry.kind) {
    case 'narration':
      return `（旁白）${entry.content}`;
    case 'action':
      return `（${nameOf(entry.speakerId ?? '')}的动作）${entry.content}`;
    case 'dialogue':
      return `${nameOf(entry.speakerId ?? '')}：${entry.content}`;
    case 'user_input':
      return `（你）${entry.content}`;
    case 'choice':
      return `（你选择）${entry.content}`;
    case 'suggestion':
      return `（灵感建议）${entry.content}`;
    default:
      return `（${entry.content}）`;
  }
}

/** L0 + L1：世界规则与"此刻" */
export function renderWorldLayer(ctx: WorldContext): string {
  const lines: string[] = [];
  const rules = ctx.worldFacts.filter((f) => f.category === 'rule');
  const places = ctx.worldFacts.filter((f) => f.category === 'location');
  const atmos = ctx.worldFacts.filter((f) => f.category === 'atmosphere');
  const history = ctx.worldFacts.filter((f) => f.category === 'history' || f.category === 'shared_knowledge' || f.category === 'custom');

  lines.push(`【此刻】${ctx.place} · ${ctx.timeLabel} · 气氛：${ctx.mood}`);
  lines.push(`【在场】${ctx.presence.map((id) => ctx.nameOf(id)).join('、') || '只有你'}（用户也在场）`);
  if (rules.length) lines.push(`【这个世界不变的规则】\n${rules.map((f) => `- ${f.content}`).join('\n')}`);
  if (places.length) lines.push(`【这个世界的地方】\n${places.map((f) => `- ${f.content}`).join('\n')}`);
  if (atmos.length) lines.push(`【这个世界的氛围】\n${atmos.map((f) => `- ${f.content}`).join('\n')}`);
  if (history.length) lines.push(`【这个世界的过往与共识】\n${history.map((f) => `- ${f.content}`).join('\n')}`);
  return lines.join('\n');
}

/** 关系分面 → 一句人话（没有记录时返回空串，绝不编） */
function relationText(state: RelationshipState | undefined): string {
  return describeFacets(state, 3).map((r) => r.text).join('，');
}

/** L5：用户 ↔ 在场角色 的关系（自然语言，不含数字） */
export function renderRelationLayer(ctx: WorldContext): string {
  const lines: string[] = [];
  for (const id of ctx.presence) {
    const text = relationText(ctx.perCharacter[id]?.userRelation);
    if (!text) continue;
    lines.push(`${ctx.nameOf(id)} 与你：${text}`);
  }
  return lines.length ? `【你们现在的关系】\n${lines.join('\n')}` : '';
}

/** L8：还没做完的事 */
export function renderThreadLayer(ctx: WorldContext): string {
  if (ctx.openThreads.length === 0) return '';
  return `【还没做完 / 没说清的事】\n${ctx.openThreads
    .slice(0, 6)
    .map((t) => `- ${ctx.nameOf(t.characterId)}：${t.title}${t.detail ? `（${t.detail}）` : ''}`)
    .join('\n')}`;
}

/** L9：最近发生过的事（世界层都知道的） */
export function renderEventLayer(ctx: WorldContext): string {
  if (ctx.recentEvents.length === 0) return '';
  return `【最近发生过的事】\n${ctx.recentEvents
    .slice(0, 6)
    .map((e) => `- ${e.title}${e.summary ? `：${e.summary}` : ''}`)
    .join('\n')}`;
}

/** L3：当前片段最近内容（给 Director 判断"现在到哪了"） */
export function renderRecentLayer(ctx: WorldContext, limit = 16): string {
  const rows = ctx.recentEntries.slice(0, limit).reverse();
  if (rows.length === 0) return '【这一刻刚开始，还没有人说话】';
  return `【你们刚刚经历的这一刻】\n${rows.map((e) => entryLine(e, ctx.nameOf)).join('\n')}`;
}

/** Director 用的完整世界层（不含任何角色的私有信息） */
export function renderWorldBrief(ctx: WorldContext, recentLimit = 16): string {
  return [
    renderWorldLayer(ctx),
    renderRelationLayer(ctx),
    renderThreadLayer(ctx),
    renderEventLayer(ctx),
    renderRecentLayer(ctx, recentLimit),
  ].filter(Boolean).join('\n\n');
}

/* ------------------------------------------------------------------ *
 * 渲染：给某个 Actor 的私有上下文（§20 / §23）
 * ------------------------------------------------------------------ */

/**
 * 角色私有上下文。**只包含 TA 能知道的东西**。
 * 注意这里从不传 `renderWorldLayer`（那一层含全部世界设定），
 * 而是用 `perCharacter[id].facts`（已过可见性闸门）。
 */
export function renderCharacterContext(ctx: WorldContext, characterId: string): string {
  const memory = ctx.perCharacter[characterId];
  if (!memory) return '';
  const lines: string[] = [];
  lines.push(`【你此刻在哪里】${ctx.place} · ${ctx.timeLabel} · 气氛：${ctx.mood}`);
  lines.push(`【在场的人】${ctx.presence.map((id) => ctx.nameOf(id)).join('、')}，以及用户`);

  const rules = memory.facts.filter((f) => f.category === 'rule');
  const others = memory.facts.filter((f) => f.category !== 'rule');
  if (rules.length) lines.push(`【你知道的世界规则】\n${rules.map((f) => `- ${f.content}`).join('\n')}`);
  if (others.length) lines.push(`【你知道的设定】\n${others.map((f) => `- ${f.content}`).join('\n')}`);
  if (memory.userRelation) {
    const text = relationText(memory.userRelation);
    if (text) lines.push(`【你和用户现在的关系】${text}`);
  }
  if (memory.memories.length) {
    lines.push(`【你们一起经历过的事（你亲身在场）】\n${memory.memories.map((m) => `- ${m.title}${m.summary ? `：${m.summary}` : ''}`).join('\n')}`);
  }
  if (memory.scenes.length) {
    lines.push(`【你参与过的片段】\n${memory.scenes.map((s) => `- ${s.title}（${s.place}）：${s.summary}`).join('\n')}`);
  }
  if (memory.diaries.length) {
    lines.push(`【用户亲口告诉过你的生活】\n${memory.diaries.map((d) => `- ${d.date} ${d.title}：${d.content}`).join('\n')}`);
  }
  if (memory.threads.length) {
    lines.push(`【你心里还记着的事】\n${memory.threads.map((t) => `- ${t.title}${t.detail ? `（${t.detail}）` : ''}`).join('\n')}`);
  }
  return lines.join('\n');
}

/** 一致性守护用：这个世界里"存在但只有部分人知道"的事（§27） */
export function renderGuardContext(ctx: WorldContext): string {
  const lines: string[] = [];
  if (ctx.secrets.length) {
    lines.push(`【秘密（只有当事人知道，其他人不可以知道）】\n${ctx.secrets.map((s) => `- ${ctx.nameOf(s.ownerCharacterId)} 的：${s.title}`).join('\n')}`);
  }
  const facts = ctx.worldFacts.map((f) => `- [${f.category}] ${f.content}`);
  if (facts.length) lines.push(`【世界设定】\n${facts.join('\n')}`);
  const facetNames = Object.values(FACET_LABEL).join(' / ');
  lines.push(`【允许的关系分面】${facetNames}`);
  return lines.join('\n');
}
