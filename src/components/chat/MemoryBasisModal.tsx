import { useEffect, useRef, useState } from 'react';
import type { ContinuityThread, Message, SharedMemory, SharedStoryEvent, MemoryItem, WorldScene, WorldEvent } from '../../db/index';
import { memoryRepo } from '../../db/memory-repo';
import { continuityRepo, KIND_LABEL, STATUS_LABEL } from '../../db/continuity-repo';
import { sharedEventRepo } from '../../db/shared-event-repo';
import { sharedMemoryRepo } from '../../db/shared-memory-repo';
import { worldSceneRepo } from '../../db/world-scene-repo';
import { worldEventRepo } from '../../db/world-event-repo';
import { Modal } from '../ui/Modal';
import { LoadingSkeleton } from '../ui/LoadingSkeleton';
import { FeedbackNotice } from '../ui/FeedbackNotice';
import { useAuthStore } from '../../store/auth-store';

type Trace = Message['contextTrace'];

/**
 * 记忆依据：这条回复当时**真的**参考了哪些本地数据。
 * 只读取 contextTrace 里记录的 id —— 不重新推理、不展示整段 prompt，
 * 记忆被删除后也不会再出现在这里（会明确显示"已不存在"）。
 */
export function MemoryBasisModal(props: Omit<Parameters<typeof MemoryBasisContent>[0], 'owner'>) {
  const owner = useAuthStore(s => s.userId);
  const access = useRef({ open: false, owner });
  if (props.open && !access.current.open) access.current.owner = owner;
  access.current.open = props.open;
  const changedOwner = props.open && access.current.owner !== owner;
  useEffect(() => { if (changedOwner) props.onClose(); }, [changedOwner, props.onClose]);
  return props.open && owner && !changedOwner ? <MemoryBasisContent key={`${owner}:${JSON.stringify(props.trace ?? null)}`} {...props} owner={owner} /> : null;
}

