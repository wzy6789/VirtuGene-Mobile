/**
 * 4.x → 5.0 Living World 派生回填（Phase 1）
 *
 * 设计约束（对应审计报告 §18 与确认稿 §十）：
 * 1. **只新增派生数据**：既有 11 张表不改写、不删除（`diaries` 只补默认字段）。
 * 2. **幂等**：所有派生行使用「由幂等键算出的确定性 id」+ 存在即跳过，
 *    因此重复执行（升级重试、手动补偿重建）不会产生重复行，也不会覆盖运行期的新数据。
 * 3. **幂等键 = userId + worldId + sourceType + sourceId**（不是只有 sourceType+sourceId）。
 * 4. **零网络**：本函数在 IndexedDB 的 versionchange 事务内执行，只做本地纯变换。
 * 5. **不编造数值**：旧数据没有数值增量时，只留"原因记录"，不填假数字。
 *
 * 迁移语义（确认稿 §八，禁止把普通互动/未完成事件混为 stage）：
 *   CharacterState.lifeEvents  interaction → interaction ｜ memory → shared_memory
 *                              relationship → relationship ｜ goal → continuity
 *   continuityThreads                             → continuity
 *   sharedStoryEvents                             → relationship
 *   diaries                                       → 不派生（§十三：旧日记一律 private）
 *   memories                                      → 不迁移（是"用户事实"，不是共同经历）
 *   sharedMemories                                → 不回填（共同记忆由运行期产生）
 */
import type { Transaction, Table } from 'dexie';
import type {
  CharacterState,
  ContinuityThread,
  Diary,
  SharedStoryEvent,
  User,
  World,
  WorldEvent,
  WorldEventType,
  CharacterKnowledge,
  RelationshipEvent,
  RelationshipState,
} from '../../db/index';
import {
  characterIdsOf,
  characterRef,
  defaultWorldId,
  defaultWorldName,
  derivedWorldEventId,
  stableId,
  subjectPair,
  subjectPairKey,
  userRef,
} from './subjects';

export interface MigrationCounts {
  worldsCreated: number;
  worldsSkipped: number;
  worldEventsCreated: number;
  worldEventsSkipped: number;
  characterKnowledgeCreated: number;
  characterKnowledgeSkipped: number;
  relationshipStatesCreated: number;
  relationshipStatesSkipped: number;
  relationshipEventsCreated: number;
  relationshipEventsSkipped: number;
  sharedMemoriesCreated: number;
  diariesPatched: number;
  /** R7 收尾：被清掉的"世界层好感度快照"行数（应始终为 0 或一次性清理数） */
  legacyAffinityStripped: number;
}

export function emptyCounts(): MigrationCounts {
  return {
    worldsCreated: 0,
    worldsSkipped: 0,
    worldEventsCreated: 0,
    worldEventsSkipped: 0,
    characterKnowledgeCreated: 0,
    characterKnowledgeSkipped: 0,
    relationshipStatesCreated: 0,
    relationshipStatesSkipped: 0,
    relationshipEventsCreated: 0,
    relationshipEventsSkipped: 0,
    sharedMemoriesCreated: 0,
    diariesPatched: 0,
    legacyAffinityStripped: 0,
  };
}

/** lifeEvent.type → WorldEventType（goal 归入 continuity：它是"尚未完成的意向"，绝不是一场 stage） */
function mapLifeEventType(type: string): WorldEventType {
  switch (type) {
    case 'memory':
      return 'shared_memory';
    case 'relationship':
      return 'relationship';
    case 'goal':
      return 'continuity';
    case 'interaction':
    default:
      return 'interaction';
  }
}

/** 重要度：只做粗分档，不假造精确权重 */
function importanceOf(type: WorldEventType): number {
  switch (type) {
    case 'stage':
    case 'life_trace':
      return 0.8;
    case 'shared_memory':
    case 'relationship':
      return 0.7;
    case 'continuity':
      return 0.6;
    default:
      return 0.5;
  }
}

