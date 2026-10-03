import { MultiFilterChips } from '../ui/PhysicalInteractions';
import { AnimatedValue } from '../ui/AnimatedValue';
import { ConnectionEmptyState } from '../ui/ConnectionEmptyState';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useChatStore } from '../../store/chat-store';
import { useAuthStore } from '../../store/auth-store';
import { CharacterAddModal } from './CharacterAddModal';
import { CharacterProfileModal } from './CharacterProfileModal';
import { GroupChatPage } from '../chat/GroupChatPage';
import { RelationNetworkModal } from './RelationNetworkModal';
import { Modal } from '../ui/Modal';
import { Avatar } from '../ui/Avatar';
import { BrandWordmark } from '../ui/BrandWordmark';
import { getSortKey } from '../../lib/pinyin';
import type { Character } from '../../db/index';
import { isStoryCharacter } from '../../lib/character-domain';
import { SecretaryWorkspaceCard } from '../secretary/SecretaryWorkspaceCard';

export function MobileCharacterPage({ onSelect }: { onSelect: () => void }) {
  const characters = useChatStore(s => s.characters);
  const loadCharacters = useChatStore(s => s.loadCharacters);
  const fetchUnreadCounts = useChatStore(s => s.fetchUnreadCounts);
  const selectCharacter = useChatStore(s => s.selectCharacter);
  const deleteCharacter = useChatStore(s => s.deleteCharacter);
  const userId = useAuthStore(s => s.userId) ?? '';
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'own'>('all');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const tagOptions = useMemo(() => {
    const counts = new Map<string, number>();
    characters.filter(isStoryCharacter).forEach(c => new Set(c.tags ?? []).forEach(t => { if (t.trim()) counts.set(t, (counts.get(t) ?? 0) + 1); }));
    return [...new Set([...[...counts].sort((a, b) => b[1] - a[1]).map(([tag]) => tag).slice(0, 16), ...selectedTags])];
  }, [characters, selectedTags]);
  useEffect(() => { setSelectedTags([]); }, [userId]);
  const [editor, setEditor] = useState<{ character?: Character } | null>(null);
  const [manage, setManage] = useState<Character | null>(null);
  const [profile, setProfile] = useState<Character | null>(null);
  const [deleting, setDeleting] = useState<Character | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [groups, setGroups] = useState(false);
  const [network, setNetwork] = useState(false);
  const isOwn = (c: Character) => !c.isPreset && c.createdBy === userId;

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
    return characters.filter(c => isStoryCharacter(c) && (filter === 'all' || (!c.isPreset && c.createdBy === userId)) &&
      (!selectedTags.length || selectedTags.some(tag => c.tags?.includes(tag))) &&
      (!query || [c.name, c.signature ?? '', ...(c.tags ?? [])].some(value => value.toLocaleLowerCase().includes(query))))
      .sort((a, b) => getSortKey(a.name).localeCompare(getSortKey(b.name)));
  }, [characters, search, filter, userId, selectedTags]);

  const enterChat = async (c: Character) => {
    await selectCharacter(c.id);
    setProfile(null); onSelect();
  };
  const remove = async () => {
    if (!deleting || lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try { await deleteCharacter(deleting.id); setDeleting(null); }
    catch { setError('删除未完成，请重试。'); }
    finally { lock.current = false; setBusy(false); }
  };

  return <div className="vg-characters h-full min-h-0 flex flex-col overflow-hidden">
    <header className="vg-character-heading shrink-0 px-5 pt-5 pb-3">
      <div className="flex items-center justify-between gap-3">
        <div><p className="vg-brand-wordmark"><BrandWordmark /></p><h1 className="mt-1 text-2xl font-semibold text-ink">角色</h1></div>
        <button onClick={() => setEditor({})} className="vg-primary-action min-h-11 rounded-full px-4 text-sm">＋ 添加角色</button>
      </div>
      <div className="vg-conversation-search mt-4 flex min-h-11 items-center rounded-2xl border border-line bg-surface px-3">
        <input aria-label="搜索角色" placeholder="搜索名字、签名或标签" value={search} onChange={e => setSearch(e.target.value)} className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none" />
        {search && <button aria-label="清空搜索" className="h-11 w-11 text-sub" onClick={() => setSearch('')}>×</button>}
      </div>
    </header>
    <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 pb-6">
      <div className="vg-character-shortcuts grid grid-cols-2 gap-3 mb-4">
        <button onClick={() => setNetwork(true)} className="is-relations min-h-20 rounded-2xl border border-life-cyan/20 px-4 text-left">
          <span className="vg-shortcut-title text-base font-medium text-ink">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="12" cy="5" r="2.5" /><circle cx="5" cy="17" r="2.5" /><circle cx="19" cy="17" r="2.5" /><path d="m10.5 7-4 7.5m7-7.5 4 7.5M7.5 17h9" /></svg>
            关系星图
          </span><span className="mt-1 block text-xs text-sub">看看彼此的连接</span>
        </button>
        <button onClick={() => setGroups(true)} className="is-groups min-h-20 rounded-2xl border border-gene-purple/20 px-4 text-left">
          <span className="vg-shortcut-title text-base font-medium text-ink">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><circle cx="9" cy="8" r="3" /><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 4v1" /></svg>
            角色群聊
          </span><span className="mt-1 block text-xs text-sub">一起聊点什么</span>
        </button>
      </div>
      <div className="mb-4"><SecretaryWorkspaceCard onOpen={c => void enterChat(c)} /></div>
      <div className="vg-character-tabs flex items-center gap-1 mb-2" role="tablist" aria-label="角色分类">
        {(['all', 'own'] as const).map(value => <button key={value} role="tab" aria-selected={filter === value} onClick={() => setFilter(value)} className={`min-h-11 px-3 text-sm rounded-xl ${filter === value ? 'text-ink bg-surface font-semibold' : 'text-sub'}`}>{value === 'all' ? '全部' : '我的角色'}</button>)}
        <span className="ml-auto text-xs text-sub"><AnimatedValue value={visible.length} /> 位</span>
      </div>
      {tagOptions.length > 0 && <MultiFilterChips options={tagOptions} value={selectedTags} onChange={setSelectedTags} />}
      {error && !deleting && <div role="alert" className="mb-3 rounded-xl bg-red-500/10 p-3 text-sm text-red-400">{error}<button className="ml-3 underline" onClick={() => setRetry(v => v + 1)}>重试</button></div>}
      {loading && characters.length === 0 ? <div className="vg-character-loading" role="status"><span className="sr-only">正在读取角色…</span>{[0,1,2].map(i=><div key={i} className="vg-skeleton-row" aria-hidden="true"><i /><span><b /><b /></span></div>)}</div> : visible.length === 0 ? <ConnectionEmptyState searching={!!search || selectedTags.length > 0}
        title={search || selectedTags.length ? '没有找到匹配的角色' : '在这里，认识一个新的灵魂'}
        detail={search || selectedTags.length ? '试试其他关键词，或清除筛选重新看看。' : '创建一个角色，让彼此的故事慢慢生长。'}
        action={<button onClick={() => { if (search || selectedTags.length) { setSearch(''); setSelectedTags([]); } else setEditor({}); }}>{search || selectedTags.length ? '清除筛选' : '添加角色'}</button>} /> : <div className="space-y-2">{visible.map(c => <CharacterRow key={c.id} character={c} onOpen={() => setProfile(c)} onManage={isOwn(c) ? () => setManage(c) : undefined} />)}</div>}
    </div>
    <Modal open={!!manage} onClose={() => setManage(null)} title={manage?.name} width="max-w-sm">
      <div className="p-4 space-y-2">
        {manage?.agentProfile === 'secretary' ? <button className="w-full min-h-12 rounded-xl bg-surface text-sm text-ink" onClick={() => { setManage(null); window.dispatchEvent(new Event('virtugene:open-secretary')); }}>助理管理 · 解雇与聘用</button> : <>
          <button className="w-full min-h-12 rounded-xl bg-surface text-sm text-ink" onClick={() => { if (manage) setEditor({ character: manage }); setManage(null); }}>编辑角色</button>
          <button className="w-full min-h-12 rounded-xl bg-red-500/10 text-sm text-red-400" onClick={() => { setError(''); setDeleting(manage); setManage(null); }}>删除角色</button>
        </>}
      </div>
    </Modal>
    <Modal open={!!deleting} onClose={() => { if (!busy) setDeleting(null); }} title="删除角色" width="max-w-sm" closeOnBackdrop={false}>
      <div className="p-5 text-sm text-sub"><p>确定删除「{deleting?.name}」？关联的对话、记忆和关系也会清除，无法恢复。</p>{error && <p role="alert" className="mt-3 text-red-400">{error}</p>}<div className="mt-5 flex gap-3"><button disabled={busy} className="flex-1 min-h-11 rounded-xl border border-line" onClick={() => setDeleting(null)}>取消</button><button disabled={busy} onClick={() => void remove()} className="flex-1 min-h-11 rounded-xl bg-red-500/15 text-red-400">{busy ? '正在删除…' : '确认删除'}</button></div></div>
    </Modal>
    {profile && <CharacterProfileModal key={profile.id} character={characters.find(c => c.id === profile.id) ?? profile} worldCharacters={characters} userId={userId} onClose={() => setProfile(null)} onChat={enterChat} onAdd={enterChat} />}
    {editor && <CharacterAddModal key={editor.character?.id ?? 'new'} open onClose={() => setEditor(null)} editCharacter={editor.character} onSelected={() => { if (!editor.character) onSelect(); }} />}
    {groups && <GroupChatPage onClose={() => setGroups(false)} />}
    {network && <RelationNetworkModal open onClose={() => setNetwork(false)} characters={characters.filter(isStoryCharacter)} userId={userId} />}
  </div>;
}

