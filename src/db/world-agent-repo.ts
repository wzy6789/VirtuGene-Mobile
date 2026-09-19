import { db, type WorldAgentState, type WorldPresence } from './index';

export function agentStateId(worldId: string, characterId: string): string {
  return `agent:${worldId}:${characterId}`;
}

export function presenceId(worldId: string, characterId: string): string {
  return `presence:${worldId}:${characterId}`;
}

export const worldAgentRepo = {
  async ensureState(userId: string, worldId: string, characterId: string): Promise<WorldAgentState> {
    const id = agentStateId(worldId, characterId);
    const existing = await db.worldAgentStates.get(id);
    if (existing && existing.userId === userId) return existing;
    const now = Date.now();
    const state: WorldAgentState = {
      id,
      userId,
      worldId,
      characterId,
      autonomy: 'normal',
      updatedAt: now,
    };
    await db.worldAgentStates.put(state);
    return state;
  },

  async ensureStates(userId: string, worldId: string, characterIds: string[]): Promise<WorldAgentState[]> {
    return Promise.all(characterIds.map((characterId) => this.ensureState(userId, worldId, characterId)));
  },

  async getState(worldId: string, characterId: string, userId?: string): Promise<WorldAgentState | undefined> {
    const row = await db.worldAgentStates.get(agentStateId(worldId, characterId));
    return row && (userId === undefined || row.userId === userId) ? row : undefined;
  },

  async listStates(worldId: string, userId?: string): Promise<WorldAgentState[]> {
    const rows = await db.worldAgentStates.where('worldId').equals(worldId).toArray();
    return rows.filter((row) => userId === undefined || row.userId === userId).sort((a, b) => b.updatedAt - a.updatedAt);
  },

  async updateState(
    worldId: string,
    characterId: string,
    patch: Partial<Pick<WorldAgentState, 'autonomy' | 'currentGoal' | 'nextIntent' | 'lastPulseAt' | 'lastActionAt'>>,
  ): Promise<WorldAgentState | undefined> {
    const existing = await db.worldAgentStates.get(agentStateId(worldId, characterId));
    if (!existing) return undefined;
    const next = { ...existing, ...patch, updatedAt: Date.now() };
    await db.worldAgentStates.put(next);
    return next;
  },

  async moveCharacter(params: {
    userId: string;
    worldId: string;
    characterId: string;
    locationId: string;
    worldTime: number;
    status?: WorldPresence['status'];
    note?: string;
  }): Promise<WorldPresence> {
    const id = presenceId(params.worldId, params.characterId);
    const current = await db.worldPresences.get(id);
    const next: WorldPresence = {
      id,
      userId: params.userId,
      worldId: params.worldId,
      characterId: params.characterId,
      locationId: params.locationId,
      status: params.status ?? 'present',
      sinceWorldTime: current?.locationId === params.locationId ? current.sinceWorldTime : params.worldTime,
      ...(params.note ? { note: params.note.slice(0, 160) } : {}),
      updatedAt: Date.now(),
    };
    await db.worldPresences.put(next);
    await this.ensureState(params.userId, params.worldId, params.characterId);
    return next;
  },

  async setPresenceStatus(params: {
    userId: string;
    worldId: string;
    characterId: string;
    status: WorldPresence['status'];
    worldTime: number;
    note?: string;
  }): Promise<WorldPresence | undefined> {
    const existing = await db.worldPresences.get(presenceId(params.worldId, params.characterId));
    if (!existing || existing.userId !== params.userId) return undefined;
    const next: WorldPresence = {
      ...existing,
      status: params.status,
      sinceWorldTime: params.status === 'present' ? params.worldTime : existing.sinceWorldTime,
      ...(params.note ? { note: params.note.slice(0, 160) } : {}),
      updatedAt: Date.now(),
    };
    await db.worldPresences.put(next);
    return next;
  },

  async listPresences(worldId: string, userId?: string): Promise<WorldPresence[]> {
    const rows = await db.worldPresences.where('worldId').equals(worldId).toArray();
    return rows.filter((row) => userId === undefined || row.userId === userId).sort((a, b) => b.updatedAt - a.updatedAt);
  },

  async listAtLocation(worldId: string, locationId: string, userId?: string): Promise<WorldPresence[]> {
    const rows = await db.worldPresences.where('[worldId+locationId]').equals([worldId, locationId]).toArray();
    return rows.filter((row) => (userId === undefined || row.userId === userId) && row.status === 'present');
  },

  async clearForWorld(worldId: string): Promise<void> {
    await Promise.all([
      db.worldPresences.where('worldId').equals(worldId).delete(),
      db.worldAgentStates.where('worldId').equals(worldId).delete(),
    ]);
  },

  async clearForUser(userId: string): Promise<void> {
    await Promise.all([
      db.worldPresences.where('userId').equals(userId).delete(),
      db.worldAgentStates.where('userId').equals(userId).delete(),
    ]);
  },

  async removeCharacter(userId: string, worldId: string, characterId: string): Promise<void> {
    const presence = await db.worldPresences.get(presenceId(worldId, characterId));
    if (presence?.userId === userId) await db.worldPresences.delete(presence.id);
    const state = await db.worldAgentStates.get(agentStateId(worldId, characterId));
    if (state?.userId === userId) await db.worldAgentStates.delete(state.id);
  },
};
