import { useEffect, useState } from 'react';
import { useAuthStore } from '../../store/auth-store';
import { messageRepo } from '../../db/message-repo';
import { memoryRepo } from '../../db/memory-repo';
import { stateRepo } from '../../db/state-repo';

interface TimelineItem {
  id: string;
  time: number;
  kind: 'start' | 'milestone' | 'memory' | 'image';
  text: string;
  image?: string;
}

function fmtDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

function kindIcon(kind: TimelineItem['kind']): string {
  switch (kind) {
    case 'start':
      return '🌱';
    case 'milestone':
      return '💠';
    case 'memory':
      return '✦';
    case 'image':
      return '📷';
  }
}

/**
 * 共同时间线 · 我们的故事：把相识、里程碑（等阶进阶）、记忆碎片、你分享的照片
 * 汇成一条时间轴——一眼看尽你们的关系是怎么一步步走到今天的。
 */
export function StoryTimeline({
  open,
  onClose,
  characterId,
  characterName,
}: {
  open: boolean;
  onClose: () => void;
  characterId: string | null;
  characterName: string;
}) {
  const userId = useAuthStore((s) => s.userId) ?? '';
  const [items, setItems] = useState<TimelineItem[] | null>(null);

  useEffect(() => {
    if (!open || !characterId) return;
    let alive = true;
    setItems(null);
    void (async () => {
      try {
        const list: TimelineItem[] = [];
        const st = await stateRepo.getOrCreate(characterId, userId);
        const memories = await memoryRepo.getByCharacter(characterId, userId);
        const sessions = await import('../../db/session-repo').then((m) => m.sessionRepo.getByCharacter(characterId, userId));
        const latest = sessions[0];
        if (latest) {
          const msgs = await messageRepo.getBySession(latest.id);
          const first = msgs[0];
          if (first) {
            list.push({ id: 'start', time: first.createdAt, kind: 'start', text: `与「${characterName}」相识` });
          }
          for (const m of msgs) {
            if (m.role === 'user' && m.image) {
              list.push({ id: `img-${m.id}`, time: m.createdAt, kind: 'image', text: m.content || '分享了一张照片', image: m.image });
            }
          }
        }
        for (const ms of st.milestones ?? []) {
          list.push({ id: `ms-${ms.reachedAt}`, time: ms.reachedAt, kind: 'milestone', text: `进阶为「${ms.level}」` });
        }
        for (const mem of memories) {
          list.push({ id: mem.id, time: mem.createdAt, kind: 'memory', text: mem.content });
        }
        list.sort((a, b) => a.time - b.time);
        if (alive) setItems(list);
      } catch {
        if (alive) setItems([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [open, characterId, userId, characterName]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[96] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-md glass-card rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]" onClick={(e) => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-line flex items-center justify-between shrink-0">
          <span className="text-sm font-medium text-ink">📖 我们的故事 · 共同时间线</span>
          <button onClick={onClose} className="text-gray-400 hover:text-ink text-lg leading-none">×</button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {items === null ? (
            <div className="flex items-center justify-center gap-2 text-xs text-gray-500 py-8">
              <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeDasharray="28" strokeDashoffset="20" />
              </svg>
              正在翻找你们的回忆…
            </div>
          ) : items.length === 0 ? (
            <div className="text-center text-xs text-gray-500 py-10">
              还没有故事。去和「{characterName}」说说话，时间轴会从这里开始生长。
            </div>
          ) : (
            <div className="relative pl-6">
              {/* 竖线 */}
              <div className="absolute left-[7px] top-1 bottom-1 w-px bg-gradient-to-b from-gene-purple/50 via-life-cyan/40 to-transparent" />
              {items.map((it) => (
                <div key={it.id} className="relative mb-4">
                  <span
                    className={`absolute -left-6 top-1 w-4 h-4 rounded-full flex items-center justify-center text-[9px] border ${
                      it.kind === 'milestone'
                        ? 'bg-gene-purple/20 border-gene-purple/50'
                        : it.kind === 'start'
                          ? 'bg-life-cyan/20 border-life-cyan/50'
                          : 'bg-panel border-line'
                    }`}
                  >
                    {kindIcon(it.kind)}
                  </span>
                  <div className="rounded-xl bg-panel/50 border border-line px-3 py-2">
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-[10px] text-gray-500 tabular-nums">{fmtDate(it.time)}</span>
                      <span className="text-[9px] text-gray-400">
                        {it.kind === 'milestone' ? '等阶进阶' : it.kind === 'memory' ? '记忆碎片' : it.kind === 'image' ? '分享时刻' : '起点'}
                      </span>
                    </div>
                    {it.image ? (
                      <img src={it.image} alt={it.text} className="max-h-40 rounded-lg object-cover mb-1.5 w-full" />
                    ) : null}
                    <p className={`text-xs leading-relaxed ${it.kind === 'memory' ? 'text-ink/90 italic' : 'text-ink'}`}>
                      {it.kind === 'milestone' ? (
                        <>
                          <span className="text-gene-purple font-medium">{it.text}</span>
                        </>
                      ) : (
                        it.text
                      )}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
