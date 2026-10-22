import { useEffect, useMemo, useRef, useState } from 'react';
import { liveQuery } from 'dexie';
import { GeneGlyph } from '../ui/GeneGlyph';
import { useChatStore } from '../../store/chat-store';
import { useAuthStore } from '../../store/auth-store';
import { characterRepo } from '../../db/character-repo';
import { categorizeTag, CATEGORY_LABELS, CATEGORY_ORDER, type TagCategory } from '../../lib/tag-categories';
import { getInitial, getSortKey } from '../../lib/pinyin';
import { Icon } from '../ui/Icon';
import { FeedbackNotice } from '../ui/FeedbackNotice';
import { IS_MOBILE } from '../../lib/platform';
import { CharacterProfileModal } from './CharacterProfileModal';
import { FusionModal } from './FusionModal';
import { CharacterPortrait } from './CharacterCover';
import { useGeneProfileHandoff } from './useGeneProfileHandoff';
import type { Character } from '../../db/index';
import { ensureOwnedChatCharacter } from '../../lib/character-chat';
import '../../styles/gene-library.css';

interface GenePoolTabProps {
  onSelect: (character: Character) => void;
  singleScroll?: boolean;
}

type FilterTab = 'all' | 'preset' | 'shared' | 'mine';
type CatFilter = 'all' | TagCategory;
type ViewMode = 'grid' | 'az';

const FILTERS: { key: FilterTab; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'preset', label: '预设' },
  { key: 'shared', label: '共享' },
  { key: 'mine', label: '我的' },
];

function sourceLabel(character: Character, userId: string) {
  if (character.isPreset) return '预设';
  if (character.createdBy === userId) return '我的';
  return '共享';
}

