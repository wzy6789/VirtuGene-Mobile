import { Modal } from '../ui/Modal';
import { useEffect, useState } from 'react';
import { useAuthStore } from '../../store/auth-store';
import { messageRepo } from '../../db/message-repo';
import { memoryRepo } from '../../db/memory-repo';
import { stateRepo } from '../../db/state-repo';
import { Icon, type IconName } from '../ui/Icon';
import { LoadingSkeleton } from '../ui/LoadingSkeleton';
import '../../styles/memory-archive.css';

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

function kindIcon(kind: TimelineItem['kind']): IconName {
  switch (kind) {
    case 'start':
      return 'spark';
    case 'milestone':
      return 'flag';
    case 'memory':
      return 'diary';
    case 'image':
      return 'image';
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
  return <StoryTimelineContent key={`${userId}:${characterId}`} open={open} onClose={onClose} characterId={characterId} characterName={characterName} userId={userId} />;
}

function StoryTimelineContent({ open, onClose, characterId, characterName, userId }: Parameters<typeof StoryTimeline>[0] & { userId: string }) {
  const [items, setItems] = useState<TimelineItem[] | null>(null);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  const [visibleCount, setVisibleCount] = useState(40);

  useEffect(() => {
    if (!open || !characterId) return;
    let alive = true;
    setItems(null);
    setError(false); setVisibleCount(40);
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
        if (alive) { setItems([]); setError(true); }
      }
    })();
    return () => {
      alive = false;
    };
  }, [open, characterId, userId, characterName, revision]);

  if (!open) return null;

  return (
    <Modal open onClose={onClose} title="我们的故事 · 共同时间线" canSnapshotOnExit={() => false}><div>
        <div className="vg-memory-archive px-4 py-4">
          {items === null ? (
            <LoadingSkeleton label="正在翻找你们的回忆" rows={3} />
          ) : error ? (
            <div className="vg-record-card" role="alert"><p className="text-base text-ink">回忆暂时没有读取到</p><p className="mt-2 text-sm leading-7 text-sub">可以再试一次，已有记录仍保存在本机。</p><button type="button" className="vg-button vg-button-secondary mt-3" onClick={() => setRevision(value => value + 1)}><Icon name="refresh" />重新读取</button></div>
          ) : items.length === 0 ? (
            <div className="vg-record-card text-center text-sm leading-7 text-sub py-10">
              还没有故事。去和「{characterName}」说说话，时间轴会从这里开始生长。
            </div>
          ) : (
            <div className="relative pl-6" role="list" aria-label="共同时间线">
              {/* 竖线 */}
              <div className="absolute left-[7px] top-1 bottom-1 w-px bg-gradient-to-b from-gene-purple/50 via-life-cyan/40 to-transparent" />
              {items.slice(0, visibleCount).map((it) => (
                <article key={it.id} className="relative mb-4" role="listitem">
                  <span
                    className="absolute -left-7 top-4 w-6 h-6 rounded-full flex items-center justify-center border border-line bg-panel text-[color:var(--vg-cyan)]"
                    aria-hidden="true"
                  >
                    <Icon name={kindIcon(it.kind)} size={14} />
                  </span>
                  <div className="vg-record-card">
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                      <time dateTime={new Date(it.time).toISOString()} className="text-xs text-sub tabular-nums">{fmtDate(it.time)}</time>
                      <span className="text-xs text-sub">
                        {it.kind === 'milestone' ? '等阶进阶' : it.kind === 'memory' ? '记忆碎片' : it.kind === 'image' ? '分享时刻' : '起点'}
                      </span>
                    </div>
                    {it.image ? (
                      <img src={it.image} alt={it.text} loading="lazy" className="max-h-40 rounded-xl object-cover mb-3 w-full" />
                    ) : null}
                    <p className="text-sm leading-7 text-ink">
                      {it.kind === 'milestone' ? (
                        <>
                          <span className="text-[color:var(--vg-accent)] font-medium">{it.text}</span>
                        </>
                      ) : (
                        it.text
                      )}
                    </p>
                  </div>
                </article>
              ))}
              {visibleCount < items.length && <button type="button" className="vg-button vg-button-secondary w-full" onClick={() => setVisibleCount(value => value + 40)}>继续看后面的故事 <span className="text-sub">还有{items.length - visibleCount}段</span></button>}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
