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
import type { WorldScene, WorldSceneEntry } from '../../db/index';
import { useAuthStore } from '../../store/auth-store';
import { useChatStore } from '../../store/chat-store';
import { useUIStore } from '../../store/ui-store';
import { worldRepo } from '../../db/world-repo';
import {
  canvasPresence,
  ensureCanvasScene,
  isSavedAsStory,
  latestSuggestions,
  loadCanvas,
  loadEarlier,
  pauseCanvas,
  saveAsStory,
  worldTimeLabel,
} from '../../lib/world/world-canvas';
import { retryWorldTurn, runWorldTurn } from '../../lib/world/world-turn';
import { worldAiAvailability, type WorldAiAvailability } from '../../lib/world/world-ai-client';
import { WorldStream } from './WorldStream';
import { WorldComposer, WorldControlSheet, WorldPresenceChips, WorldSuggestions, type WorldControlAction } from './WorldControls';

const HINT_KEY = 'virtugene:world-canvas-hint';

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
  const [hintVisible, setHintVisible] = useState(() => {
    try { return localStorage.getItem(HINT_KEY) !== '1'; } catch { return true; }
  });
  const [savedStory, setSavedStory] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const scrollerRef = useRef<HTMLDivElement>(null);
  /** 用户是否停在底部（决定新内容要不要自动跟随，§70） */
  const stickRef = useRef(true);
  const turnCountRef = useRef(0);

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
        const view = await loadCanvas(target);
        if (!alive) return;
        if (view) {
          setScene(view.scene);
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
    setEntries((prev) => (prev.some((e) => e.id === entry.id) ? prev : [...prev, entry]));
    if (!stickRef.current) setUnseen((n) => n + 1);
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
    setBusy(true);
    setError(null);
    setFailedTurnId(null);
    setSuggestions([]);
    setText('');
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
        onEvent: (event) => {
          if (event.type === 'entry' || event.type === 'user_entry') appendEntry(event.entry);
          if (event.type === 'ready') setBusy(false);
          if (event.type === 'status' && event.status === 'failed') setBusy(false);
        },
      });
      turnCountRef.current += 1;
      if (result.status === 'failed') {
        setFailedTurnId(result.turnId);
        setError('这一次世界没有继续回应。');
      } else {
        setSuggestions(result.suggestions);
        if (hintVisible && turnCountRef.current === 1) {
          setHintVisible(false);
          try { localStorage.setItem(HINT_KEY, '1'); } catch { /* 忽略 */ }
        }
      }
      // 本地动作可能改了地点/时间/在场的人 → 刷新这一段
      const refreshed = await loadCanvas(scene.id);
      if (refreshed) {
        setScene(refreshed.scene);
        setEntries(refreshed.entries);
        setHasMore(refreshed.hasMore);
      }
    } catch {
      setError('这一次世界没有继续回应。');
    } finally {
      setBusy(false);
    }
  }, [scene, userId, busy, appendEntry, hintVisible]);

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
    setBusy(true);
    setError(null);
    try {
      const result = await retryWorldTurn({
        turnId: failedTurnId,
        characters: useChatStore.getState().characters,
        onEvent: (event) => {
          if (event.type === 'entry') appendEntry(event.entry);
          if (event.type === 'ready') setBusy(false);
        },
      });
      if (result?.status === 'completed') {
        setFailedTurnId(null);
        setSuggestions(result.suggestions);
      } else {
        setError('这一次世界仍然没有回应。');
      }
    } finally {
      setBusy(false);
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
        await pauseCanvas(scene.id);
        setSheetOpen(false);
        setToast('这一段留着，随时回来。');
        return;
      case 'finish':
        await pauseCanvas(scene.id);
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

  const summon = useCallback(async (characterId: string) => {
    if (!scene) return;
    const character = characters.find((c) => c.id === characterId);
    if (character) await send(`让${character.name}过来。`, 'control');
  }, [scene, characters, send]);

  const dismiss = useCallback(async (characterId: string) => {
    if (!scene) return;
    const character = characters.find((c) => c.id === characterId);
    if (character) await send(`让${character.name}先离开。`, 'control');
  }, [scene, characters, send]);

  const loadMore = useCallback(async () => {
    const el = scrollerRef.current;
    if (!scene || !hasMore || entries.length === 0) return;
    const previousHeight = el?.scrollHeight ?? 0;
    const older = await loadEarlier(scene.id, entries[0].index);
    setEntries((prev) => [...older, ...prev]);
    setHasMore(older.length >= 60);
    requestAnimationFrame(() => {
      if (el) el.scrollTop = el.scrollHeight - previousHeight;
    });
  }, [scene, hasMore, entries]);

  const presence = useMemo(() => {
    if (!scene) return { present: [], absent: [] };
    const present = characters.filter((c) => scene.characterIds.includes(c.id));
    const absent = characters.filter((c) => !scene.characterIds.includes(c.id));
    return { present, absent };
  }, [scene, characters]);

  useEffect(() => {
    if (!scene) return;
    void canvasPresence(scene, characters);
  }, [scene, characters]);

  if (!userId) return null;

  return (
    <div className="vg-canvas">
      {/* 顶部：只显示最必要的信息，点击才展开（§10） */}
      <button type="button" className="vg-canvas-top" onClick={() => setHeaderOpen((v) => !v)}>
        <span className="vg-canvas-place">{scene ? `${scene.place} · ${worldTimeLabel(scene)}` : '正在进入世界…'}</span>
        <span className="vg-canvas-people">
          {presence.present.length > 0 ? `${presence.present.map((c) => c.name).join(' · ')} · 你` : '只有你'}
        </span>
        <span className="vg-canvas-more" aria-hidden>{headerOpen ? '收起' : '状态'}</span>
      </button>
      {headerOpen && scene && (
        <div className="vg-canvas-panel">
          <p>地点：{scene.place}</p>
          <p>时间：{worldTimeLabel(scene)}</p>
          <p>氛围：{scene.mood}</p>
          <p>在场：{presence.present.map((c) => c.name).join('、') || '只有你'}</p>
          <p className="vg-canvas-panel-note">所有变化都可以直接用一句话说出来。</p>
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
            <p>这里还没有发生任何事情。</p>
            <p className="vg-canvas-empty-hint">试着说一句：</p>
            <button type="button" onClick={() => void send('今晚我们去海边。', 'control')}>“今晚我们去海边。”</button>
          </div>
        ) : (
          <WorldStream entries={entries} characters={characters} />
        )}

        {/* 第一次进入后的自由度提示（§82：只出现一次，不长期占屏） */}
        {hintVisible && entries.length > 0 && !busy && (
          <div className="vg-canvas-hint">
            <p>你也可以直接说：</p>
            <p>“我们去海边。”　“让星遥过来。”　“直接到第二天早上。”</p>
            <button type="button" onClick={() => { setHintVisible(false); try { localStorage.setItem(HINT_KEY, '1'); } catch { /* 忽略 */ } }}>
              知道了
            </button>
          </div>
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

      {/* 人物 chips + 灵感建议 + 输入区 */}
      <div className="vg-canvas-bottom">
        <WorldPresenceChips
          present={presence.present}
          absent={presence.absent}
          onSummon={(id) => void summon(id)}
          onDismiss={(id) => void dismiss(id)}
        />
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
        onClose={() => setSheetOpen(false)}
        onAction={(action) => void runControl(action)}
      />

      {toast && <div className="vg-toast">{toast}</div>}
    </div>
  );
}
