import { useEffect, useMemo, useState } from 'react';
import { db, type CharacterState, type RelationshipEvent, type RelationshipState } from '../../db/index';
import { useAuthStore } from '../../store/auth-store';
import { useChatStore } from '../../store/chat-store';
import { useUIStore } from '../../store/ui-store';
import { worldRepo } from '../../db/world-repo';
import { relationshipRepo } from '../../db/relationship-repo';
import { sharedMemoryRepo } from '../../db/shared-memory-repo';
import { continuityRepo } from '../../db/continuity-repo';
import { characterRef, userRef } from '../../lib/world/subjects';
import { describeFacets, hasExplainableRecord, pairTitle, recentReasons, reasonText } from '../../lib/world/relationships';
import { relativeDay } from '../../lib/world/world-picks';
import { getRelationLevel } from '../../lib/affinity';
import { SpaceHeading } from '../ui/SpaceHeading';
import { Avatar } from '../ui/Avatar';

/**
 * 关系网络（5.0 Phase 2b-5 / 2B：可解释化）
 *
 * 只回答两个问题，而且**只讲真实发生过的事**：
 *   1. 现在是什么关系 —— 等阶来自 4.x 好感度（唯一来源），分面来自世界层（有记录才显示）
 *   2. 为什么会变成这样 —— 关系变化史里的真实原因（4.x 等阶升级会实时写进来）
 *
 * 纪律：**不显示任何内部数值**（好感度数字、分面数字、权重都不出现）；
 * 没有记录就说"还没有记录到变化"，不编故事。
 * 全程本地读取，不调用任何 AI。
 */
