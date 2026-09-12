import { db, type ContinuityThread } from './index';

/** 每个角色最多同时挂着的「未完成事件」数量；超出时把最旧的归档，而不是删掉。 */
export const MAX_OPEN_THREADS = 8;

export type ContinuityKind = ContinuityThread['kind'];

export const CONTINUITY_KINDS: { key: ContinuityKind; label: string; hint: string }[] = [
  { key: 'promise', label: '承诺', hint: '答应过对方的事' },
  { key: 'plan', label: '计划', hint: '说好要一起做、还没做' },
  { key: 'topic', label: '话题', hint: '聊到一半、还没说完' },
  { key: 'conflict', label: '分歧', hint: '还没化解的不愉快' },
  { key: 'reminder', label: '提醒', hint: '某天要记得的事' },
];

export const KIND_LABEL: Record<ContinuityKind, string> = {
  promise: '承诺',
  plan: '计划',
  topic: '话题',
  conflict: '分歧',
  reminder: '提醒',
};

/** 状态文案：区分「用户自己说不聊了」与「因为超上限被系统自动收起」 */
export const STATUS_LABEL: Record<ContinuityThread['status'], string> = {
  open: '还没做完',
  done: '已完成',
  dropped: '你说稍后再说',
  archived: '自动收起（超出上限）',
};

/** 归一化：去掉标点与空白，便于比较两条线索是不是同一件事。 */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s，。、！？；：,.!?;:'"“”‘’（）()\[\]【】—\-…~]/g, '');
}