function CharacterRow({ character: c, onOpen, onManage }: { character: Character; onOpen: () => void; onManage?: () => void }) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = useRef(false);
  const origin = useRef({ x: 0, y: 0 });
  const cancel = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; };
  useEffect(() => cancel, []);
  return <div className="vg-character-row flex items-center rounded-2xl border border-line bg-panel/45">
    <button className="flex min-w-0 flex-1 items-center gap-3 p-3 text-left select-none" onClick={() => { if (!held.current) onOpen(); held.current = false; }}
      onPointerDown={e => { cancel(); held.current = false; origin.current = { x: e.clientX, y: e.clientY }; if (onManage && e.button === 0) timer.current = setTimeout(() => { held.current = true; onManage(); }, 550); }}
      onPointerMove={e => { if (Math.hypot(e.clientX - origin.current.x, e.clientY - origin.current.y) > 8) cancel(); }} onPointerUp={cancel} onPointerCancel={cancel} onPointerLeave={cancel}
      onContextMenu={e => { if (onManage) { e.preventDefault(); cancel(); held.current = true; onManage(); } }}>
      <Avatar avatar={c.avatar} size="lg" className="!w-12 !h-12" />
      <span className="min-w-0 flex-1"><span className="block truncate text-base font-medium text-ink">{c.name}</span><span className="mt-1 block truncate text-xs text-sub">{c.signature || (c.tags ?? []).slice(0, 3).join(' · ') || '点击查看角色'}</span></span>
    </button>
    {onManage && <button aria-label={`管理${c.name}`} onClick={onManage} className="min-h-12 w-11 shrink-0 text-xl text-sub">⋯</button>}
  </div>;
}
