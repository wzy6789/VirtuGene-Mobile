import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { liveQuery } from 'dexie';
import { useAuthStore } from '../../store/auth-store';
import { useChatStore } from '../../store/chat-store';
import { useUIStore } from '../../store/ui-store';
import { worldRepo } from '../../db/world-repo';
import { readMemoryExhibitPage, readCurrentExhibitRows, type MemoryExhibitCursor } from '../../db/shared-memory-exhibit';
import type { SharedMemory } from '../../db';
import { Icon } from '../ui/Icon';
import { LoadingSkeleton } from '../ui/LoadingSkeleton';
import { OrbEmptyState } from '../ui/OrbEmptyState';
import { Modal } from '../ui/Modal';
import { lazyFeature } from '../ui/lazyFeature';
import { TimelineRecordDialog } from './TimelineRecordDialog';
import type { TimelineRecordDetail, TimelineRecordRef } from '../../lib/world/timeline-record';
import { memorySourceLabel } from '../../lib/world/timeline-record';
import '../../styles/memory-library.css';

const MemoryArchive = lazyFeature(() => import('../character/MemoryArchiveModal').then(m => ({ default: m.MemoryArchiveModal })));
const searchText = (value: string) => value.normalize('NFKC').toLocaleLowerCase().trim();
function stamp(value: number) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? {
    iso: date.toISOString(), label: date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
  } : { iso: undefined, label: '时间未记录' };
}
export function WorldMemoryPage() {
  const userId = useAuthStore(s => s.userId);
  return <MemoryExhibit key={userId ?? 'signed-out'} userId={userId}/>;
}
function MemoryExhibit({ userId }: { userId: string | null }) {
  const allCharacters = useChatStore(s => s.characters);
  const characters = useMemo(() => allCharacters.filter(c => c.createdBy === userId), [allCharacters, userId]);
  const [items, setItems] = useState<SharedMemory[]>([]);
  const [loadedIds, setLoadedIds] = useState<string[]>([]);
  const [cursor, setCursor] = useState<MemoryExhibitCursor>();
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState(false);
  const request = useRef(0), moreLock = useRef(false);
  const loadStatus = useRef<HTMLParagraphElement>(null);
  const [worldId, setWorldId] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<TimelineRecordRef>();
  const scrollRoot=useRef<HTMLDivElement>(null),searchInput=useRef<HTMLInputElement>(null);
  const returnTo=useRef<{id:string;index:number;top:number}|undefined>(undefined);
  const [chooseCharacter, setChooseCharacter] = useState(false);
  const [characterId, setCharacterId] = useState<string>();
  const character = characters.find(c => c.id === characterId);
  useEffect(() => {
    let alive = true;
    const token = ++request.current;
    moreLock.current=false;
    setLoading(true); setError(false); setItems([]); setLoadedIds([]); setCursor(undefined);
    setWorldId(undefined); setSelected(undefined); setLoadingMore(false); setMoreError(false);
    void (async () => {
      if (!userId) { setLoading(false); return; }
      const world = await worldRepo.ensureDefaultWorld(userId);
      const page = await readMemoryExhibitPage(userId,world.id);
      if (!alive || request.current!==token || useAuthStore.getState().userId !== userId) return;
      if (!page.available) throw Error('memory:world-unavailable');
      setWorldId(world.id); setItems(page.items); setLoadedIds(page.items.map(item=>item.id)); setCursor(page.next); setLoading(false);
    })().catch(() => { if (alive) { setError(true); setLoading(false); } });
    if (!useChatStore.getState().characters.length) void useChatStore.getState().loadCharacters();
    return () => { alive = false; request.current++; };
  }, [userId, revision]);
  useEffect(() => {
    if (!userId || !worldId) return;
    let alive=true;
    const current=()=>alive&&useAuthStore.getState().userId===userId;
    const subscription=liveQuery(()=>readCurrentExhibitRows(userId,worldId,loadedIds)).subscribe({
      next:page=>{if(current()){
        if(page.available)setItems(page.items);
        else {setItems([]);setCursor(undefined);setSelected(undefined);setError(true);}
      }},
      error:()=>{if(current()){setError(true);setSelected(undefined);}},
    });
    return()=>{alive=false;subscription.unsubscribe();};
  },[userId,worldId,loadedIds]);
  const loadMore=async()=>{
    if(!userId||!worldId||!cursor||moreLock.current||useAuthStore.getState().userId!==userId)return;
    moreLock.current=true;setLoadingMore(true);setMoreError(false);
    const token=request.current,current=()=>request.current===token&&useAuthStore.getState().userId===userId;
    try{
      const page=await readMemoryExhibitPage(userId,worldId,cursor);
      if(!current())return;
      if(!page.available){setItems([]);setCursor(undefined);setSelected(undefined);setError(true);return;}
      setItems(previous=>{const ids=new Set(previous.map(item=>item.id));return [...previous,...page.items.filter(item=>!ids.has(item.id))];});
      setLoadedIds(previous=>[...new Set([...previous,...page.items.map(item=>item.id)])]);setCursor(page.next);
      requestAnimationFrame(()=>{
        if(!current())return;
        const first=page.items.map(item=>document.querySelector<HTMLButtonElement>(`[data-exhibit-id="${CSS.escape(item.id)}"] button`)).find(Boolean);
        if(first)first.focus({preventScroll:true});
        else if(!page.next)loadStatus.current?.focus({preventScroll:true});
      });
    }catch{if(current())setMoreError(true);}
    finally{if(current()){moreLock.current=false;setLoadingMore(false);}}
  };
  const names = useMemo(() => new Map(characters.map(c => [c.id, c.name])), [characters]);
  const participants = useCallback((memory: SharedMemory) => [...new Set(memory.participants)].flatMap(ref =>
    ref === 'u:' + userId ? ['你'] : ref.startsWith('c:') ? [names.get(ref.slice(2)) ?? '已移除的角色'] : []).join(' · '), [names, userId]);
  const filtered = useMemo(() => {
    const needle = searchText(query);
    return needle ? items.filter(item => searchText([item.title, item.summary, participants(item)].join(' ')).includes(needle)) : items;
  }, [items, participants, query]);
  const updateRecord = useCallback((ref: TimelineRecordRef, detail: TimelineRecordDetail | undefined) => {
    setItems(previous => previous.flatMap(item => item.id !== ref.id ? [item] : detail ? [{ ...item,
      title: detail.title, summary: detail.body ?? '', participants: detail.participants ?? item.participants,
      createdAt: detail.recordedAt,
    }] : []));
  }, []);
  const closeRecord=useCallback(()=>{
    setSelected(undefined);
    requestAnimationFrame(()=>{
      if(useAuthStore.getState().userId!==userId||!scrollRoot.current)return;
      const saved=returnTo.current,root=scrollRoot.current;
      if(saved){
        root.scrollTop=saved.top;
        const rows=[...root.querySelectorAll<HTMLLIElement>('[data-exhibit-id]')];
        const row=rows.find(item=>item.dataset.exhibitId===saved.id)??rows[Math.min(saved.index,rows.length-1)];
        (row?.querySelector<HTMLButtonElement>('button')??searchInput.current)?.focus({preventScroll:true});
      }
    });
  },[userId]);
  const navigate = (view: 'stage' | 'diary' | 'timeline' | 'worldSettings') => useUIStore.getState().setActiveView(view);
  return <div ref={scrollRoot} className="vg-memory-exhibit vg-light-paper h-full overflow-y-auto">
    <header className="vg-memory-exhibit-header">
      <button type="button" aria-label="返回世界" onClick={() => useUIStore.getState().setActiveView('chat')}><Icon name="back" size={23}/></button>
      <h1>记忆馆</h1>
      <button type="button" aria-label="时间线" onClick={() => navigate('timeline')}><Icon name="clock" size={23}/></button>
    </header>
    <p className="vg-memory-exhibit-intro">一起经历的片段，留在这里。</p>
    <nav className="vg-memory-destinations" aria-label="其他记录">
      <button type="button" onClick={() => setChooseCharacter(true)}><Icon name="profile" size={20}/>角色记忆</button>
      <button type="button" onClick={() => navigate('diary')}><Icon name="diary" size={20}/>我的日记</button>
    </nav>
    <div className="vg-search-field vg-memory-search">
      <Icon name="search" size={20}/><input ref={searchInput} type="search" aria-label="搜索世界经历" placeholder="搜索世界经历" value={query} onChange={event => setQuery(event.target.value)}/>
      {query && <button type="button" aria-label="清空搜索" onClick={() => {setQuery('');searchInput.current?.focus();}}><Icon name="close" size={18}/></button>}
    </div>
    <h2 className="vg-memory-section-title">世界经历</h2>
    {loading ? <LoadingSkeleton label="正在读取世界经历" rows={2}/> : error ?
      <OrbEmptyState title="记忆暂时没有读到" detail="请重新读取这台设备上的记录。" emotion="error" action="重新读取" onAction={() => setRevision(n => n + 1)}/> : !items.length ?
      cursor ? <p className="vg-memory-search-empty" role="status">当前批次没有可展示的经历，可以继续加载更早记录。</p> :
      <OrbEmptyState title="共同的片段，从下一次相遇开始" detail="一起经历的事、收藏的对话，会慢慢留在这里。" emotion="curious" action="进入世界" onAction={() => useUIStore.getState().openCanvas(null)}/> : !filtered.length ?
      <p className="vg-memory-search-empty" role="status">当前已载入的经历里没有找到“{query}”。</p> :
      <ul className="vg-memory-exhibit-list">{filtered.map((memory,index) => {
        const date = stamp(memory.createdAt);
        return <li key={memory.id} data-exhibit-id={memory.id}><button type="button" aria-haspopup="dialog" onClick={() => {returnTo.current={id:memory.id,index,top:scrollRoot.current?.scrollTop??0};setSelected({kind:'memory',id:memory.id,revision:memory.updatedAt});}}>
          <span className="vg-memory-exhibit-meta"><time dateTime={date.iso}>{date.label}</time><span>{memorySourceLabel(memory.sourceType)}</span></span>
          <span className="vg-memory-exhibit-title"><strong>{memory.title}</strong><Icon name="chevron" size={20}/></span>
          {memory.summary && <span className="vg-memory-exhibit-summary">{memory.summary}</span>}
          {participants(memory) && <span className="vg-memory-exhibit-people">{participants(memory)}</span>}
        </button></li>;
      })}</ul>}
    {!loading&&!error&&cursor&&<div className="px-4 py-4 space-y-3">
      {moreError&&<p role="alert" className="text-sm text-sub">更早的经历暂时没能读到，已显示的内容仍在。可以重试。</p>}
      <button type="button" className="vg-button vg-button-secondary w-full" disabled={loadingMore} aria-busy={loadingMore} onClick={()=>void loadMore()}>{loadingMore?'正在读取更早经历…':moreError?'重试加载更早经历':'加载更早经历'}</button>
    </div>}
    <footer className="vg-memory-exhibit-footer">
      <p ref={loadStatus} tabIndex={-1} role="status">已载入 {items.length} 条世界经历。仅搜索已载入的内容{cursor?'，可继续加载更早经历':'。'}</p>
      <div><button type="button" className="vg-button vg-button-primary" onClick={() => navigate('stage')}><Icon name="clock"/>回看已经发生的世界</button>
      <button type="button" className="vg-button vg-button-secondary" onClick={() => navigate('worldSettings')}><Icon name="gear"/>世界设定</button></div>
    </footer>
    {selected && userId && worldId && <TimelineRecordDialog key={selected.id} userId={userId} worldId={worldId} record={selected} onRead={updateRecord} onClose={closeRecord} surface="light-paper"/>}
    <Modal open={chooseCharacter} onClose={() => setChooseCharacter(false)} title="选择角色" presentation="dialog" panelClassName="vg-light-paper" canSnapshotOnExit={() => false}>
      <div className="p-4 space-y-2">{characters.length ? characters.map(c => <button type="button" key={c.id} className="vg-button vg-button-secondary w-full" onClick={() => { setChooseCharacter(false); setCharacterId(c.id); }}>{c.name}</button>) : <p className="text-sm text-sub">还没有可以查看记忆的角色。</p>}</div>
    </Modal>
    {character && userId && <MemoryArchive open character={character} userId={userId} onClose={() => setCharacterId(undefined)}/>}
  </div>;
}
