import { Icon } from '../ui/Icon';
import { PressLightCard } from '../ui/PhysicalInteractions';
import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {liveQuery} from 'dexie';
import {loadWorldResumePreview} from '../../lib/world/resume-preview';
import {lazyFeature} from '../ui/lazyFeature';
const ThreadsModal=lazyFeature(()=>import('../character/ContinuityThreadsModal').then(m=>({default:m.ContinuityThreadsModal})));
import { useAuthStore } from '../../store/auth-store';
import { useChatStore } from '../../store/chat-store';
import { useUIStore } from '../../store/ui-store';
import { worldRepo } from '../../db/world-repo';
import { worldSceneRepo } from '../../db/world-scene-repo';
import { worldEventRepo } from '../../db/world-event-repo';
import { continuityRepo } from '../../db/continuity-repo';
import { db,type ContinuityThread } from '../../db';
import { latestResumableScene, loadResumableScene } from '../../lib/world/resume-scene';
import { WorldResumeCard } from './WorldResumeCard';
import {beginSoulHandoff,registerSoulElement} from '../../lib/soul-handoff';
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
import { LoadingSkeleton } from '../ui/LoadingSkeleton';
import { Avatar } from '../ui/Avatar';
import { avatarImageSrc } from '../../lib/avatar';
import { secretaryAvatar } from '../../lib/secretary/appearance';
import worldStarfield from '../../assets/world/deep-blue-galaxy.png';
import { openAssistantWorkspace } from '../../lib/secretary/navigation';
import { useWorldDayOverview } from '../../lib/world/day-overview';
import '../../styles/world-home-content.css';

const DAY_MS = 86_400_000;
type ScenePreview = { id: string; status: 'loading' | 'ready' | 'unavailable' | 'error'; scene?: WorldScene; entries: WorldSceneEntry[] };
/** Caller owns the readonly transaction; authorization is never cached across actions. */
async function sceneInScope(id: string, userId: string, worldId: string, isCurrent: () => boolean) {
  if (!isCurrent()) return undefined;
  const [scene, world] = await Promise.all([db.worldScenes.get(id), db.worlds.get(worldId)]);
  return isCurrent() && scene?.userId === userId && world?.userId === userId && scene.worldId === worldId ? scene : undefined;
}
function EventTime({value}:{value:number}){
  const date=new Date(value);if(!Number.isFinite(date.getTime()))return null;
  return <time className="text-xs text-sub" dateTime={date.toISOString()}>{date.toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}</time>;
}

