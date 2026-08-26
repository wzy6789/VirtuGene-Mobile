import { useEffect, useMemo, useRef, useState } from 'react';
import { useChatStore } from '../../store/chat-store';
import { useAuthStore } from '../../store/auth-store';
import { characterRepo } from '../../db/character-repo';
import { categorizeTag, CATEGORY_LABELS, CATEGORY_ORDER, type TagCategory } from '../../lib/tag-categories';
import { getInitial, getSortKey, INDEX_LETTERS } from '../../lib/pinyin';
import { IS_MOBILE } from '../../lib/platform';
import { CharacterProfileModal } from './CharacterProfileModal';
import type { Character } from '../../db/index';

interface GenePoolTabProps {
  onSelect: (character: Character) => void;
}

type FilterTab = 'all' | 'preset' | 'shared' | 'mine';
type CatFilter = 'all' | TagCategory;
type ViewMode = 'grid' | 'az';

const FILTERS: { key: FilterTab; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'preset', label: '预设基因' },
  { key: 'shared', label: '共享基因' },
  { key: 'mine', label: '我的' },
];

function getBadge(char: Character, userId: string) {
  if (char.isPreset || char.sourcePresetId) {
    return { text: '预设基因', className: 'bg-gene-purple/20 text-gene-purple' };
  }
  if (char.published && char.createdBy !== userId) {
    return { text: '共享基因', className: 'bg-amber-500/20 text-amber-400' };
  }
  return { text: '自定义基因', className: 'bg-life-cyan/10 text-life-cyan' };
}

