import { useFeedback } from '../../lib/feedback';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Character, SharedStoryEvent } from '../../db/index';
import { sharedEventRepo, SHARED_EVENT_TYPES, type SharedEventType } from '../../db/shared-event-repo';
import { Modal } from '../ui/Modal';
import { FeedbackNotice } from '../ui/FeedbackNotice';
import { LoadingSkeleton } from '../ui/LoadingSkeleton';
import { SettingsField } from '../settings/SettingsUI';

/**
 * 两个人的共同故事：角色 ↔ 角色之间发生过的事。
 * 与群聊无关，也不改动用户设定的关系标签——只记录"他们之间发生过什么"。
 * 同一件事允许两边看法不一样，所以视角分开填写。
 */
export function SharedStoryEventsModal(props: Parameters<typeof SharedStoryContent>[0]) {
  return props.open ? <SharedStoryContent key={`${props.userId}:${props.a.id}:${props.b.id}`} {...props} /> : null;
}

function SharedStoryContent({
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
  const feedback = useFeedback();
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [readError, setReadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const mounted = useRef(true);
  const readGeneration = useRef(0);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; readGeneration.current++; }; }, []);

  const [draftType, setDraftType] = useState<SharedEventType>('相识');
  const [draftTitle, setDraftTitle] = useState('');
  const [draftDetail, setDraftDetail] = useState('');
  const [viewA, setViewA] = useState('');
  const [viewB, setViewB] = useState('');

  const reload = useCallback(async () => {
    const ticket = ++readGeneration.current;
    setLoading(true);
    setReadError(false);
    try {
      const rows = await sharedEventRepo.getByPair(a.id, b.id, userId);
      if (mounted.current && ticket === readGeneration.current) setEvents(rows);
    } catch {
      if (mounted.current && ticket === readGeneration.current) setReadError(true);
    } finally {
      if (mounted.current && ticket === readGeneration.current) setLoading(false);
    }
  }, [a.id, b.id, userId]);

  useEffect(() => {
    if (!open) return;
    setAdding(false);
    setEditingId(null);
    setConfirmId(null);
    setError(null);
    void reload();
    return () => { readGeneration.current++; };
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
    if (lock.current || loading || readError || !mounted.current) return;
    const title = draftTitle.trim();
    if (!title) {
      setError('写一句具体发生了什么。');
      return;
    }
    const viewpoints: Record<string, string> = {};
    if (viewA.trim()) viewpoints[a.id] = viewA.trim().slice(0, 160);
    if (viewB.trim()) viewpoints[b.id] = viewB.trim().slice(0, 160);
    lock.current = true; setBusy(true); setError(null);
    try {
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
    if (!mounted.current) return;
    resetDraft();
    await reload();
    } catch {
      if (mounted.current) setError('这段故事还没有保存，请重试。你的输入已保留。');
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirmId || lock.current || !mounted.current) return;
    lock.current = true; setBusy(true); setError(null);
    try {
      await sharedEventRepo.remove(confirmId);
      if (!mounted.current) return;
      setConfirmId(null);
      feedback('共同故事已删除', { tone: 'success' });
      await reload();
    } catch {
      if (mounted.current) setError('故事删除未完成，请再试一次。');
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={() => { if (!lock.current) onClose(); }} canSnapshotOnExit={() => false} title={`${a.name} 与 ${b.name} 的故事`} width="max-w-md" panelClassName="vg-settings-panel">
      <div className="vg-settings-design p-5">
        {readError && <FeedbackNotice tone="error" message="共同经历暂时没有读到，请重试。"><button type="button" className="vg-button vg-button-secondary" onClick={() => void reload()}>重新读取</button></FeedbackNotice>}
        {error && !confirmId && <FeedbackNotice tone="error" message={error} />}
        <fieldset className="min-w-0 border-0 p-0" disabled={busy || loading || readError}>
        <p className="text-sm leading-7 text-sub">
          这里记录这两个人之间真实发生过的事。和他们各自的私聊、群聊都无关，也不会改变你设定的关系。
          同一件事允许两个人的感受不同——所以视角可以分别写。
        </p>

        <div className="mt-3">
          <button
            onClick={() => { setAdding((v) => !v); setEditingId(null); setError(null); }}
            className="min-h-11 min-w-11 rounded-full border border-life-cyan/35 bg-life-cyan/10 px-3 py-1.5 text-xs text-[color:var(--vg-accent)] active:scale-[.97]"
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
                  aria-pressed={draftType === type}
                  onClick={() => setDraftType(type)}
                  className={`min-h-11 min-w-11 rounded-full px-2.5 py-1 text-xs transition-colors ${
                    draftType === type ? 'bg-gene-purple/20 text-gene-purple border border-gene-purple/35' : 'border border-line text-sub'
                  }`}
                >
                  {type}
                </button>
              ))}
            </div>
            <SettingsField label="事件内容"
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value.slice(0, 60))}
              placeholder="发生了什么？"
              className="mt-2.5 w-full rounded-xl border border-line bg-panel px-3 py-2 text-sm text-ink outline-none focus:border-life-cyan/50"
            />
            <textarea
              aria-label="经过"
              value={draftDetail}
              onChange={(e) => setDraftDetail(e.target.value.slice(0, 240))}
              placeholder="经过（可留空）"
              rows={2}
              className="mt-2 w-full resize-none rounded-xl border border-line bg-panel px-3 py-2 text-sm text-ink outline-none focus:border-life-cyan/50"
            />
            <div className="mt-2 space-y-2">
              <label className="block">
                <span className="text-xs text-sub">{a.name} 的感受（可留空）</span>
                <input
                  value={viewA}
                  onChange={(e) => setViewA(e.target.value.slice(0, 160))}
                  className="mt-1 w-full rounded-xl border border-line bg-panel px-3 py-1.5 text-sm text-ink outline-none focus:border-gene-purple/50"
                />
              </label>
              <label className="block">
                <span className="text-xs text-sub">{b.name} 的感受（可留空）</span>
                <input
                  value={viewB}
                  onChange={(e) => setViewB(e.target.value.slice(0, 160))}
                  className="mt-1 w-full rounded-xl border border-line bg-panel px-3 py-1.5 text-sm text-ink outline-none focus:border-gene-purple/50"
                />
              </label>
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <button onClick={resetDraft} className="min-h-11 min-w-11 rounded-lg px-3 py-1.5 text-xs text-sub">取消</button>
              <button onClick={() => void submit()} className="min-h-11 min-w-11 rounded-lg bg-gene-purple px-3.5 py-1.5 text-xs text-white active:scale-[.97]">
                {busy ? '正在保存…' : editingId ? '保存修改' : '记下来'}
              </button>
            </div>
          </div>
        )}

        {loading && <LoadingSkeleton label="正在读取共同经历" rows={2} />}

        {!loading && !readError && events.length === 0 && !adding && (
          <div className="py-10 text-center text-xs text-sub">
            他们之间还没有故事。<br />可以手动添加，也可以让你们的关系自然生长。
          </div>
        )}

        {events.length > 0 && (
          <div className="relative mt-4 pl-6">
            <div className="absolute left-[7px] top-2 bottom-2 w-px bg-gradient-to-b from-life-cyan via-gene-purple/60 to-transparent" />
            {events.map((event) => (
              <div key={event.id} className="relative mb-3 last:mb-0">
                <span className="absolute -left-6 top-1.5 flex h-4 w-4 items-center justify-center rounded-full border border-life-cyan/60 bg-panel text-xs text-[color:var(--vg-accent)]">✦</span>
                <div className="rounded-xl border border-line bg-surface/70 px-3 py-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium leading-7 text-ink">
                      <span className="mr-1.5 rounded-full bg-life-cyan/12 px-1.5 py-0.5 text-xs text-[color:var(--vg-accent)]">{event.type}</span>
                      {event.title}
                    </p>
                    <time className="shrink-0 text-xs text-sub">{new Date(event.createdAt).toLocaleDateString('zh-CN')}</time>
                  </div>
                  {event.detail && <p className="mt-1 text-sm leading-7 text-sub">{event.detail}</p>}
                  {(event.viewpoints?.[a.id] || event.viewpoints?.[b.id]) && (
                    <div className="mt-2 space-y-1 border-l-2 border-gene-purple/40 pl-2">
                      {event.viewpoints?.[a.id] && <p className="text-sm leading-7 text-sub">{a.name}：{event.viewpoints[a.id]}</p>}
                      {event.viewpoints?.[b.id] && <p className="text-sm leading-7 text-sub">{b.name}：{event.viewpoints[b.id]}</p>}
                    </div>
                  )}
                  <div className="mt-2 flex justify-end gap-1.5">
                        <button onClick={() => startEdit(event)} className="min-h-11 min-w-11 rounded-lg px-2 py-1 text-xs text-sub">编辑</button>
                        <button onClick={() => setConfirmId(event.id)} className="min-h-11 min-w-11 rounded-lg px-2 py-1 text-xs text-sub">删除</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        </fieldset>
      </div>
      {confirmId && <Modal open presentation="dialog" title="删除这段故事？" width="max-w-sm" onClose={() => { if (!lock.current) { setConfirmId(null); setError(null); } }} canSnapshotOnExit={() => false}>
        <div className="space-y-4 p-5"><p className="text-sm leading-7 text-ink">{events.find(event => event.id === confirmId)?.title}</p><p className="text-sm leading-7 text-sub">删除后无法恢复，两个人各自的聊天记录会保留。</p>{error && <FeedbackNotice tone="error" message={error} />}<div className="flex gap-3"><button type="button" disabled={busy} className="vg-button vg-button-secondary flex-1" onClick={() => { setConfirmId(null); setError(null); }}>取消</button><button type="button" disabled={busy} className="vg-button vg-button-danger flex-1" onClick={() => void remove()}>{busy ? '正在删除…' : '确认删除'}</button></div></div>
      </Modal>}
    </Modal>
  );
}
