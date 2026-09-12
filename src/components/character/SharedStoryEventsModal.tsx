import { useCallback, useEffect, useState } from 'react';
import type { Character, SharedStoryEvent } from '../../db/index';
import { sharedEventRepo, SHARED_EVENT_TYPES, type SharedEventType } from '../../db/shared-event-repo';
import { Modal } from '../ui/Modal';

/**
 * 两个人的共同故事：角色 ↔ 角色之间发生过的事。
 * 与群聊无关，也不改动用户设定的关系标签——只记录"他们之间发生过什么"。
 * 同一件事允许两边看法不一样，所以视角分开填写。
 */
export function SharedStoryEventsModal({
  open,
  onClose,
  a,
  b,
  userId,
}: {
  open: boolean;
  onClose: () => void;
  a: Character;
  b: Character;
  userId: string;
}) {
  const [events, setEvents] = useState<SharedStoryEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [draftType, setDraftType] = useState<SharedEventType>('相识');
  const [draftTitle, setDraftTitle] = useState('');
  const [draftDetail, setDraftDetail] = useState('');
  const [viewA, setViewA] = useState('');
  const [viewB, setViewB] = useState('');

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setEvents(await sharedEventRepo.getByPair(a.id, b.id, userId));
    } finally {
      setLoading(false);
    }
  }, [a.id, b.id, userId]);

  useEffect(() => {
    if (!open) return;
    setAdding(false);
    setEditingId(null);
    setConfirmId(null);
    setError(null);
    void reload();
  }, [open, reload]);

  const resetDraft = () => {
    setDraftType('相识');
    setDraftTitle('');
    setDraftDetail('');
    setViewA('');
    setViewB('');
    setEditingId(null);
    setAdding(false);
    setError(null);
  };

  const startEdit = (event: SharedStoryEvent) => {
    setEditingId(event.id);
    setAdding(true);
    setDraftType(event.type);
    setDraftTitle(event.title);
    setDraftDetail(event.detail ?? '');
    setViewA(event.viewpoints?.[a.id] ?? '');
    setViewB(event.viewpoints?.[b.id] ?? '');
  };

  const submit = async () => {
    const title = draftTitle.trim();
    if (!title) {
      setError('写一句具体发生了什么。');
      return;
    }
    const viewpoints: Record<string, string> = {};
    if (viewA.trim()) viewpoints[a.id] = viewA.trim().slice(0, 160);
    if (viewB.trim()) viewpoints[b.id] = viewB.trim().slice(0, 160);
    if (editingId) {
      await sharedEventRepo.update(editingId, {
        type: draftType,
        title,
        detail: draftDetail.trim(),
        viewpoints,
      });
    } else {
      await sharedEventRepo.create({
        userId,
        a: a.id,
        b: b.id,
        type: draftType,
        title,
        detail: draftDetail.trim() || undefined,
        viewpoints,
        origin: 'user',
      });
    }
    resetDraft();
    await reload();
  };

  return (
    <Modal open={open} onClose={onClose} title={`${a.name} 与 ${b.name} 的故事`} width="max-w-md">
      <div className="p-5">
        <p className="text-[11px] leading-relaxed text-gray-500">
          这里记录这两个人之间真实发生过的事。和他们各自的私聊、群聊都无关，也不会改变你设定的关系。
          同一件事允许两个人的感受不同——所以视角可以分别写。
        </p>

        <div className="mt-3">
          <button
            onClick={() => { setAdding((v) => !v); setEditingId(null); setError(null); }}
            className="rounded-full border border-life-cyan/35 bg-life-cyan/10 px-3 py-1.5 text-[11px] text-life-cyan active:scale-[.97]"
          >
            {adding ? '取消' : '＋ 添加共同事件'}
          </button>
        </div>

        {adding && (
          <div className="mt-3 rounded-2xl border border-line bg-surface/70 p-3">
            <div className="flex flex-wrap gap-1.5">
              {SHARED_EVENT_TYPES.map((type) => (
                <button
                  key={type}
                  onClick={() => setDraftType(type)}
                  className={`rounded-full px-2.5 py-1 text-[11px] transition-colors ${
                    draftType === type ? 'bg-gene-purple/20 text-gene-purple border border-gene-purple/35' : 'border border-line text-gray-500'
                  }`}
                >
                  {type}
                </button>
              ))}
            </div>
            <input
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value.slice(0, 60))}
              placeholder="发生了什么？"
              className="mt-2.5 w-full rounded-xl border border-line bg-panel px-3 py-2 text-[13px] text-ink outline-none focus:border-life-cyan/50"
            />
            <textarea
              value={draftDetail}
              onChange={(e) => setDraftDetail(e.target.value.slice(0, 240))}
              placeholder="经过（可留空）"
              rows={2}
              className="mt-2 w-full resize-none rounded-xl border border-line bg-panel px-3 py-2 text-[12px] text-ink outline-none focus:border-life-cyan/50"
            />
            <div className="mt-2 space-y-2">
              <label className="block">
                <span className="text-[10px] text-gray-500">{a.name} 的感受（可留空）</span>
                <input
                  value={viewA}
                  onChange={(e) => setViewA(e.target.value.slice(0, 160))}
                  className="mt-1 w-full rounded-xl border border-line bg-panel px-3 py-1.5 text-[12px] text-ink outline-none focus:border-gene-purple/50"
                />
              </label>
              <label className="block">
                <span className="text-[10px] text-gray-500">{b.name} 的感受（可留空）</span>
                <input
                  value={viewB}
                  onChange={(e) => setViewB(e.target.value.slice(0, 160))}
                  className="mt-1 w-full rounded-xl border border-line bg-panel px-3 py-1.5 text-[12px] text-ink outline-none focus:border-gene-purple/50"
                />
              </label>
            </div>
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

        {!loading && events.length === 0 && !adding && (
          <div className="py-10 text-center text-xs text-gray-500">
            他们之间还没有故事。<br />可以手动添加，也可以让你们的关系自然生长。
          </div>
        )}

        {events.length > 0 && (
          <div className="relative mt-4 pl-6">
            <div className="absolute left-[7px] top-2 bottom-2 w-px bg-gradient-to-b from-life-cyan via-gene-purple/60 to-transparent" />
            {events.map((event) => (
              <div key={event.id} className="relative mb-3 last:mb-0">
                <span className="absolute -left-6 top-1.5 flex h-4 w-4 items-center justify-center rounded-full border border-life-cyan/60 bg-panel text-[9px] text-life-cyan">✦</span>
                <div className="rounded-xl border border-line bg-surface/70 px-3 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-medium text-ink">
                      <span className="mr-1.5 rounded-full bg-life-cyan/12 px-1.5 py-0.5 text-[10px] text-life-cyan">{event.type}</span>
                      {event.title}
                    </p>
                    <time className="shrink-0 text-[10px] text-gray-500">{new Date(event.createdAt).toLocaleDateString('zh-CN')}</time>
                  </div>
                  {event.detail && <p className="mt-1 text-[11px] leading-relaxed text-gray-500">{event.detail}</p>}
                  {(event.viewpoints?.[a.id] || event.viewpoints?.[b.id]) && (
                    <div className="mt-2 space-y-1 border-l-2 border-gene-purple/40 pl-2">
                      {event.viewpoints?.[a.id] && <p className="text-[11px] text-gray-500">{a.name}：{event.viewpoints[a.id]}</p>}
                      {event.viewpoints?.[b.id] && <p className="text-[11px] text-gray-500">{b.name}：{event.viewpoints[b.id]}</p>}
                    </div>
                  )}
                  <div className="mt-2 flex justify-end gap-1.5">
                    {confirmId === event.id ? (
                      <>
                        <span className="text-[10px] text-gray-500">这段故事将被永久抹除</span>
                        <button onClick={() => setConfirmId(null)} className="rounded-lg px-2 py-1 text-[10px] text-gray-500">取消</button>
                        <button
                          onClick={() => void sharedEventRepo.remove(event.id).then(() => { setConfirmId(null); return reload(); })}
                          className="rounded-lg bg-red-500/15 px-2 py-1 text-[10px] text-red-400"
                        >
                          删除
                        </button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => startEdit(event)} className="rounded-lg px-2 py-1 text-[10px] text-gray-500">编辑</button>
                        <button onClick={() => setConfirmId(event.id)} className="rounded-lg px-2 py-1 text-[10px] text-gray-500">删除</button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
