/**
 * World Canvas / 世界空间（5.0.0 Living World §8 / §9 / §10 / §66 / §67）
 *
 * 整个 5.0 最重要的页面，也是**唯一**的核心交互面：
 * 用户直接对世界表达意图，输入框就是操作系统的命令行。
 *
 * 页面结构（§9）：
 *   顶部世界状态（点击才展开·不长期占屏）
 *   内容流（世界流：旁白 / 对白 / 动作 / 用户行动）
 *   在场人物 chips
 *   输入区（+ 灵感建议 + 世界控制）
 *
 * 交互纪律：
 * - **沉浸式**：进入后底部一级导航隐藏（§67），返回键先退出世界空间
 * - **键盘**：输入框始终可见（sticky 底部），内容区正确缩放（§66）
 * - **滚动**：用户停在底部就自动跟随；正在向上阅读**绝不**强拉到底（§70）
 * - **渐进式回应**（§57）：用户行动立刻可见，第一位角色生成完立刻出现，
 *   看到回复后即可继续输入（结算在后台继续）
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { WorldAgentState, WorldLocation, WorldObject, WorldPresence, WorldScene, WorldSceneEntry } from '../../db/index';
import { useAuthStore } from '../../store/auth-store';
import { useChatStore } from '../../store/chat-store';
import { useUIStore } from '../../store/ui-store';
import { worldRepo } from '../../db/world-repo';
import { worldSceneRepo } from '../../db/world-scene-repo';
import { worldLocationRepo } from '../../db/world-location-repo';
import { worldAgentRepo } from '../../db/world-agent-repo';
import { worldObjectRepo } from '../../db/world-object-repo';
import {
  canvasPresence,
  ensureCanvasScene,
  isSavedAsStory,
  latestSuggestions,
  loadCanvas,
  loadEarlier,
  moveSceneToLocation,
  pauseCanvas,
  saveAsStory,
  worldTimeLabel,
} from '../../lib/world/world-canvas';
import { retryWorldTurn, runWorldTurn } from '../../lib/world/world-turn';
import { worldAiAvailability, type WorldAiAvailability } from '../../lib/world/world-ai-client';
import { ensureWorldKernel } from '../../lib/world/world-kernel';
import { WorldStream } from './WorldStream';
import { WorldComposer, WorldControlSheet, WorldSuggestions, type WorldControlAction } from './WorldControls';
import { WorldExplorePanel } from './WorldExplorePanel';

const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));
function canvasRevealDelay(entry: WorldSceneEntry, previousSpeaker: string | null): number {
  const length = entry.content.trim().length;
  if (entry.kind === 'narration') return Math.min(620, 160 + length * 5);
  if (entry.kind !== 'dialogue' && entry.kind !== 'action') return 0;
  const speakerChanged = Boolean(entry.speakerId && previousSpeaker && entry.speakerId !== previousSpeaker);
  const breathingRoom = speakerChanged ? 680 : entry.kind === 'action' ? 260 : 180;
  return Math.min(1_450, breathingRoom + length * (entry.kind === 'dialogue' ? 7 : 5));
}

export function WorldCanvas() {
  const userId = useAuthStore((s) => s.userId);
  const characters = useChatStore((s) => s.characters);
  const canvasSceneId = useUIStore((s) => s.canvasSceneId);

  const [scene, setScene] = useState<WorldScene | null>(null);
  const [entries, setEntries] = useState<WorldSceneEntry[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [failedTurnId, setFailedTurnId] = useState<string | null>(null);
  const [ai, setAi] = useState<WorldAiAvailability | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [headerOpen, setHeaderOpen] = useState(false);
  const [unseen, setUnseen] = useState(0);
  const [savedStory, setSavedStory] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [entryMemoryMode, setEntryMemoryMode] = useState<'memory' | 'present'>('memory');
  const [exploreOpen, setExploreOpen] = useState(false);
  const [locations, setLocations] = useState<WorldLocation[]>([]);
  const [objects, setObjects] = useState<WorldObject[]>([]);
  const [worldPresence, setWorldPresence] = useState<WorldPresence[]>([]);
  const [agents, setAgents] = useState<WorldAgentState[]>([]);

  const scrollerRef = useRef<HTMLDivElement>(null);
  /** 用户是否停在底部（决定新内容要不要自动跟随，§70） */
  const stickRef = useRef(true);
  const awaitingVisibleReplyRef = useRef(0);
  const visibleQueueRef = useRef<Promise<void>>(Promise.resolve());
  const visibleSpeakerRef = useRef<string | null>(null);

  /* ------------------------------ 载入片段 ------------------------------ */
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    setLoading(true);
    void (async () => {
      try {
        await useChatStore.getState().loadCharacters();
        const list = useChatStore.getState().characters;
        const world = await worldRepo.ensureDefaultWorld(userId);
        // 指定了片段就打开它（从记忆页点进来）；否则取/建"此刻"
        const target = canvasSceneId ?? (await ensureCanvasScene({ userId, worldId: world.id, characters: list })).id;
        await ensureWorldKernel({ userId, worldId: world.id, characterIds: list.map((character) => character.id) });
        const view = await loadCanvas(target, { userId });
        if (!alive) return;
        if (view) {
          setScene(view.scene);
          setEntryMemoryMode(view.scene.state.entryMemoryMode ?? 'memory');
          visibleSpeakerRef.current = null;
          visibleQueueRef.current = Promise.resolve();
          setEntries(view.entries);
          setHasMore(view.hasMore);
          setSuggestions(latestSuggestions(view.entries)?.options ?? []);
        }
        setSavedStory(await isSavedAsStory(userId, world.id, target));
      } catch {
        if (alive) setError('世界没有打开成功，请稍后再试。');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [userId, canvasSceneId]);

  // The exploration layer is a read-only view over the same world records.
  // It is refreshed when a scene changes, so leaving and returning shows the
  // latest objects and who is actually present at the location.
  useEffect(() => {
    if (!scene || !userId) {
      setLocations([]);
      setObjects([]);
      setWorldPresence([]);
      setAgents([]);
      return;
    }
    let alive = true;
    void (async () => {
      try {
        const location = await worldLocationRepo.ensureFromScene(scene);
        await worldObjectRepo.ensureForScene({ ...scene, locationId: location.id });
        if (alive && scene.locationId !== location.id) {
          setScene((current) => current?.id === scene.id ? { ...current, locationId: location.id } : current);
        }
        const [nextLocations, nextObjects, nextPresence, nextAgents] = await Promise.all([
          worldLocationRepo.listForWorld(scene.worldId, userId),
          worldObjectRepo.listForLocation(scene.worldId, location.id, userId),
          worldAgentRepo.listAtLocation(scene.worldId, location.id, userId),
          worldAgentRepo.listStates(scene.worldId, userId),
        ]);
        if (alive) {
          setLocations(nextLocations);
          setObjects(nextObjects);
          setWorldPresence(nextPresence);
          setAgents(nextAgents);
        }
      } catch {
        if (alive) {
          setLocations([]);
          setObjects([]);
          setWorldPresence([]);
          setAgents([]);
        }
      }
    })();
    return () => { alive = false; };
  }, [scene, userId]);

  /* ------------------------------ AI 可用性（§55） ------------------------------ */
  useEffect(() => {
    let alive = true;
    void worldAiAvailability().then((status) => { if (alive) setAi(status); });
    return () => { alive = false; };
  }, [userId]);

  /* ------------------------------ 返回键：先退出世界空间（§66） ------------------------------ */
  useEffect(() => {
    const onPop = () => {
      if (sheetOpen) { setSheetOpen(false); window.history.pushState({ vgCanvas: true }, ''); return; }
      // 返回 = 离开世界空间，回到「世界」这一栏（底部导航恢复显示）
      useUIStore.getState().setActiveView('chat');
      useUIStore.getState().setMobileTab('world');
    };
    window.history.pushState({ vgCanvas: true }, '');
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [sheetOpen]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(timer);
  }, [toast]);

  /* ------------------------------ 滚动跟随（§70） ------------------------------ */
  const scrollToBottom = useCallback((smooth = false) => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    stickRef.current = true;
    setUnseen(0);
  }, []);

  useEffect(() => {
    if (stickRef.current) {
      const el = scrollerRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [entries]);

  const appendEntry = useCallback((entry: WorldSceneEntry) => {
    visibleQueueRef.current = visibleQueueRef.current.then(async () => {
      const reveal = canvasRevealDelay(entry, visibleSpeakerRef.current);
      if (reveal > 0) await wait(reveal);
      setEntries((prev) => (prev.some((e) => e.id === entry.id) ? prev : [...prev, entry]));
      if (!stickRef.current) setUnseen((n) => n + 1);
      if (entry.kind === 'dialogue' || entry.kind === 'action') visibleSpeakerRef.current = entry.speakerId ?? null;
    });
    return visibleQueueRef.current;
  }, []);

  const onScroll = () => {
    const el = scrollerRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = distance < 60;
    stickRef.current = atBottom;
    if (atBottom) setUnseen(0);
  };

  /* ------------------------------ 一轮世界交互 ------------------------------ */
  const send = useCallback(async (value: string, origin: 'text' | 'suggestion' | 'control' = 'text') => {
    const payload = value.trim();
    if (!payload || !scene || !userId || busy) return;
    let awaitingVisibleReply = true;
    const releaseVisibleReply = () => {
      if (!awaitingVisibleReply) return;
      awaitingVisibleReply = false;
      awaitingVisibleReplyRef.current = Math.max(0, awaitingVisibleReplyRef.current - 1);
      setBusy(awaitingVisibleReplyRef.current > 0);
    };
    awaitingVisibleReplyRef.current += 1;
    setBusy(true);
    setError(null);
    setFailedTurnId(null);
    setSuggestions([]);
    setText('');
    setExploreOpen(false);
    stickRef.current = true;
    try {
      const world = await worldRepo.ensureDefaultWorld(userId);
      const list = useChatStore.getState().characters;
      const result = await runWorldTurn({
        userId,
        worldId: world.id,
        sceneId: scene.id,
        text: payload,
        origin,
        characters: list,
        entryMemoryMode,
        onEvent: (event) => {
          if (event.type === 'entry' || event.type === 'user_entry') appendEntry(event.entry);
          if (event.type === 'ready') void visibleQueueRef.current.then(releaseVisibleReply);
          if (event.type === 'status' && event.status === 'failed') void visibleQueueRef.current.then(releaseVisibleReply);
        },
      });
      await visibleQueueRef.current;
      if (result.status === 'failed') {
        setFailedTurnId(result.turnId);
        setError('这一次世界没有继续回应。');
      } else {
        setSuggestions(result.suggestions);
      }
      // 本地动作可能改了地点/时间/在场的人 → 刷新这一段
      const refreshed = await loadCanvas(scene.id, { userId });
      if (refreshed) {
        setScene(refreshed.scene);
        setEntries(refreshed.entries);
        setHasMore(refreshed.hasMore);
      }
    } catch {
      setError('这一次世界没有继续回应。');
    } finally {
      releaseVisibleReply();
    }
  }, [scene, userId, busy, appendEntry, entryMemoryMode]);

  /** 世界主页的「灵感」按钮：进入世界后由它把那句话说出来（§79） */
  useEffect(() => {
    const onSay = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail;
      if (typeof detail === 'string' && detail.trim()) void send(detail, 'control');
    };
    window.addEventListener('vg:world-say', onSay);
    return () => window.removeEventListener('vg:world-say', onSay);
  }, [send]);

  const retry = useCallback(async () => {
    if (!failedTurnId) return;
    let awaitingVisibleReply = true;
    const releaseVisibleReply = () => {
      if (!awaitingVisibleReply) return;
      awaitingVisibleReply = false;
      awaitingVisibleReplyRef.current = Math.max(0, awaitingVisibleReplyRef.current - 1);
      setBusy(awaitingVisibleReplyRef.current > 0);
    };
    awaitingVisibleReplyRef.current += 1;
    setBusy(true);
    setError(null);
    try {
      const result = await retryWorldTurn({
        turnId: failedTurnId,
        characters: useChatStore.getState().characters,
        onEvent: (event) => {
          if (event.type === 'entry') appendEntry(event.entry);
          if (event.type === 'ready') void visibleQueueRef.current.then(releaseVisibleReply);
        },
      });
      await visibleQueueRef.current;
      if (result?.status === 'completed') {
        setFailedTurnId(null);
        setSuggestions(result.suggestions);
      } else {
        setError('这一次世界仍然没有回应。');
      }
    } finally {
      releaseVisibleReply();
    }
  }, [failedTurnId, appendEntry]);

  /* ------------------------------ 控制面板动作 ------------------------------ */
  const runControl = useCallback(async (action: WorldControlAction) => {
    if (!scene || !userId) return;
    const charactersNow = useChatStore.getState().characters;
    switch (action.kind) {
      case 'characters_talk':
        setSheetOpen(false);
        await send('你们自己聊一会儿吧，我听着。', 'control');
        return;
      case 'entry_mode':
        setEntryMemoryMode(action.mode);
        await worldSceneRepo.patchSceneState(scene.id, {
          entryMemoryMode: action.mode,
          participants: scene.state.participants.map((participant) => ({
            ...participant,
            entryMemoryMode: action.mode,
          })),
        });
        setToast(action.mode === 'memory' ? '角色会带着共同记忆进入' : '角色只带着此刻状态进入');
        return;
      case 'time_skip':
        setSheetOpen(false);
        await send(action.label, 'control');
        return;
      case 'save_moment':
        setSheetOpen(false);
        await send('把刚刚这一刻记下来。', 'control');
        return;
      case 'undo': {
        setSheetOpen(false);
        await send('刚才不算。', 'control');
        return;
      }
      case 'pause':
        await pauseCanvas(scene.id, userId ?? undefined);
        setSheetOpen(false);
        setToast('这一段留着，随时回来。');
        return;
      case 'finish':
        await pauseCanvas(scene.id, userId ?? undefined);
        setSheetOpen(false);
        setToast('这一段收在这里了，下次可以从新的时刻开始。');
        return;
      case 'save_story': {
        const world = await worldRepo.ensureDefaultWorld(userId);
        const saved = await saveAsStory({ userId, worldId: world.id, sceneId: scene.id });
        setSheetOpen(false);
        if (saved) {
          setSavedStory(true);
          setToast(`已经收进你们的故事：${saved.title}`);
        }
        return;
      }
      default:
        setSheetOpen(false);
    }
  }, [scene, userId, send]);

  const exitCanvas = useCallback(async () => {
    if (scene?.status === 'active') await pauseCanvas(scene.id, userId ?? undefined);
    useUIStore.getState().setActiveView('chat');
    useUIStore.getState().setMobileTab('world');
  }, [scene]);

  const loadMore = useCallback(async () => {
    const el = scrollerRef.current;
    if (!scene || !hasMore || entries.length === 0) return;
    const previousHeight = el?.scrollHeight ?? 0;
    const older = await loadEarlier(scene.id, entries[0].index, 60, userId ?? undefined);
    setEntries((prev) => [...older, ...prev]);
    setHasMore(older.length >= 60);
    requestAnimationFrame(() => {
      if (el) el.scrollTop = el.scrollHeight - previousHeight;
    });
  }, [scene, hasMore, entries]);

  const presence = useMemo(() => {
    if (!scene) return { present: [] };
    const ids = worldPresence.length ? worldPresence.map((item) => item.characterId) : scene.characterIds;
    const present = characters.filter((c) => ids.includes(c.id));
    return { present };
  }, [scene, characters, worldPresence]);

  const inspectObject = useCallback(async (object: WorldObject) => {
    if (!userId) return;
    await worldObjectRepo.applyAction(object.id, userId, 'inspect');
    setObjects((current) => current.map((item) => item.id === object.id ? { ...item, lastAction: '你查看过这里', updatedAt: Date.now() } : item));
    setExploreOpen(false);
    await send(`我仔细查看了“${object.name}”，想知道这里还留下了什么`, 'control');
  }, [send, userId]);

  const actObject = useCallback(async (object: WorldObject, action: 'take' | 'leave' | 'open') => {
    if (!userId) return;
    const updated = await worldObjectRepo.applyAction(object.id, userId, action);
    if (!updated) return;
    setObjects((current) => current.map((item) => item.id === updated.id ? updated : item));
    setExploreOpen(false);
    const actionText = action === 'take' ? '把它带走' : action === 'leave' ? '把它放回这里' : '打开它';
    await send(`我${actionText}：“${object.name}”`, 'control');
  }, [send, userId]);

  const moveToLocation = useCallback(async (location: WorldLocation) => {
    if (!scene || !userId) return;
    const moved = await moveSceneToLocation({
      userId,
      worldId: scene.worldId,
      sceneId: scene.id,
      locationId: location.id,
    });
    if (moved) setScene(moved);
    setExploreOpen(false);
    await send(`我想前往“${location.name}”，看看那里现在发生了什么`, 'control');
  }, [moveSceneToLocation, scene, send, userId]);

  useEffect(() => {
    if (!scene) return;
    void canvasPresence(scene, characters);
  }, [scene, characters]);

  if (!userId) return null;

  return (
    <div className="vg-canvas relative">
      {/* 顶部：只显示最必要的信息，点击才展开（§10） */}
      <div className="vg-canvas-top">
        <span className="vg-canvas-place">{scene ? `${scene.place} · ${worldTimeLabel(scene)}` : '正在进入世界…'}</span>
        <span className="vg-canvas-people">
          {presence.present.length > 0 ? `${presence.present.map((c) => c.name).join(' · ')} · 你` : '只有你'}
        </span>
        <button type="button" className="vg-canvas-more" onClick={() => setHeaderOpen((v) => !v)} aria-expanded={headerOpen}>
          {headerOpen ? '收起' : '状态'}
        </button>
        <button type="button" className="vg-canvas-more" onClick={() => setExploreOpen((value) => !value)} aria-expanded={exploreOpen}>
          探索
        </button>
        <button type="button" className="vg-canvas-exit" onClick={() => void exitCanvas()}>
          退出
        </button>
      </div>
      {scene && exploreOpen && (
        <WorldExplorePanel
          scene={scene}
          locations={locations}
          objects={objects}
          presence={worldPresence}
          agents={agents}
          characters={characters}
          onClose={() => setExploreOpen(false)}
          onInspect={(object) => void inspectObject(object)}
          onAct={(object, action) => void actObject(object, action)}
          onMove={(location) => void moveToLocation(location)}
        />
      )}
      {headerOpen && scene && (
        <div className="vg-canvas-panel">
          <p>地点：{scene.place}</p>
          <p>时间：{worldTimeLabel(scene)}</p>
          <p>氛围：{scene.mood}</p>
          <p>在场：{presence.present.map((c) => c.name).join('、') || '只有你'}</p>
        </div>
      )}

      {/* 内容流 */}
      <div className="vg-canvas-scroll" ref={scrollerRef} onScroll={onScroll}>
        {hasMore && (
          <button type="button" className="vg-load-earlier" onClick={() => void loadMore()}>
            查看更早内容
          </button>
        )}
        {loading ? (
          <p className="vg-canvas-loading" role="status">正在打开你的世界…</p>
        ) : entries.length === 0 ? (
          <div className="vg-canvas-empty">
            <span aria-hidden="true" />
            <p>这一刻很安静。</p>
            <p className="vg-canvas-empty-hint">你可以开口，也可以先看看。</p>
          </div>
        ) : (
          <WorldStream entries={entries} characters={characters} />
        )}

        {error && (
          <div className="vg-canvas-error">
            <p>{error}</p>
            {failedTurnId && (
              <button type="button" onClick={() => void retry()} disabled={busy}>重试</button>
            )}
          </div>
        )}
      </div>

      {unseen > 0 && (
        <button type="button" className="vg-new-content" onClick={() => scrollToBottom(true)}>
          ↓ 新内容
        </button>
      )}

      {/* 灵感与输入：角色召入直接用自然语言完成，不再占用一整行快捷栏。 */}
      <div className="vg-canvas-bottom">
        <WorldSuggestions
          options={suggestions}
          onPick={(option) => void send(option, 'suggestion')}
          onDismiss={() => setSuggestions([])}
        />
        <WorldComposer
          value={text}
          onChange={setText}
          onSend={() => void send(text)}
          onOpenControls={() => setSheetOpen(true)}
          busy={busy}
          aiDetail={ai && ai.status === 'UNAVAILABLE' ? ai.detail : null}
        />
        {savedStory && <p className="vg-canvas-saved">这一段已经收进你们的故事。</p>}
      </div>

      <WorldControlSheet
        open={sheetOpen}
        scene={scene}
        busy={busy}
        entryMemoryMode={entryMemoryMode}
        onClose={() => setSheetOpen(false)}
        onAction={(action) => void runControl(action)}
      />

      {toast && <div className="vg-toast">{toast}</div>}
    </div>
  );
}
