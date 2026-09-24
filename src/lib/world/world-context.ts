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
import { db, type Character, type SharedMemory, type WorldEvent, type WorldFact, type WorldObject, type WorldScene, type WorldSceneEntry, type ContinuityThread, type RelationshipState } from '../../db/index';
import { worldFactRepo } from '../../db/world-fact-repo';
import { worldEventRepo } from '../../db/world-event-repo';
import { sceneEntriesAvailableToAudience, worldSceneRepo } from '../../db/world-scene-repo';
import { knowledgeRepo } from '../../db/knowledge-repo';
import { continuityRepo } from '../../db/continuity-repo';
import { relationshipRepo } from '../../db/relationship-repo';
import { diaryRepo } from '../../db/diary-repo';
import { characterRef, userRef } from './subjects';
import { selectRecallableSharedMemories } from './recall';
import { recallCharacterMemory } from '../character-memory';
import { selectRecallableScenes } from './scene-recall';
import { listMentionableDiaryIds } from './diary-visibility';
import { describeFacets, FACET_LABEL } from './relationships';
import { buildHiddenUserProfile } from './user-profile';
import { worldObjectRepo } from '../../db/world-object-repo';
import { todoRepo } from '../../db/todo-repo';
import { isVisibleToCharacter } from './visibility';
import type { WorldConversationState, WorldVisualState } from './world-immersion';
import { deriveWorldVisualState, directorConversationHints, emptyConversationState } from './world-immersion';

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
  /** 当前用户输入，只用于从该角色已有的用户记忆中挑选相关参考 */
  userText?: string;
}

export interface CharacterMemory {
  crossChannelMemory?: string;
  /** 用户明确回忆旧事时，为该角色单独检索且通过认知闸门的历史。 */
  historicalRecall?: { date: string; text: string }[];
  persona?: string;
  characterId: string;
  name: string;
  /** TA 知道并且可以提起的共同记忆 */
  memories: SharedMemory[];
  /** TA 能看到的日记（已过认知闸门） */
  diaries: { id: string; date: string; title: string; content: string }[];
  /** TA 知道且可提起的非公开世界事件；世界公开事件由导演层统一提供。 */
  events: WorldEvent[];
  /** TA 亲身参与过、且可以提起的已完成片段 */
  scenes: { id: string; title: string; place: string; summary: string }[];
  /** TA 知道的世界事实（可见性过滤后的设定） */
  facts: WorldFact[];
  /** TA 与用户之间当前的关系状态（自然语言渲染） */
  userRelation?: RelationshipState;
  /** TA 未完成的、与用户之间的事 */
  threads: ContinuityThread[];
  /** 只由该角色自己的 4.x 用户记忆整理出的隐藏画像，不跨角色共享 */
  userProfile?: string;
  /** 用户明确告诉 TA 的现实待办；私密待办永远不在这里。 */
  todos: { title: string; dueDate?: string; dueTime?: string; note?: string }[];
}

export interface WorldContext {
  sceneGoal?: string;
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
  /** 仅含所有在场角色都知道、都可提起的旧事，供导演规划使用。 */
  recalledHistory?: { date: string; text: string }[];
  /** 当前地点留下的可观察物件；它们是世界状态，不是聊天记忆。 */
  objects: WorldObject[];
  /** L8 与在场角色相关的未完成的事 */
  openThreads: ContinuityThread[];
  /** 每个在场角色的私有上下文 */
  perCharacter: Record<string, CharacterMemory>;
  /** §27 一致性守护用：这个世界里存在的"秘密"（只有守门人能看到） */
  secrets: { ownerCharacterId: string; title: string }[];
  nameOf: (characterId: string) => string;
  /** 短期导演状态：用于换题、主动发起和意象冷却。 */
  conversation?: WorldConversationState;
  /** 当前场景的稳定视觉状态。 */
  visual?: WorldVisualState;
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
  const world = await db.worlds.get(worldId);
  if (!world || world.userId !== userId || scene.userId !== userId || scene.worldId !== worldId) {
    throw new Error('world-context:scene-owner-mismatch');
  }
  const presence = presenceOf(scene, params.presence);
  // In a shared scene every spoken line is heard by all present characters.
  // A private actor prompt is not a privacy boundary: the actor may repeat it.
  const sharedAudience = presence.length > 1;
  const nameOf = (id: string) => params.characters.find((c) => c.id === id)?.name ?? '某人';

  const [worldFacts, entries, recentEvents, allThreads, objects] = await Promise.all([
    worldFactRepo.listWorldLevel(worldId, 16, userId),
    worldSceneRepo.listRecentEntries(scene.id, Math.max(20, params.recentLimit ?? 60)),
    worldEventRepo.getRecent(worldId, 30, userId).then((rows) => rows.filter((event) => event.visibility === 'world')),
    continuityRepo.getOpenByUser(userId),
    scene.locationId ? worldObjectRepo.listForLocation(worldId, scene.locationId, userId) : Promise.resolve([]),
  ]);

