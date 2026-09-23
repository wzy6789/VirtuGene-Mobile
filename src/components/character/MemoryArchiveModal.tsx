import { useCallback, useEffect, useState } from 'react';
import type { Character, MemoryItem } from '../../db/index';
import { memoryRepo } from '../../db/memory-repo';
import { sessionRepo } from '../../db/session-repo';
import { messageRepo } from '../../db/message-repo';
import { Modal } from '../ui/Modal';
import { memoryKindLabel } from '../../lib/memory-engine';

type MemoryFilter = 'all' | 'fact' | 'preference' | 'episode' | 'promise' | 'character-life';

/**
 * 记忆档案：角色记得的每一件事，以及它从哪来。
 * 用户可以看见来源、点开原话、并直接删掉不想被记住的内容。
 */
export function MemoryArchiveModal({
  open,
  onClose,
  character,
  userId,
}: {
  open: boolean;
  onClose: () => void;
  character: Character;
  userId: string;
}) {
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [sessionTitles, setSessionTitles] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [originals, setOriginals] = useState<Record<string, string[]>>({});
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [filter, setFilter] = useState<MemoryFilter>('all');

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const list = await memoryRepo.getRecentByCharacter(character.id, userId, 60);
      setMemories(list);
      const sessionIds = Array.from(new Set(list.map((m) => m.sourceSessionId).filter((id): id is string => !!id)));
      const titles: Record<string, string> = {};
      for (const id of sessionIds) {
        const session = await sessionRepo.getById(id);
        if (session) titles[id] = session.title || '一段对话';
      }
      setSessionTitles(titles);
    } finally {
      setLoading(false);
    }
  }, [character.id, userId]);

  useEffect(() => {
    if (!open) return;
    setExpanded(null);
    setOriginals({});
    setConfirmId(null);
    setFilter('all');
    void reload();
  }, [open, reload]);

  const toggleOriginal = async (memory: MemoryItem) => {
    if (expanded === memory.id) {
      setExpanded(null);
      return;
    }
    setExpanded(memory.id);
    const ids = memory.sourceMessageIds ?? [];
    if (ids.length === 0 || originals[memory.id]) return;
    const found: string[] = [];
    for (const id of ids) {
      const msg = await messageRepo.getById(id);
      if (msg) found.push(msg.content.slice(0, 160));
    }
    setOriginals((prev) => ({ ...prev, [memory.id]: found }));
  };

  return (
    <Modal open={open} onClose={onClose} title={`${character.name} 的记忆档案`} width="max-w-md">
      <div className="p-5">
        <p className="text-[11px] leading-relaxed text-gray-500">
          这里保存着{character.name}记得的关于你的事。来源和原话都在你的手机上，删除后角色就不会再想起来。
        </p>

        {loading && <p className="py-8 text-center text-xs text-gray-500">正在读取记忆…</p>}

        {!loading && memories.length === 0 && (
          <div className="py-10 text-center text-xs text-gray-500">
            还没有记忆。<br />聊到你的偏好、经历或计划时，它们会慢慢沉淀在这里。
          </div>
        )}

        {!loading && memories.length > 0 && (
          <div className="mt-3 flex gap-1.5 overflow-x-auto pb-1">
            {([
              ['all', '全部'],
              ['fact', '关于你'],
              ['preference', '偏好'],
              ['episode', '共同经历'],
              ['promise', '约定'],
              ['character-life', '角色生活'],
            ] as [MemoryFilter, string][]).map(([value, label]) => (
              <button
                key={value}
                onClick={() => setFilter(value)}
                className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] transition ${filter === value ? 'bg-life-cyan/20 text-life-cyan' : 'bg-black/5 text-gray-500'}`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        <ul className="mt-3 space-y-2">
          {memories.filter((memory) => filter === 'all' || memory.memoryKind === filter).map((memory) => {
            const hasOrigin = (memory.sourceMessageIds?.length ?? 0) > 0;
            const sessionTitle = memory.sourceSessionId ? sessionTitles[memory.sourceSessionId] : undefined;
            return (
              <li key={memory.id} className="rounded-2xl border border-gene-purple/20 bg-gene-purple/[0.05] px-3 py-2.5">
                <p className="text-[12.5px] leading-relaxed text-ink">{memory.content}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-gray-500">
                  <span className="rounded-full bg-life-cyan/10 px-1.5 py-0.5 text-life-cyan">{memoryKindLabel(memory.memoryKind)}</span>
                  {memory.pinned && (memory.status ?? 'active') === 'active' && <span className="rounded-full bg-gene-purple/15 px-1.5 py-0.5 text-gene-purple">必须记住</span>}
                  {memory.status === 'superseded' && <span className="rounded-full bg-gray-500/15 px-1.5 py-0.5 text-gray-500">已被新信息替代</span>}
                  {memory.status === 'withdrawn' && <span className="rounded-full bg-gray-500/15 px-1.5 py-0.5 text-gray-500">已撤回，不再召回</span>}
                  <span>{new Date(memory.createdAt).toLocaleDateString('zh-CN')}</span>
                  {sessionTitle && <span>· 来自「{sessionTitle}」</span>}
                  <span>· {hasOrigin ? '有原话依据' : '由对话总结'}</span>
                  {typeof memory.confidence === 'number' && memory.confidence < 0.8 && <span>· 把握不大</span>}
                </div>
                {hasOrigin && (
                  <button
                    onClick={() => void toggleOriginal(memory)}
                    className="mt-1.5 text-[10px] text-life-cyan"
                  >
                    {expanded === memory.id ? '收起原话' : '看当时说的话'}
                  </button>
                )}
                {expanded === memory.id && (
                  <div className="mt-1.5 space-y-1 border-l-2 border-life-cyan/40 pl-2">
                    {(originals[memory.id] ?? []).length === 0 ? (
                      <p className="text-[10px] text-gray-500">原消息已被删除或已清理。</p>
                    ) : (
                      (originals[memory.id] ?? []).map((text, i) => (
                        <p key={i} className="text-[11px] leading-relaxed text-gray-500">{text}</p>
                      ))
                    )}
                  </div>
                )}
                <div className="mt-2 flex justify-end">
                  <button
                    onClick={() => void memoryRepo.setPinned(memory.id, !memory.pinned).then(reload)}
                    disabled={(memory.status ?? 'active') !== 'active' && !memory.pinned}
                    title={(memory.status ?? 'active') !== 'active' ? '已停用的旧记忆不能重新置顶；需要时请在聊天中重新告诉角色' : undefined}
                    className="mr-2 rounded-lg px-2 py-1 text-[10px] text-life-cyan disabled:cursor-not-allowed disabled:text-gray-500"
                  >
                    {(memory.status ?? 'active') !== 'active' ? (memory.pinned ? '清除重点' : '已停用') : memory.pinned ? '取消重点' : '设为必须记住'}
                  </button>
                  {confirmId === memory.id ? (
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-gray-500">这段记忆将被永久抹除</span>
                      <button onClick={() => setConfirmId(null)} className="rounded-lg px-2 py-1 text-[10px] text-gray-500">取消</button>
                      <button
                        onClick={() => void memoryRepo.deleteById(memory.id).then(() => { setConfirmId(null); return reload(); })}
                        className="rounded-lg bg-red-500/15 px-2 py-1 text-[10px] text-red-400"
                      >
                        删除
                      </button>
                    </div>
                  ) : (
                    <button onClick={() => setConfirmId(memory.id)} className="rounded-lg px-2 py-1 text-[10px] text-gray-500">删除这条记忆</button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </Modal>
  );
}
