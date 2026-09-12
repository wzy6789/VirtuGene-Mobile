import { useEffect, useMemo, useState } from 'react';
import { db, type Diary } from '../../db/index';
import { useAuthStore } from '../../store/auth-store';
import { useChatStore } from '../../store/chat-store';
import { setDiarySharing, describeSharing } from '../../lib/world/diary-visibility';
import { Modal } from '../ui/Modal';
import { formatDateFull } from '../../lib/diary-utils';

/**
 * 日记的「谁能看到这一页」（5.0 Phase 2b-4）
 *
 * 三个选项，语义严格区分（这是隐私边界，不是文案修辞）：
 * - 仅自己：不写世界事件、不给任何角色认知（**默认**）
 * - 告诉某角色：只给那个角色"知道 + 可以提起"的权限，**不写世界事件**（不在世界年表留痕）
 * - 加入共同世界：写一条 `reality` 世界事件，并按参与者建立认知
 *
 * 撤回立即生效：改为「仅自己」会真的删掉认知行，下一次发送就不会再注入。
 */
export function DiarySharingControl({
  diary,
  onChange,
  compact = false,
}: {
  diary: Diary;
  onChange?: (next: Diary) => void;
  compact?: boolean;
}) {
  const userId = useAuthStore((s) => s.userId) ?? '';
  const characters = useChatStore((s) => s.characters);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mine = useMemo(() => characters.filter((c) => c.createdBy === userId), [characters, userId]);
  const nameOf = (id: string) => characters.find((c) => c.id === id)?.name ?? 'TA';
  const label = describeSharing(diary, nameOf);

  const apply = async (visibility: Diary['visibility'], visibleTo: string[] = []) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await setDiarySharing({ userId, diaryId: diary.id, visibility: visibility ?? 'private', visibleTo });
      const fresh = await db.diaries.get(diary.id);
      setOpen(false);
      if (fresh) onChange?.(fresh);
    } catch {
      setError('没能保存这次的授权，请再试一次');
    } finally {
      setBusy(false);
    }
  };

  const isWorld = diary.visibility === 'world';
  const isSelected = diary.visibility === 'selected' && (diary.visibleTo ?? []).length > 0;

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={label}
        className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs transition-colors ${
          isWorld
            ? 'border-gene-purple/40 bg-gene-purple/10 text-gene-purple'
            : isSelected
              ? 'border-life-cyan/40 bg-life-cyan/10 text-life-cyan'
              : 'border-line bg-surface text-gray-500 hover:text-ink'
        }`}
      >
        <span>{isWorld ? '🌍' : isSelected ? '🤝' : '🔒'}</span>
        {!compact && <span className="max-w-[132px] truncate">{label}</span>}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-50 mt-1 w-[268px] py-1.5 glass-card rounded-xl shadow-xl animate-fade-in">
            <p className="px-4 pt-1.5 pb-1 text-[10px] tracking-[0.14em] text-gray-500 uppercase">谁能看到这一页</p>
            <button
              type="button"
              onClick={() => void apply('private')}
              className="w-full flex items-start gap-2 px-4 py-2 text-left hover:bg-surface transition-colors"
            >
              <span className="shrink-0">🔒</span>
              <span className="min-w-0">
                <span className="block text-sm text-sub">仅自己可见</span>
                <span className="block text-[10px] leading-4 text-gray-500">默认。任何角色都不会知道，也不会提起</span>
              </span>
            </button>
            <div className="my-1 mx-3 h-px bg-line" />
            <p className="px-4 py-1 text-[10px] text-gray-500">告诉某一个角色（只给 TA 知道，不进世界年表）</p>
            {mine.length === 0 && <p className="px-4 py-2 text-[11px] text-gray-500">还没有可以告诉的角色</p>}
            {mine.map((c) => {
              const active = isSelected && (diary.visibleTo ?? []).includes(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  disabled={busy}
                  onClick={() => void apply('selected', [c.id])}
                  className="w-full flex items-center gap-2 px-4 py-2 text-left text-sm text-sub hover:bg-surface transition-colors disabled:opacity-50"
                >
                  <span className="shrink-0">{c.avatar.startsWith('data:') ? '🙂' : c.avatar}</span>
                  <span className="min-w-0 flex-1 truncate">{c.name}</span>
                  {active && <span className="shrink-0 text-[10px] text-life-cyan">已授权</span>}
                </button>
              );
            })}
            <div className="my-1 mx-3 h-px bg-line" />
            <button
              type="button"
              onClick={() => void apply('world')}
              className="w-full flex items-start gap-2 px-4 py-2 text-left hover:bg-surface transition-colors"
            >
              <span className="shrink-0">🌍</span>
              <span className="min-w-0">
                <span className="block text-sm text-sub">加入共同世界</span>
                <span className="block text-[10px] leading-4 text-gray-500">写进世界年表（你的生活），并让关联角色知道</span>
              </span>
            </button>
            {error && <p className="px-4 py-1.5 text-[11px] text-rose-400">{error}</p>}
          </div>
        </>
      )}
    </div>
  );
}

/** 列表/阅读视图上的小徽章：一眼看出"这一页谁能看到"（仅自己时不显示，避免噪音） */
export function DiarySharingBadge({ diary }: { diary: Diary }) {
  const characters = useChatStore((s) => s.characters);
  if (!diary.visibility || diary.visibility === 'private') return null;
  const nameOf = (id: string) => characters.find((c) => c.id === id)?.name ?? 'TA';
  const world = diary.visibility === 'world';
  return (
    <span
      title={describeSharing(diary, nameOf)}
      className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] ${
        world ? 'bg-gene-purple/12 text-gene-purple' : 'bg-life-cyan/12 text-life-cyan'
      }`}
    >
      {world ? '🌍 共同世界' : `🤝 ${(diary.visibleTo ?? []).map(nameOf).join('、') || '已授权'}`}
    </span>
  );
}

