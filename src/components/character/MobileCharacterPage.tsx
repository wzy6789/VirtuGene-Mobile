import { Icon } from '../ui/Icon';
import { ConnectionEmptyState } from '../ui/ConnectionEmptyState';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useChatStore } from '../../store/chat-store';
import { useFeedback } from '../../lib/feedback';
import { useAuthStore } from '../../store/auth-store';
import { CharacterAddModal } from './CharacterAddModal';
import { CharacterProfileModal } from './CharacterProfileModal';
import { GroupChatPage } from '../chat/GroupChatPage';
import { RelationNetworkModal } from './RelationNetworkModal';
import { FeedbackNotice } from '../ui/FeedbackNotice';
import { Modal } from '../ui/Modal';
import { beginSoulHandoff, soulElement } from '../../lib/soul-handoff';
import { resonate } from '../../lib/haptics';
import { getSortKey } from '../../lib/pinyin';
import type { Character } from '../../db/index';
import { isStoryCharacter } from '../../lib/character-domain';
import { openAssistantWorkspace } from '../../lib/secretary/navigation';
import { ensureOwnedChatCharacter } from '../../lib/character-chat';
import { CharacterPortrait } from './CharacterCover';
import { featuredCharacters } from './character-space-model';
import '../../styles/character-space.css';
import { PrimaryPageBackdrop } from '../layout/PrimaryPageBackdrop';

let savedCharacters: {owner:string;top:number;search:string} | undefined;

