import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Character, CharacterState, ContinuityThread, LifeEvent, SharedStoryEvent } from '../../db/index';
import { stateRepo } from '../../db/state-repo';
import { continuityRepo, KIND_LABEL, STATUS_LABEL } from '../../db/continuity-repo';
import { sharedEventRepo } from '../../db/shared-event-repo';
import { getRelationLevel } from '../../lib/affinity';
import { Modal } from '../ui/Modal';
import { ContinuityThreadsModal } from './ContinuityThreadsModal';
import { MemoryArchiveModal } from './MemoryArchiveModal';
import { LoadingSkeleton } from '../ui/LoadingSkeleton';
import { FeedbackNotice } from '../ui/FeedbackNotice';

type Filter = 'all' | 'me' | 'world';

type Item =
  | { key: string; at: number; kind: 'thread'; thread: ContinuityThread }
  | { key: string; at: number; kind: 'life'; event: LifeEvent }
  | { key: string; at: number; kind: 'shared'; event: SharedStoryEvent };

const FILTERS: { key: Filter; label: string; hint: string }[] = [
  { key: 'all', label: '全部', hint: '你和 TA，以及 TA 自己的故事' },
  { key: 'me', label: '我和 TA', hint: '只属于你和 TA 的经历与未完成的事' },
  { key: 'world', label: '人物关系', hint: 'TA 与其他角色之间的故事' },
];

/**
 * 生命时间线：把「生命轨迹 + 未完成事件 + 人物共同事件」收在同一条线上。
 * 全部为本机数据，用户随时可以完成、收起或删除其中任何一条。
 */
export function LifeTimelineModal(props: Parameters<typeof LifeTimelineContent>[0]) {
  return props.open ? <LifeTimelineContent key={`${props.userId}:${props.character.id}`} {...props} /> : null;
}

