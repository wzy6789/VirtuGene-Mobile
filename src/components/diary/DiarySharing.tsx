import { useEffect, useMemo, useRef, useState } from 'react';
import { db, type Diary } from '../../db/index';
import { useAuthStore } from '../../store/auth-store';
import { useChatStore } from '../../store/chat-store';
import { setDiarySharing, describeSharing } from '../../lib/world/diary-visibility';
import { Modal } from '../ui/Modal';
import { formatDateFull } from '../../lib/diary-utils';
import { Icon } from '../ui/Icon';
import { Avatar } from '../ui/Avatar';
import { FeedbackNotice } from '../ui/FeedbackNotice';

function visibleCharacters(diary: Diary): string[] {
  return diary.visibility === 'world' ? (diary.characterId ? [diary.characterId] : [])
    : diary.visibility === 'selected' ? diary.visibleTo ?? [] : [];
}

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

  const mine = useMemo(() => characters.filter((c) => c.createdBy === userId && c.agentProfile !== 'secretary'), [characters, userId]);
  const nameOf = (id: string) => characters.find((c) => c.id === id && c.createdBy === userId)?.name ?? '已移除角色';
  const label = describeSharing(diary, nameOf);
  const currentNames = visibleCharacters(diary).map(nameOf).join('、');
  const worldName = diary.characterId ? nameOf(diary.characterId) : '';

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
        aria-label={`日记可见范围：${label}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs transition-colors ${
          isWorld
            ? 'border-life-cyan/40 bg-life-cyan/10 text-life-cyan'
            : isSelected
              ? 'border-life-cyan/40 bg-life-cyan/10 text-life-cyan'
              : 'border-line bg-surface text-sub hover:text-ink'
        }`}
      >
        <Icon name={isWorld ? 'globe' : isSelected ? 'profile' : 'lock'} size={16} />
        {!compact && <span className="max-w-[132px] truncate">{label}</span>}
      </button>

      {open && (
        <Modal open presentation="dialog" title="谁能看到这一页" width="max-w-sm" onClose={()=>{if(!busy)setOpen(false);}} canSnapshotOnExit={()=>false} panelClassName="vg-diary vg-diary-sharing">
          <div className="py-2" aria-busy={busy}>
            <p className="vg-diary-sharing-current">当前可见：{currentNames || '仅自己'}{isWorld && ' · 已加入世界年表'}</p>
            {(isWorld || isSelected) && <p className="vg-diary-sharing-impact">变更后只向新对象提供此日记；已发生的对话仍保留。</p>}
            <button
              type="button"
              disabled={busy}
              aria-pressed={!isWorld && !isSelected}
              onClick={() => void apply('private')}
              className="w-full flex items-start gap-2 px-4 py-2 text-left hover:bg-surface transition-colors"
            >
              <Icon name="lock" size={18} className="shrink-0" />
              <span className="min-w-0">
                <span className="block text-sm text-sub">仅自己可见</span>
                <span className="block text-xs leading-relaxed text-sub">{isWorld ? '收回后不再向角色提供此日记，并移出世界年表。' : isSelected ? '收回后不再向角色提供此日记。' : '当前不向角色提供此日记。'}</span>
              </span>
            </button>
            <div className="my-1 mx-3 h-px bg-line" />
            <p className="px-4 py-1 text-xs text-sub">仅告诉所选角色，不加入世界年表</p>
            {mine.length === 0 && <p className="px-4 py-2 text-xs text-sub">还没有可以告诉的角色</p>}
            {mine.map((c) => {
              const active = isSelected && (diary.visibleTo ?? []).includes(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  disabled={busy}
                  aria-pressed={active}
                  onClick={() => void apply('selected', [c.id])}
                  className="w-full flex items-center gap-2 px-4 py-2 text-left text-sm text-sub hover:bg-surface transition-colors disabled:opacity-50"
                >
                  <Avatar avatar={c.avatar} size="sm" fallback={c.name.slice(0, 1) || 'TA'} />
                  <span className="min-w-0 flex-1 break-words">{c.name}</span>
                  {active && <span className="shrink-0 text-xs text-life-cyan">已授权</span>}
                </button>
              );
            })}
            <div className="my-1 mx-3 h-px bg-line" />
            <button
              type="button"
              disabled={busy}
              aria-pressed={isWorld}
              onClick={() => void apply('world')}
              className="w-full flex items-start gap-2 px-4 py-2 text-left hover:bg-surface transition-colors"
            >
              <Icon name="globe" size={18} className="shrink-0" />
              <span className="min-w-0">
                <span className="block text-sm text-sub">加入共同世界</span>
                <span className="block text-xs leading-relaxed text-sub">{worldName ? `写入世界年表，并向 ${worldName} 提供此日记。` : '写入世界年表；没有关联角色，不向角色提供此日记。'}</span>
              </span>
            </button>
            {error && <div className="px-4 py-2"><FeedbackNotice tone="error" message={error} /></div>}
          </div>
        </Modal>
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
      className="inline-flex items-center gap-1 shrink-0 rounded-full px-1.5 py-0.5 text-xs bg-life-cyan/12 text-life-cyan"
    >
      <Icon name={world ? 'globe' : 'profile'} size={14} />
      {world ? '共同世界' : (diary.visibleTo ?? []).map(nameOf).join('、') || '已授权'}
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
  const [busyId, setBusyId] = useState<string | null>(null);
  const busy = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !userId) return;
    let alive = true;
    setLoading(true);
    setError(null);
    setNotice(null);
    void (async () => {
      const all = await db.diaries.where('userId').equals(userId).toArray();
      if (!alive) return;
      setShared(
        all
          .filter((d) => !d.deletedAt && d.visibility && d.visibility !== 'private')
          .sort((a, b) => b.date.localeCompare(a.date)),
      );
      setLoading(false);
    })().catch(() => { if (alive) { setLoading(false); setError('暂时无法读取授权，请重新打开。'); } });
    return () => { alive = false; };
  }, [open, userId]);

  const nameOf = (id: string) => characters.find((c) => c.id === id && c.createdBy === userId)?.name ?? '已移除角色';
  const revoke = async (diary: Diary) => {
    if (busy.current) return;
    busy.current = true;
    setBusyId(diary.id); setError(null); setNotice(null);
    const names = visibleCharacters(diary).map(nameOf).join('、');
    try {
      await setDiarySharing({ userId, diaryId: diary.id, visibility: 'private' });
      setShared(rows => rows.filter(row => row.id !== diary.id));
      setNotice(names ? `已停止向 ${names} 提供此日记，历史对话仍保留。` : '已将日记移出世界年表。');
    } catch { setError('未能收回授权，当前可见范围未改变，请重试。'); }
    finally { busy.current = false; setBusyId(null); }
  };

  return (
    <Modal panelClassName="vg-settings-panel vg-diary" open={open} onClose={()=>{if(!busy.current)onClose();}} title="谁能看到我的日记" width="max-w-md" canSnapshotOnExit={()=>false}>
      <div className="vg-settings-design space-y-3">
        <p className="text-xs leading-relaxed text-sub">
          收回后不再向角色提供该日记，并移出世界年表；已发生的对话仍保留。
        </p>
        {error && <FeedbackNotice tone="error" message={error} />}
        {notice && <FeedbackNotice tone="success" message={notice} />}
        {loading && <p className="py-6 text-center text-xs text-sub">正在读取…</p>}
        {!loading && shared.length === 0 && (
          <p className="py-6 text-center text-xs text-sub">
            暂无已授权的日记。
          </p>
        )}
        {!loading && shared.length > 0 && (
          <ul className="space-y-2">
            {shared.map((d) => (
              <li key={d.id} className="rounded-xl border border-line bg-surface/60 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="min-w-0 break-words text-sm font-medium text-ink">{d.title || '无标题'}</p>
                  <span className="shrink-0 text-xs text-sub">{formatDateFull(d.date)}</span>
                </div>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <span className="min-w-0 text-xs text-sub break-words">当前可见：{visibleCharacters(d).map(nameOf).join('、') || '仅自己'}{d.visibility === 'world' && ' · 世界年表'}</span>
                  <button
                    type="button"
                    disabled={busyId !== null}
                    onClick={() => void revoke(d)}
                    aria-label={`收回《${d.title || '无标题'}》对${visibleCharacters(d).map(nameOf).join('、') || '世界年表'}的授权`}
                    className="vg-button vg-button-ghost shrink-0"
                  >
                    {busyId === d.id ? '收回中…' : '收回'}
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
