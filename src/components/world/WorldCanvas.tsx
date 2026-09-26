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
 * - **滚动**：输入框点击、键盘变化和新内容到达都跟随最新；加载旧内容保留视野。
 * - **渐进式回应**（§57）：用户行动立刻可见，第一位角色生成完立刻出现，
 *   看到回复后即可继续输入（结算在后台继续）
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLatestMessageScroll } from '../ui/useLatestMessageScroll';
import type { WorldAgentState, WorldLocation, WorldObject, WorldPresence, WorldScene, WorldSceneEntry } from '../../db/index';
import { useAuthStore } from '../../store/auth-store';
import { useChatStore } from '../../store/chat-store';
import { useUIStore } from '../../store/ui-store';
import { worldRepo } from '../../db/world-repo';
import { worldSceneRepo } from '../../db/world-scene-repo';
import { worldLocationRepo } from '../../db/world-location-repo';
import { worldAgentRepo } from '../../db/world-agent-repo';
import { worldObjectRepo } from '../../db/world-object-repo';
import { Avatar } from '../ui/Avatar';
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
import { finishSceneAndSettle } from '../../lib/world/scene-runtime';
import { worldAiAvailability, type WorldAiAvailability } from '../../lib/world/world-ai-client';
import { ensureWorldKernel } from '../../lib/world/world-kernel';
import { runWorldPulse } from '../../lib/world/world-autonomy';
import { worldEventRepo } from '../../db/world-event-repo';
import { WorldStream } from './WorldStream';
import { WorldComposer, WorldControlSheet, WorldSuggestions, type WorldControlAction } from './WorldControls';
import { WorldExplorePanel } from './WorldExplorePanel';
import { StoryCompass } from './StoryCompass';
import { deriveWorldVisualState, visualCss, revealDelayFor } from '../../lib/world/world-immersion';

const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));
function canvasRevealDelay(entry: WorldSceneEntry, previousSpeaker: string | null): number {
  return revealDelayFor(entry, previousSpeaker ?? undefined);
}

/** Keep provider/network details out of the world surface. The retry action
 * remains available, but the copy should sound like a person waiting for a
 * scene to reconnect rather than an internal error log. */
