/**
 * 世界写入器（Phase 2b-0 最小闭环）
 *
 * 职责：把**既有流程真实产生**的东西同步成世界层记录，仅此而已。
 * 严格约束（对应确认稿 §5 写入路径规格）：
 * 1. **不新增任何 AI 调用**：这里只在既有结算/既有用户动作之后做纯本地派生。
 * 2. **只写"真正发生的事"**：
 *    - 关系变化（关系等阶升级 → relationship）
 *    - 约定与未完成事项（continuityThreads → continuity；lifeEvent.type='goal' → continuity）
 *    普通闲聊（'interaction'）与「记住」（'memory'）**刻意不写**：
 *    前者会让年表变成聊天流水账，后者属于"用户事实"（进 memories，由 2b-2 的显式入口再决定是否成为共同记忆）。
 * 3. **幂等**：全部使用确定性 id（userId+worldId+sourceType+sourceId），重复同步只更新同一行；
 *    「完成/收起/重新挂起」也是更新同一条事件的 resolved，不会产生第二条。
 * 4. **认知边界**：事件参与者里的角色会获得一条认知（亲身经历 ⇒ full + 可提起），
 *    其他角色不会因为这件事而"知道"。
 * 5. 失败不阻断主流程：世界层是派生数据，写不进去不能让聊天/结算崩掉（调用方负责兜底）。
 *
 * Phase 2b-2 追加：`collectMessageAsSharedMemory`（用户显式「收藏为共同记忆」）。
 * 它是 `sharedMemories` 的**第一个生产写入路径**，与上面的"自动派生"不同：
 * 由用户明确动作触发，因此可以写"共同记忆"；同样零 AI 调用，且三张表在一个事务里。 */
import type { ContinuityThread, LifeEvent, Message, WorldEventType } from '../../db/index';
import { db } from '../../db/index';
import { worldRepo } from '../../db/world-repo';
import { worldEventRepo } from '../../db/world-event-repo';
import { knowledgeRepo } from '../../db/knowledge-repo';
import { sharedMemoryRepo } from '../../db/shared-memory-repo';
import { relationshipRepo } from '../../db/relationship-repo';
import { characterRef, derivedWorldEventId, stableId, userRef } from './subjects';
import { splitForMemory } from './world-picks';

/** 重要度：只做粗分档，不假造精确权重 */
function importanceOf(type: WorldEventType): number {
  switch (type) {
    case 'stage':
    case 'life_trace':
      return 0.9;
    case 'relationship':
    case 'shared_memory':
      return 0.7;
    case 'continuity':
      return 0.6;
    default:
      return 0.5;
  }
}

/** 允许进入世界层的来源白名单（未标注来源的旧数据按 'chat' 处理） */
const WORLD_SOURCES = new Set(['chat', 'manual']);

/**
 * 4.x 生命轨迹类型 → 世界事件类型
 *
 * 运行期规则（严格按已批准的 §5 写入路径规格）：**只写三类**
 *   关系变化（relationship）、约定/计划（goal → continuity）、未完成事项（continuityThreads）
 * 明确不写：
 *   - interaction：普通互动，世界年表不是聊天流水账
 *   - memory：用户「记住」产生的是"用户事实"，只进 memories；
 *     真正让它成为共同记忆的是 Phase 2b-2 的「收藏为共同记忆」显式入口
 *   - **来源为 group 的（如"进入共同场域"）：建群是功能操作，不是关系变化**
 * 注意：Phase 1 的一次性**历史回填**对 memory 采取更宽的口径（旧数据已经发生过，
 * 能派生的都派生；当时也没有 source 字段）；运行期更严格，两者是"历史补偿 vs 今后规则"的区别。
 */
function mapLifeEventType(type: LifeEvent['type']): WorldEventType | null {
  switch (type) {
    case 'relationship':
      return 'relationship';
    case 'goal':
      return 'continuity';
    case 'interaction':
    case 'memory':
    default:
      return null;
  }
}

/** 取该用户的默认世界 id（确定性生成 ⇒ 不会产生额外世界） */
async function resolveWorldId(userId: string, worldId?: string): Promise<string> {
  if (worldId) return worldId;
  const world = await worldRepo.ensureDefaultWorld(userId);
  return world.id;
}

/**
 * 生命轨迹 → 世界事件。
 * 返回派生出的世界事件 id；该类型不写世界层时返回 null。
 */
