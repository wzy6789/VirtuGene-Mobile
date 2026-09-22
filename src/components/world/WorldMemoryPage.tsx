/**
 * 我们经历过的事（5.0.0 Living World §45 / §43）
 *
 * 用户 UI 里**不出现 "SharedMemory"**这种内部词汇——这里叫「我们经历过的事」。
 * 每条记忆是一段有情绪重量的片段，参与者写清楚（古月娜 · 星遥 · 你）。
 *
 * 数据纪律（沿用已验收的三道闸门，不新增任何口径）：
 * - 只读 `sharedMemories`（用户显式收藏 + 世界结算写入 + 写入世界记录）
 * - 参与者是"谁经历了"，可见性是"谁被允许知道"，两者**不是一回事**，
 *   因此这里展示参与者，不展示可见性名单（避免让用户以为记忆是"分权限"的）
 */
import { useEffect, useMemo, useState } from 'react';
import { useAuthStore } from '../../store/auth-store';
import { useChatStore } from '../../store/chat-store';
import { useUIStore } from '../../store/ui-store';
import { worldRepo } from '../../db/world-repo';
import { sharedMemoryRepo } from '../../db/shared-memory-repo';
import type { SharedMemory } from '../../db/index';
import { SpaceHeading } from '../ui/SpaceHeading';
import { relativeDay } from '../../lib/world/world-picks';

export function WorldMemoryPage() {
  const userId = useAuthStore((s) => s.userId);
  const characters = useChatStore((s) => s.characters);
  const [items, setItems] = useState<SharedMemory[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      if (!userId) { setLoading(false); return; }
      const world = await worldRepo.ensureDefaultWorld(userId);
      const list = await sharedMemoryRepo.listByWorld(world.id, 200, userId);
      if (!alive) return;
      setItems(list);
      setLoading(false);
    })();
    if (characters.length === 0) void useChatStore.getState().loadCharacters();
    return () => { alive = false; };
  }, [userId, characters.length]);

  const nameOf = useMemo(() => {
    const map = new Map(characters.map((c) => [c.id, c.name]));
    return (id: string) => map.get(id) ?? 'TA';
  }, [characters]);

  /** 参与者写成人话：古月娜 · 星遥 · 你 */
  const participantsLine = (memory: SharedMemory): string => {
    const names = memory.characterIds.map(nameOf);
    return [...names, '你'].join(' · ');
  };

  return (
    <div className="h-full overflow-y-auto px-4 pb-6">
      <div className="pt-5">
        <SpaceHeading
          eyebrow="living world"
          title="我们经历过的事"
          detail="这些都是你们真正一起经历过的片段。"
          action={(
            <button
              type="button"
              onClick={() => useUIStore.getState().setActiveView('worldSettings')}
              className="text-[11px] text-gray-500"
            >
              设定 ›
            </button>
          )}
        />
      </div>

      {loading ? (
        <p className="mt-10 text-center text-sm text-gray-500">正在读取…</p>
      ) : items.length === 0 ? (
        <section className="mt-5 rounded-[24px] border border-line bg-surface/50 px-5 py-7 text-center">
          <p className="text-sm text-ink">你们还没有真正经历足够多的事情。</p>
          <p className="mt-2 text-xs leading-6 text-gray-500">
            在世界里一起过的日子、在聊天里长按收藏的那些话，都会留在这里。
          </p>
          <button
            type="button"
            onClick={() => useUIStore.getState().openCanvas(null)}
            className="mt-5 w-full rounded-xl bg-gene-purple px-4 py-2.5 text-sm font-medium text-white"
          >
            进入世界
          </button>
        </section>
      ) : (
        <ul className="mt-3 space-y-2">
          {items.map((memory) => (
            <li key={memory.id} className="rounded-2xl border border-line bg-surface/60 px-3.5 py-3.5">
              <button
                type="button"
                className="w-full text-left"
                onClick={() => setOpenId(openId === memory.id ? null : memory.id)}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="rounded-full bg-life-cyan/12 px-2 py-0.5 text-[10px] text-life-cyan">
                    {memory.tags.find((t) => t.includes('共同') || t.includes('经历')) ?? '一起经历'}
                  </span>
                  <time className="shrink-0 text-[10px] text-gray-500">{relativeDay(memory.createdAt)}</time>
                </div>
                <p className="mt-1.5 text-[13.5px] font-medium text-ink">{memory.title}</p>
                {(openId === memory.id || memory.summary) && (
                  <p className="mt-1 text-[11.5px] leading-relaxed text-gray-500">
                    {memory.summary || '没有更多细节，但你们都在场。'}
                  </p>
                )}
                <p className="mt-1.5 text-[10px] text-gray-500">{participantsLine(memory)}</p>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* 旧入口的**回看**能力仍保留，但不再作为世界首页的一级入口。 */}
      {!loading && (
        <button
          type="button"
          onClick={() => useUIStore.getState().setActiveView('stage')}
          className="mt-5 w-full rounded-xl border border-line px-4 py-2.5 text-[11px] text-sub"
        >
          回看已经发生的世界 ›
        </button>
      )}
    </div>
  );
}
