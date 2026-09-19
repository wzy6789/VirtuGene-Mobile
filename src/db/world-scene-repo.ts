import { db, type SceneParticipantState, type WorldScene, type WorldSceneEntry, type WorldSceneState } from './index';

/**
 * 场景仓库（World Stage）：
 * - worldScenes        场景主行 + **结构化**状态（SceneState）
 * - worldSceneEntries  场景正文（独立表：长场景 / 分页 / 断点恢复 / 暂停继续 / 单条重生成）
 *
 * 明确不复用 sessions / messages（确认稿 §七）：
 * 场景有旁白、幕次、选择、用户自由行为等结构，写进聊天会污染
 * 最近聊天、未读数、聊天摘要与导出。
 */
export interface NewSceneInput {
  userId: string;
  worldId: string;
  title: string;
  place: string;
  timeLabel: string;
  mood: string;
  theme?: string;
  characterIds: string[];
  templateId?: string;
  /** 每个角色本场的目标 / 已知 / 隐瞒（隐藏张力的载体） */
  participants?: SceneParticipantState[];
  sceneGoal?: string;
  /** 世界内核为场景分配的稳定地点 / 世界脉冲来源。 */
  locationId?: string;
  pulseId?: string;
  startedWorldTime?: number;
}

export function emptySceneState(sceneGoal?: string): WorldSceneState {
  return {
    ...(sceneGoal ? { sceneGoal } : {}),
    currentAct: 1,
    currentTension: 0,
    activeSecrets: [],
    activeConflicts: [],
    pendingConsequences: [],
    resolvedEventIds: [],
    newEventIds: [],
    participants: [],
  };
}