export async function syncLifeEventToWorld(params: {
  userId: string;
  characterId: string;
  lifeEvent: LifeEvent;
  worldId?: string;
}): Promise<string | null> {
  const { userId, characterId, lifeEvent } = params;
  const type = mapLifeEventType(lifeEvent.type);
  if (!type) return null;
  // 来源白名单：群聊相关（建群等）属于功能操作，不进世界层
  if (lifeEvent.source && !WORLD_SOURCES.has(lifeEvent.source)) return null;

  const worldId = await resolveWorldId(userId, params.worldId);
  const event = await worldEventRepo.createIfAbsent({
    userId,
    worldId,
    type,
    title: lifeEvent.title,
    summary: lifeEvent.detail ?? '',
    participants: [userRef(userId), characterRef(characterId)],
    timestamp: lifeEvent.createdAt,
    importance: importanceOf(type),
    sourceType: 'lifeEvent',
    sourceId: lifeEvent.id,
    // 这是"用户和这个角色之间"的事：默认只有当事人知道，不擅自让全世界角色都知道
    visibility: 'selected',
    visibleTo: [characterId],
    resolved: true,
    tags: ['来自你们的对话'],
    meta: { lifeEventType: lifeEvent.type },
  });

  // 亲身经历 ⇒ 该角色获得认知（可以自然地提起）
  await knowledgeRepo.upsert({ userId, worldId, characterId, eventId: event.id, knowledgeLevel: 'full', canMention: true });

  /**
   * 关系变化额外记一条「为什么」（Phase 2b-5 关系网络可解释化）。
   *
   * `facets: {}` —— **只记录原因，不改任何数值**：
   * 好感度等数值的唯一来源仍然是 4.x 的 `CharacterState`（R7 未决项），
   * 世界层不做第二次写入，因此不会出现"两套数值互相打架"。
   * 幂等键用 lifeEvent.id ⇒ 重复同步（重试/回放）不会写第二条。
   */
  if (type === 'relationship') {
    await relationshipRepo.applyEvent({
      userId,
      worldId,
      a: userRef(userId),
      b: characterRef(characterId),
      facets: {},
      reason: lifeEvent.title,
      sourceEventId: event.id,
      sourceType: 'lifeEvent',
      idempotencyKey: lifeEvent.id,
      createdAt: lifeEvent.createdAt,
    });
  }
  return event.id;
}

/**
 * 未完成事件 → 世界事件（约定 / 计划 / 话题 / 分歧 / 提醒）。
 * 「已完成」时才把 resolved 置 true；archived（超上限自动收起）与 dropped（用户说稍后再说）都不算已解决。
 */
export async function syncContinuityThreadToWorld(params: {
  userId: string;
  thread: ContinuityThread;
  worldId?: string;
}): Promise<string> {
  const { userId, thread } = params;
  const worldId = await resolveWorldId(userId, params.worldId);
  const event = await worldEventRepo.createIfAbsent({
    userId,
    worldId,
    type: 'continuity',
    title: thread.title,
    summary: thread.detail ?? '',
    participants: [userRef(userId), characterRef(thread.characterId)],
    timestamp: thread.createdAt,
    importance: importanceOf('continuity'),
    sourceType: 'continuity',
    sourceId: thread.id,
    visibility: 'selected',
    visibleTo: [thread.characterId],
    resolved: thread.status === 'done',
    tags: ['你们之间还没做完的事'],
    meta: { threadStatus: thread.status, kind: thread.kind, ...(thread.dueAt ? { dueAt: thread.dueAt } : {}) },
  });

  // 状态/文案可能变化（完成、收起、重新挂起、用户改写标题）：同步同一条事件，绝不新增
  await worldEventRepo.update(event.id, {
    title: thread.title,
    summary: thread.detail ?? '',
    resolved: thread.status === 'done',
    meta: { threadStatus: thread.status, kind: thread.kind, ...(thread.dueAt ? { dueAt: thread.dueAt } : {}) },
  });
  await knowledgeRepo.upsert({
    userId,
    worldId,
    characterId: thread.characterId,
    eventId: event.id,
    knowledgeLevel: 'full',
    canMention: true,
  });
  return event.id;
}

/** 未完成事件被彻底删除（用户主动删除 / 角色被删）→ 派生事件一并移除，避免孤儿 */
export async function removeContinuityThreadFromWorld(userId: string, threadIds: string[]): Promise<void> {
  if (threadIds.length === 0) return;
  const world = await worldRepo.ensureDefaultWorld(userId);
  for (const id of threadIds) {
    // 与 syncContinuityThreadToWorld 写入时同一个确定性 id，不需要查询
    await worldEventRepo.remove(derivedWorldEventId(userId, world.id, 'continuity', id));
  }
}

