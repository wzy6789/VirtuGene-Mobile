import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { liveQuery } from 'dexie';
import { type WorldScene, type WorldSceneEntry } from '../../db/index';
import { useAuthStore } from '../../store/auth-store';
import { useFeedback } from '../../lib/feedback';
import { useChatStore } from '../../store/chat-store';
import { useUIStore } from '../../store/ui-store';
import { worldRepo } from '../../db/world-repo';
import { worldSceneRepo } from '../../db/world-scene-repo';
import {
  deleteScene,
  finishSceneAndSettle,
  loadScene,
  startScene,
} from '../../lib/world/scene-runtime';
import { Avatar } from '../ui/Avatar';
import { Icon } from '../ui/Icon';
import { Modal } from '../ui/Modal';
import { LoadingSkeleton } from '../ui/LoadingSkeleton';
import { useAiAvailability } from '../settings/useAiAvailability';
import { FeedbackNotice } from '../ui/FeedbackNotice';
import '../../styles/stage-paper.css';

/**
 * 星域资料管理页（世界列表 / 建立新世界 / 回看）。
 *
 * 5.2 起这里**不再**是第二条发言路径：所有世界的继续与发言都进统一的世界播放器
 * （WorldCanvas + runWorldTurn）。本页保留的是历史资料管理能力：
 * 创建世界、回看正文、结束世界并结算、删除世界。
 */
const STATUS_LABEL: Record<WorldScene['status'], string> = {
  draft: '还没开始',
  active: '正在进行',
  paused: '先搁着',
  finished: '已结束',
};

function humanStageError(message?: string): string {
  const text = message?.trim() ?? '';
  if (!text) return '这一次还没接上，请再试一次。';
  if (/auth:|invalid_key|api.?key|鉴权|权限/i.test(text)) return '当前模型暂时不可用，请检查 AI 设置后再试。';
  if (/timeout|timed out|超时|network|fetch|连接|网络/i.test(text)) return '回应来得有点慢，网络恢复后再试一次。';
  return '这一次还没接上，请再试一次。';
}

