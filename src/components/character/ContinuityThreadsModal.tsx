import { useFeedback } from '../../lib/feedback';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Character, ContinuityThread } from '../../db/index';
import { continuityRepo, CONTINUITY_KINDS, KIND_LABEL, MAX_OPEN_THREADS, STATUS_LABEL, type ContinuityKind } from '../../db/continuity-repo';
import { Modal } from '../ui/Modal';
import { FeedbackNotice } from '../ui/FeedbackNotice';
import { LoadingSkeleton } from '../ui/LoadingSkeleton';
import { SettingsField } from '../settings/SettingsUI';

/**
 * 未完成事件：用户和角色之间「说好了但还没做完」的事。
 * 全部由用户掌控：可以自己加、改、标记完成、收起或彻底删除。
 */
export function ContinuityThreadsModal(props: Parameters<typeof ContinuityThreadsContent>[0]) {
  return props.open ? <ContinuityThreadsContent key={`${props.userId}:${props.character.id}`} {...props} /> : null;
}

function ContinuityThreadsContent({
  open,
  onClose,
  character,
  userId,
  /** 打开时是否直接展开"添加"表单 */
  startAdding = false,
}: {
  open: boolean;
  onClose: () => void;
  character: Character;
  userId: string;
  startAdding?: boolean;
}) {
  const [threads, setThreads] = useState<ContinuityThread[]>([]);
  const feedback = useFeedback();
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(startAdding);
  const [showHistory, setShowHistory] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftKind, setDraftKind] = useState<ContinuityKind>('plan');
  const [draftDetail, setDraftDetail] = useState('');
  const [draftDue, setDraftDue] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ContinuityThread | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [readError, setReadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const mutationLock = useRef(false);
  const readGeneration = useRef(0);
  const scope = useRef({ open, userId, characterId: character.id });
  scope.current = { open, userId, characterId: character.id };
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; readGeneration.current++; }; }, []);
  const current = () => mounted.current && scope.current.open && scope.current.userId === userId && scope.current.characterId === character.id;

  const reload = useCallback(async () => {
    const ticket = ++readGeneration.current;
    setLoading(true);
    setReadError(false);
    try {
      const rows = await continuityRepo.getByCharacter(character.id, userId);
      if (mounted.current && ticket === readGeneration.current && scope.current.open && scope.current.userId === userId && scope.current.characterId === character.id) setThreads(rows);
      return true;
    } catch {
      if (mounted.current && ticket === readGeneration.current) setReadError(true);
      return false;
    } finally {
      if (mounted.current && ticket === readGeneration.current) setLoading(false);
    }
  }, [character.id, userId]);

  useEffect(() => {
    if (!open) return;
    setAdding(startAdding);
    setEditingId(null);
    setConfirmId(null);
    setError(null);
    setThreads([]);
    setDraftTitle(''); setDraftKind('plan'); setDraftDetail(''); setDraftDue('');
    setShowHistory(false);
    void reload();
    return () => { readGeneration.current++; };
  }, [open, startAdding, reload]);

  const openThreads = threads.filter((t) => t.status === 'open').sort((a, b) => (a.dueAt ?? a.createdAt) - (b.dueAt ?? b.createdAt));
  const closedThreads = threads.filter((t) => t.status !== 'open').sort((a, b) => b.updatedAt - a.updatedAt);

  const resetDraft = () => {
    setDraftTitle('');
    setDraftKind('plan');
    setDraftDetail('');
    setDraftDue('');
    setEditingId(null);
    setAdding(false);
    setError(null);
  };

  const submit = async () => {
    if (mutationLock.current || loading || readError || !current()) return;
    const title = draftTitle.trim();
    if (!title) {
      setError('写一句具体的事，比如"周末一起看那部电影"。');
      return;
    }
    const dueAt = draftDue ? new Date(`${draftDue}T12:00:00`).getTime() : undefined;
    if (dueAt !== undefined && !Number.isFinite(dueAt)) { setError('请选择有效的约定日期。'); return; }
    mutationLock.current = true; setBusy(true); setError(null);
    try {
    if (editingId) {
      await continuityRepo.update(editingId, {
        title,
        kind: draftKind,
        detail: draftDetail.trim(),
        dueAt,
      });
    } else {
      await continuityRepo.create({
        characterId: character.id,
        userId,
        kind: draftKind,
        title,
        detail: draftDetail.trim() || undefined,
        dueAt,
        origin: 'user',
      });
    }
    if (!current()) return;
    resetDraft();
    await reload();
    } catch {
      if (current()) setError('这件事还没有保存，请重试。你的输入已保留。');
    } finally {
      mutationLock.current = false;
      if (current()) setBusy(false);
    }
  };

  const changeStatus = async (action: () => Promise<unknown>, success?: string) => {
    if (mutationLock.current || !current()) return;
    mutationLock.current = true; setBusy(true); setError(null);
    try {
      await action();
      if (!current()) return;
      setConfirmId(null);
      setDeleteTarget(null);
      if (success) feedback(success, { tone: 'success' });
      await reload();
    } catch {
      if (current()) setError('操作未完成，请再试一次。');
    } finally {
      mutationLock.current = false;
      if (current()) setBusy(false);
    }
  };

  const startEdit = (thread: ContinuityThread) => {
    setEditingId(thread.id);
    setAdding(true);
    setDraftTitle(thread.title);
    setDraftKind(thread.kind);
    setDraftDetail(thread.detail ?? '');
    setDraftDue(thread.dueAt ? new Date(thread.dueAt).toISOString().slice(0, 10) : '');
  };

  return (
    <Modal open={open} onClose={() => { if (!mutationLock.current) onClose(); }} canSnapshotOnExit={() => false} title={`${character.name} 还没做完的事`} width="max-w-md" panelClassName="vg-settings-panel">
      <div className="vg-settings-design p-5">
        {readError && <FeedbackNotice tone="error" message="这些约定暂时没有读到，请重试。"><button type="button" className="min-h-11 min-w-11 vg-button vg-button-secondary" onClick={() => void reload()}>重新读取</button></FeedbackNotice>}
        {error && <FeedbackNotice tone="error" message={error} />}
        <fieldset disabled={busy || loading || readError} className="min-w-0 border-0 p-0">
        <p className="text-xs leading-relaxed text-sub">
          这些是你们之间真实出现过、但还没结束的事。角色会因此记得"我们还有件事没做完"，也能在合适的时候自然接上。
          最多同时挂着 {MAX_OPEN_THREADS} 件，超出的会自动收起。
        </p>

        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={() => { setAdding((v) => !v); setEditingId(null); setError(null); }}
            className="rounded-full border border-life-cyan/35 bg-life-cyan/10 px-3 py-1.5 text-xs text-[color:var(--vg-accent)] active:scale-[.97]"
          >
            {adding ? '取消添加' : '＋ 添加一件'}
          </button>
          {closedThreads.length > 0 && (
            <button
              onClick={() => setShowHistory((v) => !v)}
              className="rounded-full border border-line px-3 py-1.5 text-xs text-sub active:scale-[.97]"
            >
              {showHistory ? '隐藏归档' : `归档 ${closedThreads.length}`}
            </button>
          )}
        </div>

        {adding && (
          <div className="mt-3 rounded-2xl border border-line bg-surface/70 p-3">
            <div className="flex flex-wrap gap-1.5">
              {CONTINUITY_KINDS.map((kind) => (
                <button
                  key={kind.key}
                  onClick={() => setDraftKind(kind.key)}
                  className={`rounded-full px-2.5 py-1 text-xs transition-colors ${
                    draftKind === kind.key ? 'bg-gene-purple/20 text-gene-purple border border-gene-purple/35' : 'border border-line text-sub'
                  }`}
                >
                  {kind.label}
                </button>
              ))}
            </div>
            <SettingsField label="约定内容"
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value.slice(0, 60))}
              placeholder="还没做完的是什么？"
              className="mt-2.5 w-full rounded-xl border border-line bg-panel px-3 py-2 text-sm text-ink outline-none focus:border-life-cyan/50"
            />
            <textarea
              aria-label="补充细节"
              value={draftDetail}
              onChange={(e) => setDraftDetail(e.target.value.slice(0, 200))}
              placeholder="补充细节（可留空）"
              rows={2}
              className="mt-2 w-full resize-none rounded-xl border border-line bg-panel px-3 py-2 text-xs text-ink outline-none focus:border-life-cyan/50"
            />
            <label className="mt-2 flex items-center gap-2 text-xs text-sub">
              约定时间（可留空）
              <input
                type="date"
                value={draftDue}
                onChange={(e) => setDraftDue(e.target.value)}
                className="rounded-lg border border-line bg-panel px-2 py-1 text-xs text-ink outline-none"
              />
            </label>
            <div className="mt-3 flex justify-end gap-2">
              <button onClick={resetDraft} className="min-h-11 min-w-11 rounded-lg px-3 py-1.5 text-xs text-sub">取消</button>
              <button onClick={() => void submit()} className="rounded-lg bg-gene-purple px-3.5 py-1.5 text-xs text-white active:scale-[.97]">
                {busy ? '正在保存…' : editingId ? '保存修改' : '记下来'}
              </button>
            </div>
          </div>
        )}

        {loading && <LoadingSkeleton label="正在读取约定" rows={2} />}

        {!loading && !readError && openThreads.length === 0 && !adding && (
          <div className="py-10 text-center text-xs text-sub">
            还没有未完成的事。<br />聊到"下次一起……""改天再说"时，它们会自己出现在这里。
          </div>
        )}

        {openThreads.length > 0 && (
          <ul className="mt-3 space-y-2">
            {openThreads.map((thread) => (
              <li key={thread.id} className="rounded-2xl border border-life-cyan/20 bg-life-cyan/[0.05] px-3 py-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink">{thread.title}</p>
                    <p className="mt-0.5 text-xs text-[color:var(--vg-accent)]">
                      {KIND_LABEL[thread.kind]}
                      {thread.dueAt ? ` · ${new Date(thread.dueAt).getMonth() + 1} 月 ${new Date(thread.dueAt).getDate()} 日` : ''}
                      {thread.origin === 'user' ? ' · 你添加的' : ' · 来自你们的对话'}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button onClick={() => void changeStatus(() => continuityRepo.complete(thread.id))} className="rounded-lg bg-life-cyan/15 px-2 py-1 text-xs text-[color:var(--vg-accent)]">完成</button>
                    <button aria-label={`管理约定：${thread.title}`} onClick={() => setConfirmId(confirmId === thread.id ? null : thread.id)} className="rounded-lg px-2 py-1 text-xs text-sub">更多</button>
                  </div>
                </div>
                {thread.detail && <p className="mt-1.5 text-xs leading-relaxed text-sub">{thread.detail}</p>}
                {confirmId === thread.id && (
                  <Modal open presentation="dialog" title="约定操作" width="max-w-sm" onClose={() => { if (!mutationLock.current) setConfirmId(null); }} canSnapshotOnExit={() => false}>
                  <div className="space-y-3 p-5"><p className="text-sm leading-7 text-ink">{thread.title}</p>
                    <button disabled={busy} onClick={() => { setConfirmId(null); startEdit(thread); }} className="vg-button vg-button-secondary w-full">编辑</button>
                    <button disabled={busy} onClick={() => void changeStatus(() => continuityRepo.drop(thread.id))} className="vg-button vg-button-secondary w-full">稍后再说</button>
                    <button
                      disabled={busy} onClick={() => { setConfirmId(null); setDeleteTarget(thread); }}
                      className="vg-button vg-button-danger w-full"
                    >
                      删除
                    </button>
                  </div>
                  </Modal>
                )}
              </li>
            ))}
          </ul>
        )}

        {showHistory && closedThreads.length > 0 && (
          <div className="mt-5">
            <h3 className="text-xs tracking-[0.14em] uppercase text-sub">已收起 / 已完成</h3>
            <ul className="mt-2 space-y-1.5">
              {closedThreads.map((thread) => (
                <li key={thread.id} className="flex items-center justify-between gap-2 rounded-xl border border-line bg-surface/60 px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-xs text-sub line-through decoration-gray-600">{thread.title}</p>
                    <p className="text-xs text-sub">
                      {STATUS_LABEL[thread.status]} · {KIND_LABEL[thread.kind]}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    <button onClick={() => void changeStatus(() => continuityRepo.reopen(thread.id))} className="rounded-lg px-2 py-1 text-xs text-[color:var(--vg-accent)]">重新挂起</button>
                    <button onClick={() => setDeleteTarget(thread)} className="min-h-11 min-w-11 rounded-lg px-2 py-1 text-xs text-red-400">删除</button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
        </fieldset>
      </div>
      {deleteTarget && <Modal open presentation="dialog" title="删除这条约定？" width="max-w-sm" onClose={() => { if (!mutationLock.current) setDeleteTarget(null); }} canSnapshotOnExit={() => false}>
        <div className="space-y-4 p-5"><p className="text-sm leading-7 text-ink">{deleteTarget.title}</p><p className="text-sm leading-7 text-sub">删除后无法恢复，相关聊天不会删除。</p><div className="flex gap-3"><button type="button" disabled={busy} className="vg-button vg-button-secondary flex-1" onClick={() => setDeleteTarget(null)}>取消</button><button type="button" disabled={busy} className="vg-button vg-button-danger flex-1" onClick={() => void changeStatus(() => continuityRepo.remove(deleteTarget.id), '这条约定已删除')}>{busy ? '正在删除…' : '确认删除'}</button></div></div>
      </Modal>}
    </Modal>
  );
}