function MemoryBasisContent({
  open,
  onClose,
  trace,
  characterName,
  owner,
}: {
  open: boolean;
  onClose: () => void;
  trace: Trace;
  characterName: string;
  owner?: string;
}) {
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [threads, setThreads] = useState<ContinuityThread[]>([]);
  const [events, setEvents] = useState<SharedStoryEvent[]>([]);
  const [sharedMemories, setSharedMemories] = useState<SharedMemory[]>([]);
  const [scenes, setScenes] = useState<WorldScene[]>([]);
  const [pulseEvents, setPulseEvents] = useState<WorldEvent[]>([]);
  const [loading, setLoading] = useState(!!trace);
  const [readError, setReadError] = useState(false);
  const [readAttempt, setReadAttempt] = useState(0);

  useEffect(() => {
    if (!open || !trace) {
      setLoading(false);
      setReadError(false);
      setMemories([]);
      setThreads([]);
      setEvents([]);
      setSharedMemories([]);
      setScenes([]);
      setPulseEvents([]);
      return;
    }
    let active = true;
    setLoading(true);
    setReadError(false);
    setMemories([]); setThreads([]); setEvents([]); setSharedMemories([]); setScenes([]); setPulseEvents([]);
    void Promise.all([
      memoryRepo.getByIds(trace.memoryIds ?? []),
      continuityRepo.getByIds(trace.continuityThreadIds ?? []),
      sharedEventRepo.getByIds(trace.sharedEventIds ?? []),
      sharedMemoryRepo.getByIds(trace.sharedMemoryIds ?? []),
      worldSceneRepo.getByIds(trace.sceneIds ?? []),
      worldEventRepo.getByIds(trace.pulseEventIds ?? []),
    ])
      .then(([m, t, e, s, sc, pe]) => {
        if (!active) return;
        setMemories(m.filter(row => row.userId === owner));
        setThreads(t.filter(row => row.userId === owner));
        setEvents(e.filter(row => row.userId === owner));
        setSharedMemories(s.filter(row => row.userId === owner));
        setScenes(sc.filter(row => row.userId === owner));
        setPulseEvents(pe.filter(row => row.userId === owner));
      })
      .catch(() => { if (active) setReadError(true); })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [open, trace, readAttempt, owner]);

  const missingMemory = (trace?.memoryIds?.length ?? 0) - memories.length;
  const missingThread = (trace?.continuityThreadIds?.length ?? 0) - threads.length;
  const missingEvent = (trace?.sharedEventIds?.length ?? 0) - events.length;
  const missingSharedMemory = (trace?.sharedMemoryIds?.length ?? 0) - sharedMemories.length;
  const missingScene = (trace?.sceneIds?.length ?? 0) - scenes.length;
  const missingPulseEvent = (trace?.pulseEventIds?.length ?? 0) - pulseEvents.length;
  const todoReferenceCount = Math.max(trace?.todoIds?.length ?? 0, trace?.todoOccurrenceIds?.length ?? 0);
  const empty =
    !(trace?.memoryIds?.length) && !(trace?.continuityThreadIds?.length) && !(trace?.sharedEventIds?.length) && !(trace?.sharedMemoryIds?.length) && !(trace?.sceneIds?.length) && !(trace?.pulseEventIds?.length) && !(trace?.todoIds?.length) && !(trace?.todoOccurrenceIds?.length) && !trace?.groupSummary && !trace?.crossChannelReferences?.length;

  return (
    <Modal open={open} onClose={onClose} title="这条回复的记忆依据" width="max-w-md" canSnapshotOnExit={() => false}>
      <div className="p-5 space-y-4">
        <p className="text-sm leading-7 text-sub">
          这里记录的是生成这条回复时，实际提供给{characterName || '角色'}的记忆来源。原记录保存在本机，选中的内容会随请求发送给你使用的模型服务。
        </p>

        {loading && <LoadingSkeleton label="正在读取本地记忆依据" rows={3} />}
        {readError && <FeedbackNotice tone="error" message="本地依据暂时没有读到，请重试。"><button type="button" className="vg-button vg-button-secondary" onClick={() => setReadAttempt(value => value + 1)}>重新读取</button></FeedbackNotice>}
        {!!trace?.crossChannelReferences?.length && (
          <section className="text-sm leading-7 text-sub">
            <h3 className="font-semibold text-ink">跨场景记忆</h3>
            <p>本轮参考了 {trace.crossChannelReferences.filter(r => r.source === 'group').length} 条群聊记录、{trace.crossChannelReferences.filter(r => r.source === 'moment').length} 条动态或互动、{trace.crossChannelReferences.filter(r => r.source === 'diary').length} 篇已授权日记、{trace.crossChannelReferences.filter(r => r.source === 'world').length} 条星域经历，以及 {trace.crossChannelReferences.filter(r => r.source === 'todo').length + todoReferenceCount} 条已分享待办经历。这里保留来源标识，不复制已删除的正文。</p>
          </section>
        )}
        {!!trace?.groupSummary && (
          <section className="text-sm leading-7 text-sub">
            <h3 className="font-semibold text-ink">群聊历史摘要</h3>
            <p>本轮使用了该群截至 {new Date(trace.groupSummary.updatedAt).toLocaleString('zh-CN')} 的摘要。原始消息删除后，这份摘要会同步失效。</p>
          </section>
        )}
        {!!todoReferenceCount && (
          <section className="text-sm leading-7 text-sub">
            <h3 className="font-semibold text-ink">已分享待办</h3>
            <p>本轮实际参考了 {todoReferenceCount} 条用户明确分享的待办/完成记录。</p>
          </section>
        )}

        {!loading && !readError && empty && (
          <div className="py-8 text-center text-xs text-sub">
            这条回复没有依赖本机记忆——{characterName || '角色'}当时只根据你们的对话本身回应。
          </div>
        )}

        {!loading && !readError && memories.length > 0 && (
          <section>
            <div className="mb-2 flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-gene-purple" />
              <h3 className="text-xs font-semibold text-ink">长期记忆</h3>
              <span className="text-xs text-sub">{memories.length} 条</span>
            </div>
            <ul className="space-y-1.5">
              {memories.map((m) => (
                <li key={m.id} className="rounded-xl border border-gene-purple/20 bg-gene-purple/[0.06] px-3 py-2">
                  <p className="text-sm leading-7 text-ink">{m.content}</p>
                  <p className="mt-1 text-xs text-sub">
                    {new Date(m.createdAt).toLocaleDateString('zh-CN')}
                    {m.sourceMessageIds && m.sourceMessageIds.length > 0 ? ' · 有原话依据' : ' · 由对话总结'}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        )}

        {!loading && !readError && threads.length > 0 && (
          <section>
            <div className="mb-2 flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-life-cyan" />
              <h3 className="text-xs font-semibold text-ink">还没做完的事</h3>
              <span className="text-xs text-sub">{threads.length} 条</span>
            </div>
            <ul className="space-y-1.5">
              {threads.map((t) => (
                <li key={t.id} className="rounded-xl border border-life-cyan/20 bg-life-cyan/[0.06] px-3 py-2">
                  <p className="text-sm leading-7 text-ink">{t.title}</p>
                  <p className="mt-1 text-xs text-sub">
                    {KIND_LABEL[t.kind]} · {STATUS_LABEL[t.status]}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        )}

        {!loading && !readError && events.length > 0 && (
          <section>
            <div className="mb-2 flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--vg-accent)]" />
              <h3 className="text-xs font-semibold text-ink">人物之间的故事</h3>
              <span className="text-xs text-sub">{events.length} 条</span>
            </div>
            <ul className="space-y-1.5">
              {events.map((e) => (
                <li key={e.id} className="rounded-xl border border-line bg-surface/70 px-3 py-2">
                  <p className="text-sm leading-7 text-ink">{e.title}</p>
                  <p className="mt-1 text-xs text-sub">{e.type}</p>
                </li>
              ))}
            </ul>
          </section>
        )}

        {!loading && !readError && sharedMemories.length > 0 && (
          <section>
            <div className="mb-2 flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-gene-purple" />
              <h3 className="text-xs font-semibold text-ink">你们一起经历过的事</h3>
              <span className="text-xs text-sub">{sharedMemories.length} 条</span>
            </div>
            <ul className="space-y-1.5">
              {sharedMemories.map((m) => (
                <li key={m.id} className="rounded-xl border border-gene-purple/20 bg-gene-purple/[0.06] px-3 py-2">
                  <p className="text-sm leading-7 text-ink">{m.title}</p>
                  {m.summary && <p className="mt-1 text-sm leading-7 text-sub">{m.summary}</p>}
                  <p className="mt-1 text-xs text-sub">
                    {new Date(m.createdAt).toLocaleDateString('zh-CN')} · 你收藏的共同记忆
                  </p>
                </li>
              ))}
            </ul>
          </section>
        )}

        {!loading && !readError && scenes.length > 0 && (
          <section>
            <div className="mb-2 flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-life-cyan" />
              <h3 className="text-xs font-semibold text-ink">你们一起演过的戏</h3>
              <span className="text-xs text-sub">{scenes.length} 场</span>
            </div>
            <ul className="space-y-1.5">
              {scenes.map((s) => (
                <li key={s.id} className="rounded-xl border border-life-cyan/20 bg-life-cyan/[0.05] px-3 py-2">
                  <p className="text-sm leading-7 text-ink">{s.title}</p>
                  <p className="mt-1 text-xs text-sub">
                    {s.place} · {s.timeLabel}
                    {s.finishedAt ? ` · ${new Date(s.finishedAt).toLocaleDateString('zh-CN')}` : ''}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        )}

        {!loading && !readError && pulseEvents.length > 0 && (
          <section>
            <div className="mb-2 flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-gene-purple" />
              <h3 className="text-xs font-semibold text-ink">世界自主行动</h3>
              <span className="text-xs text-sub">{pulseEvents.length} 条</span>
            </div>
            <ul className="space-y-1.5">
              {pulseEvents.map((event) => (
                <li key={event.id} className="rounded-xl border border-gene-purple/20 bg-gene-purple/[0.06] px-3 py-2">
                  <p className="text-sm leading-7 text-ink">{event.title}</p>
                  {event.summary && <p className="mt-1 text-sm leading-7 text-sub">{event.summary}</p>}
                  <p className="mt-1 text-xs text-sub">你不在时，角色亲身参与的世界事件</p>
                </li>
              ))}
            </ul>
          </section>
        )}

        {!loading && !readError && (missingMemory > 0 || missingThread > 0 || missingEvent > 0 || missingSharedMemory > 0 || missingScene > 0 || missingPulseEvent > 0) && (
          <p className="rounded-xl border border-line bg-surface/60 px-3 py-2 text-sm leading-7 text-sub">
            有 {missingMemory + missingThread + missingEvent + missingSharedMemory + missingScene + missingPulseEvent} 条当时的依据如今已不存在（可能已被你删除或自动清理），所以这里不再显示。
          </p>
        )}
      </div>
    </Modal>
  );
}
