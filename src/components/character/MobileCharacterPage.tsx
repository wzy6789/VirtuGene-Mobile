import { useEffect, useMemo, useRef, useState } from 'react';
import { useChatStore } from '../../store/chat-store';
import { CharacterAddModal } from './CharacterAddModal';
import { getInitial, getSortKey, INDEX_LETTERS } from '../../lib/pinyin';

interface Props {
  /** 选择角色后回调（切回聊天 tab） */
  onSelect: () => void;
}

/**
 * 手机端角色列表页（微信「通讯录」式）：
 * 顶部为「基因实验室」入口，下方角色按首字母 A-Z 分组（右侧字母索引条），
 * 点击角色直接进入聊天。
 */
export function MobileCharacterPage({ onSelect }: Props) {
  const characters = useChatStore((s) => s.characters);
  const selectedCharacterId = useChatStore((s) => s.selectedCharacterId);
  const selectCharacter = useChatStore((s) => s.selectCharacter);
  const unreadByCharacter = useChatStore((s) => s.unreadByCharacter);
  const loadCharacters = useChatStore((s) => s.loadCharacters);
  const fetchUnreadCounts = useChatStore((s) => s.fetchUnreadCounts);
  const [showLab, setShowLab] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void loadCharacters();
    void fetchUnreadCounts();
  }, [loadCharacters, fetchUnreadCounts]);

  /** 按首字母分组 + 组内按拼音排序（微信通讯录式） */
  const groups = useMemo(() => {
    const map = new Map<string, typeof characters>();
    for (const c of characters) {
      const letter = getInitial(c.name);
      if (!map.has(letter)) map.set(letter, []);
      map.get(letter)!.push(c);
    }
    // 组内按全拼排序；组按 A-Z 顺序（'#' 放最后）
    for (const arr of map.values()) arr.sort((a, b) => getSortKey(a.name).localeCompare(getSortKey(b.name)));
    return [...map.entries()].sort(([a], [b]) => (a === '#' ? 1 : b === '#' ? -1 : a.localeCompare(b)));
  }, [characters]);

  /** 已有角色的字母集合（索引条只点亮有内容的字母） */
  const availableLetters = useMemo(() => new Set(groups.map(([l]) => l)), [groups]);

  const handleSelect = async (id: string) => {
    await selectCharacter(id);
    onSelect();
  };

  /** 点击索引字母 → 滚动到对应分组 */
  const scrollToLetter = (letter: string) => {
    const el = listRef.current?.querySelector(`[data-letter="${letter}"]`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="h-full flex flex-col">
      {/* 头部 */}
      <div className="h-12 flex items-center gap-2 px-4 border-b border-line shrink-0">
        <span className="text-base font-bold bg-gradient-to-r from-gene-purple to-life-cyan bg-clip-text text-transparent">
          我的角色
        </span>
        <span className="text-[10px] text-gray-400">{characters.length} 位灵魂</span>
      </div>

      {/* 滚动容器（relative：字母索引条相对可视区域定位，滚动时固定在右侧中间） */}
      <div className="relative flex-1 overflow-y-auto py-1">
        {/* 基因实验室入口：放在所有人物之上，醒目（紫青渐变横条） */}
        <button
          onClick={() => setShowLab(true)}
          className="mx-3 mb-2 mt-1 w-[calc(100%-1.5rem)] flex items-center gap-3 px-4 py-3.5 rounded-2xl text-left overflow-hidden relative transition-all active:scale-[0.98] bg-gradient-to-r from-gene-purple to-[#00CEC9] shadow-[0_4px_16px_rgba(108,92,231,0.35)]"
        >
          {/* DNA 点缀光斑 */}
          <span className="absolute -top-6 -right-6 w-20 h-20 rounded-full bg-white/15 blur-xl pointer-events-none" />
          <span className="absolute -bottom-8 -left-4 w-24 h-24 rounded-full bg-white/10 blur-2xl pointer-events-none" />
          <span className="relative shrink-0 w-10 h-10 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center text-xl">
            🧬
          </span>
          <span className="relative min-w-0 flex-1">
            <span className="block text-sm font-semibold text-white">基因实验室</span>
            <span className="block text-[11px] text-white/85 mt-0.5 truncate">培育新的数字灵魂</span>
          </span>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="relative shrink-0 opacity-90">
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>

      {/* 角色列表（按字母分组） */}
      <div>
        {characters.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center gap-3 text-gray-500 px-8 text-center">
            <span className="text-4xl">🧬</span>
            <p className="text-sm">还没有角色，去基因实验室孵化一个数字灵魂吧</p>
            <button
              onClick={() => setShowLab(true)}
              className="mt-1 px-4 py-2 rounded-full text-sm bg-gene-purple text-white shadow-[0_2px_12px_rgba(108,92,231,0.35)]"
            >
              打开基因实验室
            </button>
          </div>
        ) : (
          <div ref={listRef}>
            {groups.map(([letter, list]) => (
              <div key={letter}>
                {/* 分组标题 */}
                <div
                  data-letter={letter}
                  className="sticky top-0 z-10 px-4 py-1 text-[11px] font-medium text-gray-400 bg-app/90 backdrop-blur-sm"
                >
                  {letter === '#' ? '#' : letter}
                </div>
                {list.map((c) => {
                  const isSelected = c.id === selectedCharacterId;
                  const unread = unreadByCharacter[c.id] ?? 0;
                  return (
                    <button
                      key={c.id}
                      onClick={() => void handleSelect(c.id)}
                      className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors active:bg-surface ${
                        isSelected ? 'bg-gene-purple/8' : ''
                      }`}
                    >
                      {c.avatar.startsWith('data:') ? (
                        <img src={c.avatar} alt={c.name} className="w-10 h-10 rounded-xl object-cover shrink-0" />
                      ) : (
                        <span className="w-10 h-10 rounded-xl bg-surface flex items-center justify-center text-xl shrink-0">
                          {c.avatar}
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-ink truncate">{c.name}</span>
                          {c.tags.slice(0, 2).map((tag) => (
                            <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded bg-surface text-gray-400 shrink-0">
                              {tag}
                            </span>
                          ))}
                        </div>
                        {c.signature ? (
                          <p className="text-xs text-gray-500 truncate mt-0.5">{c.signature}</p>
                        ) : (
                          <p className="text-xs text-gray-500 truncate mt-0.5">{c.systemPrompt.slice(0, 40)}</p>
                        )}
                      </div>
                      {unread > 0 && (
                        <span className="shrink-0 min-w-5 h-5 px-1.5 rounded-full bg-red-500 text-white text-[11px] flex items-center justify-center">
                          {unread > 99 ? '99+' : unread}
                        </span>
                      )}
                      {isSelected && unread === 0 && (
                        <span className="shrink-0 text-xs text-gene-purple">✓</span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        )}

        {/* 右侧字母索引条（微信通讯录式；相对滚动容器可视区固定，滚动不跑位） */}
        {characters.length > 0 && (
          <div className="absolute right-0 top-1/2 -translate-y-1/2 z-20 flex flex-col items-center gap-[2px] px-0.5 py-1 select-none">
            {INDEX_LETTERS.map((l) => {
              const has = availableLetters.has(l);
              return (
                <button
                  key={l}
                  onClick={() => scrollToLetter(l)}
                  disabled={!has}
                  className={`w-4 h-4 flex items-center justify-center text-[9px] leading-none rounded transition-colors ${
                    has ? 'text-gene-purple font-semibold active:bg-gene-purple/15' : 'text-gray-300'
                  }`}
                >
                  {l}
                </button>
              );
            })}
          </div>
        )}
      </div>
      </div>

      <CharacterAddModal
        open={showLab}
        onClose={() => setShowLab(false)}
        onSelected={() => {
          setShowLab(false);
          onSelect();
        }}
      />
    </div>
  );
}