export function MobileWorldPage({onCanvasIntent}:{onCanvasIntent?:()=>void}={}) {
  const owner=useAuthStore(s=>s.userId);
  return <ScopedWorldPage key={owner??''} onCanvasIntent={onCanvasIntent}/>;
}
function ScopedWorldPage({onCanvasIntent}:{onCanvasIntent?:()=>void}) {
  const pageRef = useRef<HTMLDivElement>(null);
  const overviewPosition = useRef(0);
  const overviewFocus = useRef<HTMLElement | null>(null);
  const selectionEpoch = useRef(0);
  const selectedIdRef = useRef<string | null>(null);
  const openLock = useRef(false);
  const resumeTitleRef=useRef<HTMLSpanElement>(null);
  const userId = useAuthStore((state) => state.userId);
  const allCharacters = useChatStore((state) => state.characters);
  const assistant = allCharacters.find(c => c.createdBy === userId && c.agentProfile === 'secretary' && c.secretaryStatus !== 'dismissed');
  const assistantPortrait = assistant && (avatarImageSrc(assistant.avatar) ? assistant.avatar : secretaryAvatar(assistant.secretaryPersonality ?? 'gentle', assistant.secretaryAppearance ?? 'female'));
  const characters = useMemo(() => allCharacters.filter(c => c.agentProfile !== 'secretary'), [allCharacters]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [scenes, setScenes] = useState<WorldScene[]>([]);
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null);
  const [preview, setPreview] = useState<ScenePreview>();
  const [previewRetry, setPreviewRetry] = useState(0);
  const [openBusy, setOpenBusy] = useState(false);
  const [openIssue, setOpenIssue] = useState<string>();
  const setSceneSelection = (id: string | null) => {
    selectionEpoch.current++; selectedIdRef.current = id; openLock.current = false;
    resumeEpoch.current++; resumeLock.current = false; setResumeBusy(false);
    setOpenBusy(false); setOpenIssue(undefined); setSelectedSceneId(id);
    setPreview(id ? { id, status: 'loading', entries: [] } : undefined);
  };
  const retryScenePreview = () => {
    selectionEpoch.current++; openLock.current = false; setOpenBusy(false); setOpenIssue(undefined);
    setPreviewRetry(value => value + 1);
  };
  useEffect(() => () => { selectionEpoch.current++; selectedIdRef.current = null; }, []);
  const [kernel, setKernel] = useState<WorldKernelSnapshot | null>(null);
  useEffect(()=>{
    if(!kernel?.world.id||!userId)return;
    const subscription=liveQuery(()=>worldRepo.getById(kernel.world.id)).subscribe({next:world=>{
      if(useAuthStore.getState().userId!==userId)return;
      if(!world||world.userId!==userId){setSceneSelection(null);setKernel(null);setScenes([]);setRecentWorldEvents([]);setPulse(null);setLoadError(true);}
    },error:()=>{if(useAuthStore.getState().userId===userId){setSceneSelection(null);setScenes([]);setLoadError(true);}}});
    return()=>subscription.unsubscribe();
  },[kernel?.world.id,userId]);
  const [stats, setStats] = useState<Awaited<ReturnType<typeof worldRepo.stats>>>(null);
  const [pulse, setPulse] = useState<WorldPulse | null>(null);
  const [recentWorldEvents, setRecentWorldEvents] = useState<WorldEvent[]>([]);
  const recentEventKeys=JSON.stringify(recentWorldEvents.map(event=>event.id));
  useEffect(()=>{
    const ids=JSON.parse(recentEventKeys) as string[];
    if(!ids.length||!userId||!kernel?.world.id)return;
    const subscription=liveQuery(async()=>useAuthStore.getState().userId===userId?await db.worldEvents.bulkGet(ids):[]).subscribe({next:rows=>{
      if(useAuthStore.getState().userId!==userId)return;
      setRecentWorldEvents(rows.filter((row):row is WorldEvent=>!!row&&row.userId===userId&&row.worldId===kernel.world.id).sort((a,b)=>b.timestamp-a.timestamp));
    },error:()=>{if(useAuthStore.getState().userId===userId)setRecentWorldEvents([]);}});
    return()=>subscription.unsubscribe();
  },[recentEventKeys,userId,kernel?.world.id]);
  const [pulseBusy, setPulseBusy] = useState(false);
  const [worldExpanded, setWorldExpanded] = useState(false);
  const [panelReady, setPanelReady] = useState(false);
  const [momentUnread, setMomentUnread] = useState(0);
  const theaterOpen = useUIStore((state) => state.worldTheaterOpen);
  const daySummary = useWorldDayOverview(userId, !theaterOpen);
  const lastCanvasSceneId = useUIStore((state) => state.canvasSceneId);

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

  const selectedScene = preview?.id === selectedSceneId && preview.status === 'ready' ? preview.scene : undefined;
  const sceneKeys = JSON.stringify(scenes.map(scene => scene.id).sort());
  useEffect(() => {
    const ids = JSON.parse(sceneKeys) as string[];
    if (!ids.length || !userId || !kernel?.world.id) return;
    let alive = true;
    const worldId = kernel.world.id;
    // Only already-loaded IDs, one bulk query; no per-candidate full database scan.
    const subscription = liveQuery(() => db.worldScenes.bulkGet(ids)).subscribe({
      next: rows => {
        if (!alive || useAuthStore.getState().userId !== userId) return;
        const valid = new Map(rows.filter((row): row is WorldScene => !!row && row.userId === userId && row.worldId === worldId).map(row => [row.id, row]));
        setScenes(current => current.map(row => valid.get(row.id)).filter((row): row is WorldScene => !!row));
      },
      error: () => { if (alive && useAuthStore.getState().userId === userId) { setSceneSelection(null); setScenes([]); setLoadError(true); } },
    });
    return () => { alive = false; subscription.unsubscribe(); };
  }, [sceneKeys, userId, kernel?.world.id]);
  const resumeScene = useMemo(() => latestResumableScene(scenes, userId ?? '', kernel?.world.id, lastCanvasSceneId), [scenes, userId, kernel?.world.id, lastCanvasSceneId]);
  const resumeTitle=useCallback((node:HTMLSpanElement|null)=>{
    resumeTitleRef.current=node;
    if(node&&userId&&resumeScene?.id)return registerSoulElement(node,JSON.stringify([userId,resumeScene.id]),'world-entry');
  },[userId,resumeScene?.id]);
  const [resumeBusy, setResumeBusy] = useState(false);
  const resumeLock = useRef(false);
  const resumeEpoch = useRef(0);
  useEffect(() => {
    resumeEpoch.current++; resumeLock.current = false; setResumeBusy(false);
    return () => { resumeEpoch.current++; };
  }, [userId, kernel?.world.id]);
  const [resumeIssue, setResumeIssue] = useState<string>();
  const [openThreads, setOpenThreads] = useState<ContinuityThread[]>([]);
  const [threadCharacter,setThreadCharacter]=useState<string>();
  const [resumePreview,setResumePreview]=useState<Awaited<ReturnType<typeof loadWorldResumePreview>>>();
  // A newly selected cover must never inherit the previous scene's excerpt.
  const resumeExcerpt = resumePreview?.scene.id === resumeScene?.id ? resumePreview?.excerpt : undefined;
  useEffect(()=>{
    setResumePreview(undefined);
    if(!resumeScene||!userId||!kernel)return;
    const subscription=liveQuery(()=>loadWorldResumePreview(resumeScene.id,userId,kernel.world.id,()=>useAuthStore.getState().userId===userId)).subscribe({
      next:preview=>{if(useAuthStore.getState().userId!==userId)return;setResumePreview(preview);if(!preview)setScenes(rows=>rows.filter(row=>row.id!==resumeScene.id));},
      error:()=>{if(useAuthStore.getState().userId===userId){setResumePreview(undefined);setResumeIssue('场景摘要暂未读到，你仍可以继续这一幕。');}},
    });return()=>subscription.unsubscribe();
  },[resumeScene?.id,userId,kernel?.world.id]);
  useEffect(() => {
    let alive = true; setOpenThreads([]); setResumeIssue(undefined);
    if (userId) void continuityRepo.getOpenByUser(userId).then(rows => {
      if (alive && useAuthStore.getState().userId === userId) setOpenThreads(rows);
    }).catch(() => { if (alive) setResumeIssue('未完成事项暂未读到，你仍可以继续这一幕。'); });
    return () => { alive = false; };
  }, [userId, reloadToken]);
  const resumeLastScene = async () => {
    if (!resumeScene || !userId || !kernel || resumeLock.current) return;
    const epoch = resumeEpoch.current;
    const currentScope = () => resumeEpoch.current === epoch && useAuthStore.getState().userId === userId
      && useUIStore.getState().activeView === 'chat' && useUIStore.getState().mobileTab === 'world';
    resumeLock.current = true; setResumeBusy(true); setResumeIssue(undefined);
    try {
      const current = await loadResumableScene(resumeScene.id, userId, kernel.world.id, currentScope);
      if (!currentScope()) return;
      if (!current) { setResumeIssue('这一幕已变化，请重新读取世界。'); setReloadToken(value => value + 1); return; }
      beginSoulHandoff(JSON.stringify([userId,current.id]),resumeTitleRef.current,'world-scene');
      useUIStore.getState().openCanvas(current.id);
    } catch { if (currentScope()) setResumeIssue('这一幕暂未读到，请重试。'); }
    finally { if (resumeEpoch.current === epoch) { resumeLock.current = false; setResumeBusy(false); } }
  };
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
            characterIds: useChatStore.getState().characters.filter(c => c.agentProfile !== 'secretary').map((character) => character.id),
          }),
          worldRepo.stats(world.id),
          worldEventRepo.listTimeline(world.id, { limit: 4, userId }),
        ]);
        if (!alive) return;
        setScenes(nextScenes);
        setKernel(nextKernel);
        setStats(nextStats);
        setRecentWorldEvents(nextEvents);
        setSceneSelection(null);
        const recentPulses = await worldPulseRepo.listRecent(world.id, 1, userId);
        if (alive) setPulse(recentPulses[0] ?? null);
        // 首屏先可交互；离线脉冲在后台完成，避免一次模型请求把世界入口卡住。
        if (alive) setLoading(false);
        const currentCharacters = useChatStore.getState().characters.filter(c => c.agentProfile !== 'secretary');
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
          setSceneSelection(null);
          setLoadError(true);
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    if (allCharacters.length === 0) void useChatStore.getState().loadCharacters();
    return () => { alive = false; if (idleTimer !== undefined) window.clearTimeout(idleTimer); };
  }, [userId, characters.length, reloadToken]);

  useEffect(() => {
    if (!worldExpanded) { setPanelReady(false); return; }
    const frame = window.setTimeout(() => setPanelReady(true), 32);
    return () => window.clearTimeout(frame);
  }, [worldExpanded]);

  useEffect(() => {
    if (!selectedSceneId || !userId || !kernel?.world.id || !theaterOpen) return;
    let alive = true;
    const id = selectedSceneId, worldId = kernel.world.id;
    const isCurrent = () => alive && selectedIdRef.current === id && useAuthStore.getState().userId === userId;
    setPreview({ id, status: 'loading', entries: [] });
    const subscription = liveQuery(() => db.transaction('r', [db.worldScenes, db.worlds, db.worldSceneEntries], async () => {
      const scene = await sceneInScope(id, userId, worldId, isCurrent);
      if (!scene) return undefined;
      // Latest indexed window, never the end of the oldest 400 rows.
      const entries = await worldSceneRepo.listRecentEntries(id, 12);
      return isCurrent() ? { scene, entries: entries.filter(entry => entry.kind !== 'system').slice(-3) } : undefined;
    })).subscribe({
      next: result => {
        if (!isCurrent()) return;
        if (result) setPreview({ id, status: 'ready', ...result });
        else {
          selectionEpoch.current++; openLock.current = false; setOpenBusy(false); setOpenIssue(undefined);
          setPreview({ id, status: 'unavailable', entries: [] }); setScenes(rows => rows.filter(row => row.id !== id));
        }
      },
      error: () => {
        if (!isCurrent()) return;
        selectionEpoch.current++; openLock.current = false; setOpenBusy(false); setOpenIssue(undefined);
        setPreview({ id, status: 'error', entries: [] });
      },
    });
    return () => { alive = false; subscription.unsubscribe(); };
  }, [selectedSceneId, userId, kernel?.world.id, theaterOpen, previewRetry]);

  useLayoutEffect(() => {
    if (selectedSceneId) {
      if (pageRef.current) pageRef.current.scrollTop = 0;
      pageRef.current?.querySelector<HTMLButtonElement>('.vg-world-theater-header > button')?.focus({ preventScroll: true });
    }
    else {
      if (pageRef.current) pageRef.current.scrollTop = overviewPosition.current;
      if (overviewFocus.current?.isConnected) overviewFocus.current.focus({ preventScroll: true });
    }
  }, [selectedSceneId]);
  useEffect(() => {
    if (!theaterOpen || !selectedSceneId) return;
    const back = (event: Event) => { event.preventDefault(); setSceneSelection(null); };
    window.addEventListener('vg:back-request', back);
    return () => window.removeEventListener('vg:back-request', back);
  }, [theaterOpen, selectedSceneId]);
  useEffect(() => { if (!theaterOpen && selectedIdRef.current) setSceneSelection(null); }, [theaterOpen]);

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
    setSceneSelection(null);
    useUIStore.getState().setWorldTheaterOpen(true);
  };
  const leaveTheater = () => {
    setSceneSelection(null);
    useUIStore.getState().setWorldTheaterOpen(false);
  };
  const enterLivingWorld = () => {
    // “此刻”只回到仍在进行的生活；已暂停的旧世界从它自己的星点继续，避免串场。
    const active = scenes.find((scene) => scene.status === 'active');
    useUIStore.getState().openCanvas(active?.id ?? null);
  };
  const continueScene = async () => {
    if (!selectedScene || !userId || !kernel || openLock.current) return;
    const id = selectedScene.id, epoch = selectionEpoch.current, status = selectedScene.status;
    const isCurrent = () => epoch === selectionEpoch.current && selectedIdRef.current === id && useAuthStore.getState().userId === userId
      && useUIStore.getState().activeView === 'chat' && useUIStore.getState().mobileTab === 'world';
    openLock.current = true; setOpenBusy(true); setOpenIssue(undefined);
    try {
      const current = status === 'active' || status === 'paused'
        ? await loadResumableScene(id, userId, kernel.world.id, isCurrent)
        : await db.transaction('r', [db.worldScenes, db.worlds], () => sceneInScope(id, userId, kernel.world.id, isCurrent));
      if (!isCurrent()) return;
      if (!current || current.status !== status) { setOpenIssue('场景已变化，请重新读取后再打开。'); return; }
      useUIStore.getState().openCanvas(current.id);
    } catch { if (isCurrent()) setOpenIssue('场景暂未读到，请重试。'); }
    finally { if (epoch === selectionEpoch.current) { openLock.current = false; setOpenBusy(false); } }
  };
  const enterAssistant = (tab: 'today' | 'chat') => {
    if (!userId || useAuthStore.getState().userId !== userId) return;
    if (assistant) openAssistantWorkspace(tab, 'world-entry');
    else window.dispatchEvent(new Event('virtugene:open-secretary'));
  };
  const openSceneDetails = (sceneId: string) => {
    overviewPosition.current = pageRef.current?.scrollTop ?? 0;
    overviewFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSceneSelection(sceneId);
  };
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
        <button type="button" aria-expanded={worldExpanded} aria-controls="world-living-panel" onClick={() => setWorldExpanded((value) => !value)}>{worldExpanded ? '收起' : '看看发生了什么'}</button>
      </div>
      <p className="vg-world-now-summary">
        {pulseBusy ? '角色们正在沿着自己的生活继续行动。' : pulse?.summary ?? '你不在的时候，时间也会在这里留下痕迹。'}
      </p>
      {worldExpanded && kernel && panelReady && (
        <div id="world-living-panel"><WorldLivingPanel
          kernel={kernel}
          characters={characters}
          scenes={scenes}
          events={recentWorldEvents}
          pulse={pulse}
          pulseBusy={pulseBusy}
          onPulse={() => void triggerManualPulse()}
        /></div>
      )}
      <div className="vg-world-now-actions">
        <button type="button" className="is-primary" onClick={enterLivingWorld}>进入此刻</button>
        <button type="button" onClick={() => void triggerManualPulse()} disabled={pulseBusy || characters.length === 0}>{pulseBusy ? '世界行走中…' : '让时间走一步'}</button>
      </div>
    </section>
  );

  return (
    <div className="vg-world-scene-shell h-full min-h-0" data-world-scene="deep-blue-galaxy">
      <div className="vg-world-scene-backdrop" aria-hidden="true"><img src={worldStarfield} width={853} height={1844} alt="" draggable={false} fetchPriority="high" /></div>
    <div ref={pageRef} className={`vg-world-page vg-light-paper h-full overflow-y-auto px-4 pb-8 ${selectedSceneId ? 'vg-starfield-detail-page' : theaterOpen ? 'vg-starfield-page' : 'vg-world-home-sample'}`}>
      {!theaterOpen && !selectedScene && (
        <div className="pt-5 vg-world-landing">
          <SpaceHeading eyebrow="" title="世界" detail=""/>
          <section className="vg-world-resume vg-world-assistant vg-scene-glass" aria-label="生活助理空间">
            <div className="vg-world-assistant-head">
              <div className="vg-world-assistant-identity">
                <p className="vg-continuity-eyebrow">生活助理</p>
                <h2>{assistant ? assistant.name : '未设置'}</h2>
              </div>
              {assistant && assistantPortrait ? <span role="img" aria-label={`${assistant.name}的头像`} className="vg-world-assistant-portrait"><Avatar avatar={assistantPortrait} size="lg" className="vg-world-assistant-avatar" fallback={assistant.name.slice(0,1)} loading="eager" soulKey={userId ? `action-cabin:${userId}` : undefined} soulRole="world-entry" /></span> : <span className="vg-world-assistant-placeholder" aria-hidden="true"><Icon name="profile" size={32} /></span>}
            </div>
            <div className="vg-world-resume-actions">
              {assistant ? <><button type="button" className="vg-button vg-button-primary" onClick={() => enterAssistant('chat')}>聊一聊</button><button type="button" className="vg-button vg-button-secondary" onClick={() => enterAssistant('today')}>助理空间</button></> : <button type="button" disabled={!userId} className="vg-button vg-button-primary" onClick={() => enterAssistant('today')}>选择助理</button>}
            </div>
            {daySummary && <button type="button" className="vg-world-day-summary" onClick={openTodo}><span>今日待办 <strong>{daySummary.today}</strong></span><span>未安排 <strong>{daySummary.unplanned}</strong></span></button>}
          </section>
          <nav className="vg-world-daily vg-scene-glass" aria-label="世界入口">
            <PressLightCard type="button" className="vg-world-daily-entry" onClick={openMoments}>
              <Icon name="moment" size={24} />
              <strong>朋友圈</strong>
            </PressLightCard>
            <PressLightCard type="button" className="vg-world-daily-entry" onClick={openDiary}>
              <Icon name="diary" size={24} />
              <strong>日记</strong>
            </PressLightCard>
            <PressLightCard type="button" className="vg-world-daily-entry" onClick={openTodo}>
              <Icon name="calendar" size={24} />
              <strong>待办</strong>
            </PressLightCard>
            <PressLightCard type="button" className="vg-world-daily-entry" onClick={openTheater}>
              <Icon name="play" size={24} />
              <strong>星域</strong>
            </PressLightCard>
          </nav>
          {!loading && !loadError && resumeScene && <WorldResumeCard compact scene={resumeScene} characters={characters} threads={[]} titleRef={resumeTitle} onContinueIntent={onCanvasIntent} busy={resumeBusy} issue={resumeIssue} onContinue={() => void resumeLastScene()} onFree={enterLivingWorld}/>}
          {momentUnread>0&&<button type="button" className="vg-world-open-thread vg-scene-glass" onClick={openMoments}><span>朋友圈</span><strong>{momentUnread>99?'99+':momentUnread} 条新互动</strong></button>}
          {recentWorldEvents.some(event=>event.userId===userId&&event.worldId===kernel?.world.id)&&<section className="vg-world-records"><h2>最近留下</h2>{recentWorldEvents.filter(event=>event.userId===userId&&event.worldId===kernel?.world.id).slice(0,1).map(event=><button type="button" className="vg-world-recent vg-scene-glass" key={event.id} onClick={openTimeline}><Icon name="moment" size={22}/><span><strong className="flex flex-wrap items-center justify-between gap-2"><span>{event.title}</span><EventTime value={event.timestamp}/></strong><small>{event.summary}</small></span></button>)}</section>}
        </div>
      )}
      {threadCharacter&&userId&&characters.find(c=>c.id===threadCharacter&&c.createdBy===userId)&&<Suspense fallback={<p role="status">正在读取未完成事项…</p>}><ThreadsModal open character={characters.find(c=>c.id===threadCharacter)!} userId={userId} onClose={()=>{setThreadCharacter(undefined);setReloadToken(value=>value+1);}}/></Suspense>}

      {theaterOpen && <header className="vg-world-theater-header">
        <button type="button" onClick={selectedSceneId ? () => setSceneSelection(null) : leaveTheater} aria-label={selectedSceneId ? '返回星域' : '返回世界'}><Icon name="back" size={21} /></button>
        <h1>星域</h1>
      </header>}
      {loading ? (
        <LoadingSkeleton label={theaterOpen ? '正在读取星域' : '正在读取你的世界'} rows={2} />
      ) : loadError ? (
        <section className="mt-5 rounded-[26px] border border-rose-400/25 bg-rose-500/[0.06] px-5 py-7 text-center">
          <h2 className="mt-1 text-base font-semibold text-ink">世界读取失败</h2>
          <p className="mt-2 text-sm leading-6 text-sub" role="alert">没有读到本机保存的世界记录。请重试读取。</p>
          <button type="button" onClick={() => setReloadToken((token) => token + 1)} className="vg-button vg-button-secondary mt-5 w-full">重新读取</button>
        </section>
      ) : (
        <>
          {theaterOpen ? (
            <section className="vg-world-theater" aria-label="世界星域">
              {selectedSceneId && (selectedScene ? (
                <WorldSceneConstellation
                  scene={selectedScene}
                  entries={preview?.entries ?? []}
                  characters={characters}
                  busy={openBusy}
                  issue={openIssue}
                  onRetry={retryScenePreview}
                  onContinue={() => void continueScene()}
                />
              ) : preview?.status === 'unavailable' || preview?.status === 'error' ? (
                <section className="vg-starfield-detail-issue">
                  <h2>{preview.status === 'unavailable' ? '场景已不可用' : '场景读取失败'}</h2>
                  <p role="alert">{preview.status === 'unavailable' ? '这段场景已删除或权限已变化，请返回星域选择其他场景。' : '场景记录暂未读到，重新读取即可重试。'}</p>
                  <button type="button" className="vg-button vg-button-secondary" onClick={retryScenePreview}>重新读取场景</button>
                </section>
              ) : <LoadingSkeleton label="正在读取这段经历…" rows={3}/>)}
                <div hidden={!!selectedSceneId} inert={!!selectedSceneId}>
                  <WorldConstellation
                    scenes={scenes}
                    characters={characters}
                    currentSceneId={resumeScene?.id}
                    onOpenScene={openSceneDetails}
                    onOpenStage={openStage}
                    onCreate={createWorld}
                    archives={
                    <nav className="vg-world-dock" aria-label="世界档案">
                    <button type="button" onClick={openRelations}><span><Icon name="connection" size={21} /></span><b>关系</b></button>
                    <button type="button" onClick={openMemory}><span><Icon name="spark" size={21} /></span><b>记忆</b></button>
                    <button type="button" onClick={openTimeline}><span><Icon name="clock" size={21} /></span><b>年表</b><em>世界如何走到今天</em></button>
                    <button type="button" onClick={openSettings}><span><Icon name="gear" size={21} /></span><b>设定</b><em>世界遵守的规则</em></button>
                    </nav>
                    }
                  >
                    {resumeScene && <WorldResumeCard scene={resumeScene} excerpt={resumeExcerpt} characters={characters} threads={openThreads}
                      titleRef={resumeTitle} onContinueIntent={onCanvasIntent} busy={resumeBusy} issue={resumeIssue} onContinue={() => void resumeLastScene()} onFree={enterLivingWorld} onCreate={createWorld} onThread={thread=>setThreadCharacter(thread.characterId)} />}
                  </WorldConstellation>
                  {nowCard}
                </div>
            </section>
          ) : (
            null
          )}
        </>
      )}
    </div>
    </div>
  );
}
