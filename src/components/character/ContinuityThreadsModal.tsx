import { useCallback, useEffect, useState } from 'react';
import type { Character, ContinuityThread } from '../../db/index';
import { continuityRepo, CONTINUITY_KINDS, KIND_LABEL, MAX_OPEN_THREADS, STATUS_LABEL, type ContinuityKind } from '../../db/continuity-repo';
import { Modal } from '../ui/Modal';

/**
 * 未完成事件：用户和角色之间「说好了但还没做完」的事。
 * 全部由用户掌控：可以自己加、改、标记完成、收起或彻底删除。
 */
export function ContinuityThreadsModal({
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
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(startAdding);
  const [showHistory, setShowHistory] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftKind, setDraftKind] = useState<ContinuityKind>('plan');
  const [draftDetail, setDraftDetail] = useState('');
  const [draftDue, setDraftDue] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setThreads(await continuityRepo.getByCharacter(character.id, userId));
    } finally {
      setLoading(false);
    }
  }, [character.id, userId]);

  useEffect(() => {
    if (!open) return;
    setAdding(startAdding);
    setEditingId(null);
    setConfirmId(null);
    setError(null);
    void reload();
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
    const title = draftTitle.trim();
    if (!title) {
      setError('写一句具体的事，比如"周末一起看那部电影"。');
      return;
    }
    const dueAt = draftDue ? new Date(`${draftDue}T12:00:00`).getTime() : undefined;
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
    resetDraft();
    await reload();
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
    <Modal open={open} onClose={onClose} title={`${character.name} 还没做完的事`} width="max-w-md">
      <div className="p-5">
        <p className="text-[11px] leading-relaxed text-gray-500">
          这些是你们之间真实出现过、但还没结束的事。角色会因此记得"我们还有件事没做完"，也能在合适的时候自然接上。
          最多同时挂着 {MAX_OPEN_THREADS} 件，超出的会自动收起。
        </p>

        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={() => { setAdding((v) => !v); setEditingId(null); setError(null); }}
            className="rounded-full border border-life-cyan/35 bg-life-cyan/10 px-3 py-1.5 text-[11px] text-life-cyan active:scale-[.97]"
          >
            {adding ? '取消添加' : '＋ 添加一件'}
          </button>
          {closedThreads.length > 0 && (
            <button
              onClick={() => setShowHistory((v) => !v)}
              className="rounded-full border border-line px-3 py-1.5 text-[11px] text-gray-500 active:scale-[.97]"
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
                  className={`rounded-full px-2.5 py-1 text-[11px] transition-colors ${
                    draftKind === kind.key ? 'bg-gene-purple/20 text-gene-purple border border-gene-purple/35' : 'border border-line text-gray-500'
                  }`}
                >
                  {kind.label}
                </button>
              ))}
            </div>
            <input
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value.slice(0, 60))}
              placeholder="还没做完的是什么？"
              className="mt-2.5 w-full rounded-xl border border-line bg-panel px-3 py-2 text-[13px] text-ink outline-none focus:border-life-cyan/50"
            />
            <textarea
              value={draftDetail}
              onChange={(e) => setDraftDetail(e.target.value.slice(0, 200))}
              placeholder="补充细节（可留空）"
              rows={2}
              className="mt-2 w-full resize-none rounded-xl border border-line bg-panel px-3 py-2 text-[12px] text-ink outline-none focus:border-life-cyan/50"
            />
            <label className="mt-2 flex items-center gap-2 text-[11px] text-gray-500">
              约定时间（可留空）
              <input
                type="date"
                value={draftDue}
                onChange={(e) => setDraftDue(e.target.value)}
                className="rounded-lg border border-line bg-panel px-2 py-1 text-[11px] text-ink outline-none"
              />
            </label>
            {error && <p className="mt-2 text-[11px] text-rose-400">{error}</p>}
            <div className="mt-3 flex justify-end gap-2">
              <button onClick={resetDraft} className="rounded-lg px-3 py-1.5 text-[12px] text-gray-500">取消</button>
              <button onClick={() => void submit()} className="rounded-lg bg-gene-purple px-3.5 py-1.5 text-[12px] text-white active:scale-[.97]">
                {editingId ? '保存修改' : '记下来'}
              </button>
            </div>
          </div>
        )}

        {loading && <p className="py-8 text-center text-xs text-gray-500">正在读取…</p>}

        {!loading && openThreads.length === 0 && !adding && (
          <div className="py-10 text-center text-xs text-gray-500">
            还没有未完成的事。<br />聊到"下次一起……""改天再说"时，它们会自己出现在这里。
          </div>
        )}

        {openThreads.length > 0 && (
          <ul className="mt-3 space-y-2">
            {openThreads.map((thread) => (
              <li key={thread.id} className="rounded-2xl border border-life-cyan/20 bg-life-cyan/[0.05] px-3 py-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium text-ink">{thread.title}</p>
                    <p className="mt-0.5 text-[10px] text-life-cyan">
                      {KIND_LABEL[thread.kind]}
                      {thread.dueAt ? ` · ${new Date(thread.dueAt).getMonth() + 1} 月 ${new Date(thread.dueAt).getDate()} 日` : ''}
                      {thread.origin === 'user' ? ' · 你添加的' : ' · 来自你们的对话'}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button onClick={() => void continuityRepo.complete(thread.id).then(reload)} className="rounded-lg bg-life-cyan/15 px-2 py-1 text-[10px] text-life-cyan">完成</button>
                    <button onClick={() => setConfirmId(confirmId === thread.id ? null : thread.id)} className="rounded-lg px-2 py-1 text-[10px] text-gray-500">…</button>
                  </div>
                </div>
                {thread.detail && <p className="mt-1.5 text-[11px] leading-relaxed text-gray-500">{thread.detail}</p>}
                {confirmId === thread.id && (
                  <div className="mt-2 flex flex-wrap justify-end gap-1.5 border-t border-line pt-2">
                    <button onClick={() => startEdit(thread)} className="rounded-lg px-2 py-1 text-[10px] text-gray-500">编辑</button>
                    <button onClick={() => void continuityRepo.drop(thread.id).then(reload)} className="rounded-lg px-2 py-1 text-[10px] text-gray-500">稍后再说</button>
                    <button
                      onClick={() => void continuityRepo.remove(thread.id).then(() => { setConfirmId(null); return reload(); })}
                      className="rounded-lg bg-red-500/15 px-2 py-1 text-[10px] text-red-400"
                    >
                      删除
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {showHistory && closedThreads.length > 0 && (
          <div className="mt-5">
            <h3 className="text-[11px] tracking-[0.14em] uppercase text-gray-500">已收起 / 已完成</h3>
            <ul className="mt-2 space-y-1.5">
              {closedThreads.map((thread) => (
                <li key={thread.id} className="flex items-center justify-between gap-2 rounded-xl border border-line bg-surface/60 px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-[12px] text-gray-500 line-through decoration-gray-600">{thread.title}</p>
                    <p className="text-[10px] text-gray-600">
                      {STATUS_LABEL[thread.status]} · {KIND_LABEL[thread.kind]}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    <button onClick={() => void continuityRepo.reopen(thread.id).then(reload)} className="rounded-lg px-2 py-1 text-[10px] text-life-cyan">重新挂起</button>
                    <button onClick={() => void continuityRepo.remove(thread.id).then(reload)} className="rounded-lg px-2 py-1 text-[10px] text-red-400">删除</button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  );
}