/**
 * 「谁能看到我的日记」总览：取代 4.x 的全局开关。
 * 列出所有**非私密**的日记，并可在同一处收回授权（改回仅自己）。
 */
export function DiarySharingOverviewModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const userId = useAuthStore((s) => s.userId) ?? '';
  const characters = useChatStore((s) => s.characters);
  const [shared, setShared] = useState<Diary[]>([]);
  const [loading, setLoading] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!open || !userId) return;
    let alive = true;
    setLoading(true);
    void (async () => {
      const all = await db.diaries.where('userId').equals(userId).toArray();
      if (!alive) return;
      setShared(
        all
          .filter((d) => !d.deletedAt && d.visibility && d.visibility !== 'private')
          .sort((a, b) => b.date.localeCompare(a.date)),
      );
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [open, userId, version]);

  const nameOf = (id: string) => characters.find((c) => c.id === id)?.name ?? 'TA';

  return (
    <Modal open={open} onClose={onClose} title="谁能看到我的日记" width="max-w-md">
      <div className="space-y-3 p-5">
        <p className="text-[11px] leading-relaxed text-gray-500">
          日记**默认只有你自己知道**。只有你在这里逐条授权过的内容，才可能被对应角色知道或提起；
          收回授权后立刻失效。
        </p>
        {loading && <p className="py-6 text-center text-xs text-gray-500">正在读取…</p>}
        {!loading && shared.length === 0 && (
          <p className="py-6 text-center text-xs text-gray-500">
            还没有授权给任何角色的日记——它们全都只属于你。
          </p>
        )}
        {!loading && shared.length > 0 && (
          <ul className="space-y-2">
            {shared.map((d) => (
              <li key={d.id} className="rounded-xl border border-line bg-surface/60 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="min-w-0 truncate text-[12px] font-medium text-ink">{d.title || '无标题'}</p>
                  <span className="shrink-0 text-[10px] text-gray-500">{formatDateFull(d.date)}</span>
                </div>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <span className="text-[10px] text-gray-500">{describeSharing(d, nameOf)}</span>
                  <button
                    type="button"
                    onClick={() => {
                      void setDiarySharing({ userId, diaryId: d.id, visibility: 'private' }).then(() => setVersion((v) => v + 1));
                    }}
                    className="shrink-0 text-[10px] text-life-cyan"
                  >
                    收回
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
