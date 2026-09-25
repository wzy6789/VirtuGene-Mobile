import { db, type CharacterKnowledge } from './index';
import { stableId } from '../lib/world/subjects';

/**
 * 角色认知边界仓库：**"发生过" ≠ "某个角色知道"**。
 *
 * 这张表回答三件事（5.0 世界真实性的地基）：
 * 1. 谁知道这条世界事件（knowledgeLevel：none/hint/partial/full）
 * 2. 谁可以主动提起（canMention=false ⇒ 知道但不主动说）
 * 3. 谁在守着这个秘密（isSecret + secretOwnerId）
 *
 * 秘密（CharacterSecret）暂时不再单独建表：上面的字段已能表达
 * "知道 / 不知道 / 只知道一部分 / 知道但不能主动说 / 属于某个角色的秘密"。
 * 等将来需要"秘密传播、泄密、揭穿、谎言、遗忘"时再独立建模。
 */
export interface KnowledgeInput {
  userId: string;
  worldId: string;
  characterId: string;
  eventId: string;
  knowledgeLevel?: CharacterKnowledge['knowledgeLevel'];
  canMention?: boolean;
  isSecret?: boolean;
  secretOwnerId?: string;
  sourceCharacterId?: string;
  sourceRevision?: number;
  learnedAt?: number;
}

/** 认知强度排序（用于 minLevel 过滤） */
const LEVEL_ORDER: CharacterKnowledge['knowledgeLevel'][] = ['none', 'hint', 'partial', 'full'];

function knowledgeId(userId: string, worldId: string, characterId: string, eventId: string): string {
  return stableId('know', userId, worldId, characterId, eventId);
}