export function GenePoolTab({ onSelect }: GenePoolTabProps) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FilterTab>('all');
  const [catFilter, setCatFilter] = useState<CatFilter>('all');
  const [view, setView] = useState<ViewMode>('az');
  const [poolCharacters, setPoolCharacters] = useState<Character[]>([]);
  const [profileChar, setProfileChar] = useState<Character | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const groupRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const selectedCharacterId = useChatStore((s) => s.selectedCharacterId);
  const selectCharacter = useChatStore((s) => s.selectCharacter);
  const createCharacter = useChatStore((s) => s.createCharacter);
  const userId = useAuthStore((s) => s.userId) ?? '';
  /** 手机端屏幕小：强制列表视图，不用网格（微信/QQ 通讯录式） */
  const effectiveView: ViewMode = IS_MOBILE ? 'az' : view;

  // The gene pool is independent of the sidebar: it also surfaces others'
  // published characters (which are hidden from the left sidebar).
  useEffect(() => {
    let alive = true;
    characterRepo.getAll().then((all) => {
      if (alive) setPoolCharacters(all);
    });
    return () => {
      alive = false;
    };
  }, []);

  const poolBase = poolCharacters.filter(
    (c) => c.isPreset || c.published || c.createdBy === userId,
  );

  const preFiltered = (() => {
    switch (filter) {
      case 'preset':
        return poolBase.filter((c) => c.isPreset);
      case 'shared':
        return poolBase.filter((c) => c.published && !c.isPreset && c.createdBy !== userId);
      case 'mine':
        return poolBase.filter((c) => c.createdBy === userId && !c.isPreset);
      default:
        return poolBase;
    }
  })();

  const catFiltered =
    catFilter === 'all'
      ? preFiltered
      : preFiltered.filter((c) => c.tags.some((t) => categorizeTag(t) === catFilter));

  const filtered = catFiltered.filter(
    (c) =>
      c.name.includes(query) ||
      c.tags.some((t) => t.includes(query)) ||
      c.systemPrompt.includes(query),
  );

  const grouped = useMemo(() => {
    const sorted = [...filtered].sort((a, b) =>
      getSortKey(a.name).localeCompare(getSortKey(b.name)),
    );
    const map = new Map<string, Character[]>();
    for (const c of sorted) {
      const letter = getInitial(c.name);
      const arr = map.get(letter) ?? [];
      arr.push(c);
      map.set(letter, arr);
    }
    const letters = [...map.keys()].sort((a, b) => {
      if (a === '#') return 1;
      if (b === '#') return -1;
      return a.localeCompare(b);
    });
    return letters.map((letter) => ({ letter, chars: map.get(letter)! }));
  }, [filtered]);

  const presentLetters = useMemo(() => new Set(grouped.map((g) => g.letter)), [grouped]);

  const clonePresetIfNeeded = async (character: Character): Promise<Character> => {
    const mine = await characterRepo.getByCreator(userId);
    if (character.isPreset) {
      const existing = mine.find((c) => c.sourcePresetId === character.id);
      if (existing) return existing;
    } else {
      const existing = mine.find((c) => c.name === character.name);
      if (existing) return existing;
    }
    return createCharacter({
      name: character.name,
      avatar: character.avatar,
      systemPrompt: character.systemPrompt,
      tags: character.tags,
      signature: character.signature,
      greeting: character.greeting,
      sourcePresetId: character.isPreset ? character.id : undefined,
      isPreset: false,
      isCustom: false,
      published: false,
      createdBy: userId,
      proactivity: character.proactivity,
    });
  };

  const handleAdd = async (character: Character) => {
    const clone = await clonePresetIfNeeded(character);
    setProfileChar(null);
    onSelect(clone);
  };

  const handleChat = async (character: Character) => {
    await selectCharacter(character.id);
    setProfileChar(null);
    onSelect(character);
  };

  const scrollToLetter = (letter: string) => {
    const container = listRef.current;
    const el = groupRefs.current[letter];
    if (!container || !el) return;
    container.scrollTop += el.getBoundingClientRect().top - container.getBoundingClientRect().top;
  };

  return (
    <div className="space-y-4">
      {/* Search + view toggle */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500"
            viewBox="0 0 16 16"
            fill="none"
          >
            <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.2" />
            <path d="M11 11L14.5 14.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索基因序列..."
            className="w-full pl-10 pr-4 py-2.5 bg-surface border border-line-strong rounded-xl text-sm text-ink placeholder-gray-500 focus:outline-none focus:border-gene-purple/50 transition-colors"
          />
        </div>
        {/* 视图切换（手机端屏幕小，强制列表视图，隐藏网格切换） */}
        {!IS_MOBILE && (
        <div className="flex shrink-0 bg-surface rounded-lg p-0.5 border border-line">
          <button
            onClick={() => setView('grid')}
            className={`px-2.5 py-1 rounded-md text-xs transition-colors ${
              view === 'grid' ? 'bg-gene-purple text-white' : 'text-gray-500 hover:text-sub'
            }`}
          >
            网格
          </button>
          <button
            onClick={() => setView('az')}
            className={`px-2.5 py-1 rounded-md text-xs transition-colors ${
              view === 'az' ? 'bg-gene-purple text-white' : 'text-gray-500 hover:text-sub'
            }`}
          >
            A-Z
          </button>
        </div>
        )}
      </div>

      {/* Source filter tabs */}
      <div className="flex gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 rounded-lg text-xs transition-colors ${
              filter === f.key
                ? 'bg-gene-purple/20 text-gene-purple'
                : 'text-gray-500 hover:text-sub hover:bg-surface'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Tag category filter */}
      <div className="flex gap-1.5">
        {(['all', ...CATEGORY_ORDER] as CatFilter[]).map((cat) => (
          <button
            key={cat}
            onClick={() => setCatFilter(cat)}
            className={`px-3 py-1.5 rounded-lg text-xs transition-colors ${
              catFilter === cat
                ? 'bg-life-cyan/15 text-life-cyan'
                : 'text-gray-500 hover:text-sub hover:bg-surface'
            }`}
          >
            {cat === 'all' ? '全部' : CATEGORY_LABELS[cat]}
          </button>
        ))}
      </div>

      {/* Results */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-gray-500">
          <span className="text-4xl mb-3">🧬</span>
          <span className="text-sm">未找到匹配的基因序列</span>
        </div>
      ) : effectiveView === 'grid' ? (
        <div className="grid grid-cols-2 gap-3 max-h-[45vh] overflow-y-auto pr-1">
          {filtered.map((char) => {
            const isSelected = char.id === selectedCharacterId;
            const isShared = char.published && !char.isPreset && char.createdBy !== userId;
            const badge = getBadge(char, userId);
            return (
              <button
                key={char.id}
                onClick={() => setProfileChar(char)}
                className={`relative text-left p-4 rounded-xl border transition-all hover:bg-surface ${
                  isSelected
                    ? 'border-gene-purple bg-gene-purple/10'
                    : 'border-line'
                }`}
              >
                {isSelected && (
                  <span className="absolute top-2 right-2 text-gene-purple text-xs">✓</span>
                )}
                <div className="flex items-start gap-3">
                  {char.avatar.startsWith('data:') ? (
                    <img src={char.avatar} alt={char.name} className="w-9 h-9 rounded-lg object-cover shrink-0" />
                  ) : (
                    <span className="text-3xl shrink-0">{char.avatar}</span>
                  )}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-ink truncate">{char.name}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${badge.className}`}>
                        {badge.text}
                      </span>
                    </div>
                    {char.signature && (
                      <p className="text-[11px] text-gray-500 line-clamp-1 mt-0.5">{char.signature}</p>
                    )}
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {char.tags.map((tag) => (
                        <span
                          key={tag}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-surface text-gray-400"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                    {isShared && (
                      <span className="inline-block mt-2 text-[10px] text-life-cyan">
                        ⧉ 点击查看档案
                      </span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="flex gap-1">
          <div ref={listRef} className="flex-1 min-w-0 max-h-[45vh] overflow-y-auto pr-1">
            {grouped.map((group) => (
              <div
                key={group.letter}
                ref={(el) => {
                  groupRefs.current[group.letter] = el;
                }}
              >
                <div className="px-2 pt-3 pb-1 text-[11px] font-semibold text-life-cyan">
                  {group.letter}
                </div>
                {group.chars.map((char) => {
                  const isSelected = char.id === selectedCharacterId;
                  const badge = getBadge(char, userId);
                  return (
                    <button
                      key={char.id}
                      onClick={() => setProfileChar(char)}
                      className={`w-full flex items-center gap-3 px-2 py-2 rounded-lg text-left transition-colors hover:bg-surface ${
                        isSelected ? 'bg-gene-purple/10' : ''
                      }`}
                    >
                      {char.avatar.startsWith('data:') ? (
                        <img src={char.avatar} alt={char.name} className="w-8 h-8 rounded-lg object-cover shrink-0" />
                      ) : (
                        <span className="text-xl shrink-0">{char.avatar}</span>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-ink truncate">{char.name}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${badge.className}`}>
                            {badge.text}
                          </span>
                        </div>
                        {char.signature && (
                          <p className="text-[11px] text-gray-500 truncate mt-0.5">{char.signature}</p>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>

          {/* Letter index bar */}
          <div className="shrink-0 flex flex-col justify-center gap-0.5 text-[10px] text-gray-500">
            {INDEX_LETTERS.map((l) => (
              <button
                key={l}
                onClick={() => scrollToLetter(l)}
                className={`w-4 h-4 flex items-center justify-center rounded transition-colors ${
                  presentLetters.has(l)
                    ? 'text-life-cyan hover:bg-life-cyan/10'
                    : 'text-gray-600/40'
                }`}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
      )}

      {profileChar && (
        <CharacterProfileModal
          character={profileChar}
          userId={userId}
          onClose={() => setProfileChar(null)}
          onAdd={handleAdd}
          onChat={handleChat}
        />
      )}
    </div>
  );
}