  const recentEntries = sceneEntriesAvailableToAudience([...entries].reverse(), scene, presence);
  const openThreads = allThreads.filter((t) => presence.includes(t.characterId));

  const perCharacter: Record<string, CharacterMemory> = {};
  const secrets: { ownerCharacterId: string; title: string }[] = [];

  for (const characterId of presence) {
    const participant = scene.state.participants?.find((p) => p.characterId === characterId);
    const entryMemoryMode = participant?.entryMemoryMode ?? scene.state.entryMemoryMode ?? 'memory';
    const carryMemory = entryMemoryMode !== 'present';
    const [facts, memories, scenes, diaryVisible, threads, relation, userMemories, todos, knownRows] = await Promise.all([
      worldFactRepo.listForCharacter(worldId, characterId, 10, userId),
      carryMemory && !sharedAudience ? selectRecallableSharedMemories({ userId, worldId, characterId, limit: 3 }) : Promise.resolve([]),
      carryMemory && !sharedAudience ? selectRecallableScenes({ userId, worldId, characterId, limit: 2 }) : Promise.resolve([]),
      carryMemory && !sharedAudience ? diaryRepo.listVisibleFor(characterId, userId, 20) : Promise.resolve([]),
      carryMemory && !sharedAudience ? Promise.resolve(openThreads.filter((t) => t.characterId === characterId)) : Promise.resolve([]),
      sharedAudience ? Promise.resolve(undefined) : relationshipRepo.getStateFor(userRef(userId), characterRef(characterId), worldId),
      carryMemory && !sharedAudience
        ? db.memories.where('characterId').equals(characterId).toArray().then((rows) => rows
          .filter((row) => row.userId === userId)
          .filter((row) => (row.status ?? 'active') === 'active')
          .sort((a, b) => b.createdAt - a.createdAt)
          // 让 buildHiddenUserProfile 从完整候选集中按相关性挑选；固定取最近 18 条
          // 会让很重要但较早的用户事实在星域里永久消失。
          )
      : Promise.resolve([]),
      carryMemory && !sharedAudience ? todoRepo.visibleForCharacter(userId, characterId, 5) : Promise.resolve([]),
      carryMemory && !sharedAudience ? knowledgeRepo.listKnownBy(characterId, worldId, { minLevel: 'partial', limit: 30, userId }) : Promise.resolve([]),
    ]);

    const knownEvents = carryMemory && knownRows.length
      ? (await worldEventRepo.getByIds(knownRows.filter((row) => row.canMention).map((row) => row.eventId)))
        .filter((event) => event.userId === userId && event.worldId === worldId && event.visibility !== 'world' && isVisibleToCharacter(event, characterId))
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 6)
      : [];

    // 日记：可见 ∩ 可提起（与私聊完全同一口径，避免"世界页能说、私聊不能说"）
    const mentionable = carryMemory && !sharedAudience
      ? await listMentionableDiaryIds(userId, worldId, characterId)
      : new Set<string>();
    const diaries = diaryVisible
      .filter((d) => mentionable.has(d.id))
      .slice(0, 3)
      .map((d) => ({ id: d.id, date: d.date, title: d.title, content: d.content.slice(0, 400) }));

    perCharacter[characterId] = {
      crossChannelMemory: carryMemory ? (await recallCharacterMemory({
        userId, characterId, query: params.userText, audience: presence,
        // In a shared scene, world memories pass the existing all-listeners
        // knowledge/visibility gate; private one-to-one chat never does.
        sources: sharedAudience ? ['group', 'moment', 'todo', 'world', 'diary'] : ['chat', 'group', 'moment', 'todo', 'diary'],
        worldId, excludeSceneId: scene.id, budget: 2200,
      })).text : '',
      persona: params.characters.find((character) => character.id === characterId)?.systemPrompt,
      characterId,
      name: nameOf(characterId),
      memories: memories.map((m) => m.memory),
      diaries,
      events: knownEvents,
      scenes: scenes.map((s) => ({
        id: s.scene.id,
        title: s.scene.title,
        place: s.scene.place,
        summary: s.event.summary || s.scene.title,
      })),
      facts: sharedAudience ? facts.filter((fact) => fact.visibility === 'world') : facts,
      ...(relation && relation.userId === userId ? { userRelation: relation } : {}),
      threads,
      ...(carryMemory && !sharedAudience ? { userProfile: buildHiddenUserProfile(userMemories, params.userText) } : {}),
      todos: todos.map((todo) => ({ title: todo.title, ...(todo.dueDate ? { dueDate: todo.dueDate } : {}), ...(todo.dueTime ? { dueTime: todo.dueTime } : {}), ...(todo.note ? { note: todo.note.slice(0, 120) } : {}) })),
    };

