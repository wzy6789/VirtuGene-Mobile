import { db, type WorldClock, type WorldPulse } from '../../db';
import { worldPulseRepo } from '../../db/world-pulse-repo';

/** 避免每次打开页面都制造一条“世界脉冲”；自主行动阶段会在这个记录上继续工作。 */
export const WORLD_PULSE_MIN_GAP_MS = 15 * 60_000;

export function clockAt(clock: WorldClock, now = Date.now()): number {
  return clock.worldAt + Math.max(0, now - clock.lastReconciledAt);
}

/**
 * 把应用关闭期间经过的时间登记为一次待处理脉冲。
 * 这里只推进时钟并记录 pending，不编造角色行为；AI 失败时也不会出现假的世界事件。
 */
export async function beginWorldPulse(params: {
  userId: string;
  worldId: string;
  reason?: WorldPulse['reason'];
  now?: number;
  minGapMs?: number;
}): Promise<WorldPulse | null> {
  const now = params.now ?? Date.now();
  const minimum = params.minGapMs ?? WORLD_PULSE_MIN_GAP_MS;
  return db.transaction('rw', [db.worlds, db.worldPulses], async () => {
    const world = await db.worlds.get(params.worldId);
    if (!world || world.userId !== params.userId) throw new Error('world:not-found');
    const clock: WorldClock = world.clock ?? { worldAt: world.createdAt, lastReconciledAt: now, pace: 'realtime' };
    const elapsed = Math.max(0, now - clock.lastReconciledAt);
    if (elapsed < minimum) return null;
    const fromWorldTime = clock.worldAt;
    const toWorldTime = fromWorldTime + elapsed;
    const pulse: WorldPulse = {
      id: crypto.randomUUID(),
      userId: params.userId,
      worldId: params.worldId,
      reason: params.reason ?? 'resume',
      fromWorldTime,
      toWorldTime,
      status: 'pending',
      eventIds: [],
      createdAt: now,
    };
    await db.worldPulses.put(pulse);
    await db.worlds.put({
      ...world,
      clock: { ...clock, worldAt: toWorldTime, lastReconciledAt: now },
      lastPulseAt: now,
      updatedAt: now,
    });
    return pulse;
  });
}

export async function completeWorldPulse(id: string, eventIds: string[], summary?: string): Promise<void> {
  await worldPulseRepo.complete(id, { eventIds, ...(summary ? { summary } : {}) });
}

export async function failWorldPulse(id: string, error: string): Promise<void> {
  await worldPulseRepo.fail(id, error);
}