export function MobileRelationsPage() {
  const userId = useAuthStore((s) => s.userId) ?? '';
  const characters = useChatStore((s) => s.characters);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [states, setStates] = useState<RelationshipState[]>([]);
  const [events, setEvents] = useState<RelationshipEvent[]>([]);
  const [charStates, setCharStates] = useState<CharacterState[]>([]);
  const [memoryCounts, setMemoryCounts] = useState<Record<string, number>>({});
  const [threadCounts, setThreadCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    let alive = true;
    void (async () => {
      if (!userId) { setLoading(false); return; }
      setLoading(true);
      setLoadError(false);
      try {
        const world = await worldRepo.ensureDefaultWorld(userId, useAuthStore.getState().username ?? undefined);
        const [nextStates, nextEvents, nextCharStates] = await Promise.all([
          relationshipRepo.listStatesByWorld(world.id),
          relationshipRepo.listEventsByWorld(world.id),
          db.characterStates.where('userId').equals(userId).toArray(),
        ]);
        if (!alive) return;
        setStates(nextStates);
        setEvents(nextEvents);
        setCharStates(nextCharStates);
        // 真实计数（"你们一起经历过多少事"），失败不影响页面其它部分
        const mem: Record<string, number> = {};
        const thr: Record<string, number> = {};
        await Promise.all(charStates.map(async (cs) => {
          try {
            mem[cs.characterId] = (await sharedMemoryRepo.listExperiencedWith(cs.characterId, world.id, 100)).length;
            thr[cs.characterId] = (await continuityRepo.getOpenByCharacter(cs.characterId, userId)).length;
          } catch { /* ignore */ }
        }));
        if (alive) { setMemoryCounts(mem); setThreadCounts(thr); }
      } catch {
        if (alive) { setStates([]); setEvents([]); setCharStates([]); setLoadError(true); }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    if (characters.length === 0) void useChatStore.getState().loadCharacters();
    return () => { alive = false; };
  }, [userId, characters.length, reloadToken]);

  const nameOf = useMemo(() => {
    const map = new Map(characters.map((c) => [c.id, c.name]));
    return (id: string) => map.get(id) ?? 'TA';
  }, [characters]);

  /** 角色 ↔ 角色（世界层独有：4.x 没有"角色之间的关系"） */
  const pairStates = useMemo(
    () => states.filter((s) => !s.subjects.includes(userRef(userId))),
    [states, userId],
  );

  const eventsOf = useMemo(() => {
    const map = new Map<string, RelationshipEvent[]>();
    for (const e of events) {
      const list = map.get(e.pairKey) ?? [];
      list.push(e);
      map.set(e.pairKey, list);
    }
    return (pairKey: string) => map.get(pairKey) ?? [];
  }, [events]);

  const stateOf = useMemo(() => {
    const map = new Map(states.map((s) => [s.pairKey, s]));
    return (pairKey: string) => map.get(pairKey);
  }, [states]);

  const myCharacters = useMemo(() => characters.filter((c) => c.createdBy === userId), [characters, userId]);
  const charStateOf = useMemo(() => {
    const map = new Map(charStates.map((cs) => [cs.characterId, cs]));
    return (id: string) => map.get(id);
  }, [charStates]);

  return (
    <div className="h-full overflow-y-auto px-4 pb-6">
      <div className="pt-5">
        <SpaceHeading eyebrow="relationships" title="关系网络" detail="现在是什么关系，以及为什么会变成这样。" />
      </div>

      <button
        type="button"
        onClick={() => useUIStore.getState().setActiveView('chat')}
        className="mt-3 text-xs text-gray-400 transition-colors hover:text-ink"
      >
        ‹ 返回世界
      </button>

      {loading ? (
        <div className="mt-10 text-center text-sm text-gray-500" role="status">正在读取你们的关系…</div>
      ) : loadError ? (
        <section className="mt-5 rounded-[26px] border border-rose-400/25 bg-rose-500/[0.06] px-5 py-7 text-center">
          <h2 className="text-base font-semibold text-ink">关系读取失败</h2>
          <p className="mt-2 text-xs leading-6 text-gray-500">没能从本机读到关系记录。你的数据仍保存在这台设备上。</p>
          <button
            type="button"
            onClick={() => setReloadToken((n) => n + 1)}
            className="mt-5 w-full rounded-xl border border-line px-4 py-2.5 text-sm text-sub active:scale-[.99]"
          >
            重新读取
          </button>
        </section>
      ) : (
        <section className="mt-5 space-y-5">
          {/* ---------- 你和他们 ---------- */}
          <div>
            <p className="mb-2 text-[10px] tracking-[0.16em] uppercase text-gray-500">你和他们</p>
            {myCharacters.length === 0 ? (
              <p className="rounded-2xl border border-line bg-surface/60 px-4 py-5 text-center text-xs text-gray-500">
                你还没有角色。先去「角色」里认识一个吧。
              </p>
            ) : (
              <ul className="space-y-2.5">
                {myCharacters.map((c) => {
                  const cs = charStateOf(c.id);
                  const affinity = cs?.affinity ?? 0;
                  const { level } = getRelationLevel(affinity);
                  const levelName = cs?.tierNames?.[level.name] || level.name;
                  const pairKey = `${[characterRef(c.id), userRef(userId)].sort().join('|')}`;
                  const st = stateOf(pairKey);
                  const reasons = recentReasons(eventsOf(pairKey), 2);
                  const facets = describeFacets(st, 2);
                  const memories = memoryCounts[c.id] ?? 0;
                  const threads = threadCounts[c.id] ?? 0;
                  return (
                    <li key={c.id} className="rounded-[22px] border border-line bg-surface/70 px-4 py-4">
                      <div className="flex items-center gap-3">
                        <Avatar avatar={c.avatar} size="sm" className="ring-1 ring-life-cyan/30" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-ink">{c.name}</p>
                          <p className="mt-0.5 text-[11px] text-life-cyan">{levelName} · {level.desc}</p>
                        </div>
                      </div>

                      <p className="mt-2.5 text-[11px] leading-5 text-gray-500">
                        {memories > 0 && `你们一起经历过 ${memories} 件事`}
                        {memories > 0 && threads > 0 && ' · '}
                        {threads > 0 && `还有 ${threads} 件没做完`}
                        {memories === 0 && threads === 0 && '还没有留下共同的经历'}
                      </p>

                      {facets.length > 0 && (
                        <p className="mt-1.5 flex flex-wrap gap-1.5">
                          {facets.map((f) => (
                            <span key={f.facet} className="rounded-full bg-gene-purple/10 px-2 py-0.5 text-[10px] text-gene-purple">
                              {f.text}
                            </span>
                          ))}
                        </p>
                      )}

                      <div className="mt-3 border-t border-line pt-2.5">
                        <p className="text-[10px] text-gray-500">为什么会变成这样</p>
                        {reasons.length === 0 ? (
                          <p className="mt-1.5 text-[11px] leading-5 text-gray-500">
                            还没有记录到变化。等阶升级、一起经历的事，会慢慢出现在这里。
                          </p>
                        ) : (
                          <ul className="mt-1.5 space-y-1.5">
                            {reasons.map((e) => (
                              <li key={e.id} className="flex items-start gap-2">
                                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-life-cyan" />
                                <span className="min-w-0 flex-1">
                                  <span className="block text-[12px] leading-5 text-ink/90">{reasonText(e)}</span>
                                  <span className="text-[10px] text-gray-500">{relativeDay(e.createdAt)}</span>
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* ---------- 他们之间 ---------- */}
          <div>
            <p className="mb-2 text-[10px] tracking-[0.16em] uppercase text-gray-500">他们之间</p>
            {pairStates.length === 0 ? (
              <p className="rounded-2xl border border-line bg-surface/60 px-4 py-5 text-center text-xs leading-6 text-gray-500">
                角色之间还没有发生能被记下来的事。<br />
                等他们在同一个故事里相遇，这里会慢慢长出关系网。
              </p>
            ) : (
              <ul className="space-y-2.5">
                {pairStates.map((s) => {
                  const reasons = recentReasons(eventsOf(s.pairKey), 2);
                  const facets = describeFacets(s, 3);
                  return (
                    <li key={s.id} className="rounded-[22px] border border-line bg-surface/70 px-4 py-4">
                      <p className="text-sm font-medium text-ink">{pairTitle(s, userId, nameOf)}</p>
                      {facets.length > 0 ? (
                        <p className="mt-1.5 flex flex-wrap gap-1.5">
                          {facets.map((f) => (
                            <span key={f.facet} className="rounded-full bg-gene-purple/10 px-2 py-0.5 text-[10px] text-gene-purple">
                              {f.text}
                            </span>
                          ))}
                        </p>
                      ) : (
                        <p className="mt-1.5 text-[11px] text-gray-500">还没有记录到他们之间的具体变化。</p>
                      )}
                      {reasons.length > 0 && (
                        <ul className="mt-2.5 space-y-1.5 border-t border-line pt-2.5">
                          {reasons.map((e) => (
                            <li key={e.id} className="flex items-start gap-2">
                              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-life-cyan" />
                              <span className="min-w-0 flex-1">
                                <span className="block text-[12px] leading-5 text-ink/90">{reasonText(e)}</span>
                                <span className="text-[10px] text-gray-500">{relativeDay(e.createdAt)}</span>
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                      {!hasExplainableRecord(s, eventsOf(s.pairKey)) && (
                        <p className="mt-1.5 text-[11px] text-gray-500">
                          他们在同一个世界里，但还没有留下能解释的变化。
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <p className="pb-2 text-center text-[10px] leading-relaxed text-gray-600">
            这里只写真实发生过的变化：等阶升级、约定与共同经历。<br />
            不显示任何内部数值。
          </p>
        </section>
      )}
    </div>
  );
}