export function MobileCharacterPage({ onSelect, onChatIntent }: { onSelect: () => void; onChatIntent?: () => void }) {
  const characters = useChatStore(s => s.characters);
  const previews = useChatStore(s => s.charPreviews);
  const loadCharacters = useChatStore(s => s.loadCharacters);
  const fetchUnreadCounts = useChatStore(s => s.fetchUnreadCounts);
  const selectCharacter = useChatStore(s => s.selectCharacter);
  const deleteCharacter = useChatStore(s => s.deleteCharacter);
  const feedback = useFeedback();
  const userId = useAuthStore(s => s.userId) ?? '';
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [search, setSearch] = useState(() => savedCharacters?.owner === userId ? savedCharacters.search : '');
  const scrollRef = useRef<HTMLDivElement>(null);
  const savedState = useRef({search}); savedState.current = {search};
  useLayoutEffect(() => { if (scrollRef.current && savedCharacters?.owner === userId) scrollRef.current.scrollTop = savedCharacters.top; return () => { if (scrollRef.current) savedCharacters = {owner:userId,top:scrollRef.current.scrollTop,...savedState.current}; }; },[userId]);
  const previousOwner = useRef(userId);
  useLayoutEffect(() => { if (previousOwner.current !== userId) {
    previousOwner.current = userId; savedCharacters = undefined;
    scrollRestored.current = false; navigationEpoch.current++;
    setSearch(''); setProfile(null); setManage(null); setEditor(null); setDeleting(null); setNetwork(false); setGroups(false); setTools(false);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  } },[userId]);
  const [editor, setEditor] = useState<{ character?: Character; initialTab?: 'pool' | 'create' } | null>(null);
  const [manage, setManage] = useState<Character | null>(null);
  const [profile, setProfile] = useState<Character | null>(null);
  const profileRef = useRef(profile); profileRef.current = profile;
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; },[]);
  const [deleting, setDeleting] = useState<Character | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [groups, setGroups] = useState(false);
  const [network, setNetwork] = useState(false);
  const [tools, setTools] = useState(false);
  const navigationEpoch = useRef(0);
  const isOwn = (c: Character) => !c.isPreset && c.createdBy === userId;
  const scopedCharacters = useMemo(() => characters.filter(c => c.createdBy === userId || c.isPreset || c.published), [characters, userId]);

  useEffect(() => {
    let alive = true;
    setLoading(true); setError('');
    Promise.all([loadCharacters(), fetchUnreadCounts()]).catch(() => {
      if (alive) setError('角色读取失败，请重试。');
    }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [loadCharacters, fetchUnreadCounts, userId, retry]);

  const visible = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return scopedCharacters.filter(c => isStoryCharacter(c) &&
      (!query || [c.name, c.signature ?? '', ...(c.tags ?? [])].some(value => value.toLocaleLowerCase().includes(query))))
      .sort((a, b) => getSortKey(a.name).localeCompare(getSortKey(b.name)));
  }, [scopedCharacters, search]);
  const filtering = !!search.trim();
  const featured = useMemo(() => filtering ? [] : featuredCharacters(visible, previews, userId), [filtering, visible, previews, userId]);
  const featuredIds = new Set(featured.map(c => c.id));
  const orderedCharacters = [...featured, ...visible.filter(c => !featuredIds.has(c.id))];
  const scrollRestored = useRef(false);
  useLayoutEffect(() => {
    if (!loading && !scrollRestored.current) {
      scrollRestored.current = true;
      if (scrollRef.current && savedCharacters?.owner === userId) scrollRef.current.scrollTop = savedCharacters.top;
    }
  }, [loading, userId]);
  const openProfile = (c: Character) => {
    navigationEpoch.current++;
    beginSoulHandoff(`avatar:${c.id}`, soulElement(`avatar:${c.id}`, 'list'), 'profile');
    setProfile(c);
  };

  const enterChat = async (c: Character) => {
    onChatIntent?.();
    const epoch = ++navigationEpoch.current;
    const fromProfile = profileRef.current?.id === c.id;
    const target = await ensureOwnedChatCharacter(c, userId);
    if (useAuthStore.getState().userId !== userId || epoch !== navigationEpoch.current || (fromProfile && profileRef.current?.id !== c.id)) return;
    await selectCharacter(target.id);
    if (!mounted.current || epoch !== navigationEpoch.current || (fromProfile && profileRef.current?.id !== c.id) || useAuthStore.getState().userId !== userId || useChatStore.getState().selectedCharacterId !== target.id) return;
    beginSoulHandoff(`avatar:${target.id}`,soulElement(`avatar:${c.id}`,'profile'),'chat');
    setProfile(null); onSelect();
  };
  const remove = async () => {
    if (!deleting || lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try { resonate('warning'); await deleteCharacter(deleting.id); feedback('角色与关联记录已删除', { tone: 'success' }); setDeleting(null); }
    catch { setError('删除未完成，请重试。'); }
    finally { lock.current = false; setBusy(false); }
  };

  return <div className="vg-characters vg-character-gallery vg-destination-page h-full min-h-0 flex flex-col overflow-hidden" data-primary-scene="mountain-lake">
    <PrimaryPageBackdrop page="characters" />
    <header className="vg-gallery-heading shrink-0">
      <div className="flex items-center justify-between gap-3">
        <h1>角色</h1>
        <div className="vg-gallery-heading-actions"><button type="button" aria-label="更多角色功能" onClick={() => setTools(true)} className="vg-gallery-more"><Icon name="more" size={22}/></button></div>
      </div>
      <nav className="vg-gene-entrances" aria-label="基因入口">
        <button type="button" className="vg-gene-entrance vg-scene-glass" onClick={() => setEditor({ initialTab: 'pool' })}><Icon name="database" size={25}/><span>基因库</span></button>
        <button type="button" className="vg-gene-entrance vg-scene-glass" onClick={() => setEditor({ initialTab: 'create' })}><Icon name="plus" size={25}/><span>创建基因</span></button>
      </nav>
      <div className="vg-search-field vg-conversation-search mt-4 flex items-center px-3">
        <Icon name="search" size={18}/>
        <input aria-label="搜索角色" placeholder="搜索角色" value={search} onChange={e => setSearch(e.target.value)} className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none" />
        {search && <button aria-label="清空搜索" className="h-11 w-11 text-sub" onClick={() => setSearch('')}><Icon name="close" size={18} /></button>}
      </div>
    </header>
    <div ref={scrollRef} className="vg-gallery-scroll min-h-0 flex-1 overflow-y-auto overflow-x-hidden" onScroll={() => { if (scrollRef.current) savedCharacters = { owner: userId, top: scrollRef.current.scrollTop, ...savedState.current }; }}>
      {error && !deleting && <div role="alert" className="mb-3 rounded-xl bg-red-500/10 p-3 text-sm text-red-400">{error}<button className="ml-3 min-h-11 px-3 underline" onClick={() => setRetry(v => v + 1)}>重试</button></div>}
      {loading && scopedCharacters.length === 0 ? <div className="vg-gallery-loading" role="status"><span className="sr-only">正在读取角色…</span>{[0,1,2].map(i=><div key={i} className="vg-skeleton-row" aria-hidden="true"><i /><span><b /><b /></span></div>)}</div> : visible.length === 0 ? <ConnectionEmptyState searching={filtering}
        title={filtering ? '没有找到匹配的角色' : '还没有角色'}
        detail={filtering ? '试试其他关键词。' : '从基因库添加，或创建自己的角色。'}
        action={<button onClick={() => { if (filtering) setSearch(''); else setEditor({ initialTab: 'create' }); }}>{filtering ? '清空搜索' : '创建基因'}</button>} /> : <section className="vg-gallery-collection vg-scene-glass" aria-label={filtering ? '搜索结果' : '角色列表'}>
          <div className={`vg-gallery-list${filtering ? ' is-filtered' : ''}`}>{orderedCharacters.map(c => <CharacterRow key={c.id} character={c} onOpen={() => openProfile(c)} onManage={isOwn(c) ? () => setManage(c) : undefined} />)}</div>
        </section>}
    </div>
    <Modal presentation="dialog" open={tools} onClose={() => setTools(false)} title="角色工具" width="max-w-sm">
      <div className="vg-gallery-tools">
        <button type="button" onClick={() => { setTools(false); setNetwork(true); }}><Icon name="connection" size={22}/><span><strong>关系星图</strong><small>查看角色之间的联系</small></span></button>
        <button type="button" onClick={() => { setTools(false); setGroups(true); }}><Icon name="moment" size={22}/><span><strong>角色群聊</strong><small>让大家在同一段对话中相遇</small></span></button>
        <button type="button" onClick={() => { setTools(false); openAssistantWorkspace('today'); }}><Icon name="spark" size={22}/><span><strong>生活助理</strong><small>今日安排与待处理事项</small></span></button>
      </div>
    </Modal>
    <Modal presentation="dialog" open={!!manage} onClose={() => setManage(null)} title={manage?.name} width="max-w-sm">
      <div className="vg-dialog-actions p-4 space-y-2">
        {manage?.agentProfile === 'secretary' ? <button className="w-full min-h-12 rounded-xl bg-surface text-sm text-ink" onClick={() => { setManage(null); window.dispatchEvent(new Event('virtugene:open-secretary')); }}>助理管理 · 解雇与聘用</button> : <>
          <button className="w-full min-h-12 rounded-xl bg-surface text-sm text-ink" onClick={() => { if (manage) setEditor({ character: manage }); setManage(null); }}>编辑角色</button>
          <button className="w-full min-h-12 rounded-xl bg-red-500/10 text-sm text-red-400" onClick={() => { setError(''); setDeleting(manage); setManage(null); }}>删除角色</button>
        </>}
      </div>
    </Modal>
    <Modal presentation="dialog" open={!!deleting} onClose={() => { if (!busy) setDeleting(null); }} title="删除角色" width="max-w-sm" closeOnBackdrop={false}>
      <div className="vg-delete-confirmation m-5" aria-busy={busy}><p>确定删除「{deleting?.name}」？关联的对话、记忆和关系也会清除，无法恢复。</p>{busy && <p role="status" className="mt-3 text-sm text-sub">正在清理聊天与关联记录，完成后会自动关闭。</p>}{error && <FeedbackNotice className="mt-3" message={error} tone="error" />}<div className="mt-5 flex gap-3"><button disabled={busy} className="flex-1 min-h-11 rounded-xl border border-line" onClick={() => setDeleting(null)}>取消</button><button disabled={busy} onClick={() => void remove()} className="flex-1 min-h-11 rounded-xl bg-red-500/15 text-red-400">{busy ? '正在删除…' : '确认删除'}</button></div></div>
    </Modal>
    {profile && (profile.createdBy === userId || profile.isPreset || profile.published) && <CharacterProfileModal key={`${userId}:${profile.id}`} character={scopedCharacters.find(c => c.id === profile.id) ?? profile} worldCharacters={scopedCharacters} userId={userId} onClose={() => { navigationEpoch.current++; setProfile(null); }} onChat={enterChat} />}
    {editor && <CharacterAddModal key={editor.character?.id ?? `new-${editor.initialTab ?? 'pool'}`} open initialTab={editor.initialTab} onClose={() => setEditor(null)} editCharacter={editor.character} onSelected={() => { if (!editor.character) onSelect(); }} />}
    {groups && <GroupChatPage onClose={() => setGroups(false)} />}
    {network && <RelationNetworkModal open onClose={() => setNetwork(false)} characters={scopedCharacters.filter(isStoryCharacter)} userId={userId} />}
  </div>;
}

