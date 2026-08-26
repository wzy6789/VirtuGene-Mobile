import { useEffect, useMemo, useRef, useState } from 'react';
import { useChatStore } from '../../store/chat-store';
import { useAuthStore } from '../../store/auth-store';
import { CharacterAddModal } from './CharacterAddModal';
import { CharacterProfileModal } from './CharacterProfileModal';
import { Modal } from '../ui/Modal';
import { getInitial, getSortKey, INDEX_LETTERS } from '../../lib/pinyin';
import type { Character } from '../../db/index';

interface Props {
  /** 选择角色后回调（切回聊天 tab） */
  onSelect: () => void;
}

/**
 * 手机端角色列表页（微信「通讯录」式）：
 * 顶部为搜索框 + 基因实验室入口，下方角色按首字母 A-Z 分组（右侧字母索引条）。
 * 长按角色可编辑 / 删除（自定义角色；预设只可聊）。
 * 点击角色直接进入聊天。
 */
export function MobileCharacterPage({ onSelect }: Props) {
  const characters = useChatStore((s) => s.characters);
  const selectedCharacterId = useChatStore((s) => s.selectedCharacterId);
  const selectCharacter = useChatStore((s) => s.selectCharacter);
  const unreadByCharacter = useChatStore((s) => s.unreadByCharacter);
  const loadCharacters = useChatStore((s) => s.loadCharacters);
  const fetchUnreadCounts = useChatStore((s) => s.fetchUnreadCounts);
  const deleteCharacter = useChatStore((s) => s.deleteCharacter);
  const userId = useAuthStore((s) => s.userId) ?? '';
  const [showLab, setShowLab] = useState(false);
  const [editChar, setEditChar] = useState<Character | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Character | null>(null);
  const [profileChar, setProfileChar] = useState<Character | null>(null);
  const [search, setSearch] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressedRef = useRef(false);

  useEffect(() => {
    void loadCharacters();
    void fetchUnreadCounts();
  }, [loadCharacters, fetchUnreadCounts]);

  /** 搜索过滤（名字/标签/签名/性格片段） */
  const filtered = useMemo(() => {
    const kw = search.trim().toLowerCase();
    if (!kw) return characters;
    return characters.filter((c) =>
      c.name.toLowerCase().includes(kw) ||
      c.tags.some((t) => t.toLowerCase().includes(kw)) ||
      (c.signature ?? '').toLowerCase().includes(kw) ||
      c.systemPrompt.toLowerCase().includes(kw),
    );
  }, [characters, search]);

  /** 按首字母分组 + 组内按拼音排序（搜索时不用分组） */
  const groups = useMemo(() => {
    const map = new Map<string, typeof characters>();
    for (const c of filtered) {
      const letter = getInitial(c.name);
      if (!map.has(letter)) map.set(letter, []);
      map.get(letter)!.push(c);
    }
    for (const arr of map.values()) arr.sort((a, b) => getSortKey(a.name).localeCompare(getSortKey(b.name)));
    return [...map.entries()].sort(([a], [b]) => (a === '#' ? 1 : b === '#' ? -1 : a.localeCompare(b)));
  }, [filtered]);

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

  /** 长按角色 → 弹编辑/删除菜单（自定义角色） */
  const startLongPress = (c: Character, x: number, y: number) => {
    if (longPressRef.current) clearTimeout(longPressRef.current);
    longPressedRef.current = false;
    longPressRef.current = setTimeout(() => {
      longPressedRef.current = true;
      // 自定义角色可编辑/删除；预设只提示不可编辑
      if (c.isPreset || c.createdBy !== userId) return;
      setEditChar(c);
    }, 600);
  };

  const cancelLongPress = () => {
    if (longPressRef.current) {
      clearTimeout(longPressRef.current);
      longPressRef.current = null;
    }
  };

  const handleItemClick = (c: Character) => {
    if (longPressedRef.current) {
      longPressedRef.current = false;
      cancelLongPress();
      return;
    }
    cancelLongPress();
    // 点角色 → 打开资料卡（资料卡内再点「开始聊天」）
    setProfileChar(c);
  };

  const isOwn = (c: Character) => !c.isPreset && c.createdBy === userId;

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
        {/* 搜索框（微信通讯录式） */}
        <div className="mx-3 mb-2 mt-1">
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-surface border border-line focus-within:border-gene-purple/40 transition-all">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-gray-400 shrink-0">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索角色"
              className="flex-1 bg-transparent text-sm text-ink placeholder:text-gray-500 outline-none min-w-0"
            />
            {search && (
              <button onClick={() => setSearch('')} className="text-gray-400 hover:text-ink transition-colors">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* 基因实验室入口：放在所有人物之上，醒目（紫青渐变横条） */}
        <button
          onClick={() => setShowLab(true)}
          className="mx-3 mb-2 w-[calc(100%-1.5rem)] flex items-center gap-3 px-4 py-3.5 rounded-2xl text-left overflow-hidden relative transition-all active:scale-[0.98] bg-gradient-to-r from-gene-purple to-[#00CEC9] shadow-[0_4px_16px_rgba(108,92,231,0.35)]"
        >
          <span className="absolute -top-6 -right-6 w-20 h-20 rounded-full bg-white/15 blur-xl pointer-events-none" />
          <span className="absolute -bottom-8 -left-4 w-24 h-24 rounded-full bg-white/10 blur-2xl pointer-events-none" />
          <span className="relative shrink-0 w-10 h-10 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 12c-2-2.5-5.5-4-8-4M12 12c2-2.5 5.5-4 8-4M12 12c-2 2.5-2 7.5 0 10M12 12c2 2.5 2 7.5 0 10M4 8c0-2 2-3 4-3M20 8c0-2-2-3-4-3M4 16c0 2 2 3 4 3M20 16c0 2-2 3-4 3" />
            </svg>
          </span>
          <span className="relative min-w-0 flex-1">
            <span className="block text-sm font-semibold text-white">基因实验室</span>
            <span className="block text-[11px] text-white/85 mt-0.5 truncate">培育新的数字灵魂</span>
          </span>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="relative shrink-0 opacity-90">
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>

        {/* 角色列表（按字母分组；搜索时扁平显示） */}
        <div>
          {filtered.length === 0 ? (
            <div className="py-10 text-center text-gray-500">
              <p className="text-sm">{search ? '未找到匹配的角色' : '还没有角色，去基因实验室孵化一个数字灵魂吧'}</p>
              {!search && (
                <button
                  onClick={() => setShowLab(true)}
                  className="mt-3 px-4 py-2 rounded-full text-sm bg-gene-purple text-white shadow-[0_2px_12px_rgba(108,92,231,0.35)]"
                >
                  打开基因实验室
                </button>
              )}
            </div>
          ) : search.trim() ? (
            /* 搜索模式：扁平列表 */
            <div ref={listRef}>
              {filtered.map((c) => (
                <CharacterRow key={c.id} c={c} selected={c.id === selectedCharacterId} unread={unreadByCharacter[c.id] ?? 0} onSelect={handleItemClick} onLongPress={(x, y) => startLongPress(c, x, y)} />
              ))}
            </div>
          ) : (
            <div ref={listRef}>
              {groups.map(([letter, list]) => (
                <div key={letter}>
                  <div
                    data-letter={letter}
                    className="sticky top-0 z-10 px-4 py-1 text-[11px] font-medium text-gray-400 bg-app/90 backdrop-blur-sm"
                  >
                    {letter === '#' ? '#' : letter}
                  </div>
                  {list.map((c) => (
                    <CharacterRow key={c.id} c={c} selected={c.id === selectedCharacterId} unread={unreadByCharacter[c.id] ?? 0} onSelect={handleItemClick} onLongPress={(x, y) => startLongPress(c, x, y)} />
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 右侧字母索引条（微信通讯录式；搜索时隐藏；略下移避开顶部搜索+基因实验室横条） */}
        {!search && filtered.length > 0 && (
          <div className="absolute right-0 top-[58%] -translate-y-1/2 z-20 flex flex-col items-center gap-[1px] px-0.5 py-1 select-none">
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

      {/* 长按编辑菜单（自定义角色） */}
      {editChar && isOwn(editChar) && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setEditChar(null)} />
          <div className="fixed z-50 inset-x-0 bottom-0 rounded-t-2xl bg-panel border-t border-line p-4 pb-[max(env(safe-area-inset-bottom),16px)] animate-fade-in">
            <p className="text-sm font-medium text-ink text-center mb-3">{editChar.name}</p>
            <div className="space-y-2">
              <button
                onClick={() => { setShowLab(true); setEditChar(null); }}
                className="w-full py-3 rounded-xl bg-surface border border-line text-sm text-ink transition-colors"
              >
                编辑基因
              </button>
              <button
                onClick={() => { setDeleteTarget(editChar); setEditChar(null); }}
                className="w-full py-3 rounded-xl bg-red-500/10 text-red-400 text-sm transition-colors"
              >
                删除角色
              </button>  <button
                onClick={() => setEditChar(null)}
                className="w-full py-3 rounded-xl bg-surface border border-line text-sm text-gray-500 transition-colors"
              >
                取消
              </button>
            </div>
          </div>
        </>
      )}

      {/* 删除确认 */}
      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} width="max-w-sm" closeOnBackdrop={false}>
        <div className="p-6">
          <p className="text-sm text-sub mb-2">删除角色「{deleteTarget?.name}」？</p>
          <p className="text-xs text-gray-500 mb-6">将连同与该角色的全部对话、记忆和关系记录一并清除，此操作不可恢复。</p>
          <div className="flex gap-3 justify-end">
            <button onClick={() => setDeleteTarget(null)} className="px-4 py-2 rounded-lg text-sm text-gray-400 hover:bg-surface transition-colors">取消</button>
            <button
              onClick={() => {
                if (deleteTarget) void deleteCharacter(deleteTarget.id);
                setDeleteTarget(null);
              }}
              className="px-4 py-2 rounded-lg text-sm bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
            >
              确认删除
            </button>
          </div>
        </div>
      </Modal>

      {/* 角色资料卡（点角色打开，微信/QQ 式） */}
      {profileChar && (
        <CharacterProfileModal
          character={profileChar}
          userId={userId}
          onClose={() => setProfileChar(null)}
          onChat={async (c) => {
            setProfileChar(null);
            await selectCharacter(c.id);
            onSelect();
          }}
          onAdd={async (c) => {
            setProfileChar(null);
            // 添加预设/共享角色后直接开始聊天
            await selectCharacter(c.id);
            onSelect();
          }}
        />
      )}

      <CharacterAddModal
        key={editChar?.id ?? 'new'}
        open={showLab}
        onClose={() => { setShowLab(false); setEditChar(null); }}
        editCharacter={editChar}
        onSelected={() => {
          const wasEditing = !!editChar;
          setShowLab(false);
          setEditChar(null);
          // 编辑模式保存后留在角色页；新建/添加角色后切回聊天
          if (!wasEditing) onSelect();
        }}
      />
    </div>
  );
}

/** 角色行（头像 / 名字 / 标签 / 签名 / 未读 / 选中态） */
function CharacterRow({ c, selected, unread, onSelect, onLongPress }: {
  c: Character;
  selected: boolean;
  unread: number;
  onSelect: (c: Character) => void;
  onLongPress: (x: number, y: number) => void;
}) {
  const pressRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  return (
    <button
      onClick={() => onSelect(c)}
      onTouchStart={(e) => {
        const t = e.touches[0];
        if (pressRef.current) clearTimeout(pressRef.current);
        pressRef.current = setTimeout(() => onLongPress(t?.clientX ?? 0, t?.clientY ?? 0), 600);
      }}
      onTouchEnd={() => { if (pressRef.current) clearTimeout(pressRef.current); }}
      onTouchMove={() => { if (pressRef.current) clearTimeout(pressRef.current); }}
      onContextMenu={(e) => { e.preventDefault(); onLongPress(e.clientX, e.clientY); }}
      className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors active:bg-surface ${selected ? 'bg-gene-purple/8' : ''}`}
    >
      {c.avatar.startsWith('data:') ? (
        <img src={c.avatar} alt={c.name} className="w-10 h-10 rounded-full object-cover shrink-0" />
      ) : (
        <span className="w-10 h-10 rounded-full bg-surface flex items-center justify-center text-xl shrink-0">
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
      {selected && unread === 0 && (
        <span className="shrink-0 text-xs text-gene-purple">✓</span>
      )}
    </button>
  );
}