function humanWorldError(message?: string): string {
  const text = message?.trim() ?? '';
  if (!text) return '这一轮没有接上，再试一次就好。';
  if (/auth:|invalid[_ -]?key|api.?key|鉴权|权限/i.test(text)) {
    return '当前模型暂时不可用，请检查 AI 设置后再试。';
  }
  if (/timeout|timed out|超时|network|fetch|连接|网络/i.test(text)) {
    return '回应来得有点慢，网络恢复后再试一次。';
  }
  if (/截断|没有返回|空响应|生成失败|不可用的场景内容/i.test(text)) {
    return '这一轮没有接上，再试一次就好。';
  }
  return text;
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
  const setCanvasSheetOpen = useUIStore((state) => state.setCanvasSheetOpen);
  const [headerOpen, setHeaderOpen] = useState(false);
  const [unseen, setUnseen] = useState(0);
  const [savedStory, setSavedStory] = useState(false);

  useEffect(() => {
    setCanvasSheetOpen(sheetOpen);
    return () => setCanvasSheetOpen(false);
  }, [sheetOpen, setCanvasSheetOpen]);

  useEffect(() => {
    const closeSheet = () => setSheetOpen(false);
    window.addEventListener('vg-close-canvas-sheet', closeSheet);
    return () => window.removeEventListener('vg-close-canvas-sheet', closeSheet);
  }, []);
  const [toast, setToast] = useState<string | null>(null);
  const [entryMemoryMode, setEntryMemoryMode] = useState<'memory' | 'present' | 'amnesiac'>('memory');
  const [exploreOpen, setExploreOpen] = useState(false);
  const [locations, setLocations] = useState<WorldLocation[]>([]);
  const [objects, setObjects] = useState<WorldObject[]>([]);
  const [carriedObjects, setCarriedObjects] = useState<WorldObject[]>([]);
  const [worldPresence, setWorldPresence] = useState<WorldPresence[]>([]);
  const [agents, setAgents] = useState<WorldAgentState[]>([]);

  const scrollerRef = useRef<HTMLDivElement>(null);
  /** 用户是否停在底部（决定新内容要不要自动跟随，§70） */
  const stickRef = useRef(true);
  const awaitingVisibleReplyRef = useRef(0);
  const visibleQueueRef = useRef<Promise<void>>(Promise.resolve());
  const visibleSpeakerRef = useRef<string | null>(null);

  /* ------------------------------ 流式增量（星域呈现） ------------------------------
   * 角色/旁白边生成边上屏：partial 是**未落库**的临时内容，
   * 最终正文仍以 worldSceneEntries 为准（守护改写后也以落库版本为准）。
   * 每个临时片段用 turnId + sceneId + speakerId + kind 复合键标识——
   * 同一角色一轮里动作/对白分两拍、自动小拍连说两次，只按 speakerId 会互相覆盖。
   * 高频增量先收进 ref，按 requestAnimationFrame 合帧上屏，避免每个 token 整页重渲染。 */
  interface PartialSlice { speakerId: string | null; field: 'narration' | 'dialogue' | 'action'; text: string }
  const [partials, setPartials] = useState<Record<string, PartialSlice>>({});
  const pendingPartialsRef = useRef<Map<string, PartialSlice>>(new Map());
  const partialFrameRef = useRef(0);
  /** 本轮里有过流式呈现的复合键：对应 entry 落库时跳过节拍延迟，避免"看过的再等一遍" */
  const streamedKeysRef = useRef<Set<string>>(new Set());
  const committedStreamKeysRef = useRef<Set<string>>(new Set());

  const partialKeyOf = useCallback((turnId: string, sceneId: string, speakerId: string | null, field: string) =>
    `${turnId}:${sceneId}:${speakerId ?? '__narration'}:${field}`, []);

  const clearPartials = useCallback(() => {
    if (partialFrameRef.current) {
      cancelAnimationFrame(partialFrameRef.current);
      partialFrameRef.current = 0;
    }
    pendingPartialsRef.current.clear();
    setPartials({});
    streamedKeysRef.current.clear();
    committedStreamKeysRef.current.clear();
  }, []);

  /** 流式增量上屏：按动画帧合帧批量替换，提交后跟随最新内容。 */
  const handleTurnPartial = useCallback((event: { turnId: string; sceneId: string; speakerId: string | null; field: 'narration' | 'dialogue' | 'action'; text: string }) => {
    const key = partialKeyOf(event.turnId, event.sceneId, event.speakerId, event.field);
    if (committedStreamKeysRef.current.has(key)) return;
    streamedKeysRef.current.add(key);
    pendingPartialsRef.current.set(key, { speakerId: event.speakerId, field: event.field, text: event.text });
    if (partialFrameRef.current) return;
    partialFrameRef.current = requestAnimationFrame(() => {
      partialFrameRef.current = 0;
      const pending = pendingPartialsRef.current;
      if (pending.size === 0) return;
      pendingPartialsRef.current = new Map();
      setPartials((prev) => {
        const next = { ...prev };
        for (const [key, slice] of pending) {
          if (!committedStreamKeysRef.current.has(key)) next[key] = slice;
        }
        return next;
      });
    });
  }, [partialKeyOf]);

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
        // 指定了片段就打开它（从星图/记忆页点进来）；否则取/建"此刻"
        const target = canvasSceneId ?? (await ensureCanvasScene({ userId, worldId: world.id, characters: list })).id;
        await ensureWorldKernel({ userId, worldId: world.id, characterIds: list.map((character) => character.id) });
        // 继续一段暂停中的世界：把它唤醒为进行中（finished 保持只读，绝不改写状态）
        const targetScene = await worldSceneRepo.getScene(target);
        if (targetScene && (targetScene.status === 'paused' || targetScene.status === 'draft')) {
          await worldSceneRepo.setSceneStatus(target, 'active');
        }
        const view = await loadCanvas(target, { userId });
        if (!alive) return;
        if (view) {
          setScene(view.scene);
          setEntryMemoryMode(view.scene.state.entryMemoryMode ?? 'memory');
          visibleSpeakerRef.current = null;
          visibleQueueRef.current = Promise.resolve();
          clearPartials();
          setEntries(view.entries);
          setHasMore(view.hasMore);
          setSuggestions(latestSuggestions(view.entries)?.options ?? []);
        }
        setSavedStory(await isSavedAsStory(userId, world.id, target));
        // 世界脉冲在首屏之后后台推进，不能让用户为了等“世界自己生活”而卡在 loading。
        void runWorldPulse({ userId, worldId: world.id, characters: list, reason: 'resume' }).then(async (pulse) => {
          if (!alive || pulse.eventIds.length === 0) return;
          const echo = await worldEventRepo.getById(pulse.eventIds[0]);
          setToast(echo?.title ? `你离开的时候：${echo.title}` : '你离开的时候，世界也留下了一点动静。');
          const refreshed = await loadCanvas(target, { userId });
          if (alive && refreshed) {
            setScene(refreshed.scene);
            setEntries(refreshed.entries);
            setHasMore(refreshed.hasMore);
          }
        });
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
      setCarriedObjects([]);
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
        const [nextLocations, nextObjects, nextCarriedObjects, nextPresence, nextAgents] = await Promise.all([
          worldLocationRepo.listForWorld(scene.worldId, userId),
          worldObjectRepo.listForLocation(scene.worldId, location.id, userId),
          worldObjectRepo.listCarried(scene.worldId, userId),
          worldAgentRepo.listAtLocation(scene.worldId, location.id, userId),
          worldAgentRepo.listStates(scene.worldId, userId),
        ]);
        if (alive) {
          setLocations(nextLocations);
          setObjects(nextObjects);
          setCarriedObjects(nextCarriedObjects);
          setWorldPresence(nextPresence);
          setAgents(nextAgents);
        }
      } catch {
        if (alive) {
          setLocations([]);
          setObjects([]);
          setCarriedObjects([]);
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
      if (window.history.state?.vgMobileNav) return;
      if (sheetOpen) { setSheetOpen(false); return; }
      // 返回 = 离开世界空间，回到「世界」这一栏（底部导航恢复显示）
      useUIStore.getState().setActiveView('chat');
      useUIStore.getState().setMobileTab('world');
    };
    // 移动端返回栈由 MobileLayout 统一管理，画布不再额外压入 history。
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

  const followLatest = useLatestMessageScroll(scrollerRef);
  const latestEntryId = entries.length ? entries[entries.length - 1].id : undefined;
  useEffect(() => {
    // New rows/stream deltas always follow; prepending older rows does not.
    stickRef.current = true;
    setUnseen(0);
    return followLatest();
  }, [latestEntryId, partials, followLatest]);

  const appendEntry = useCallback((entry: WorldSceneEntry) => {
    visibleQueueRef.current = visibleQueueRef.current.then(async () => {
      // 这条内容如果刚刚流式出现过，直接落位：清掉临时气泡，也不再等节拍延迟。
      // 复合键与流式增量一致（turnId + sceneId + speakerId + kind），
      // 旧数据没有 meta 时拿不到 turnId → 认为没流式过，走正常揭示节拍。
      const rawTurnId = entry.meta?.turnId ?? entry.meta?.beatId;
      const entryTurnId = typeof rawTurnId === 'string' ? rawTurnId : null;
      const streamable = entry.kind === 'narration' || entry.kind === 'dialogue' || entry.kind === 'action';
      const streamKey = entryTurnId && streamable
        ? partialKeyOf(entryTurnId, entry.sceneId, entry.speakerId ?? null, entry.kind)
        : null;
      const wasStreamed = Boolean(streamKey) && streamedKeysRef.current.has(streamKey!);
      if (streamKey) {
        committedStreamKeysRef.current.add(streamKey);
        pendingPartialsRef.current.delete(streamKey);
      }
      if (wasStreamed) {
        setPartials((prev) => {
          if (!prev[streamKey!]) return prev;
          const next = { ...prev };
          delete next[streamKey!];
          return next;
        });
      }
      const reveal = wasStreamed ? 0 : canvasRevealDelay(entry, visibleSpeakerRef.current);
      if (reveal > 0) await wait(reveal);
      setEntries((prev) => (prev.some((e) => e.id === entry.id) ? prev : [...prev, entry]));
      if (!stickRef.current) setUnseen((n) => n + 1);
      if (entry.kind === 'dialogue' || entry.kind === 'action') visibleSpeakerRef.current = entry.speakerId ?? null;
    });
    return visibleQueueRef.current;
  }, [partialKeyOf]);

  const onScroll = () => {
    const el = scrollerRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = distance < 60;
    stickRef.current = atBottom;
    if (atBottom) setUnseen(0);
  };

  /* ------------------------------ 一轮世界交互 ------------------------------ */
  const send = useCallback(async (value: string, origin: 'text' | 'suggestion' | 'control' = 'text', options: { forceSettle?: boolean } = {}) => {
    const payload = value.trim();
    if (!payload || !scene || !userId || busy) return;
    if (scene.status === 'finished') return; // 已结束的世界只读
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
    clearPartials();
    stickRef.current = true;
    try {
      const world = await worldRepo.ensureDefaultWorld(userId);
      const list = useChatStore.getState().characters;
      let firstCharacterReplyShown = false;
      const result = await runWorldTurn({
        userId,
        worldId: world.id,
        sceneId: scene.id,
        text: payload,
        origin,
        characters: list,
        entryMemoryMode,
        ...(options.forceSettle ? { forceSettle: true } : {}),
        onEvent: (event) => {
          if (event.type === 'partial') handleTurnPartial(event);
          if (event.type === 'entry' || event.type === 'user_entry') {
            appendEntry(event.entry);
            // 世界流已经出现第一位角色的完整动作/对白后，允许用户继续输入。
            // 后续内容仍按队列依次落下，世界运行本身由 world-turn 队列串行保护。
            if (!firstCharacterReplyShown && event.type === 'entry' && (event.entry.kind === 'dialogue' || event.entry.kind === 'action')) {
              firstCharacterReplyShown = true;
              void visibleQueueRef.current.then(releaseVisibleReply);
            }
          }
          if (event.type === 'ready') void visibleQueueRef.current.then(releaseVisibleReply);
          if (event.type === 'status' && event.status === 'failed') void visibleQueueRef.current.then(releaseVisibleReply);
        },
      });
      await visibleQueueRef.current;
      if (result.status === 'failed') {
        setFailedTurnId(result.turnId);
        setError(humanWorldError(result.error));
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
    } catch (cause) {
      setError(humanWorldError(cause instanceof Error ? cause.message : String(cause)));
    } finally {
      releaseVisibleReply();
      clearPartials();
    }
  }, [scene, userId, busy, appendEntry, entryMemoryMode, clearPartials, handleTurnPartial]);

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
    clearPartials();
    try {
      const result = await retryWorldTurn({
        turnId: failedTurnId,
        characters: useChatStore.getState().characters,
        onEvent: (event) => {
          if (event.type === 'partial') handleTurnPartial(event);
          if (event.type === 'entry') appendEntry(event.entry);
          if (event.type === 'ready') void visibleQueueRef.current.then(releaseVisibleReply);
        },
      });
      await visibleQueueRef.current;
      if (result?.status === 'completed') {
        setFailedTurnId(null);
        setSuggestions(result.suggestions);
      } else {
        setError(humanWorldError(result?.error));
      }
    } finally {
      releaseVisibleReply();
      clearPartials();
    }
  }, [failedTurnId, appendEntry, clearPartials, handleTurnPartial]);

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
        // 「保存这一刻」= 强制把当前值得记住的事件写入世界层（§39 forceSettle），
        // 不等于结束：世界继续，状态保持进行中。
        setSheetOpen(false);
        await send('把刚刚这一刻记下来。', 'control', { forceSettle: true });
        return;
      case 'undo': {
        setSheetOpen(false);
        await send('刚才不算。', 'control');
        return;
      }
      case 'pause':
        // 暂时离开：保留进行状态，不结算、不释放角色。
        await pauseCanvas(scene.id, userId ?? undefined);
        setSheetOpen(false);
        setToast('这一段留着，随时回来。');
        return;
      case 'finish': {
        // 结束这个世界：一次性结算并把这一段标为 finished（幂等：重复调用不会重复写世界层）。
        setSheetOpen(false);
        setBusy(true);
        try {
          const finishedScene = await worldSceneRepo.getScene(scene.id);
          if (finishedScene?.status === 'finished') {
            setScene(finishedScene);
            setToast('这个世界已经结束并保存过了。');
            return;
          }
          const result = await finishSceneAndSettle({
            userId,
            sceneId: scene.id,
            apiKey: useAuthStore.getState().apiKey ?? '',
          });
          if (result.error) {
            setError(humanWorldError(result.error));
            return;
          }
          const refreshed = await loadCanvas(scene.id, { userId });
          if (refreshed) {
            setScene(refreshed.scene);
            setEntries(refreshed.entries);
            setHasMore(refreshed.hasMore);
          }
          const parts: string[] = ['这个世界的经历已经保存'];
          if (result.memoryId) parts.push('留下了一段共同记忆');
          if (result.relationshipEvents > 0) parts.push(`${result.relationshipEvents} 处关系变化`);
          if (result.unresolvedThreads > 0) parts.push(`${result.unresolvedThreads} 件未完成的事`);
          setToast(parts.join(' · '));
        } catch {
          setError('结束这个世界时没能保存经历，请再试一次。');
        } finally {
          setBusy(false);
        }
        return;
      }
      case 'save_story': {
        const world = await worldRepo.ensureDefaultWorld(userId);
        const saved = await saveAsStory({ userId, worldId: world.id, sceneId: scene.id });
        setSheetOpen(false);
        if (saved) {
          setSavedStory(true);
          setToast(`已经写入这个世界：${saved.title}`);
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
    const updated = await worldObjectRepo.applyAction(object.id, userId, action, action === 'leave' && scene
      ? { locationId: scene.locationId, sceneId: scene.id }
      : undefined);
    if (!updated) return;
    if (action === 'take') {
      setObjects((current) => current.filter((item) => item.id !== updated.id));
      setCarriedObjects((current) => [updated, ...current.filter((item) => item.id !== updated.id)]);
    } else if (action === 'leave') {
      setCarriedObjects((current) => current.filter((item) => item.id !== updated.id));
      setObjects((current) => [updated, ...current.filter((item) => item.id !== updated.id)]);
    } else {
      setObjects((current) => current.map((item) => item.id === updated.id ? updated : item));
    }
    setExploreOpen(false);
    const actionText = action === 'take' ? '把它带走' : action === 'leave' ? '把它放回这里' : '打开它';
    await send(`我${actionText}：“${object.name}”`, 'control');
  }, [scene, send, userId]);

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

  const canvasVisual = scene ? (scene.state.visual ?? deriveWorldVisualState(scene)) : undefined;

  return (
    <div
      className={`vg-canvas relative vg-world-light-${canvasVisual?.light ?? 'night'} vg-world-particle-${canvasVisual?.particle ?? 'dust'}${busy ? ' vg-canvas-is-busy' : ''}${sheetOpen ? ' vg-canvas-sheet-open' : ''}`}
      style={canvasVisual ? visualCss(canvasVisual) : undefined}
    >
      {/* 顶部只留入口、当前片段和两个动作；地点/人物详情点开再看。 */}
      <div className="vg-canvas-top">
        <button type="button" className="vg-canvas-back" onClick={() => void exitCanvas()} aria-label="离开世界">‹</button>
        <div className="vg-canvas-title-stack">
          <p className="vg-canvas-title">{scene?.title || '世界'}</p>
          <p className="vg-canvas-place">{scene ? `${scene.place} · ${worldTimeLabel(scene)}` : '正在进入世界…'}</p>
        </div>
        <div className="vg-canvas-actions">
          <button type="button" className="vg-canvas-more" onClick={() => setExploreOpen((value) => !value)} aria-expanded={exploreOpen}>
            <span aria-hidden="true">⌖</span><span>探索</span>
          </button>
          <button type="button" className="vg-canvas-more vg-canvas-menu-button" onClick={() => setHeaderOpen((v) => !v)} aria-expanded={headerOpen} aria-label="查看世界状态">
            <span aria-hidden="true">···</span>
          </button>
        </div>
      </div>
      {scene && exploreOpen && (
        <WorldExplorePanel
          scene={scene}
          locations={locations}
          objects={objects}
          carriedObjects={carriedObjects}
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
      {scene && <StoryCompass key={scene.id} scene={scene} entries={entries} busy={busy}
        onAct={(value) => void send(value, 'control')}
        onGoal={async (sceneGoal) => {
          await worldSceneRepo.patchSceneState(scene.id, { sceneGoal });
          setScene((current) => current?.id === scene.id ? { ...current, state: { ...current.state, sceneGoal } } : current);
        }} />}
      <div className="vg-canvas-scroll" ref={scrollerRef} onScroll={onScroll}>
        {hasMore && (
          <button type="button" className="vg-load-earlier" onClick={() => void loadMore()}>
            查看更早内容
          </button>
        )}
        {loading ? (
          <p className="vg-canvas-loading" role="status">正在打开你的世界…</p>
        ) : entries.length === 0 && Object.keys(partials).length === 0 ? (
          <div className="vg-canvas-empty">
            <span aria-hidden="true" />
            <p>这一刻很安静。</p>
            <p className="vg-canvas-empty-hint">你可以开口，也可以先看看。</p>
          </div>
        ) : (
          <WorldStream entries={entries} characters={characters} />
        )}

        {/* 流式增量：正在生成的角色台词/动作/旁白（未落库，最终以世界流正文为准）。
            同一角色动作/对白分两拍时并排呈现，落库后由 WorldStream 合成一个视觉组。 */}
        {(() => {
          const slices = Object.values(partials);
          const narrations = slices.filter((slice) => slice.field === 'narration' && slice.text);
          const bySpeaker = new Map<string, PartialSlice[]>();
          for (const slice of slices) {
            if (slice.field === 'narration' || !slice.speakerId) continue;
            const list = bySpeaker.get(slice.speakerId) ?? [];
            list.push(slice);
            bySpeaker.set(slice.speakerId, list);
          }
          return (
            <>
              {narrations.map((slice, index) => (
                <p key={`narration-${index}`} className="vg-narration vg-stream-live">{slice.text}</p>
              ))}
              {[...bySpeaker.entries()].map(([speakerId, speakerSlices]) => {
                const character = characters.find((c) => c.id === speakerId);
                const ordered = [...speakerSlices].sort((a, b) => (a.field === 'action' ? 0 : 1) - (b.field === 'action' ? 0 : 1));
                return (
                  <div key={speakerId} className="vg-beat">
                    <Avatar avatar={character?.avatar ?? '🙂'} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="vg-beat-name">{character?.name ?? '某人'}</p>
                      {ordered.map((slice, index) => slice.field === 'action' ? (
                        <p key={index} className="vg-beat-action vg-stream-live">{slice.text}</p>
                      ) : (
                        <p key={index} className="vg-beat-line vg-stream-live">{slice.text}</p>
                      ))}
                    </div>
                  </div>
                );
              })}
            </>
          );
        })()}

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

      {/* 灵感与输入：角色召入直接用自然语言完成，不再占用一整行快捷栏。
          已结束的世界是只读回看：不再提供输入，出口明确。 */}
      <div className="vg-canvas-bottom">
        {scene?.status === 'finished' ? (
          <div className="vg-canvas-finished">
            <p>这个世界已经结束，经历已经写入世界记录。</p>
            <button type="button" onClick={() => void exitCanvas()}>返回星域</button>
          </div>
        ) : (
          <>
            <WorldSuggestions
              options={suggestions}
              onPick={(option) => void send(option, 'suggestion')}
              onDismiss={() => setSuggestions([])}
            />
            <WorldComposer
              value={text}
              onFocusInput={() => { stickRef.current = true; setUnseen(0); followLatest(); }}
              onChange={setText}
              onSend={() => void send(text)}
              onOpenControls={() => setSheetOpen(true)}
              busy={busy}
              aiDetail={ai && ai.status === 'UNAVAILABLE' ? ai.detail : null}
            />
          </>
        )}
        {savedStory && <p className="vg-canvas-saved">这一段已经写入世界记录。</p>}
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