export function GenePoolTab({ onSelect, singleScroll = false }: GenePoolTabProps) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FilterTab>('all');
  const [catFilter, setCatFilter] = useState<CatFilter>('all');
  const [view, setView] = useState<ViewMode>('az');
  const [poolCharacters, setPoolCharacters] = useState<Character[]>([]);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [reload, setReload] = useState(0);
  const [profileChar, setProfileChar] = useState<Character | null>(null);
  const [showFusion, setShowFusion] = useState(false);
  const [returningId, setReturningId] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const groupRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const profileOwner = useRef('');
  const selectedCharacterId = useChatStore((s) => s.selectedCharacterId);
  const selectCharacter = useChatStore((s) => s.selectCharacter);
  const userId = useAuthStore((s) => s.userId) ?? '';
  const { open: openHandoff, returnToCard, invalidate: invalidateHandoff } = useGeneProfileHandoff(userId);
  const effectiveView: ViewMode = IS_MOBILE ? 'az' : view;

  // Read the catalog once per load, never once per card or verification.
  useEffect(() => {
    let alive = true;
    setLoadState('loading');
    setPoolCharacters([]);
    void characterRepo.getAll().then((all) => {
      if (!alive || (useAuthStore.getState().userId ?? '') !== userId) return;
      setPoolCharacters(all);
      setLoadState('ready');
    }).catch(() => {
      if (alive && (useAuthStore.getState().userId ?? '') === userId) setLoadState('error');
    });
    return () => { alive = false; };
  }, [userId, reload]);

  useEffect(() => {
    setProfileChar(null);
    setShowFusion(false);
  }, [userId]);

  useEffect(() => {
    if (!profileChar) return;
    const characterId = profileChar.id;
    // Watch only the open resource by primary key, never rescan the catalog.
    const subscription = liveQuery(() => characterRepo.getById(characterId)).subscribe({
      next: (source) => {
        if (useAuthStore.getState().userId !== userId || source && (source.isPreset || source.published || source.createdBy === userId)) return;
        invalidateHandoff();
        setPoolCharacters((rows) => rows.filter((row) => row.id !== characterId));
      },
      error: () => { invalidateHandoff(); },
    });
    return () => subscription.unsubscribe();
  }, [profileChar, userId, invalidateHandoff]);

  useEffect(() => {
    if (!returningId) return;
    const timer = window.setTimeout(() => setReturningId(''), 850);
    return () => window.clearTimeout(timer);
  }, [returningId]);

  const poolBase = useMemo(() => poolCharacters.filter(
    (c) => c.agentProfile !== 'secretary' && (c.isPreset || c.published || c.createdBy === userId),
  ), [poolCharacters, userId]);

  const mineBySource = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of poolBase) {
      if (!c.isPreset && c.createdBy === userId && c.sourcePresetId) map.set(c.sourcePresetId, c.id);
    }
    return map;
  }, [poolBase, userId]);
  const visibleResourceIds = useMemo(() => new Set(
    poolBase.filter((c) => c.isPreset || c.published && c.createdBy !== userId).map((c) => c.id),
  ), [poolBase, userId]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return poolBase.filter((c) => {
      if (filter === 'preset' && !c.isPreset) return false;
      if (filter === 'shared' && (!c.published || c.isPreset || c.createdBy === userId)) return false;
      if (filter === 'mine' && (c.createdBy !== userId || c.isPreset)) return false;
      // A withdrawn resource must not hide the account's surviving private copy.
      if (filter !== 'mine' && c.createdBy === userId && c.sourcePresetId && visibleResourceIds.has(c.sourcePresetId)) return false;
      if (catFilter !== 'all' && !c.tags.some((tag) => categorizeTag(tag) === catFilter)) return false;
      return !needle || [c.name, c.signature, c.systemPrompt, ...c.tags].some((value) => value?.toLocaleLowerCase().includes(needle));
    });
  }, [poolBase, filter, userId, visibleResourceIds, catFilter, query]);

  const grouped = useMemo(() => {
    const sorted = [...filtered].sort((a, b) => getSortKey(a.name).localeCompare(getSortKey(b.name)));
    const map = new Map<string, Character[]>();
    for (const c of sorted) {
      const letter = getInitial(c.name);
      const characters = map.get(letter) ?? [];
      characters.push(c);
      map.set(letter, characters);
    }
    return [...map.keys()].sort((a, b) => a === '#' ? 1 : b === '#' ? -1 : a.localeCompare(b))
      .map((letter) => ({ letter, chars: map.get(letter)! }));
  }, [filtered]);

  const handleChat = async (character: Character) => {
    const target = await ensureOwnedChatCharacter(character, userId);
    if (useAuthStore.getState().userId !== userId) return;
    await selectCharacter(target.id);
    if (useAuthStore.getState().userId !== userId || useChatStore.getState().selectedCharacterId !== target.id) return;
    setProfileChar(null);
    onSelect(target);
  };

  const getScroller = () => {
    const container = listRef.current;
    return IS_MOBILE && singleScroll ? container?.closest<HTMLElement>('[data-modal-scroll]') : container;
  };

  const openProfile = (character: Character, card: HTMLButtonElement) => {
    openHandoff(character.id, card, getScroller());
    profileOwner.current = userId;
    setReturningId('');
    setProfileChar(character);
  };

  const closeProfile = () => {
    const id = profileChar?.id;
    returnToCard();
    setProfileChar(null);
    if (id) setReturningId(id);
  };

  const scrollToLetter = (letter: string) => {
    const scroller = getScroller();
    const group = groupRefs.current[letter];
    if (!scroller || !group) return;
    const tabsHeight = IS_MOBILE && singleScroll ? scroller.querySelector('.vg-character-editor-tabs')?.getBoundingClientRect().height ?? 56 : 0;
    scroller.scrollTop += group.getBoundingClientRect().top - scroller.getBoundingClientRect().top - tabsHeight;
  };

  const clearFilters = () => { setQuery(''); setFilter('all'); setCatFilter('all'); };
  const hasFilters = !!query.trim() || filter !== 'all' || catFilter !== 'all';

  const renderCard = (character: Character) => {
    const added = mineBySource.has(character.id) || !character.isPreset && character.createdBy === userId && !!character.sourcePresetId;
    const ownedId = mineBySource.get(character.id) ?? character.id;
    return <button
      key={character.id}
      type="button"
      className="vg-gene-card"
      data-selected={ownedId === selectedCharacterId || undefined}
      data-returning={returningId === character.id || undefined}
      onClick={(event) => openProfile(character, event.currentTarget)}
      aria-label={`查看${character.name}的角色档案，${sourceLabel(character, userId)}${added ? '，已添加' : ''}`}
    >
      <span className="vg-gene-portrait" aria-hidden="true">
        <CharacterPortrait character={character} className="vg-gene-portrait-visual" soulRole="list" />
      </span>
      <span className="vg-gene-card-copy">
        <span className="vg-gene-card-heading">
          <span className="vg-gene-name">{character.name}</span>
          <span className="vg-gene-source">{sourceLabel(character, userId)}</span>
        </span>
        {character.signature && <span className="vg-gene-signature">{character.signature}</span>}
        <span className="vg-gene-card-meta">
          <span className="vg-gene-tags">
            {character.tags.slice(0, 2).map((tag, index) => <span key={`${tag}:${index}`} className="vg-gene-tag">{tag}</span>)}
            {character.tags.length > 2 && <span className="vg-gene-tag-count" aria-label={`另有 ${character.tags.length - 2} 个标签`}>+{character.tags.length - 2}</span>}
          </span>
          {added && <span className="vg-gene-added"><Icon name="check" size={12} />已添加</span>}
        </span>
      </span>
    </button>;
  };

  return <div className="vg-gene-library" data-gene-library tabIndex={-1}>
    <div className="vg-gene-heading">
      <div><h3>基因库</h3><p>发现与创造角色</p></div>
      <button type="button" onClick={() => setShowFusion(true)} className="vg-gene-tool"><GeneGlyph size={19} /><span>融合角色</span></button>
    </div>
    <div className="vg-gene-search-row">
      <div className="vg-gene-search">
        <Icon name="search" size={18} />
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="搜索角色名字、签名或标签" placeholder="搜索名字、签名、标签…" className="vg-text-field" />
      </div>
      {!IS_MOBILE && <div className="vg-gene-view" role="group" aria-label="目录视图">
        <button type="button" aria-pressed={view === 'grid'} onClick={() => setView('grid')}>网格</button>
        <button type="button" aria-pressed={view === 'az'} onClick={() => setView('az')}>A–Z</button>
      </div>}
    </div>
    <div className="vg-gene-sources" role="group" aria-label="基因来源">
      {FILTERS.map((item) => <button key={item.key} type="button" aria-pressed={filter === item.key} onClick={() => setFilter(item.key)}>{item.label}</button>)}
    </div>
    <div className="vg-gene-filter-line">
      <span className="vg-gene-result-count" role="status" aria-live="polite">{loadState === 'ready' ? `${filtered.length} 位角色` : loadState === 'loading' ? '正在读取角色' : '读取未完成'}</span>
      <details className="vg-gene-filters">
        <summary>特质筛选{catFilter !== 'all' && <span> · {CATEGORY_LABELS[catFilter]}</span>}<Icon name="chevron" size={14} /></summary>
        <div className="vg-gene-filter-options" role="group" aria-label="角色特质">
          {(['all', ...CATEGORY_ORDER] as CatFilter[]).map((category) => <button key={category} type="button" aria-pressed={catFilter === category} onClick={() => setCatFilter(category)}>{category === 'all' ? '全部特质' : CATEGORY_LABELS[category]}</button>)}
        </div>
      </details>
      {hasFilters && <button className="vg-gene-clear" type="button" onClick={clearFilters}>清除</button>}
    </div>

    {loadState === 'loading' ? <div className="vg-gene-empty" role="status"><GeneGlyph size={30} /><p>正在读取角色目录…</p></div>
      : loadState === 'error' ? <FeedbackNotice tone="error" message="角色目录暂时无法读取，筛选条件已保留。"><button type="button" className="vg-button vg-button-secondary" onClick={() => setReload((value) => value + 1)}>重新读取</button></FeedbackNotice>
      : filtered.length === 0 ? <div className="vg-gene-empty"><GeneGlyph size={32} /><p>{hasFilters ? '没有找到符合条件的角色' : '这里还没有角色'}</p><span>{hasFilters ? '换个名字或特质，再找找看。' : '创建角色，或通过融合开始新的相遇。'}</span>{hasFilters && <button type="button" className="vg-button vg-button-secondary" onClick={clearFilters}>清除筛选</button>}</div>
      : effectiveView === 'grid' ? <div ref={listRef} className="vg-gene-grid">{filtered.map(renderCard)}</div>
      : <div className="vg-gene-directory">
        <div ref={listRef} className="vg-gene-list" data-single-scroll={IS_MOBILE && singleScroll || undefined}>
          {grouped.map((group) => <div key={group.letter} className="vg-gene-group" ref={(element) => { groupRefs.current[group.letter] = element; }}>
            <div className="vg-gene-letter" aria-label={`${group.letter} 开头`}><span>{group.letter}</span></div>
            <div className="vg-gene-group-cards">{group.chars.map(renderCard)}</div>
          </div>)}
        </div>
        <nav className="vg-gene-index" aria-label="按字母定位角色">{grouped.map(({ letter }) => <button key={letter} type="button" aria-label={`定位到 ${letter} 开头的角色`} onClick={() => scrollToLetter(letter)}>{letter}</button>)}</nav>
      </div>}

    {profileChar && profileOwner.current === userId && <CharacterProfileModal character={profileChar} userId={userId} onClose={closeProfile} onChat={handleChat} />}
    {showFusion && <FusionModal sourceCharacters={poolBase} onClose={() => setShowFusion(false)} onSaved={() => setReload((value) => value + 1)} />}
  </div>;
}