/* ------------------------------------------------------------------ *
 * Phase 2b-2：把一条消息收藏为「共同记忆」（sharedMemories 的第一个生产写入路径）
 * ------------------------------------------------------------------ */

/** 收藏的来源标记：与 4.x 的 memories（用户事实）严格区分 */
export const MEMORY_SOURCE_TYPE = 'message';

export interface CollectMemoryResult {
  memoryId: string;
  eventId: string;
  /** 本次是否真的新建（false = 之前已经收藏过，重复调用不会产生第二行） */
  created: boolean;
}

/** 消息没有正文时（纯图片/纯语音）的如实占位，不编造内容 */
function fallbackTitle(hasImage: boolean, hasAudio: boolean): string {
  if (hasImage) return '一张你们一起看过的图片';
  if (hasAudio) return '一段你们之间的语音';
  return '一条你们之间的消息';
}

/**
 * 收藏一条消息为共同记忆。
 *
 * 严格约束（沿用已批准的 §5 写入路径规格）：
 * 1. **零新增 AI 调用**：整段是纯本地写入，不联网、不改 Prompt。
 * 2. **一个动作写三处，且在同一个事务里**：sharedMemories（记忆本身）+
 *    worldEvents（年表/最近发生里的 shared_memory 事件）+ characterKnowledge（该角色"知道"）。
 *    任何一步失败整笔回滚，绝不留下"有记忆没有事件"这种半写状态。
 * 3. **幂等**：确定性 id ⇒ 同一条消息重复收藏只更新同一行。
 * 4. **边界**：参与者是"你 + 该角色"；可见性 selected + 只给该角色（不擅自让全世界知道）；
 *    认知只给参与的角色（亲身经历 ⇒ full + 可提起）。
 * 5. 与「记住」（memories = 用户事实）**互不替代**：这里不写 memories。
 */
export async function collectMessageAsSharedMemory(params: {
  userId: string;
  characterId: string;
  message: Pick<Message, 'id' | 'content' | 'image' | 'audio' | 'createdAt'>;
  worldId?: string;
}): Promise<CollectMemoryResult> {
  const { userId, characterId, message } = params;
  // 世界 id 在事务外解析（ensureDefaultWorld 会写 worlds 表，属于另一件事）
  const worldId = await resolveWorldId(userId, params.worldId);
  const { title, summary } = splitForMemory(message.content ?? '');
  const finalTitle = title || fallbackTitle(Boolean(message.image), Boolean(message.audio));

  const memoryId = stableId('smem', userId, worldId, MEMORY_SOURCE_TYPE, message.id);
  const eventId = derivedWorldEventId(userId, worldId, 'sharedMemory', memoryId);
  const existing = await db.sharedMemories.get(memoryId);
  if (existing) {
    // 已收藏过：只把认知补齐（例如角色是新导入的），不产生第二行
    await knowledgeRepo.upsert({
      userId, worldId, characterId, eventId, knowledgeLevel: 'full', canMention: true,
    });
    return { memoryId, eventId, created: false };
  }

  const now = Date.now();
  const participants = [userRef(userId), characterRef(characterId)];

  await db.transaction('rw', db.sharedMemories, db.worldEvents, db.characterKnowledge, async () => {
    await sharedMemoryRepo.create({
      userId,
      worldId,
      title: finalTitle,
      summary,
      participants,
      sourceType: MEMORY_SOURCE_TYPE,
      sourceId: message.id,
      importance: 0.7,
      // 与 2b-0 的事件同一口径：这是"你们之间的事"，不擅自让全世界角色都知道
      visibility: 'selected',
      visibleTo: [characterId],
      tags: ['你收藏的共同记忆'],
      createdAt: message.createdAt ?? now,
    });

    await worldEventRepo.create({
      userId,
      worldId,
      type: 'shared_memory',
      title: finalTitle,
      summary,
      participants,
      timestamp: message.createdAt ?? now,
      importance: importanceOf('shared_memory'),
      sourceType: 'sharedMemory',
      sourceId: memoryId,
      visibility: 'selected',
      visibleTo: [characterId],
      resolved: true,
      memoryIds: [memoryId],
      tags: ['你收藏的共同记忆'],
      meta: { messageId: message.id },
    });

    await knowledgeRepo.upsert({
      userId, worldId, characterId, eventId, knowledgeLevel: 'full', canMention: true,
    });
  });

  return { memoryId, eventId, created: true };
}
