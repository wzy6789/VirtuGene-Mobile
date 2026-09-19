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

  const selectedScene = useMemo(
    () => scenes.find((scene) => scene.id === selectedSceneId) ?? null,
    [scenes, selectedSceneId],
  );
  useEffect(() => {
    let alive = true;
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
          setPulseBusy(true);
          try {
            const result: WorldAutonomyResult = await runWorldPulse({
              userId,
              worldId: world.id,
              characters: currentCharacters,
            });
            if (alive && result.pulse) {
              setPulse(result.pulse);
              if (result.status !== 'skipped' && result.eventIds.length > 0) {
                const [refreshedScenes, refreshedKernel, refreshedStats, refreshedEvents] = await Promise.all([
                  worldSceneRepo.listScenes(world.id, { limit: 50, userId }),
                  ensureWorldKernel({ userId, worldId: world.id, characterIds: currentCharacters.map((character) => character.id) }),
                  worldRepo.stats(world.id),
                  worldEventRepo.listTimeline(world.id, { limit: 4, userId }),
                ]);
                if (alive) {
                  setScenes(refreshedScenes);
                  setKernel(refreshedKernel);
                  setStats(refreshedStats);
                  setRecentWorldEvents(refreshedEvents);
                }
              }
            }
          } catch {
            // 脉冲属于后台增强：世界入口已可用时，单次结算失败不应把整页变成读取失败。
          } finally {
            if (alive) setPulseBusy(false);
          }
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
    return () => { alive = false; };
  }, [userId, characters.length, reloadToken]);

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
  const openStage = () => useUIStore.getState().setActiveView('stage');
  const openRelations = () => useUIStore.getState().setActiveView('relations');
  const openMemory = () => useUIStore.getState().setActiveView('memory');
  const openTimeline = () => useUIStore.getState().setActiveView('timeline');
  const openSettings = () => useUIStore.getState().setActiveView('worldSettings');
  const enterLivingWorld = () => {
    // “此刻”只回到仍在进行的生活；已暂停的旧剧情从它自己的星点继续，避免串场。
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

  return (
    <div className="vg-world-page h-full overflow-y-auto px-4 pb-8">
      {!selectedScene && (
        <div className="pt-5 vg-world-hero">
          <SpaceHeading eyebrow="" title="世界 Living World" detail="时间会走，角色也有自己的去处。" />
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
            {worldExpanded && kernel && (
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
        </div>
      )}

      {loading ? (
        <div className="mt-10 text-center text-sm text-gray-500" role="status">正在读取你的世界…</div>
      ) : loadError ? (
        <section className="mt-5 rounded-[26px] border border-rose-400/25 bg-rose-500/[0.06] px-5 py-7 text-center">
          <h2 className="mt-1 text-base font-semibold text-ink">世界读取失败</h2>
          <p className="mt-2 text-xs leading-6 text-gray-500">没有读到本机保存的剧情记录。你的数据仍在这台设备上。</p>
          <button type="button" onClick={() => setReloadToken((token) => token + 1)} className="mt-5 w-full rounded-xl border border-line px-4 py-2.5 text-sm text-sub active:scale-[.99]">重新读取</button>
        </section>
      ) : (
        <>
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
              <WorldConstellation
                scenes={scenes}
                currentSceneId={selectedSceneId}
                onOpenScene={openSceneDetails}
                onOpenStage={openStage}
                onOpenDiary={openDiary}
              />
              <nav className="vg-world-dock" aria-label="世界档案">
                <button type="button" onClick={openRelations}><span>⌁</span><b>关系</b><em>谁与谁正在靠近</em></button>
                <button type="button" onClick={openMemory}><span>✦</span><b>记忆</b><em>共同留下的片段</em></button>
                <button type="button" onClick={openTimeline}><span>↗</span><b>年表</b><em>世界如何走到今天</em></button>
                <button type="button" onClick={openSettings}><span>◌</span><b>设定</b><em>世界遵守的规则</em></button>
              </nav>
            </>
          )}
        </>
      )}
    </div>
  );
}