function CharacterRow({ character: c, onOpen, onManage }: { character: Character; onOpen: () => void; onManage?: () => void }) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = useRef(false);
  const origin = useRef({ x: 0, y: 0 });
  const cancel = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; };
  useEffect(() => cancel, []);
  const signature = c.signature?.trim() || c.tags?.filter(Boolean).slice(0, 3).join(' · ');
  return <article className="vg-gallery-character">
    <button className="vg-gallery-character-open" aria-label={`打开${c.name}的角色空间`} onClick={() => { if (!held.current) onOpen(); held.current = false; }}
      onPointerDown={e => { cancel(); held.current = false; origin.current = { x: e.clientX, y: e.clientY }; if (onManage && e.button === 0) timer.current = setTimeout(() => { held.current = true; onManage(); }, 550); }}
      onPointerMove={e => { if (Math.hypot(e.clientX - origin.current.x, e.clientY - origin.current.y) > 8) cancel(); }} onPointerUp={cancel} onPointerCancel={cancel} onPointerLeave={cancel}
      onContextMenu={e => { if (onManage) { e.preventDefault(); cancel(); held.current = true; onManage(); } }}>
      <CharacterPortrait character={c} className="vg-gallery-character-avatar" soulRole="list" />
      <span className="vg-gallery-character-copy"><strong>{c.name}</strong>{signature && <span>{signature}</span>}</span>
    </button>
    {onManage && <button aria-label={`管理${c.name}`} onClick={onManage} className="vg-gallery-character-manage"><Icon name="more" size={20} /></button>}
  </article>;
}
