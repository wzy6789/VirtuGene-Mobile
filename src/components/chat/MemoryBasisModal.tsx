import { useEffect, useState } from 'react';
import type { ContinuityThread, Message, SharedMemory, SharedStoryEvent, MemoryItem, WorldScene, WorldEvent } from '../../db/index';
import { memoryRepo } from '../../db/memory-repo';
import { continuityRepo, KIND_LABEL, STATUS_LABEL } from '../../db/continuity-repo';
import { sharedEventRepo } from '../../db/shared-event-repo';
import { sharedMemoryRepo } from '../../db/shared-memory-repo';
import { worldSceneRepo } from '../../db/world-scene-repo';
import { worldEventRepo } from '../../db/world-event-repo';
import { Modal } from '../ui/Modal';

type Trace = Message['contextTrace'];

/**
 * 记忆依据：这条回复当时**真的**参考了哪些本地数据。
 * 只读取 contextTrace 里记录的 id —— 不重新推理、不展示整段 prompt，
 * 记忆被删除后也不会再出现在这里（会明确显示"已不存在"）。
 */
export function MemoryBasisModal({
  open,
  onClose,
  trace,
  characterName,
}: {
  open: boolean;
  onClose: () => void;
  trace: Trace;
  characterName: string;
}) {
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [threads, setThreads] = useState<ContinuityThread[]>([]);
  const [events, setEvents] = useState<SharedStoryEvent[]>([]);
  const [sharedMemories, setSharedMemories] = useState<SharedMemory[]>([]);
  const [scenes, setScenes] = useState<WorldScene[]>([]);
  const [pulseEvents, setPulseEvents] = useState<WorldEvent[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !trace) {
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
        setMemories(m);
        setThreads(t);
        setEvents(e);
        setSharedMemories(s);
        setScenes(sc);
        setPulseEvents(pe);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [open, trace]);

  const missingMemory = (trace?.memoryIds?.length ?? 0) - memories.length;
  const missingThread = (trace?.continuityThreadIds?.length ?? 0) - threads.length;
  const missingEvent = (trace?.sharedEventIds?.length ?? 0) - events.length;
  const missingSharedMemory = (trace?.sharedMemoryIds?.length ?? 0) - sharedMemories.length;
  const missingScene = (trace?.sceneIds?.length ?? 0) - scenes.length;
  const missingPulseEvent = (trace?.pulseEventIds?.length ?? 0) - pulseEvents.length;
  const empty =
    memories.length === 0 && threads.length === 0 && events.length === 0 && sharedMemories.length === 0 && scenes.length === 0 && pulseEvents.length === 0 && !trace?.crossChannelReferences?.length;

  return (
    <Modal open={open} onClose={onClose} title="这条回复的记忆依据" width="max-w-md">
      <div className="p-5 space-y-4">
        <p className="text-[11px] leading-relaxed text-gray-500">
          这里记录的是生成这条回复时，实际提供给{characterName || '角色'}的记忆来源。原记录保存在本机，选中的内容会随请求发送给你使用的模型服务。
        </p>

        {loading && <p className="py-8 text-center text-xs text-gray-500">正在读取本地记忆…</p>}
        {!!trace?.crossChannelReferences?.length && (
          <section className="text-xs leading-6 text-sub">
            <h3 className="font-semibold text-ink">跨场景记忆</h3>
            <p>本轮参考了 {trace.crossChannelReferences.filter(r => r.source === 'group').length} 条群聊记录、{trace.crossChannelReferences.filter(r => r.source === 'moment').length} 条动态或互动记录。这里保留来源标识，不复制已删除的正文。</p>
          </section>
        )}

        {!loading && empty && (
          <div className="py-8 text-center text-xs text-gray-500">
            这条回复没有依赖本机记忆——{characterName || '角色'}当时只根据你们的对话本身回应。
          </div>
        )}

        {!loading && memories.length > 0 && (
          <section>
            <div className="mb-2 flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-gene-purple" />
              <h3 className="text-xs font-semibold text-ink">长期记忆</h3>
              <span className="text-[10px] text-gray-500">{memories.length} 条</span>
            </div>
            <ul className="space-y-1.5">
              {memories.map((m) => (
                <li key={m.id} className="rounded-xl border border-gene-purple/20 bg-gene-purple/[0.06] px-3 py-2">
                  <p className="text-[12px] leading-relaxed text-ink">{m.content}</p>
                  <p className="mt-1 text-[10px] text-gray-500">
                    {new Date(m.createdAt).toLocaleDateString('zh-CN')}
                    {m.sourceMessageIds && m.sourceMessageIds.length > 0 ? ' · 有原话依据' : ' · 由对话总结'}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        )}

        {!loading && threads.length > 0 && (
          <section>
            <div className="mb-2 flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-life-cyan" />
              <h3 className="text-xs font-semibold text-ink">还没做完的事</h3>
              <span className="text-[10px] text-gray-500">{threads.length} 条</span>
            </div>
            <ul className="space-y-1.5">
              {threads.map((t) => (
                <li key={t.id} className="rounded-xl border border-life-cyan/20 bg-life-cyan/[0.06] px-3 py-2">
                  <p className="text-[12px] leading-relaxed text-ink">{t.title}</p>
                  <p className="mt-1 text-[10px] text-gray-500">
                    {KIND_LABEL[t.kind]} · {STATUS_LABEL[t.status]}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        )}

        {!loading && events.length > 0 && (
          <section>
            <div className="mb-2 flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-[#A99CF9]" />
              <h3 className="text-xs font-semibold text-ink">人物之间的故事</h3>
              <span className="text-[10px] text-gray-500">{events.length} 条</span>
            </div>
            <ul className="space-y-1.5">
              {events.map((e) => (
                <li key={e.id} className="rounded-xl border border-line bg-surface/70 px-3 py-2">
                  <p className="text-[12px] leading-relaxed text-ink">{e.title}</p>
                  <p className="mt-1 text-[10px] text-gray-500">{e.type}</p>
                </li>
              ))}
            </ul>
          </section>
        )}

        {!loading && sharedMemories.length > 0 && (
          <section>
            <div className="mb-2 flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-gene-purple" />
              <h3 className="text-xs font-semibold text-ink">你们一起经历过的事</h3>
              <span className="text-[10px] text-gray-500">{sharedMemories.length} 条</span>
            </div>
            <ul className="space-y-1.5">
              {sharedMemories.map((m) => (
                <li key={m.id} className="rounded-xl border border-gene-purple/20 bg-gene-purple/[0.06] px-3 py-2">
                  <p className="text-[12px] leading-relaxed text-ink">{m.title}</p>
                  {m.summary && <p className="mt-1 text-[11px] leading-relaxed text-gray-500">{m.summary}</p>}
                  <p className="mt-1 text-[10px] text-gray-500">
                    {new Date(m.createdAt).toLocaleDateString('zh-CN')} · 你收藏的共同记忆
                  </p>
                </li>
              ))}
            </ul>
          </section>
        )}

        {!loading && scenes.length > 0 && (
          <section>
            <div className="mb-2 flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-life-cyan" />
              <h3 className="text-xs font-semibold text-ink">你们一起演过的戏</h3>
              <span className="text-[10px] text-gray-500">{scenes.length} 场</span>
            </div>
            <ul className="space-y-1.5">
              {scenes.map((s) => (
                <li key={s.id} className="rounded-xl border border-life-cyan/20 bg-life-cyan/[0.05] px-3 py-2">
                  <p className="text-[12px] leading-relaxed text-ink">{s.title}</p>
                  <p className="mt-1 text-[10px] text-gray-500">
                    {s.place} · {s.timeLabel}
                    {s.finishedAt ? ` · ${new Date(s.finishedAt).toLocaleDateString('zh-CN')}` : ''}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        )}

        {!loading && pulseEvents.length > 0 && (
          <section>
            <div className="mb-2 flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-gene-purple" />
              <h3 className="text-xs font-semibold text-ink">世界自主行动</h3>
              <span className="text-[10px] text-gray-500">{pulseEvents.length} 条</span>
            </div>
            <ul className="space-y-1.5">
              {pulseEvents.map((event) => (
                <li key={event.id} className="rounded-xl border border-gene-purple/20 bg-gene-purple/[0.06] px-3 py-2">
                  <p className="text-[12px] leading-relaxed text-ink">{event.title}</p>
                  {event.summary && <p className="mt-1 text-[11px] leading-relaxed text-gray-500">{event.summary}</p>}
                  <p className="mt-1 text-[10px] text-gray-500">你不在时，角色亲身参与的世界事件</p>
                </li>
              ))}
            </ul>
          </section>
        )}

        {!loading && (missingMemory > 0 || missingThread > 0 || missingEvent > 0 || missingSharedMemory > 0 || missingScene > 0 || missingPulseEvent > 0) && (
          <p className="rounded-xl border border-line bg-surface/60 px-3 py-2 text-[10px] leading-relaxed text-gray-500">
            有 {missingMemory + missingThread + missingEvent + missingSharedMemory + missingScene + missingPulseEvent} 条当时的依据如今已不存在（可能已被你删除或自动清理），所以这里不再显示。
          </p>
        )}
      </div>
    </Modal>
  );
}