export async function runWorldMigration(tx: Transaction): Promise<MigrationCounts> {
  const counts = emptyCounts();
  const now = Date.now();

  const usersTable = tx.table<User, string>('users');
  const statesTable = tx.table<CharacterState, [string, string]>('characterStates');
  const threadsTable = tx.table<ContinuityThread, string>('continuityThreads');
  const sharedEventsTable = tx.table<SharedStoryEvent, string>('sharedStoryEvents');
  const diariesTable = tx.table<Diary, string>('diaries');
  const worldsTable = tx.table<World, string>('worlds');
  const eventsTable = tx.table<WorldEvent, string>('worldEvents');
  const knowledgeTable = tx.table<CharacterKnowledge, string>('characterKnowledge');
  const relStateTable = tx.table<RelationshipState, string>('relationshipStates');
  const relEventTable = tx.table<RelationshipEvent, string>('relationshipEvents');

  // ---- 1. 收集全部 userId（users 表 + 各业务表里出现过的 userId）----
  const users = await usersTable.toArray();
  const usernameById = new Map<string, string>();
  for (const u of users) usernameById.set(u.id, u.username);

  const userIds = new Set<string>(usernameById.keys());
  for (const st of await statesTable.toArray()) if (st.userId) userIds.add(st.userId);
  for (const s of await sharedEventsTable.toArray()) if (s.userId) userIds.add(s.userId);
  for (const t of await threadsTable.toArray()) if (t.userId) userIds.add(t.userId);
  for (const d of await diariesTable.toArray()) if (d.userId) userIds.add(d.userId);

  // ---- 2. 每个用户一个默认世界（确定性 id ⇒ 重复升级不会多建）----
  for (const userId of userIds) {
    const id = defaultWorldId(userId);
    const existing = await worldsTable.get(id);
    if (existing) {
      counts.worldsSkipped += 1;
      continue;
    }
    const world: World = {
      id,
      userId,
      name: defaultWorldName(usernameById.get(userId)),
      createdAt: now,
      updatedAt: now,
      isDefault: true,
    };
    await worldsTable.put(world);
    counts.worldsCreated += 1;
  }

  // ---- 3. 逐用户派生世界事件 / 认知 / 关系 ----
  for (const userId of userIds) {
    const worldId = defaultWorldId(userId);
    const me = userRef(userId);

    const states = (await statesTable.toArray()).filter((s) => s.userId === userId);
    const threads = (await threadsTable.toArray()).filter((t) => t.userId === userId);
    const sharedEvents = (await sharedEventsTable.toArray()).filter((s) => s.userId === userId);

    /** 写入一条派生事件；返回 { event, created } */
    const putEvent = async (
      sourceType: string,
      sourceId: string,
      draft: Omit<WorldEvent, 'id' | 'userId' | 'worldId' | 'sourceType' | 'sourceId' | 'createdAt' | 'updatedAt'>,
    ): Promise<{ event: WorldEvent; created: boolean }> => {
      const id = derivedWorldEventId(userId, worldId, sourceType, sourceId);
      const existing = await eventsTable.get(id);
      if (existing) {
        counts.worldEventsSkipped += 1;
        return { event: existing, created: false };
      }
      const event: WorldEvent = {
        ...draft,
        id,
        userId,
        worldId,
        sourceType,
        sourceId,
        createdAt: now,
        updatedAt: now,
      };
      await eventsTable.put(event);
      counts.worldEventsCreated += 1;
      return { event, created: true };
    };

    /** 认知边界：事件参与者（角色）默认"亲身经历 ⇒ 完整知道且可以提起" */
    const putKnowledgeForParticipants = async (event: WorldEvent, learnedAt: number): Promise<void> => {
      for (const characterId of characterIdsOf(event.participants)) {
        const id = stableId('know', userId, worldId, characterId, event.id);
        const existing = await knowledgeTable.get(id);
        if (existing) {
          counts.characterKnowledgeSkipped += 1;
          continue;
        }
        const knowledge: CharacterKnowledge = {
          id,
          userId,
          worldId,
          characterId,
          eventId: event.id,
          knowledgeLevel: 'full',
          canMention: true,
          isSecret: false,
          learnedAt,
          updatedAt: now,
        };
        await knowledgeTable.put(knowledge);
        counts.characterKnowledgeCreated += 1;
      }
    };

    // 关系当前状态：用户↔角色（沿用 4.x 好感度语义，其余分面留 0 = 尚无记录）
    const putRelationshipState = async (
      a: string,
      b: string,
      seed: { trust?: number; dependency?: number; conflict?: number; familiarity?: number },
    ): Promise<void> => {
      const [subjectA, subjectB] = subjectPair(a, b);
      const pairKeyValue = subjectPairKey(a, b);
      const id = stableId('rel', userId, worldId, pairKeyValue);
      const existing = await relStateTable.get(id);
      if (existing) {
        counts.relationshipStatesSkipped += 1;
        return;
      }
      const state: RelationshipState = {
        id,
        userId,
        worldId,
        pairKey: pairKeyValue,
        subjectA,
        subjectB,
        subjects: [subjectA, subjectB],
        trust: seed.trust ?? 0,
        dependency: seed.dependency ?? 0,
        conflict: seed.conflict ?? 0,
        familiarity: seed.familiarity ?? 0,
        updatedAt: now,
      };
      await relStateTable.put(state);
      counts.relationshipStatesCreated += 1;
    };

    // 关系变化历史：旧数据没有数值增量 → 只记录"发生过这件事"与原因
    const putRelationshipEvent = async (
      a: string,
      b: string,
      reason: string,
      sourceType: string,
      sourceId: string,
      createdAt: number,
      sourceEventId?: string,
    ): Promise<void> => {
      const [subjectA, subjectB] = subjectPair(a, b);
      const pairKeyValue = subjectPairKey(a, b);
      const id = stableId('relev', userId, worldId, sourceType, sourceId);
      const existing = await relEventTable.get(id);
      if (existing) {
        counts.relationshipEventsSkipped += 1;
        return;
      }
      const event: RelationshipEvent = {
        id,
        userId,
        worldId,
        pairKey: pairKeyValue,
        subjectA,
        subjectB,
        subjects: [subjectA, subjectB],
        facets: {},
        reason: reason.slice(0, 240),
        ...(sourceEventId ? { sourceEventId } : {}),
        sourceType,
        createdAt,
      };
      await relEventTable.put(event);
      counts.relationshipEventsCreated += 1;
    };

    // 3.1 生命轨迹 → 世界事件
    for (const state of states) {
      const characterRefValue = characterRef(state.characterId);
      for (const lifeEvent of state.lifeEvents ?? []) {
        const type = mapLifeEventType(lifeEvent.type);
        const { event } = await putEvent('migration:lifeEvent', lifeEvent.id, {
          type,
          title: lifeEvent.title,
          summary: lifeEvent.detail ?? '',
          participants: [me, characterRefValue],
          timestamp: lifeEvent.createdAt,
          importance: importanceOf(type),
          visibility: 'selected',
          visibleTo: [state.characterId],
          resolved: true,
          relatedEventIds: [],
          memoryIds: [],
          tags: ['迁移自 4.x 生命轨迹'],
          meta: { lifeEventType: lifeEvent.type },
        });
        await putKnowledgeForParticipants(event, lifeEvent.createdAt);
        if (lifeEvent.type === 'relationship') {
          await putRelationshipEvent(
            me,
            characterRefValue,
            lifeEvent.title,
            'migration:lifeEvent',
            lifeEvent.id,
            lifeEvent.createdAt,
            event.id,
          );
        }
      }
      // 用户 ↔ 角色当前关系：世界层**不保存好感度**（R7 裁定：唯一来源是 4.x CharacterState），
      // 四个分面留 0（尚无记录），等真实事件来改
      await putRelationshipState(me, characterRefValue, {});
      // 角色↔角色：用户设定的故事关系 → 先建立状态行（数值待由事件累积）
      for (const link of state.storyRelations ?? []) {
        await putRelationshipState(characterRef(state.characterId), characterRef(link.targetCharacterId), {});
      }
    }

    // 3.2 未完成事件 → continuity（绝不是 stage）
    for (const thread of threads) {
      const characterRefValue = characterRef(thread.characterId);
      const { event } = await putEvent('migration:thread', thread.id, {
        type: 'continuity',
        title: thread.title,
        summary: thread.detail ?? '',
        participants: [me, characterRefValue],
        timestamp: thread.createdAt,
        importance: importanceOf('continuity'),
        visibility: 'selected',
        visibleTo: [thread.characterId],
        // 只有明确"已完成"才算解决；archived（超上限自动收起）与 dropped（用户说稍后再说）都不是已解决
        resolved: thread.status === 'done',
        relatedEventIds: [],
        memoryIds: [],
        tags: ['迁移自 4.x 未完成事件'],
        meta: { threadStatus: thread.status, kind: thread.kind, ...(thread.dueAt ? { dueAt: thread.dueAt } : {}) },
      });
      await putKnowledgeForParticipants(event, thread.createdAt);
    }

    // 3.3 人物共同事件 → relationship（角色↔角色）
    for (const shared of sharedEvents) {
      const [a, b] = shared.characterIds;
      const { event } = await putEvent('migration:sharedEvent', shared.id, {
        type: 'relationship',
        title: `${shared.type}：${shared.title}`,
        summary: shared.detail ?? '',
        participants: [characterRef(a), characterRef(b)],
        timestamp: shared.createdAt,
        importance: importanceOf('relationship'),
        // 保守默认：人物之间的事只有当事双方知道（不擅自让全世界的角色都知道）
        visibility: 'selected',
        visibleTo: [a, b],
        resolved: true,
        relatedEventIds: [],
        memoryIds: [],
        tags: ['迁移自 4.x 人物共同事件', shared.type],
        meta: { sharedEventType: shared.type, ...(shared.viewpoints ? { viewpoints: shared.viewpoints } : {}) },
      });
      await putKnowledgeForParticipants(event, shared.createdAt);
      await putRelationshipEvent(
        characterRef(a),
        characterRef(b),
        shared.title,
        'migration:sharedEvent',
        shared.id,
        shared.createdAt,
        event.id,
      );
    }
  }

  // ---- 4. 旧日记：一律 private（§十三）----
  // 绝不因为旧的全局开关 diarySharedWithCharacters 曾经开启，就把历史日记授权给角色；
  // 该开关只能影响"以后新建日记的默认选择"（Phase 6 处理）。
  await diariesTable.toCollection().modify((diary) => {
    if (diary.visibility === undefined) {
      diary.visibility = 'private';
      counts.diariesPatched += 1;
    }
    if (diary.visibleTo === undefined) diary.visibleTo = [];
  });

  // ---- 5. R7 收尾（幂等）：清掉早期版本写进世界层的"好感度快照" ----
  // 5.0 还没有正式发布，因此真实用户升级到 v17 时走的就是这里；
  // 开发中的 5.0 库如果已经写过快照，可以用 worldRepo.rerunMigration() 再跑一次收敛。
  // 保留四个分面，只删掉 affinity 这一个过时字段。
  await relStateTable.toCollection().modify((row) => {
    const legacy = row as RelationshipState & { affinity?: number };
    if ('affinity' in legacy) {
      delete legacy.affinity;
      counts.legacyAffinityStripped += 1;
    }
  });

  return counts;
}