export const knowledgeRepo = {
  /**
   * 授予"亲历 / 被告知"的认知，并记录**授予时所依据的来源版本**。
   *
   * 为什么必须带版本：换设备恢复备份时，导入侧要拿认知行的 `sourceRevision`
   * 去和"来源被改写 / 撤回"的墓碑比较。缺这个字段的旧写法只能按版本 0 处理，
   * 于是任何一条墓碑——包括"正文被正常改写"这种不该作废认知的墓碑——都会把
   * 认知行挡在门外，角色就静默失忆了（且没有任何提示）。
   */
  async grantForEvent(input: KnowledgeInput): Promise<string> {
    const event = input.sourceRevision === undefined ? await db.worldEvents.get(input.eventId) : undefined;
    return this.upsert({
      ...input,
      ...(input.sourceRevision === undefined && event ? { sourceRevision: event.updatedAt } : {}),
    });
  },

  /** 幂等写入（同一角色 + 同一事件只有一条认知；重复调用更新等级/标记，不新增行） */
  async upsert(input: KnowledgeInput): Promise<string> {
    const id = knowledgeId(input.userId, input.worldId, input.characterId, input.eventId);
    const now = Date.now();
    const existing = await db.characterKnowledge.get(id);
    const row: CharacterKnowledge = {
      id,
      userId: input.userId,
      worldId: input.worldId,
      characterId: input.characterId,
      eventId: input.eventId,
      knowledgeLevel: input.knowledgeLevel ?? existing?.knowledgeLevel ?? 'full',
      canMention: input.canMention ?? existing?.canMention ?? true,
      isSecret: input.isSecret ?? existing?.isSecret ?? false,
      ...(input.secretOwnerId ?? existing?.secretOwnerId
        ? { secretOwnerId: input.secretOwnerId ?? existing?.secretOwnerId }
        : {}),
      ...(input.sourceCharacterId ?? existing?.sourceCharacterId
        ? { sourceCharacterId: input.sourceCharacterId ?? existing?.sourceCharacterId }
        : {}),
      ...(input.sourceRevision ?? existing?.sourceRevision
        ? { sourceRevision: input.sourceRevision ?? existing?.sourceRevision }
        : {}),
      learnedAt: input.learnedAt ?? existing?.learnedAt ?? now,
      updatedAt: now,
    };
    await db.characterKnowledge.put(row);
    return id;
  },

  async getForCharacterEvent(characterId: string, eventId: string): Promise<CharacterKnowledge | undefined> {
    const rows = await db.characterKnowledge.where('characterId').equals(characterId).toArray();
    return rows.find((r) => r.eventId === eventId);
  },

  /** TA 能不能提起这件事（没记录 ⇒ false：不允许凭空知道） */
  async canMention(characterId: string, eventId: string): Promise<boolean> {
    const row = await this.getForCharacterEvent(characterId, eventId);
    return !!row && row.canMention && row.knowledgeLevel !== 'none';
  },

  /** TA 知道得够不够（默认至少 partial） */
  async knowsAtLeast(characterId: string, eventId: string, minLevel: CharacterKnowledge['knowledgeLevel'] = 'partial'): Promise<boolean> {
    const row = await this.getForCharacterEvent(characterId, eventId);
    if (!row) return false;
    return LEVEL_ORDER.indexOf(row.knowledgeLevel) >= LEVEL_ORDER.indexOf(minLevel);
  },

  /** 某个角色知道的一切（世界内；可按最低认知强度过滤） */
  async listKnownBy(
    characterId: string,
    worldId: string,
    opts: { minLevel?: CharacterKnowledge['knowledgeLevel']; limit?: number; userId?: string } = {},
  ): Promise<CharacterKnowledge[]> {
    const minLevel = opts.minLevel ?? 'hint';
    const rows = await db.characterKnowledge.where('characterId').equals(characterId).toArray();
    return rows
      .filter((r) => r.worldId === worldId)
      .filter((r) => opts.userId === undefined || r.userId === opts.userId)
      .filter((r) => LEVEL_ORDER.indexOf(r.knowledgeLevel) >= LEVEL_ORDER.indexOf(minLevel))
      .sort((a, b) => b.learnedAt - a.learnedAt)
      .slice(0, Math.max(1, opts.limit ?? 200));
  },

  /** TA 守着哪些秘密 */
  async listSecretsOwnedBy(characterId: string, worldId: string): Promise<CharacterKnowledge[]> {
    const rows = await db.characterKnowledge.where('characterId').equals(characterId).toArray();
    return rows.filter((r) => r.worldId === worldId && r.isSecret && r.secretOwnerId === characterId);
  },

  /** TA 只能知道但不能主动说的事（叙事上最有用的一类） */
  async listUnmentionable(characterId: string, worldId: string): Promise<CharacterKnowledge[]> {
    const rows = await db.characterKnowledge.where('characterId').equals(characterId).toArray();
    return rows.filter((r) => r.worldId === worldId && !r.canMention && r.knowledgeLevel !== 'none');
  },

  /**
   * §62：用户把秘密告诉某个角色之后，**只有那个角色**获得认知。
   * 传 sourceCharacterId 表示"从谁那里得知"。
   */
  async teach(input: Omit<KnowledgeInput, 'knowledgeLevel' | 'canMention'> & { canMention?: boolean }): Promise<string> {
    return this.upsert({ ...input, knowledgeLevel: 'full', canMention: input.canMention ?? true });
  },

  /** 谁还完全不知道这件事（用于叙事张力与"逐渐发现"） */
  async listUnaware(characterIds: string[], eventId: string): Promise<string[]> {
    const out: string[] = [];
    for (const characterId of characterIds) {
      const row = await this.getForCharacterEvent(characterId, eventId);
      if (!row || row.knowledgeLevel === 'none') out.push(characterId);
    }
    return out;
  },

  async countByWorld(worldId: string): Promise<number> {
    return db.characterKnowledge.where('worldId').equals(worldId).count();
  },

  async clearForWorld(worldId: string): Promise<void> {
    await db.characterKnowledge.where('worldId').equals(worldId).delete();
  },

  async clearForUser(userId: string): Promise<void> {
    await db.characterKnowledge.where('userId').equals(userId).delete();
  },

  async remove(id: string): Promise<void> {
    await db.characterKnowledge.delete(id);
  },

  /**
   * 收回"某个锚点"的全部认知（撤回授权 / 删除记录时使用）。
   *
   * 锚点（`eventId` 字段）原则上是一条世界事件，但 5.0.0 Phase 2b-4 起也用于
   * "只告诉某个角色、不写世界事件的现实记录"（形如 `diary:<diaryId>`）——
   * 这类授权的撤销必须**真的删掉认知行**，否则角色仍会以为 TA 知道。
   * 返回删除的行数。
   */
  async removeForEvent(eventId: string, userId?: string): Promise<number> {
    if (!eventId) return 0;
    const rows = await db.characterKnowledge.where('eventId').equals(eventId).toArray();
    const ids = rows.filter((row) => userId === undefined || row.userId === userId).map((row) => row.id);
    if (ids.length) await db.characterKnowledge.bulkDelete(ids);
    return ids.length;
  },

  /** 角色被删除：TA 的认知随之消失（认知依附于角色本身） */
  async cleanupForCharacter(characterId: string): Promise<number> {
    const rows = await db.characterKnowledge.where('characterId').equals(characterId).toArray();
    if (rows.length) await db.characterKnowledge.bulkDelete(rows.map((r) => r.id));
    return rows.length;
  },
};