    // 秘密：TA 守着不说的事（只有一致性守护看得到）
    const owned = (await knowledgeRepo.listSecretsOwnedBy(characterId, worldId)).filter((row) => row.userId === userId);
    for (const row of owned) {
      const event = await worldEventRepo.getById(row.eventId);
      if (event && event.userId === userId && event.worldId === worldId) secrets.push({ ownerCharacterId: characterId, title: event.title });
    }
  }

  return {
    sceneGoal: scene.state.sceneGoal,
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
    objects,
    openThreads,
    perCharacter,
    secrets,
    nameOf,
    conversation: scene.state.conversation ?? emptyConversationState(),
    visual: scene.state.visual ?? deriveWorldVisualState(scene),
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
  if (ctx.sceneGoal) lines.push(`【这一段的方向】${ctx.sceneGoal}。这是可改变的尝试，不是必须强迫用户完成的任务。`);
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
  return `【未完事项】\n在场角色各自记得与自己有关的未完事项；具体内容只提供给对应角色，不能由导演替他们泄露。`;
}

/** L9：最近发生过的事（世界层都知道的） */
export function renderEventLayer(ctx: WorldContext): string {
  if (ctx.recentEvents.length === 0) return '';
  return `【最近发生过的事】\n${ctx.recentEvents
    .slice(0, 6)
    .map((e) => `- ${e.title}${e.summary ? `：${e.summary}` : ''}`)
    .join('\n')}`;
}

function renderRecalledHistory(ctx: WorldContext): string {
  if (!ctx.recalledHistory?.length) return '';
  return `【用户正在回忆的共同旧事】\n${ctx.recalledHistory.map((hit) => `- ${hit.date} ${hit.text}`).join('\n')}\n这只是可核对的历史线索；只沿着用户问到的内容回应，不要把别的旧话题强行带回来。`;
}

/** L1.5：让角色知道地点里确实存在什么，以及哪些东西已经被改变。 */
export function renderObjectLayer(ctx: WorldContext): string {
  if (ctx.objects.length === 0) return '';
  return `【眼前可以观察到的物件】\n${ctx.objects.slice(0, 8).map((object) => `- ${object.name}：${object.description}${object.lastAction ? `（${object.lastAction}）` : ''}`).join('\n')}`;
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
    renderRecalledHistory(ctx),
    renderObjectLayer(ctx),
    renderRecentLayer(ctx, recentLimit),
    directorConversationHints(ctx.conversation),
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
  if (ctx.objects.length) {
    lines.push(`【你此刻能观察到的现场】\n${ctx.objects.slice(0, 8).map((object) => `- ${object.name}：${object.description}${object.lastAction ? `（${object.lastAction}）` : ''}`).join('\n')}`);
  }

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
  if (memory.events.length) {
    lines.push(`【你知道的其他世界记录】\n${memory.events.map((event) => `- ${event.title}${event.summary ? `：${event.summary}` : ''}`).join('\n')}`);
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
  if (memory.todos.length) {
    lines.push(`【用户明确告诉你的待办】\n${memory.todos.map((todo) => `- ${todo.title}${todo.dueDate ? `（${todo.dueDate}${todo.dueTime ? ` ${todo.dueTime}` : ''}）` : ''}${todo.note ? `：${todo.note}` : ''}`).join('\n')}\n只在话题相关时自然提起，不要像任务管理器一样盘问。`);
  }
  if (memory.userProfile) lines.push(memory.userProfile);
  if (memory.crossChannelMemory) lines.push(memory.crossChannelMemory);
  if (memory.historicalRecall?.length) {
    lines.push(`【你确实知道、而用户正在回忆的旧事】\n${memory.historicalRecall.map((hit) => `- ${hit.date} ${hit.text}`).join('\n')}\n只回应与用户当前问题有关的线索，不要转回无关旧话题。`);
  }
  return lines.join('\n');
}

/** 一致性守护用：这个世界里"存在但只有部分人知道"的事（§27） */
export function renderGuardContext(ctx: WorldContext): string {
  const lines: string[] = [];
  if (ctx.secrets.length) {
    // The guard is another model call. In a shared scene it must not receive
    // titles that no actor was permitted to use in spoken output.
    lines.push(ctx.presence.length > 1
      ? '【隐私边界】当前场景存在只属于个别角色的旧事；它们未提供给在场角色，不得猜测或补写。'
      : `【秘密（只有当事人知道，其他人不可以知道）】\n${ctx.secrets.map((s) => `- ${ctx.nameOf(s.ownerCharacterId)} 的：${s.title}`).join('\n')}`);
  }
  const facts = ctx.worldFacts.map((f) => `- [${f.category}] ${f.content}`);
  if (facts.length) lines.push(`【世界设定】\n${facts.join('\n')}`);
  const facetNames = Object.values(FACET_LABEL).join(' / ');
  lines.push(`【允许的关系分面】${facetNames}`);
  return lines.join('\n');
}