export const worldSceneRepo = {
  async createScene(input: NewSceneInput): Promise<string> {
    const now = Date.now();
    const id = crypto.randomUUID();
    const scene: WorldScene = {
      id,
      userId: input.userId,
      worldId: input.worldId,
      // 剧情主题是星图上的短标签，统一限制为五个字，避免移动端布局被长标题挤坏。
      title: input.title.trim().slice(0, 5),
      place: input.place.trim().slice(0, 80),
      timeLabel: input.timeLabel.trim().slice(0, 40),
      mood: input.mood.trim().slice(0, 40),
      ...(input.theme ? { theme: input.theme.trim().slice(0, 80) } : {}),
      characterIds: [...new Set(input.characterIds)],
      status: 'draft',
      state: { ...emptySceneState(input.sceneGoal), participants: input.participants ?? [] },
      ...(input.templateId ? { templateId: input.templateId } : {}),
      ...(input.locationId ? { locationId: input.locationId } : {}),
      ...(input.pulseId ? { pulseId: input.pulseId } : {}),
      ...(input.startedWorldTime !== undefined ? { startedWorldTime: input.startedWorldTime } : {}),
      startedAt: now,
      createdAt: now,
      updatedAt: now,
    };
    await db.worldScenes.put(scene);
    return id;
  },

  async getScene(id: string): Promise<WorldScene | undefined> {
    return db.worldScenes.get(id);
  },

  /** 按 id 批量取（溯源面板用；已删除的条目自然不在结果里） */
  async getByIds(ids: string[]): Promise<WorldScene[]> {
    if (ids.length === 0) return [];
    const rows = await db.worldScenes.bulkGet(ids);
    return rows.filter((row): row is WorldScene => !!row);
  },

  async listScenes(worldId: string, opts: { status?: WorldScene['status']; limit?: number; userId?: string } = {}): Promise<WorldScene[]> {
    const all = await db.worldScenes.where('worldId').equals(worldId).toArray();
    return all
      .filter((s) => opts.userId === undefined || s.userId === opts.userId)
      .filter((s) => (opts.status ? s.status === opts.status : true))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, Math.max(1, opts.limit ?? 50));
  },

  /** 某个角色参与的戏（世界舞台 → 私聊上下文的召回入口） */
  async listScenesByCharacter(
    worldId: string,
    characterId: string,
    opts: { status?: WorldScene['status']; limit?: number; userId?: string } = {},
  ): Promise<WorldScene[]> {
    const all = await db.worldScenes.where('worldId').equals(worldId).toArray();
    return all
      .filter((s) => opts.userId === undefined || s.userId === opts.userId)
      .filter((s) => s.characterIds.includes(characterId))
      .filter((s) => (opts.status ? s.status === opts.status : true))
      .sort((a, b) => (b.finishedAt ?? b.updatedAt) - (a.finishedAt ?? a.updatedAt))
      .slice(0, Math.max(1, opts.limit ?? 20));
  },

  async updateScene(id: string, patch: Partial<Pick<WorldScene, 'title' | 'place' | 'timeLabel' | 'mood' | 'theme' | 'templateId'>>): Promise<void> {
    const existing = await db.worldScenes.get(id);
    if (!existing) return;
    const safePatch = patch.title === undefined
      ? patch
      : { ...patch, title: patch.title.trim().slice(0, 5) };
    await db.worldScenes.put({ ...existing, ...safePatch, updatedAt: Date.now() });
  },

  /** 状态补丁（浅合并；participants 传入时整体替换） */
  async patchSceneState(id: string, patch: Partial<WorldSceneState>): Promise<WorldScene | undefined> {
    return db.transaction('rw', db.worldScenes, async () => {
      const existing = await db.worldScenes.get(id);
      if (!existing) return undefined;
      const next: WorldScene = {
        ...existing,
        state: { ...existing.state, ...patch },
        updatedAt: Date.now(),
      };
      await db.worldScenes.put(next);
      return next;
    });
  },

  async setSceneStatus(id: string, status: WorldScene['status']): Promise<void> {
    const existing = await db.worldScenes.get(id);
    if (!existing) return;
    await db.worldScenes.put({ ...existing, status, updatedAt: Date.now() });
  },

  /**
   * 让一个角色进入当前片段（§19「让星遥过来」。
   * 自然语言与人物 chips 走的是同一个函数，因此两者效果必然一致）。
   */
  async addParticipant(
    sceneId: string,
    characterId: string,
    options: { entryMemoryMode?: 'memory' | 'present' } = {},
  ): Promise<WorldScene | undefined> {
    return db.transaction('rw', db.worldScenes, async () => {
      const existing = await db.worldScenes.get(sceneId);
      if (!existing) return undefined;
      if (existing.characterIds.includes(characterId)) return existing;
      const participant: SceneParticipantState = {
        characterId,
        goals: [],
        knowsEventIds: [],
        secrets: [],
        ...(options.entryMemoryMode ? { entryMemoryMode: options.entryMemoryMode } : {}),
      };
      const next: WorldScene = {
        ...existing,
        characterIds: [...existing.characterIds, characterId],
        state: { ...existing.state, participants: [...existing.state.participants, participant] },
        updatedAt: Date.now(),
      };
      await db.worldScenes.put(next);
      return next;
    });
  },

  /** 让一个角色离开当前片段（TA 的认知与历史不受影响，只是这一刻不在场） */
  async removeParticipant(sceneId: string, characterId: string): Promise<WorldScene | undefined> {
    return db.transaction('rw', db.worldScenes, async () => {
      const existing = await db.worldScenes.get(sceneId);
      if (!existing) return undefined;
      const next: WorldScene = {
        ...existing,
        characterIds: existing.characterIds.filter((id) => id !== characterId),
        state: {
          ...existing.state,
          participants: existing.state.participants.filter((p) => p.characterId !== characterId),
        },
        updatedAt: Date.now(),
      };
      await db.worldScenes.put(next);
      return next;
    });
  },

  /** 结束场景并挂上它产生的世界事件（年表条目） */
  async finishScene(id: string, worldEventId?: string): Promise<void> {
    const existing = await db.worldScenes.get(id);
    if (!existing) return;
    const now = Date.now();
    await db.worldScenes.put({
      ...existing,
      status: 'finished',
      finishedAt: now,
      ...(worldEventId ? { worldEventId } : {}),
      updatedAt: now,
    });
  },

  /**
   * 追加一条场景条目。index 在**事务内**取当前最大值 +1，
   * 避免并发写入时错序（同一场景不会出现两条相同 index）。
   */
  async appendEntry(
    sceneId: string,
    entry: { kind: WorldSceneEntry['kind']; content: string; act?: number; speakerId?: string; meta?: WorldSceneEntry['meta'] },
  ): Promise<WorldSceneEntry> {
    return db.transaction('rw', db.worldScenes, db.worldSceneEntries, async () => {
      const scene = await db.worldScenes.get(sceneId);
      const rows = await db.worldSceneEntries.where('sceneId').equals(sceneId).toArray();
      const nextIndex = rows.reduce((max, r) => Math.max(max, r.index + 1), 0);
      const row: WorldSceneEntry = {
        id: crypto.randomUUID(),
        sceneId,
        index: nextIndex,
        kind: entry.kind,
        act: entry.act ?? scene?.state.currentAct ?? 1,
        ...(entry.speakerId ? { speakerId: entry.speakerId } : {}),
        content: entry.content,
        ...(entry.meta ? { meta: entry.meta } : {}),
        createdAt: Date.now(),
      };
      await db.worldSceneEntries.put(row);
      if (scene) await db.worldScenes.put({ ...scene, updatedAt: Date.now() });
      return row;
    });
  },

  /** 场景正文分页：afterIndex 之后取 limit 条（断点恢复 / 长场景懒加载） */
  async listEntries(sceneId: string, opts: { afterIndex?: number; limit?: number } = {}): Promise<WorldSceneEntry[]> {
    const rows = await db.worldSceneEntries.where('sceneId').equals(sceneId).toArray();
    return rows
      .filter((r) => (opts.afterIndex != null ? r.index > opts.afterIndex : true))
      .sort((a, b) => a.index - b.index)
      .slice(0, Math.max(1, opts.limit ?? 200));
  },

  async countEntries(sceneId: string): Promise<number> {
    return db.worldSceneEntries.where('sceneId').equals(sceneId).count();
  },

  /** 删除单条（用于"单条重新生成"） */
  async removeEntry(entryId: string): Promise<void> {
    await db.worldSceneEntries.delete(entryId);
  },

  /**
   * 改写某条正文（一致性守护发现问题时用）。
   *
   * 为什么需要它：正文是**边生成边显示**的（§57 渐进式回应），
   * 而一致性守护在所有角色生成完之后才跑。如果守护改写的内容不落回那一行，
   * 用户看到的就会是"未被修正"的版本——守护等于白跑。
   */
  async updateEntryContent(entryId: string, content: string): Promise<void> {
    const existing = await db.worldSceneEntries.get(entryId);
    if (!existing) return;
    await db.worldSceneEntries.put({ ...existing, content });
  },

  /**
   * 给某条正文打 meta 补丁（浅合并）。
   * 目前用途：用户点了"选择提示"里的某个选项后，在那条上记下 `chosen`，
   * 这样 UI 就不会再重复显示可点的选项，回看时也能看到"你当时选了什么"。
   */
  async patchEntryMeta(entryId: string, meta: NonNullable<WorldSceneEntry['meta']>): Promise<WorldSceneEntry | undefined> {
    return db.transaction('rw', db.worldSceneEntries, async () => {
      const existing = await db.worldSceneEntries.get(entryId);
      if (!existing) return undefined;
      const next: WorldSceneEntry = { ...existing, meta: { ...(existing.meta ?? {}), ...meta } };
      await db.worldSceneEntries.put(next);
      return next;
    });
  },

  async deleteScene(id: string): Promise<void> {
    await db.transaction('rw', db.worldScenes, db.worldSceneEntries, async () => {
      await db.worldSceneEntries.where('sceneId').equals(id).delete();
      await db.worldScenes.delete(id);
    });
  },

  async countByWorld(worldId: string): Promise<number> {
    return db.worldScenes.where('worldId').equals(worldId).count();
  },

  async clearForWorld(worldId: string): Promise<void> {
    const scenes = await db.worldScenes.where('worldId').equals(worldId).toArray();
    for (const scene of scenes) await this.deleteScene(scene.id);
  },

  async clearForUser(userId: string): Promise<void> {
    const scenes = await db.worldScenes.where('userId').equals(userId).toArray();
    for (const scene of scenes) await this.deleteScene(scene.id);
  },

  /**
   * 角色被删除：
   * - 从未开始的 draft 场景直接删除（没有留下的内容）
   * - 已经开始/结束的场景**保留正文**，只把该角色从参与者里摘掉
   */
  /**
   * 角色被删除：
   * - **完全没有内容的** draft 场景直接删除（什么都不会丢）
   * - 只要已经写过正文（哪怕状态还是 draft）或已经开始/结束：**保留正文**，
   *   只把该角色从参与者与 SceneState.participants 里摘掉
   */
  async cleanupForCharacter(userId: string, characterId: string): Promise<number> {
    const scenes = (await db.worldScenes.where('userId').equals(userId).toArray())
      .filter((s) => s.characterIds.includes(characterId));
    let touched = 0;
    for (const scene of scenes) {
      const entries = await this.countEntries(scene.id);
      if (scene.status === 'draft' && entries === 0) {
        await this.deleteScene(scene.id);
        touched += 1;
        continue;
      }
      await db.worldScenes.put({
        ...scene,
        characterIds: scene.characterIds.filter((id) => id !== characterId),
        state: { ...scene.state, participants: scene.state.participants.filter((p) => p.characterId !== characterId) },
        updatedAt: Date.now(),
      });
      touched += 1;
    }
    return touched;
  },
};
