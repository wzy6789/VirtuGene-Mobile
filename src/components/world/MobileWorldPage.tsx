import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuthStore } from '../../store/auth-store';
import { useChatStore } from '../../store/chat-store';
import { useUIStore } from '../../store/ui-store';
import { worldRepo } from '../../db/world-repo';
import { worldSceneRepo } from '../../db/world-scene-repo';
import { worldEventRepo } from '../../db/world-event-repo';
import type { WorldEvent, WorldPulse, WorldScene, WorldSceneEntry } from '../../db/index';
import { SpaceHeading } from '../ui/SpaceHeading';
import { WorldConstellation } from './WorldConstellation';
import { WorldSceneConstellation } from './WorldSceneConstellation';
import { ensureWorldKernel, type WorldKernelSnapshot } from '../../lib/world/world-kernel';
import { runWorldPulse, type WorldAutonomyResult } from '../../lib/world/world-autonomy';
import { worldPulseRepo } from '../../db/world-pulse-repo';
import { WorldLivingPanel } from './WorldLivingPanel';
import { momentsRepo } from '../../db/moments-repo';
import { loadMomentsPreferences } from '../../lib/moments/preferences';

const DAY_MS = 86_400_000;

export function MobileWorldPage() {
  const userId = useAuthStore((state) => state.userId);
  const characters = useChatStore((state) => state.characters);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [scenes, setScenes] = useState<WorldScene[]>([]);
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null);
  const [selectedEntries, setSelectedEntries] = useState<WorldSceneEntry[]>([]);
  const [entriesLoading, setEntriesLoading] = useState(false);
  const [kernel, setKernel] = useState<WorldKernelSnapshot | null>(null);
  const [stats, setStats] = useState<Awaited<ReturnType<typeof worldRepo.stats>>>(null);
  const [pulse, setPulse] = useState<WorldPulse | null>(null);
  const [recentWorldEvents, setRecentWorldEvents] = useState<WorldEvent[]>([]);
  const [pulseBusy, setPulseBusy] = useState(false);
  const [worldExpanded, setWorldExpanded] = useState(false);
  const [panelReady, setPanelReady] = useState(false);
  const [momentUnread, setMomentUnread] = useState(0);
  const theaterOpen = useUIStore((state) => state.worldTheaterOpen);

  useEffect(() => {
    if (!userId) return;
    // 角标跟着朋友圈设置里的「新互动红点」开关走；关掉就不再提示未读（记录仍保留）
    const refresh = () => {
      if (!loadMomentsPreferences(userId).showUnreadBadge) {
        setMomentUnread(0);
        return;
      }
      void momentsRepo.unreadNotifications(userId).then((items) => setMomentUnread(items.length)).catch(() => undefined);
    };
    refresh();
    const timer = window.setInterval(refresh, 30_000);
    return () => window.clearInterval(timer);
  }, [userId]);

  const selectedScene = useMemo(
    () => scenes.find((scene) => scene.id === selectedSceneId) ?? null,
    [scenes, selectedSceneId],
  );
  useEffect(() => {
    let alive = true;
    let idleTimer: number | undefined;
    void (async () => {
      if (!userId) {
        setLoading(false);
        return;
      }
      setLoading(true);
      setLoadError(false);
      try {
        const world = await worldRepo.ensureDefaultWorld(userId);
        const [nextScenes, nextKernel, nextStats, nextEvents] = await Promise.all([
          worldSceneRepo.listScenes(world.id, { limit: 50, userId }),
          ensureWorldKernel({
            userId,
            worldId: world.id,
            characterIds: useChatStore.getState().characters.map((character) => character.id),
          }),
          worldRepo.stats(world.id),
          worldEventRepo.listTimeline(world.id, { limit: 4, userId }),
        ]);
        if (!alive) return;
        setScenes(nextScenes);
        setKernel(nextKernel);
        setStats(nextStats);
        setRecentWorldEvents(nextEvents);
        setSelectedSceneId(null);
        const recentPulses = await worldPulseRepo.listRecent(world.id, 1, userId);
        if (alive) setPulse(recentPulses[0] ?? null);
        // 首屏先可交互；离线脉冲在后台完成，避免一次模型请求把世界入口卡住。
        if (alive) setLoading(false);
        const currentCharacters = useChatStore.getState().characters;
        if (currentCharacters.length > 0) {
          // 给首屏和“此刻”展开留出一个绘制帧；世界脉冲仍然保留，只移到后台空闲时执行。
          const runPulseWhenIdle = () => {
            if (!alive) return;
            setPulseBusy(true);
            void (async () => {
              try {
                const result: WorldAutonomyResult = await runWorldPulse({ userId, worldId: world.id, characters: currentCharacters });
                if (alive && result.pulse) {
                  setPulse(result.pulse);
                  if (result.status !== 'skipped' && result.eventIds.length > 0) {
                    const [refreshedScenes, refreshedKernel, refreshedStats, refreshedEvents] = await Promise.all([
                      worldSceneRepo.listScenes(world.id, { limit: 50, userId }),
                      ensureWorldKernel({ userId, worldId: world.id, characterIds: currentCharacters.map((character) => character.id) }),
                      worldRepo.stats(world.id),
                      worldEventRepo.listTimeline(world.id, { limit: 4, userId }),
                    ]);
                    if (alive) { setScenes(refreshedScenes); setKernel(refreshedKernel); setStats(refreshedStats); setRecentWorldEvents(refreshedEvents); }
                  }
                }
              } catch { /* 后台增强失败不影响世界入口 */ }
              finally { if (alive) setPulseBusy(false); }
            })();
          };
          idleTimer = window.setTimeout(runPulseWhenIdle, 'requestIdleCallback' in window ? 480 : 720);
        }
      } catch {
        if (alive) {
          setScenes([]);
          setKernel(null);
          setStats(null);
          setRecentWorldEvents([]);
          setSelectedSceneId(null);
          setLoadError(true);
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    if (characters.length === 0) void useChatStore.getState().loadCharacters();
    return () => { alive = false; if (idleTimer !== undefined) window.clearTimeout(idleTimer); };
  }, [userId, characters.length, reloadToken]);

  useEffect(() => {
    if (!worldExpanded) { setPanelReady(false); return; }
    const frame = window.setTimeout(() => setPanelReady(true), 32);
    return () => window.clearTimeout(frame);
  }, [worldExpanded]);

  useEffect(() => {
    let alive = true;
    if (!selectedSceneId) {
      setSelectedEntries([]);
      setEntriesLoading(false);
      return () => { alive = false; };
    }
    setEntriesLoading(true);
    void worldSceneRepo.listEntries(selectedSceneId, { limit: 400 })
      .then((entries) => {
        if (alive) setSelectedEntries(entries.filter((entry) => entry.kind !== 'system').slice(-4));
      })
      .catch(() => {
        if (alive) setSelectedEntries([]);
      })
      .finally(() => {
        if (alive) setEntriesLoading(false);
      });
    return () => { alive = false; };
  }, [selectedSceneId]);

  const openDiary = () => useUIStore.getState().setActiveView('diary');
  const openTodo = () => useUIStore.getState().setActiveView('todo');
  const openMoments = () => useUIStore.getState().setActiveView('moments');
  const openStage = () => useUIStore.getState().setActiveView('stage');
  const createWorld = () => {
    // 直接展开创建表单；创建成功后由资料页送入统一播放器
    useUIStore.getState().setWorldCreateIntent(true);
    useUIStore.getState().setActiveView('stage');
  };
  const openRelations = () => useUIStore.getState().setActiveView('relations');
  const openMemory = () => useUIStore.getState().setActiveView('memory');
  const openTimeline = () => useUIStore.getState().setActiveView('timeline');
  const openSettings = () => useUIStore.getState().setActiveView('worldSettings');
  const openTheater = () => {
    setSelectedSceneId(null);
    useUIStore.getState().setWorldTheaterOpen(true);
  };
  const leaveTheater = () => {
    setSelectedSceneId(null);
    useUIStore.getState().setWorldTheaterOpen(false);
  };
  const enterLivingWorld = () => {
    // “此刻”只回到仍在进行的生活；已暂停的旧世界从它自己的星点继续，避免串场。
    const active = scenes.find((scene) => scene.status === 'active');
    useUIStore.getState().openCanvas(active?.id ?? null);
  };
  const continueScene = () => {
    if (selectedScene) useUIStore.getState().openCanvas(selectedScene.id);
  };
  const openSceneDetails = (sceneId: string) => setSelectedSceneId(sceneId);
  const triggerManualPulse = useCallback(async () => {
    if (!userId || !kernel || pulseBusy || characters.length === 0) return;
    setPulseBusy(true);
    try {
      const result = await runWorldPulse({
        userId,
        worldId: kernel.world.id,
        characters,
        reason: 'manual',
        minGapMs: 0,
      });
      if (result.pulse) setPulse(result.pulse);
      const [nextScenes, nextKernel, nextStats, nextEvents] = await Promise.all([
        worldSceneRepo.listScenes(kernel.world.id, { limit: 50, userId }),
        ensureWorldKernel({ userId, worldId: kernel.world.id, characterIds: characters.map((character) => character.id) }),
        worldRepo.stats(kernel.world.id),
        worldEventRepo.listTimeline(kernel.world.id, { limit: 4, userId }),
      ]);
      setScenes(nextScenes);
      setKernel(nextKernel);
      setStats(nextStats);
      setRecentWorldEvents(nextEvents);
    } finally {
      setPulseBusy(false);
    }
  }, [characters, kernel, pulseBusy, userId]);

  const nowCard = (
    <section className={`vg-world-now-card ${worldExpanded ? 'is-open' : ''}`} aria-label="此刻的世界">
      <div className="vg-world-now-head">
        <span className="vg-world-pulse-orb" aria-hidden="true" />
        <div>
          <span>此刻</span>
          <strong>{kernel ? `第 ${Math.max(1, Math.floor((kernel.currentWorldTime - kernel.world.createdAt) / DAY_MS) + 1)} 天 · ${characters.length} 位角色 · ${stats?.sharedMemoryCount ?? 0} 段共同经历` : '世界正在醒来'}</strong>
        </div>
        <button type="button" onClick={() => setWorldExpanded((value) => !value)}>{worldExpanded ? '收起' : '看看发生了什么'}</button>
      </div>
      <p className="vg-world-now-summary">
        {pulseBusy ? '角色们正在沿着自己的生活继续行动。' : pulse?.summary ?? '你不在的时候，时间也会在这里留下痕迹。'}
      </p>
      {worldExpanded && kernel && panelReady && (
        <WorldLivingPanel
          kernel={kernel}
          characters={characters}
          scenes={scenes}
          events={recentWorldEvents}
          pulse={pulse}
          pulseBusy={pulseBusy}
          onPulse={() => void triggerManualPulse()}
        />
      )}
      <div className="vg-world-now-actions">
        <button type="button" className="is-primary" onClick={enterLivingWorld}>进入此刻</button>
        <button type="button" onClick={() => void triggerManualPulse()} disabled={pulseBusy || characters.length === 0}>{pulseBusy ? '世界行走中…' : '让时间走一步'}</button>
      </div>
    </section>
  );

  return (
    <div className="vg-world-page h-full overflow-y-auto px-4 pb-8">
      {!theaterOpen && !selectedScene && (
        <div className="pt-5 vg-world-hero">
          <svg className="vg-world-helix" viewBox="0 0 120 120" fill="none" aria-hidden="true">
            <circle cx="60" cy="60" r="49" stroke="currentColor" strokeOpacity=".22" />
            <circle cx="60" cy="60" r="34" stroke="currentColor" strokeOpacity=".15" strokeDasharray="2 5" />
            <path d="M39 20C81 32 81 48 39 60S-3 89 80 102M81 20C39 32 39 48 81 60s42 29-41 42" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeOpacity=".56" />
            <path d="M46 27h28M48 43h24M47 60h26M48 77h24M46 94h28" stroke="currentColor" strokeWidth=".8" strokeOpacity=".35" />
            <circle cx="81" cy="60" r="3" fill="currentColor" />
          </svg>
          <SpaceHeading eyebrow="" title="世界 Living World" detail="你的生活，与他们的时间在这里相遇。" />
          <nav className="vg-world-life-entries" aria-label="世界入口">
            <button type="button" className="vg-world-life-entry is-moments" onClick={openMoments}>
              <svg aria-hidden="true" width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8A2.5 2.5 0 0 1 17.5 16H11l-5 4v-4.2A2.5 2.5 0 0 1 4 13.5v-8Z" /><path d="M8 8h8M8 11h5" /></svg>
              <strong>朋友圈</strong>
              <span>分享今天的片段</span>
              {momentUnread > 0 && <em className="vg-world-moment-badge">{momentUnread > 99 ? '99+' : momentUnread} 条新互动</em>}
              <i aria-hidden="true">↗</i>
            </button>
            <button type="button" className="vg-world-life-entry is-diary" onClick={openDiary}>
              <svg aria-hidden="true" width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h6a3 3 0 0 1 3 3v14a4 4 0 0 0-4-2H4V4Z" /><path d="M13 7a3 3 0 0 1 3-3h4v15h-3a4 4 0 0 0-4 2M7 8h3M7 12h3" /></svg>
              <strong>日记</strong>
              <span>留下今天的故事</span>
              <i aria-hidden="true">↗</i>
            </button>
            <button type="button" className="vg-world-life-entry is-todo" onClick={openTodo}>
              <svg aria-hidden="true" width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="5" width="16" height="16" rx="3" /><path d="M8 3v4M16 3v4M4 10h16M8 15l3 3 5-5" /></svg>
              <strong>待办</strong>
              <span>安排接下来的事</span>
              <i aria-hidden="true">↗</i>
            </button>
            <button type="button" className="vg-world-life-entry is-stage" onClick={openTheater}>
              <svg aria-hidden="true" width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v11a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5v-11Z" /><path d="m9 8 6 4-6 4V8Z" /></svg>
              <strong>星域</strong>
              <span>进入正在发生的世界</span>
              <i aria-hidden="true">↗</i>
            </button>
          </nav>
        </div>
      )}

      {loading ? (
        <div className="mt-10 text-center text-sm text-gray-500" role="status">正在读取你的世界…</div>
      ) : loadError ? (
        <section className="mt-5 rounded-[26px] border border-rose-400/25 bg-rose-500/[0.06] px-5 py-7 text-center">
          <h2 className="mt-1 text-base font-semibold text-ink">世界读取失败</h2>
          <p className="mt-2 text-xs leading-6 text-gray-500">没有读到本机保存的世界记录。你的数据仍在这台设备上。</p>
          <button type="button" onClick={() => setReloadToken((token) => token + 1)} className="mt-5 w-full rounded-xl border border-line px-4 py-2.5 text-sm text-sub active:scale-[.99]">重新读取</button>
        </section>
      ) : (
        <>
          {theaterOpen ? (
            <section className="vg-world-theater" aria-label="世界星域">
              <header className="vg-world-theater-header">
                <button type="button" onClick={leaveTheater} aria-label="返回世界">‹</button>
                <div>
                  <span>WORLD CONSTELLATION</span>
                  <h1>星域</h1>
                </div>
                <i aria-hidden="true" />
              </header>
              {selectedScene ? (
                <WorldSceneConstellation
                  scene={selectedScene}
                  entries={selectedEntries}
                  characters={characters}
                  entriesLoading={entriesLoading}
                  onBack={() => setSelectedSceneId(null)}
                  onContinue={continueScene}
                />
              ) : (
                <>
                  {nowCard}
                  <WorldConstellation
                    scenes={scenes}
                    currentSceneId={selectedSceneId}
                    onOpenScene={openSceneDetails}
                    onOpenStage={openStage}
                    onCreate={createWorld}
                  />
                  <nav className="vg-world-dock" aria-label="世界档案">
                    <button type="button" onClick={openRelations}><span>⌁</span><b>关系</b><em>谁与谁正在靠近</em></button>
                    <button type="button" onClick={openMemory}><span>✦</span><b>记忆</b><em>共同留下的片段</em></button>
                    <button type="button" onClick={openTimeline}><span>↗</span><b>年表</b><em>世界如何走到今天</em></button>
                    <button type="button" onClick={openSettings}><span>◌</span><b>设定</b><em>世界遵守的规则</em></button>
                  </nav>
                </>
              )}
            </section>
          ) : (
            null
          )}
        </>
      )}
    </div>
  );
}
