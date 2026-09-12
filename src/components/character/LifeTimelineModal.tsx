import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Character, CharacterState, ContinuityThread, LifeEvent, SharedStoryEvent } from '../../db/index';
import { stateRepo } from '../../db/state-repo';
import { continuityRepo, KIND_LABEL, STATUS_LABEL } from '../../db/continuity-repo';
import { sharedEventRepo } from '../../db/shared-event-repo';
import { getRelationLevel } from '../../lib/affinity';
import { Modal } from '../ui/Modal';
import { ContinuityThreadsModal } from './ContinuityThreadsModal';
import { MemoryArchiveModal } from './MemoryArchiveModal';

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
export function LifeTimelineModal({
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
  const [loading, setLoading] = useState(false);
  const [showThreads, setShowThreads] = useState(false);
  const [addThread, setAddThread] = useState(false);
  const [showMemoryArchive, setShowMemoryArchive] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [next, events, allThreads] = await Promise.all([
        stateRepo.getOrCreate(character.id, userId),
        sharedEventRepo.getByCharacter(character.id, userId),
        continuityRepo.getByCharacter(character.id, userId),
      ]);
      setState(next);
      setThreads(allThreads);
      setSharedEvents(events);
    } finally {
      setLoading(false);
    }
  }, [character.id, userId]);

  useEffect(() => {
    if (!open) return;
    setFilter('all');
    setCollapsed(false);
    void reload();
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

  return (
    <Modal open={open} onClose={onClose} title={`${character.name} 的成长轨迹`} width="max-w-md">
      <div className="p-5">
        <div className="rounded-2xl border border-life-cyan/20 bg-gradient-to-br from-life-cyan/[0.08] to-gene-purple/[0.08] p-4">
          <p className="text-[11px] text-gray-500">此刻正在经历</p>
          <p className="mt-1 text-sm font-medium text-ink">
            {openThreads[0]?.title || state?.lifeFocus || '等待与你创造第一段共同经历。'}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-500">
            {relation && <span className="text-life-cyan">你们目前处于「{relation.level.name}」阶段</span>}
            {openThreads.length > 0 && <span>· {openThreads.length} 件还没做完</span>}
            {sharedEvents.length > 0 && <span>· {sharedEvents.length} 段人物故事</span>}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            onClick={() => { setAddThread(true); setShowThreads(true); }}
            className="rounded-full border border-life-cyan/35 bg-life-cyan/10 px-3 py-1.5 text-[11px] text-life-cyan active:scale-[.97]"
          >
            ＋ 未完成事件
          </button>
          <button
            onClick={() => setShowThreads(true)}
            className="rounded-full border border-line px-3 py-1.5 text-[11px] text-gray-500 active:scale-[.97]"
          >
            管理未完成（{threads.length}）
          </button>
          <button
            onClick={() => setShowMemoryArchive(true)}
            className="rounded-full border border-gene-purple/30 bg-gene-purple/10 px-3 py-1.5 text-[11px] text-gene-purple active:scale-[.97]"
          >
            记忆档案
          </button>
        </div>

        <div className="mt-3 flex items-center gap-1.5">
          {FILTERS.map((item) => (
            <button
              key={item.key}
              onClick={() => setFilter(item.key)}
              className={`rounded-full px-3 py-1.5 text-[11px] transition-colors ${
                filter === item.key ? 'bg-gene-purple/20 text-gene-purple border border-gene-purple/35' : 'border border-line text-gray-500'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[10px] text-gray-500">{activeHint}</p>

        {loading && <p className="py-10 text-center text-xs text-gray-500">正在读取…</p>}

        {!loading && items.length === 0 && (
          <div className="py-12 text-center text-sm text-gray-500">
            {filter === 'world'
              ? 'TA 与其他角色之间还没有故事。可以在「角色网络」里为两条关系添加共同事件。'
              : '聊几次天、记住一件事、或约定一件还没做完的事，这里就会开始记录成长。'}
          </div>
        )}

        {items.length > 0 && (
          <>
            <button
              onClick={() => setCollapsed((v) => !v)}
              className="mt-4 flex w-full items-center justify-between text-[10px] tracking-[0.14em] uppercase text-gray-500"
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
                      className={`absolute -left-6 top-1.5 flex h-4 w-4 items-center justify-center rounded-full border bg-panel text-[9px] ${
                        item.kind === 'shared' ? 'border-[#A99CF9]/60 text-[#A99CF9]' : 'border-life-cyan/60 text-life-cyan'
                      }`}
                    >
                      {item.kind === 'shared' ? '◇' : item.kind === 'thread' ? '◌' : '✦'}
                    </span>
                    <div className="rounded-xl border border-line bg-surface/70 px-3 py-2.5">
                      {item.kind === 'thread' && (
                        <>
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-xs font-medium text-ink">{item.thread.title}</p>
                            <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] ${
                              item.thread.status === 'open' ? 'bg-life-cyan/12 text-life-cyan' : 'bg-white/5 text-gray-500'
                            }`}>
                              {item.thread.status === 'open' ? KIND_LABEL[item.thread.kind] : STATUS_LABEL[item.thread.status]}
                            </span>
                          </div>
                          {item.thread.detail && <p className="mt-1 text-[11px] leading-relaxed text-gray-500">{item.thread.detail}</p>}
                          <div className="mt-1.5 flex items-center justify-between">
                            <time className="text-[10px] text-gray-500">
                              {item.thread.dueAt ? `约定 ${new Date(item.thread.dueAt).toLocaleDateString('zh-CN')}` : new Date(item.thread.createdAt).toLocaleDateString('zh-CN')}
                            </time>
                            {item.thread.status === 'open' && (
                              <button
                                onClick={() => void continuityRepo.complete(item.thread.id).then(reload)}
                                className="rounded-lg bg-life-cyan/12 px-2 py-0.5 text-[10px] text-life-cyan"
                              >
                                完成
                              </button>
                            )}
                          </div>
                        </>
                      )}

                      {item.kind === 'life' && (
                        <>
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-xs font-medium text-ink">{item.event.title}</p>
                            <time className="shrink-0 text-[10px] text-gray-500">{new Date(item.event.createdAt).toLocaleDateString('zh-CN')}</time>
                          </div>
                          {item.event.detail && <p className="mt-1 text-[11px] leading-relaxed text-gray-500">{item.event.detail}</p>}
                        </>
                      )}

                      {item.kind === 'shared' && (() => {
                        const otherId = item.event.characterIds.find((id) => id !== character.id);
                        const otherName = (otherId && nameOf(otherId)) || '另一位角色';
                        return (
                          <>
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-xs font-medium text-ink">
                                <span className="mr-1.5 rounded-full bg-[#A99CF9]/15 px-1.5 py-0.5 text-[10px] text-[#A99CF9]">{item.event.type}</span>
                                {item.event.title}
                              </p>
                              <time className="shrink-0 text-[10px] text-gray-500">{new Date(item.event.createdAt).toLocaleDateString('zh-CN')}</time>
                            </div>
                            <p className="mt-1 text-[10px] text-gray-500">与 {otherName}</p>
                            {item.event.detail && <p className="mt-1 text-[11px] leading-relaxed text-gray-500">{item.event.detail}</p>}
                            {(item.event.viewpoints?.[character.id]) && (
                              <p className="mt-1.5 border-l-2 border-gene-purple/40 pl-2 text-[11px] leading-relaxed text-gray-500">
                                {character.name}：{item.event.viewpoints[character.id]}
                              </p>
                            )}
                            {otherId && item.event.viewpoints?.[otherId] && (
                              <p className="mt-1 border-l-2 border-life-cyan/40 pl-2 text-[11px] leading-relaxed text-gray-500">
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