/** 2-gram 集合相似度：只用于「同一件事去重」，不用于任何内容猜测。 */
function similarity(a: string, b: string): number {
  const x = normalize(a);
  const y = normalize(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const grams = (s: string) => {
    const set = new Set<string>();
    for (let i = 0; i < s.length - 1; i += 1) set.add(s.slice(i, i + 2));
    return set;
  };
  // 单字标题没有 2-gram，退化为包含判断
  if (x.length < 2 || y.length < 2) return 0;
  const gx = grams(x);
  const gy = grams(y);
  let hit = 0;
  for (const g of gx) if (gy.has(g)) hit += 1;
  return (2 * hit) / (gx.size + gy.size);
}

const DUPLICATE_THRESHOLD = 0.55;

/**
 * 判断两条线索是不是同一件事：
 * - 文字高度相似（≥0.55）
 * - 或者属于同一类别、且其中一个标题整体包含另一个（如"看电影" vs "周末一起看电影"）
 */
function sameThread(
  a: { title: string; kind: ContinuityKind },
  b: { title: string; kind: ContinuityKind },
): boolean {
  if (similarity(a.title, b.title) >= DUPLICATE_THRESHOLD) return true;
  if (a.kind !== b.kind) return false;
  const x = normalize(a.title);
  const y = normalize(b.title);
  if (x.length < 2 || y.length < 2) return false;
  return x.includes(y) || y.includes(x);
}

export interface NewThreadInput {
  characterId: string;
  userId: string;
  kind: ContinuityKind;
  title: string;
  detail?: string;
  dueAt?: number;
  sourceMessageIds?: string[];
  origin?: 'ai' | 'user';
}

/**
 * 未完成事件仓库。
 * 设计约束：只有明确出现的约定/计划/话题/冲突/提醒才允许进来；
 * 同一件事不会因为反复提起而重复入库；超过上限时最旧的自动归档（可再打开）。
 */
export const continuityRepo = {
  async getById(id: string): Promise<ContinuityThread | undefined> {
    return db.continuityThreads.get(id);
  },

  async getByIds(ids: string[]): Promise<ContinuityThread[]> {
    if (ids.length === 0) return [];
    const items = await db.continuityThreads.bulkGet(ids);
    return items.filter((item): item is ContinuityThread => !!item);
  },

  async getByCharacter(characterId: string, userId: string): Promise<ContinuityThread[]> {
    const all = await db.continuityThreads.where('characterId').equals(characterId).toArray();
    return all
      .filter((t) => t.userId === userId)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  },

  /** 只取还挂着的（open），供上下文注入与 Shared Space 展示 */
  async getOpenByCharacter(characterId: string, userId: string): Promise<ContinuityThread[]> {
    const all = await this.getByCharacter(characterId, userId);
    return all
      .filter((t) => t.status === 'open')
      .sort((a, b) => (a.dueAt ?? a.createdAt) - (b.dueAt ?? b.createdAt));
  },

  async getAllByUser(userId: string): Promise<ContinuityThread[]> {
    return db.continuityThreads.where('userId').equals(userId).toArray();
  },

  async countOpen(characterId: string, userId: string): Promise<number> {
    return (await this.getOpenByCharacter(characterId, userId)).length;
  },

  /**
   * 批量写入分析结果。返回真正新增的条数。
   * - 与已有 open 线索相似度超阈值 → 视为同一件事，更新 detail / dueAt，不重复插入
   * - 同一批里相似 → 只保留一条
   * - 写完后若 open 超过 MAX_OPEN_THREADS，把最旧的若干条置为 'dropped'（归档，不是删除）
   */
  async createMany(inputs: NewThreadInput[]): Promise<number> {
    if (inputs.length === 0) return 0;
    const characterId = inputs[0].characterId;
    const userId = inputs[0].userId;
    let created = 0;

    await db.transaction('rw', db.continuityThreads, async () => {
      const existing = (await db.continuityThreads.where('characterId').equals(characterId).toArray())
        .filter((t) => t.userId === userId);
      const open = existing.filter((t) => t.status === 'open');
      const pool = [...open];
      const now = Date.now();

      for (const input of inputs) {
        const title = input.title.trim().slice(0, 60);
        if (!title) continue;
        const duplicate = pool.find((t) => sameThread(t, { title, kind: input.kind }));
        if (duplicate) {
          const mergedIds = Array.from(new Set([...(duplicate.sourceMessageIds ?? []), ...(input.sourceMessageIds ?? [])]));
          await db.continuityThreads.put({
            ...duplicate,
            detail: input.detail?.trim().slice(0, 200) || duplicate.detail,
            dueAt: input.dueAt ?? duplicate.dueAt,
            sourceMessageIds: mergedIds.slice(-6),
            updatedAt: now,
          });
          const idx = pool.findIndex((t) => t.id === duplicate.id);
          if (idx >= 0) pool[idx] = { ...duplicate, updatedAt: now };
          continue;
        }
        const thread: ContinuityThread = {
          id: crypto.randomUUID(),
          characterId,
          userId,
          kind: input.kind,
          title,
          ...(input.detail?.trim() ? { detail: input.detail.trim().slice(0, 200) } : {}),
          status: 'open',
          ...(input.dueAt ? { dueAt: input.dueAt } : {}),
          sourceMessageIds: (input.sourceMessageIds ?? []).slice(-6),
          origin: input.origin ?? 'ai',
          createdAt: now + created,
          updatedAt: now + created,
        };
        await db.continuityThreads.put(thread);
        pool.push(thread);
        created += 1;
      }

      const stillOpen = pool
        .filter((t) => t.status === 'open')
        .sort((a, b) => b.updatedAt - a.updatedAt);
      if (stillOpen.length > MAX_OPEN_THREADS) {
        // 超出上限只「自动收起」最旧的几条（保留原文与时间，用户可随时重新挂起），不做删除。
        // 用 archived 而不是 dropped：dropped 是用户自己说"稍后再说"，系统不该混用这个语义。
        const archive = stillOpen.slice(MAX_OPEN_THREADS);
        await db.continuityThreads.bulkPut(
          archive.map((t) => ({ ...t, status: 'archived' as const })),
        );
      }
    });

    return created;
  },

  /** 用户手动添加一条未完成事件（不走去重以外的 AI 逻辑） */
  async create(input: NewThreadInput): Promise<void> {
    await this.createMany([{ ...input, origin: input.origin ?? 'user' }]);
  },

  /**
   * 把标题与已有线索匹配后标记完成。
   * - 先在还挂着的线索里找；找不到再找「被系统自动收起」的（那件事真的发生过，只是当时排不下了）。
   * - 不匹配用户自己说了「稍后再说」的线索（尊重用户的选择）。
   * - 完全找不到就不动，绝不会凭空造一条「已完成」的记录。
   */
  async completeByTitle(
    characterId: string,
    userId: string,
    title: string,
    sourceMessageIds?: string[],
    kind?: ContinuityKind,
  ): Promise<boolean> {
    const all = await this.getByCharacter(characterId, userId);
    const open = all.filter((t) => t.status === 'open');
    const archived = all.filter((t) => t.status === 'archived');
    const hit = (kind ? open.find((t) => sameThread(t, { title, kind })) : undefined)
      ?? open.find((t) => similarity(t.title, title) >= 0.62)
      ?? (kind ? archived.find((t) => sameThread(t, { title, kind })) : undefined)
      ?? archived.find((t) => similarity(t.title, title) >= 0.62);
    if (!hit) return false;
    await this.complete(hit.id, sourceMessageIds);
    return true;
  },

  async complete(id: string, sourceMessageIds?: string[]): Promise<void> {
    const existing = await db.continuityThreads.get(id);
    if (!existing) return;
    const now = Date.now();
    await db.continuityThreads.put({
      ...existing,
      status: 'done',
      completedAt: now,
      updatedAt: now,
      ...(sourceMessageIds?.length
        ? { sourceMessageIds: Array.from(new Set([...(existing.sourceMessageIds ?? []), ...sourceMessageIds])).slice(-6) }
        : {}),
    });
  },

  /** 「稍后再说」：标记为不再挂起（仍可在时间线里回看） */
  async drop(id: string): Promise<void> {
    const existing = await db.continuityThreads.get(id);
    if (!existing) return;
    await db.continuityThreads.put({ ...existing, status: 'dropped', updatedAt: Date.now() });
  },

  async reopen(id: string): Promise<void> {
    const existing = await db.continuityThreads.get(id);
    if (!existing) return;
    await db.continuityThreads.put({ ...existing, status: 'open', completedAt: undefined, updatedAt: Date.now() });
  },

  async update(
    id: string,
    patch: Partial<Pick<ContinuityThread, 'title' | 'detail' | 'kind' | 'dueAt' | 'status'>>,
  ): Promise<void> {
    const existing = await db.continuityThreads.get(id);
    if (!existing) return;
    await db.continuityThreads.put({
      ...existing,
      ...patch,
      title: patch.title !== undefined ? patch.title.trim().slice(0, 60) || existing.title : existing.title,
      detail: patch.detail !== undefined ? patch.detail.trim().slice(0, 200) || undefined : existing.detail,
      updatedAt: Date.now(),
    });
  },

  async remove(id: string): Promise<void> {
    await db.continuityThreads.delete(id);
  },

  async deleteByCharacter(characterId: string, userId: string): Promise<void> {
    const all = await db.continuityThreads.where('characterId').equals(characterId).toArray();
    const ids = all.filter((t) => t.userId === userId).map((t) => t.id);
    if (ids.length) await db.continuityThreads.bulkDelete(ids);
  },

  async clearForUser(userId: string): Promise<void> {
    const all = await db.continuityThreads.where('userId').equals(userId).toArray();
    const ids = all.map((t) => t.id);
    if (ids.length) await db.continuityThreads.bulkDelete(ids);
  },
};