function LifeTimelineContent({
  open,
  onClose,
  character,
  userId,
  characters = [],
}: {
  open: boolean;
  onClose: () => void;
  character: Character;
  userId: string;
  characters?: Character[];
}) {
  const [state, setState] = useState<CharacterState | null>(null);
  const [threads, setThreads] = useState<ContinuityThread[]>([]);
  const [sharedEvents, setSharedEvents] = useState<SharedStoryEvent[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [loading, setLoading] = useState(true);
  const [showThreads, setShowThreads] = useState(false);
  const [addThread, setAddThread] = useState(false);
  const [showMemoryArchive, setShowMemoryArchive] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [readError, setReadError] = useState(false);
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const mounted = useRef(true);
  const readGeneration = useRef(0);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; readGeneration.current++; }; }, []);

  const reload = useCallback(async () => {
    const ticket = ++readGeneration.current;
    setLoading(true);
    setReadError(false);
    try {
      const [next, events, allThreads] = await Promise.all([
        stateRepo.getOrCreate(character.id, userId),
        sharedEventRepo.getByCharacter(character.id, userId),
        continuityRepo.getByCharacter(character.id, userId),
      ]);
      if (!mounted.current || ticket !== readGeneration.current) return;
      setState(next);
      setThreads(allThreads);
      setSharedEvents(events);
    } catch {
      if (mounted.current && ticket === readGeneration.current) setReadError(true);
    } finally {
      if (mounted.current && ticket === readGeneration.current) setLoading(false);
    }
  }, [character.id, userId]);

  useEffect(() => {
    if (!open) return;
    setFilter('all');
    setCollapsed(false);
    void reload();
    return () => { readGeneration.current++; };
  }, [open, reload]);

  const nameOf = useCallback(
    (id: string) => characters.find((c) => c.id === id)?.name,
    [characters],
  );

  const openThreads = useMemo(
    () => threads.filter((t) => t.status === 'open').sort((a, b) => (a.dueAt ?? a.createdAt) - (b.dueAt ?? b.createdAt)),
    [threads],
  );

  const items = useMemo<Item[]>(() => {
    const list: Item[] = [];
    if (filter === 'all' || filter === 'me') {
      for (const thread of threads) {
        list.push({ key: `t-${thread.id}`, at: thread.updatedAt, kind: 'thread', thread });
      }
      for (const event of state?.lifeEvents ?? []) {
        list.push({ key: `l-${event.id}`, at: event.createdAt, kind: 'life', event });
      }
    }
    if (filter === 'all' || filter === 'world') {
      for (const event of sharedEvents) {
        list.push({ key: `s-${event.id}`, at: event.createdAt, kind: 'shared', event });
      }
    }
    return list.sort((a, b) => b.at - a.at);
  }, [filter, threads, state, sharedEvents]);

  const relation = state ? getRelationLevel(state.affinity) : null;
  const activeHint = FILTERS.find((f) => f.key === filter)?.hint ?? '';
  const complete = async (id: string) => {
    if (lock.current || loading || readError) return;
    lock.current = true; setBusy(true); setActionError('');
    try {
      await continuityRepo.complete(id);
      if (mounted.current) await reload();
    } catch {
      if (mounted.current) setActionError('这件事还未标记完成，请重试。');
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={() => { if (!lock.current) onClose(); }} canSnapshotOnExit={() => false} title={`${character.name} 的成长轨迹`} width="max-w-md">
      <div className="p-5">
        {readError && <FeedbackNotice tone="error" message="成长轨迹暂时没有读到，请重试。"><button type="button" className="vg-button vg-button-secondary" onClick={() => void reload()}>重新读取</button></FeedbackNotice>}
        {actionError && <FeedbackNotice tone="error" message={actionError} />}
        <fieldset disabled={busy || loading || readError} className="min-w-0 border-0 p-0">
        <div className="rounded-2xl border border-life-cyan/20 bg-gradient-to-br from-life-cyan/[0.08] to-gene-purple/[0.08] p-4">
          <p className="text-xs text-sub">此刻正在经历</p>
          <p className="mt-1 text-sm font-medium text-ink">
            {loading ? '正在整理成长轨迹…' : readError ? '暂时未读取到记录' : openThreads[0]?.title || state?.lifeFocus || '等待与你创造第一段共同经历。'}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-sub">
            {relation && <span className="text-[color:var(--vg-accent)]">你们目前处于「{relation.level.name}」阶段</span>}
            {openThreads.length > 0 && <span>· {openThreads.length} 件还没做完</span>}
            {sharedEvents.length > 0 && <span>· {sharedEvents.length} 段人物故事</span>}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            onClick={() => { setAddThread(true); setShowThreads(true); }}
            className="min-h-11 min-w-11 rounded-full border border-life-cyan/35 bg-life-cyan/10 px-3 py-1.5 text-xs text-[color:var(--vg-accent)] active:scale-[.97]"
          >
            ＋ 未完成事件
          </button>
          <button
            onClick={() => setShowThreads(true)}
            className="min-h-11 min-w-11 rounded-full border border-line px-3 py-1.5 text-xs text-sub active:scale-[.97]"
          >
            管理未完成（{threads.length}）
          </button>
          <button
            onClick={() => setShowMemoryArchive(true)}
            className="min-h-11 min-w-11 rounded-full border border-gene-purple/30 bg-gene-purple/10 px-3 py-1.5 text-xs text-gene-purple active:scale-[.97]"
          >
            记忆档案
          </button>
        </div>

        <div className="mt-3 flex items-center gap-1.5">
          {FILTERS.map((item) => (
            <button
              key={item.key}
              aria-pressed={filter === item.key}
              onClick={() => setFilter(item.key)}
              className={`min-h-11 min-w-11 rounded-full px-3 py-1.5 text-xs transition-colors ${
                filter === item.key ? 'bg-gene-purple/20 text-gene-purple border border-gene-purple/35' : 'border border-line text-sub'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-sub">{activeHint}</p>

        {loading && <LoadingSkeleton label="正在读取成长轨迹" rows={3} />}

        {!loading && !readError && items.length === 0 && (
          <div className="py-12 text-center text-sm text-sub">
            {filter === 'world'
              ? 'TA 与其他角色之间还没有故事。可以在「角色网络」里为两条关系添加共同事件。'
              : '聊几次天、记住一件事、或约定一件还没做完的事，这里就会开始记录成长。'}
          </div>
        )}

        {items.length > 0 && (
          <>
            <button
              onClick={() => setCollapsed((v) => !v)}
              aria-expanded={!collapsed}
              className="min-h-11 mt-4 flex w-full items-center justify-between text-xs tracking-[0.14em] uppercase text-sub"
            >
              <span>{filter === 'world' ? '人物共同事件' : filter === 'me' ? '我和 TA 的时间线' : '完整时间线'}</span>
              <span>{collapsed ? '展开' : '收起'}</span>
            </button>

            {!collapsed && (
              <div className="relative mt-3 pl-6">
                <div className="absolute left-[7px] top-2 bottom-2 w-px bg-gradient-to-b from-life-cyan via-gene-purple/60 to-transparent" />
                {items.map((item) => (
                  <div key={item.key} className="relative mb-4 last:mb-0">
                    <span
                      className={`absolute -left-6 top-1.5 flex h-4 w-4 items-center justify-center rounded-full border bg-panel text-xs ${
                        item.kind === 'shared' ? 'border-line text-[color:var(--vg-accent)]' : 'border-life-cyan/60 text-[color:var(--vg-accent)]'
                      }`}
                    >
                      {item.kind === 'shared' ? '◇' : item.kind === 'thread' ? '◌' : '✦'}
                    </span>
                    <div className="rounded-xl border border-line bg-surface/70 px-3 py-2.5">
                      {item.kind === 'thread' && (
                        <>
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-sm font-medium leading-7 text-ink">{item.thread.title}</p>
                            <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-xs ${
                              item.thread.status === 'open' ? 'bg-life-cyan/12 text-[color:var(--vg-accent)]' : 'bg-white/5 text-sub'
                            }`}>
                              {item.thread.status === 'open' ? KIND_LABEL[item.thread.kind] : STATUS_LABEL[item.thread.status]}
                            </span>
                          </div>
                          {item.thread.detail && <p className="mt-1 text-sm leading-7 text-sub">{item.thread.detail}</p>}
                          <div className="mt-1.5 flex items-center justify-between">
                            <time className="text-xs text-sub">
                              {item.thread.dueAt ? `约定 ${new Date(item.thread.dueAt).toLocaleDateString('zh-CN')}` : new Date(item.thread.createdAt).toLocaleDateString('zh-CN')}
                            </time>
                            {item.thread.status === 'open' && (
                              <button
                                onClick={() => void complete(item.thread.id)}
                                className="min-h-11 min-w-11 rounded-lg bg-life-cyan/12 px-2 py-0.5 text-xs text-[color:var(--vg-accent)]"
                              >
                                完成
                              </button>
                            )}
                          </div>
                        </>
                      )}

                      {item.kind === 'life' && (
                        <>
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-sm font-medium leading-7 text-ink">{item.event.title}</p>
                            <time className="shrink-0 text-xs text-sub">{new Date(item.event.createdAt).toLocaleDateString('zh-CN')}</time>
                          </div>
                          {item.event.detail && <p className="mt-1 text-sm leading-7 text-sub">{item.event.detail}</p>}
                        </>
                      )}

                      {item.kind === 'shared' && (() => {
                        const otherId = item.event.characterIds.find((id) => id !== character.id);
                        const otherName = (otherId && nameOf(otherId)) || '另一位角色';
                        return (
                          <>
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="text-sm font-medium leading-7 text-ink">
                                <span className="mr-1.5 rounded-full bg-surface px-1.5 py-0.5 text-xs text-[color:var(--vg-accent)]">{item.event.type}</span>
                                {item.event.title}
                              </p>
                              <time className="shrink-0 text-xs text-sub">{new Date(item.event.createdAt).toLocaleDateString('zh-CN')}</time>
                            </div>
                            <p className="mt-1 text-xs text-sub">与 {otherName}</p>
                            {item.event.detail && <p className="mt-1 text-sm leading-7 text-sub">{item.event.detail}</p>}
                            {(item.event.viewpoints?.[character.id]) && (
                              <p className="mt-1.5 border-l-2 border-gene-purple/40 pl-2 text-sm leading-7 text-sub">
                                {character.name}：{item.event.viewpoints[character.id]}
                              </p>
                            )}
                            {otherId && item.event.viewpoints?.[otherId] && (
                              <p className="mt-1 border-l-2 border-life-cyan/40 pl-2 text-sm leading-7 text-sub">
                                {otherName}：{item.event.viewpoints[otherId]}
                              </p>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
        </fieldset>
      </div>

      <ContinuityThreadsModal
        open={showThreads}
        onClose={() => { setShowThreads(false); setAddThread(false); void reload(); }}
        character={character}
        userId={userId}
        startAdding={addThread}
      />
      <MemoryArchiveModal
        open={showMemoryArchive}
        onClose={() => setShowMemoryArchive(false)}
        character={character}
        userId={userId}
      />
    </Modal>
  );
}