export function MobileStagePage() {
  const owner = useAuthStore(state => state.userId);
  return <ScopedStagePage key={owner ?? ''}/>;
}
function ScopedStagePage() {
  const userId = useAuthStore((s) => s.userId) ?? '';
  const username = useAuthStore((s) => s.username) ?? undefined;
  const apiKey = useAuthStore((s) => s.apiKey) ?? '';
  const hasAi = useAiAvailability();
  const characters = useChatStore((s) => s.characters);

  const [worldId, setWorldId] = useState<string | null>(null);
  const [scenes, setScenes] = useState<WorldScene[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [sceneLimit, setSceneLimit] = useState(50);
  const [hasMore, setHasMore] = useState(false);
  const [listRefreshing, setListRefreshing] = useState(false);
  const moreLock = useRef(false);

  /** 当前打开回看的世界（只读；继续/发言去统一的世界播放器） */
  const [openScene, setOpenScene] = useState<WorldScene | null>(null);
  const [entries, setEntries] = useState<WorldSceneEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<WorldScene | null>(null);
  const [actionTarget, setActionTarget] = useState<WorldScene | null>(null);
  const [creating, setCreating] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'all' | WorldScene['status']>('all');
  const listRef = useRef<HTMLDivElement>(null);
  const listReturn = useRef<{id:string;top:number;index:number;control:'review'|'more';ready:boolean}|undefined>(undefined);
  const theaterOpen = useUIStore(state => state.worldTheaterOpen);
  const feedback = useFeedback();
  const mounted = useRef(true);
  const operation = useRef<symbol | null>(null);
  const rememberList = (id:string,control:'review'|'more') => {
    const rows=[...listRef.current?.querySelectorAll<HTMLElement>('[data-stage-id]')??[]];
    listReturn.current={id,control,top:listRef.current?.scrollTop??0,index:Math.max(0,rows.findIndex(row=>row.dataset.stageId===id)),ready:false};
  };
  const requestListReturn = () => { if(listReturn.current)listReturn.current.ready=true; };
  useLayoutEffect(()=>{
    const saved=listReturn.current,root=listRef.current;
    if(!saved?.ready||!root||openScene||creating||deleteTarget||actionTarget)return;
    listReturn.current=undefined;
    if(useAuthStore.getState().userId!==userId||useUIStore.getState().activeView!=='stage')return;
    const valid=new Set(scenes.filter(scene=>scene.userId===userId&&scene.worldId===worldId).map(scene=>scene.id));
    const rows=[...root.querySelectorAll<HTMLElement>('[data-stage-id]')].filter(row=>valid.has(row.dataset.stageId??''));
    const row=rows.find(row=>row.dataset.stageId===saved.id)??rows[Math.min(saved.index,rows.length-1)];
    root.scrollTop=saved.top;
    (row?.querySelector<HTMLElement>(`[data-stage-${saved.control}]`)??root.querySelector<HTMLElement>('h1'))?.focus({preventScroll:true});
  },[openScene,creating,deleteTarget,actionTarget,scenes,userId,worldId]);

  const isCurrent = (token: symbol) => mounted.current && operation.current === token
    && useAuthStore.getState().userId === userId && useUIStore.getState().activeView === 'stage';
  const beginOperation = (message: string) => {
    if (operation.current || !userId || useAuthStore.getState().userId !== userId
      || useUIStore.getState().activeView !== 'stage') return null;
    const token = Symbol();
    operation.current = token;
    setBusy(true);
    setError(null);
    setNotice(null);
    setPendingMessage(message);
    return token;
  };
  const endOperation = (token: symbol) => {
    if (operation.current !== token) return;
    operation.current = null;
    if (mounted.current) { setBusy(false); setPendingMessage(null); }
  };

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; operation.current = null; };
  }, []);

  useEffect(() => {
    operation.current = null;
    setWorldId(null);
    setScenes([]);
    setOpenScene(null);
    setEntries([]);
    setBusy(false);
    setError(null);
    setNotice(null);
    setPendingMessage(null);
    setCreating(false);
    setForm({ title: '', place: '', timeLabel: '傍晚', mood: '安静', goal: '', picked: [], entryMemoryMode: 'memory' });
  }, [userId]);

  /** 建立新世界的表单 */
  const [form, setForm] = useState({ title: '', place: '', timeLabel: '傍晚', mood: '安静', goal: '', picked: [] as string[], entryMemoryMode: 'memory' as 'memory' | 'present' | 'amnesiac' });

  /** 从星图「新的世界」进来时直接展开创建表单 */
  const createIntent = useUIStore((s) => s.worldCreateIntent);
  const setCreateIntent = useUIStore((s) => s.setWorldCreateIntent);

  const myCharacters = useMemo(() => characters.filter((c) => c.createdBy === userId && c.agentProfile !== 'secretary'), [characters, userId]);
  const nameOf = (id: string) => myCharacters.find((c) => c.id === id)?.name ?? '角色资料暂不可用';
  const sceneKeys = JSON.stringify(scenes.map(scene => scene.id).sort());
  useEffect(() => {
    const ids = JSON.parse(sceneKeys) as string[];
    if (!ids.length || !worldId || !userId) return;
    let alive = true;
    const subscription = liveQuery(() => worldSceneRepo.getByIds(ids)).subscribe({
      next: rows => {
        if (!alive || useAuthStore.getState().userId !== userId) return;
        const valid = new Map(rows.filter(scene => scene.userId === userId && scene.worldId === worldId).map(scene => [scene.id, scene]));
        setScenes(current => current.map(scene => valid.get(scene.id)).filter((scene): scene is WorldScene => !!scene));
        setDeleteTarget(current => current && valid.get(current.id) || null);
        setActionTarget(current => current && valid.get(current.id) || null);
      },
      error: () => { if (alive && useAuthStore.getState().userId === userId) { setScenes([]); setOpenScene(null); setEntries([]); setDeleteTarget(null); setActionTarget(null); setLoadError(true); } },
    });
    return () => { alive = false; subscription.unsubscribe(); };
  }, [sceneKeys, worldId, userId]);
  const occupiedByScene = useMemo(() => {
    const map = new Map<string, WorldScene>();
    for (const scene of scenes) {
      if (scene.status !== 'active' && scene.status !== 'paused') continue;
      for (const characterId of scene.characterIds) map.set(characterId, scene);
    }
    return map;
  }, [scenes]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      if (!userId) { setLoading(false); return; }
      if (!worldId) setLoading(true);
      setListRefreshing(true);
      setLoadError(false);
      try {
        const world = await worldRepo.ensureDefaultWorld(userId, username);
        if (world.userId !== userId) throw new Error('world:unavailable');
        const rows = await worldSceneRepo.listScenes(world.id, { userId, limit: sceneLimit + 1 });
        if (!alive) return;
        setWorldId(world.id);
        setHasMore(rows.length > sceneLimit);
        setScenes(rows.slice(0, sceneLimit).filter(scene => scene.userId === userId && scene.worldId === world.id));
        if (createIntent) { setCreating(true); setCreateIntent(false); }
      } catch (cause) {
        if (alive) {
          if (!worldId || cause instanceof Error && cause.message === 'world:unavailable') { setScenes([]); setHasMore(false); }
          setLoadError(true);
        }
      } finally {
        if (alive) { setLoading(false); setListRefreshing(false); moreLock.current = false; }
      }
    })();
    if (characters.length === 0) void useChatStore.getState().loadCharacters();
    return () => { alive = false; };
    // createIntent 只在进入页面时消费一次，不作为持续依赖。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, username, characters.length, reloadToken, sceneLimit]);

  useEffect(() => () => setCreateIntent(false), [setCreateIntent]);
  useEffect(() => {
    if (!worldId || !userId) return;
    let alive = true;
    const subscription = liveQuery(() => worldRepo.getById(worldId)).subscribe({
      next: world => {
        if (!alive || useAuthStore.getState().userId !== userId) return;
        if (!world || world.userId !== userId) { operation.current = null; setScenes([]); setOpenScene(null); setEntries([]); setDeleteTarget(null); setActionTarget(null); setCreating(false); setBusy(false); setPendingMessage(null); setLoadError(true); }
      },
      error: () => { if (alive && useAuthStore.getState().userId === userId) { operation.current = null; setScenes([]); setOpenScene(null); setEntries([]); setDeleteTarget(null); setActionTarget(null); setCreating(false); setBusy(false); setPendingMessage(null); setLoadError(true); } },
    });
    return () => { alive = false; subscription.unsubscribe(); };
  }, [worldId, userId]);
  useEffect(() => {
    if (!openScene?.id || !worldId) return;
    let alive = true;
    const id = openScene.id;
    const subscription = liveQuery(async () => {
      const world = await worldRepo.getById(worldId);
      if (!alive || useAuthStore.getState().userId !== userId || world?.userId !== userId) return undefined;
      const result = await loadScene(id, userId);
      return result.scene?.userId === userId && result.scene.worldId === worldId ? result : undefined;
    }).subscribe({
      next: result => {
        if (!alive || useAuthStore.getState().userId !== userId) return;
        if (result?.scene) { setOpenScene(result.scene); setEntries(result.entries); }
        else { setOpenScene(null); setEntries([]); setError('场景已删除或权限已变化，请重新读取列表。'); setReloadToken(value => value + 1); }
      },
      error: () => { if (alive && useAuthStore.getState().userId === userId) { setOpenScene(null); setEntries([]); setError('场景记录暂未读到，请重新打开。'); } },
    });
    return () => { alive = false; subscription.unsubscribe(); };
  }, [openScene?.id, worldId, userId]);
  useEffect(() => {
    if (!openScene && !creating) return;
    const back = (event: Event) => {
      if (event.defaultPrevented || deleteTarget) return;
      event.preventDefault();
      if (busy) { exitPage(); return; }
      requestListReturn();
      setOpenScene(null); setEntries([]); setCreating(false); setError(null);
    };
    window.addEventListener('vg:back-request', back);
    return () => window.removeEventListener('vg:back-request', back);
  }, [openScene?.id, creating, busy, deleteTarget]);

  const openTheScene = async (sceneId: string) => {
    if (!worldId) return;
    const token = beginOperation('正在打开场景…');
    if (!token) return;
    try {
      const world = await worldRepo.getById(worldId);
      if (!isCurrent(token)) return;
      if (world?.userId !== userId) { setError('场景已不可用，请重新读取列表。'); return; }
      const { scene, entries: rows } = await loadScene(sceneId, userId);
      if (!isCurrent(token)) return;
      if (!scene || scene.userId !== userId || scene.worldId !== worldId || world?.userId !== userId) { setError('场景已不可用，请重新读取列表。'); return; }
      rememberList(scene.id,'review');
      setOpenScene(scene);
      setEntries(rows);
    } catch {
      if (isCurrent(token)) setError('没能打开这个场景，请再试一次');
    } finally {
      endOperation(token);
    }
  };

  /** 进入统一的世界播放器：新建、继续、回看都走同一条路径 */
  const continueInCanvas = async (sceneId: string) => {
    if (!worldId) return;
    const token = beginOperation('正在打开场景…');
    if (!token) return;
    try {
      // Only two primary keys; no transcript reload before entering the canvas.
      const [scene, world] = await Promise.all([worldSceneRepo.getScene(sceneId), worldRepo.getById(worldId)]);
      if (!isCurrent(token)) return;
      if (!scene || scene.userId !== userId || scene.worldId !== worldId || world?.userId !== userId) { setError('场景已不可用，请重新读取列表。'); return; }
      endOperation(token); useUIStore.getState().openCanvas(scene.id);
    } catch { if (isCurrent(token)) setError('场景暂未读到，请重试。'); }
    finally { endOperation(token); }
  };

  const createAndOpen = async () => {
    if (!worldId) return;
    if (form.picked.length === 0) { setError('至少选一位同行者'); return; }
    const conflicts = form.picked
      .map((characterId) => ({ characterId, scene: occupiedByScene.get(characterId) }))
      .filter((item): item is { characterId: string; scene: WorldScene } => Boolean(item.scene));
    if (conflicts.length > 0) {
      setError(`${conflicts.map((item) => nameOf(item.characterId)).join('、')} 正在另一个场景中，请先结束并保存那段经历。`);
      return;
    }
    const token = beginOperation('正在创建场景…');
    if (!token) return;
    try {
      // 空标题直接使用地点（或“此刻”），不要替用户拼接生硬的标题。
      const requestedTitle = form.title.trim() || form.place.trim() || '此刻';
      const sceneId = await startScene({
        userId,
        worldId,
        title: requestedTitle.slice(0, 5),
        place: form.place.trim() || '未命名的地方',
        timeLabel: form.timeLabel,
        mood: form.mood,
        characterIds: form.picked,
        participants: form.picked.map((characterId) => ({
          characterId,
          goals: [],
          knowsEventIds: [],
          secrets: [],
          entryMemoryMode: form.entryMemoryMode,
        })),
        ...(form.goal.trim() ? { sceneGoal: form.goal.trim() } : {}),
      });
      if (!isCurrent(token)) return;
      setCreating(false);
      setForm({ title: '', place: '', timeLabel: '傍晚', mood: '安静', goal: '', picked: [], entryMemoryMode: 'memory' });
      setReloadToken((n) => n + 1);
      // 创建成功后直接进入统一播放器（§5.2 单一可交互播放器）
      endOperation(token);
      useUIStore.getState().openCanvas(sceneId);
    } catch (cause) {
      if (isCurrent(token)) setError(cause instanceof Error && cause.message === 'scene:character_occupied'
        ? '有人还在另一个场景中，请先结束并保存那段经历。'
        : '没能开启这个场景，请再试一次');
    } finally {
      endOperation(token);
    }
  };

  /** 结束旧世界并结算（幂等：finished 的世界不会重复结算） */
  const finishAndRelease = async (scene: WorldScene) => {
    if (scene.status === 'finished' || busy) return;
    const token = beginOperation('正在保存这段经历…');
    if (!token) return;
    try {
      const result = await finishSceneAndSettle({ userId, sceneId: scene.id, apiKey });
      if (!isCurrent(token)) return;
      if (result.error) {
        setError(humanStageError(result.error));
      } else {
        setNotice(`《${scene.title}》已结束，经历已经写入世界。`);
        setReloadToken((n) => n + 1);
      }
    } catch {
      if (isCurrent(token)) setError('这段经历暂时没能保存，请稍后再试。');
    } finally {
      endOperation(token);
    }
  };

  /** 明确离开，回到世界首页 */
  const exitPage = () => {
    operation.current = null;
    setBusy(false);
    setPendingMessage(null);
    setOpenScene(null);
    setEntries([]);
    setError(null);
    setDeleteTarget(null);
    useUIStore.getState().setActiveView('chat');
    useUIStore.getState().setMobileTab('world');
  };

  const removeScene = async (sceneId: string) => {
    const token = beginOperation('正在删除场景记录…');
    if (!token) return;
    try {
      await deleteScene(sceneId, userId);
      if (!isCurrent(token)) return;
      setScenes(current=>current.filter(scene=>scene.id!==sceneId));
      setReloadToken((n) => n + 1);
      setDeleteTarget(null);
      requestListReturn();
      feedback('场景记录已删除', { tone: 'success' });
    } catch { if (isCurrent(token)) feedback('场景记录未能删除，请重试', { tone: 'error' }); }
    finally { endOperation(token); }
  };

  const closeReview = () => { requestListReturn(); setOpenScene(null); setEntries([]); setError(null); };
  const closeActions = () => { requestListReturn(); setActionTarget(null); };
  const closeDelete = () => { if(!busy){requestListReturn();setDeleteTarget(null);} };
  const cancelCreate = () => { setCreating(false); setError(null); };
  const openCreate = () => { setCreating(true); setError(null); setNotice(null); };

  if (openScene) {
    const finished = openScene.status === 'finished';
    return <div className="vg-stage-active vg-light-paper flex h-full flex-col">
      <header className="vg-stage-active-header">
        <div className="vg-stage-active-title">
          <div><h1>{openScene.title}</h1><p>{[openScene.place,openScene.timeLabel,openScene.mood].filter(Boolean).join(' · ')}</p></div>
          <button type="button" onClick={closeReview} className="vg-stage-exit">返回</button>
        </div>
        <div className="vg-stage-review-meta"><span className="vg-stage-status">{STATUS_LABEL[openScene.status]}</span><p>{openScene.characterIds.map(nameOf).join('、') || '这一幕只有你'}</p></div>
      </header>
      <div className="vg-stage-transcript min-h-0 flex-1 overflow-y-auto" role="region" aria-label="世界回看正文" tabIndex={0}>
        {!entries.length && <p className="vg-stage-empty-copy">暂无可展示的记录，可以打开场景继续。</p>}
        {entries.length >= 400 && <p className="vg-stage-empty-copy">这里展示最近的记录，完整阅读请打开场景。</p>}
        <ul>{entries.map(entry => {
          if (entry.kind === 'suggestion' || entry.kind === 'system' && entry.content.startsWith('——')) return null;
          if (entry.kind === 'system') return <li key={entry.id} className="vg-stage-system">{entry.content}</li>;
          if (entry.kind === 'user_input' || entry.kind === 'choice') return <li key={entry.id} className="vg-stage-user-row"><p className={entry.kind === 'choice' ? 'vg-stage-choice' : 'vg-stage-user'}>{entry.kind === 'choice' && typeof entry.meta?.chosen === 'string' ? entry.meta.chosen : entry.content}</p></li>;
          if (entry.kind === 'action' || entry.kind === 'narration') return <li key={entry.id}><p className={entry.kind === 'action' ? 'vg-stage-action' : 'vg-stage-narration'}>{entry.content}</p></li>;
          const speaker=myCharacters.find(character => character.id === entry.speakerId);
          return <li key={entry.id} className="vg-stage-dialogue"><Avatar avatar={speaker?.avatar ?? ''} size="sm"/><div><p className="vg-stage-speaker">{speaker?.name ?? '角色资料暂不可用'}</p><p className="vg-stage-dialogue-body">{entry.content}</p></div></li>;
        })}</ul>
      </div>
      <footer className="vg-stage-composer">
        {(error || pendingMessage || notice) && <FeedbackNotice message={error ?? pendingMessage ?? notice!} tone={error ? 'error' : pendingMessage ? 'info' : 'success'}/>}
        <button type="button" disabled={busy} onClick={() => void continueInCanvas(openScene.id)} className="vg-button vg-button-primary">{busy ? '正在打开…' : finished ? '打开完整回看' : '继续这一幕'}</button>
        <p>完整阅读与对话，都在场景中继续。</p>
      </footer>
    </div>;
  }

  const visibleScenes=statusFilter==='all'?scenes:scenes.filter(scene=>scene.status===statusFilter);
  return <div ref={listRef} className="vg-stage-room vg-light-paper h-full overflow-y-auto">
    <header className="vg-stage-header">
      <button type="button" onClick={exitPage} aria-label={theaterOpen ? '返回星域' : '返回世界'}><Icon name="back" size={21}/></button>
      <h1 tabIndex={-1}>场景管理</h1>
    </header>
    {!creating && (error || pendingMessage || notice) && <FeedbackNotice message={error ?? pendingMessage ?? notice!} tone={error ? 'error' : pendingMessage ? 'info' : 'success'}/>}
    {loading ? <LoadingSkeleton label="正在读取星域…" rows={3}/> : loadError && !scenes.length ? <section className="vg-stage-error">
      <h2>场景读取失败</h2><p role="alert">暂未读到本机记录，重新读取即可重试。</p>
      <button type="button" className="vg-button vg-button-secondary" onClick={() => setReloadToken(value => value + 1)}>重新读取</button>
    </section> : <>
      {!creating && <><p className="vg-stage-intro">继续一段经历，或从新的此刻开始。</p><button type="button" onClick={openCreate} disabled={busy || !myCharacters.length} className="vg-button vg-button-primary vg-stage-new"><Icon name="plus" size={19}/>开启新场景</button></>}
      {!creating && loadError && <section className="vg-stage-error"><p role="alert">场景暂时没有重新读到，已显示的记录仍可查看。</p><button type="button" className="vg-button vg-button-secondary" onClick={()=>setReloadToken(value=>value+1)}>重新读取</button></section>}
      {!creating && scenes.length>0 && <div className="vg-stage-filters" role="group" aria-label="按场景状态筛选">{(['all','active','paused','finished','draft'] as const).map(status=><button type="button" key={status} aria-pressed={statusFilter===status} onClick={()=>setStatusFilter(status)}>{status==='all'?'全部':STATUS_LABEL[status]}</button>)}</div>}
      {!myCharacters.length && <section className="vg-stage-empty"><h2>先认识一位同行者</h2><p>添加角色后，就能一起开启场景、留下共同经历。</p><button type="button" className="vg-button vg-button-secondary" onClick={() => useUIStore.setState({activeView:'chat',mobileTab:'characters',worldTheaterOpen:false})}>去认识角色</button></section>}
      {creating && myCharacters.length > 0 && <section className="vg-stage-create">
        <header className="vg-stage-create-head"><h2>开启新场景</h2><p>选一个地点，和熟悉的人一起开始。</p></header>
        <fieldset disabled={busy}>
          <label className="vg-stage-field"><span>起始地点</span><input aria-label="起始地点" value={form.place} onChange={event => setForm(value => ({...value,place:event.target.value}))} placeholder="起始地点（例如：凌晨的便利店）"/></label>
          <label className="vg-stage-field"><span>场景简称 <small>{form.title.length}/5</small></span><input aria-label="场景简称" maxLength={5} value={form.title} onChange={event => setForm(value => ({...value,title:event.target.value.slice(0,5)}))} placeholder="最多5个字，可留空"/><small>留空时使用地点简称，完整地点和开场说明会保留。</small></label>
          <label className="vg-stage-field"><span>开始方式 <small>可留空</small></span><input aria-label="开始方式" value={form.goal} onChange={event => setForm(value => ({...value,goal:event.target.value}))} placeholder="你想怎样开始？（可留空）"/></label>
          <div className="vg-stage-cast"><h3>和谁一起 <small>可多选</small></h3><div>{myCharacters.map(character => {
            const selected=form.picked.includes(character.id), occupied=occupiedByScene.get(character.id);
            return <button key={character.id} type="button" disabled={!!occupied && !selected} aria-pressed={selected} onClick={() => setForm(value => ({...value,picked:selected ? value.picked.filter(id => id !== character.id) : [...value.picked,character.id]}))} title={occupied ? `正在《${occupied.title}》中，请先结束并保存` : undefined}><Avatar avatar={character.avatar} size="sm"/><span>{character.name}{occupied && <small>已有未结束场景</small>}</span>{selected && <Icon name="check" size={17}/>}</button>;
          })}</div></div>
          {occupiedByScene.size > 0 && <p className="vg-stage-help">每位角色同时只能参加一个未结束场景。先结束并保存原有经历，再开启新的场景。</p>}
          <div className="vg-entry-memory" role="group" aria-label="入场记忆方式"><h3>带着怎样的记忆入场</h3><div>{([
            ['memory','带上与你的记忆','延续角色已有的记忆与关系'],
            ['present','从此刻开始参与','不继承这场景入场前的正文'],
            ['amnesiac','失忆设定','特殊玩法：不带入角色原有记忆'],
          ] as const).map(([value,title,description]) => <button key={value} type="button" aria-pressed={form.entryMemoryMode === value} onClick={() => setForm(current => ({...current,entryMemoryMode:value}))}><span><strong>{title}</strong><small>{description}</small></span>{form.entryMemoryMode === value && <Icon name="check" size={18}/>}</button>)}</div><p className="vg-stage-help">“从此刻开始参与”仍保有自己的私聊、群聊与过往经历；“失忆设定”连角色自己的过往记忆也不带入。</p></div>
        </fieldset>
        {(error || pendingMessage) && <FeedbackNotice message={error ?? pendingMessage!} tone={error ? 'error' : 'info'}/>}
        <div className="vg-stage-create-actions"><button type="button" disabled={busy} onClick={cancelCreate} className="vg-button vg-button-secondary">取消</button><button type="button" disabled={busy || !form.picked.length} onClick={() => void createAndOpen()} className="vg-button vg-button-primary">{busy ? '正在创建…' : '开启场景'}</button></div>
      </section>}
      {!creating && !hasAi && scenes.some(scene => scene.status === 'active' || scene.status === 'paused') && <p className="vg-stage-help">结束并保存需要可用的模型；本地创建与回看仍可使用。</p>}
      {!creating && (visibleScenes.length ? <ul className="vg-stage-list">{visibleScenes.map(scene => <li key={scene.id} data-stage-id={scene.id}>
        <div className="vg-stage-card-head"><h2>{scene.title}</h2><span className="vg-stage-status">{STATUS_LABEL[scene.status]}</span></div>
        <p className="vg-stage-card-meta">{[scene.place,scene.timeLabel,scene.characterIds.map(nameOf).join('、')].filter(Boolean).join(' · ')}</p>
        <div className="vg-stage-card-actions"><button type="button" data-stage-review onClick={() => void openTheScene(scene.id)} disabled={busy}>回看</button><button type="button" className="is-primary" onClick={() => void continueInCanvas(scene.id)} disabled={busy}>{scene.status === 'finished' ? '打开完整回看' : '继续'}</button><button type="button" data-stage-more className="vg-stage-card-more" aria-label={`更多操作：${scene.title}`} aria-haspopup="dialog" onClick={() => {rememberList(scene.id,'more');setActionTarget(scene);}} disabled={busy}><Icon name="more" size={20}/></button></div>
      </li>)}</ul> : scenes.length ? <p className="vg-stage-help" role="status">当前已载入的场景里没有这一状态的记录{hasMore?'，可以继续加载更多场景。':'。'}</p> : myCharacters.length > 0 && <section className="vg-stage-empty"><h2>还没有共同场景</h2><p>从一个地方、一位同行者开始，经历会慢慢留在这里。</p></section>)}
      {!creating && hasMore && <button type="button" className="vg-button vg-button-secondary vg-stage-more" disabled={busy || listRefreshing} aria-busy={listRefreshing} onClick={() => { if (moreLock.current) return; moreLock.current = true; setSceneLimit(value => value + 50); }}>{listRefreshing ? '正在读取…' : '加载更多场景'}</button>}
    </>}
    <Modal open={!!actionTarget} onClose={closeActions} title="场景操作" presentation="dialog" panelClassName="vg-light-paper" canSnapshotOnExit={()=>false}>
      <div className="vg-stage-action-menu">{actionTarget && actionTarget.status!=='finished' && actionTarget.status!=='draft' && <button type="button" className="vg-button vg-button-secondary" disabled={busy||!hasAi} onClick={()=>{const scene=actionTarget;setActionTarget(null);requestListReturn();void finishAndRelease(scene);}}>结束并保存</button>}<button type="button" className="vg-button vg-button-danger" onClick={()=>{setDeleteTarget(actionTarget);setActionTarget(null);}}>删除场景记录</button></div>
    </Modal>
    <Modal open={!!deleteTarget} onClose={closeDelete} title="删除场景记录" presentation="dialog" panelClassName="vg-light-paper" closeOnBackdrop={!busy} canSnapshotOnExit={() => false}>
      <div className="vg-stage-delete"><p>删除《{deleteTarget?.title}》及对应正文？此操作无法撤销。</p><div><button type="button" disabled={busy} className="vg-button vg-button-secondary" onClick={closeDelete}>取消</button><button type="button" disabled={busy} className="vg-button vg-button-danger" onClick={() => { if (deleteTarget) void removeScene(deleteTarget.id); }}>{busy ? '正在删除…' : '确认删除'}</button></div></div>
    </Modal>
  </div>;
}
