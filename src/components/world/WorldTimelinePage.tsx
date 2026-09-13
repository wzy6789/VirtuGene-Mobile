/**
 * 世界时间线（5.0.0 Living World §46）
 *
 * 用户看到的是**一段生活史**：现实生活、世界事件、关系变化、共同经历、
 * 重要设定、时间跳跃混在一起按时间排列，**不显示任何数据库类型**。
 */
import { useEffect, useMemo, useState } from 'react';
import { useAuthStore } from '../../store/auth-store';
import { useChatStore } from '../../store/chat-store';
import { useUIStore } from '../../store/ui-store';
import { worldRepo } from '../../db/world-repo';
import { SpaceHeading } from '../ui/SpaceHeading';
import { buildTimeline, groupByDay, type TimelineItem } from '../../lib/world/world-timeline';

export function WorldTimelinePage() {
  const userId = useAuthStore((s) => s.userId);
  const characters = useChatStore((s) => s.characters);
  const [items, setItems] = useState<TimelineItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    void (async () => {
      if (!userId) { setLoading(false); return; }
      await useChatStore.getState().loadCharacters();
      const list = useChatStore.getState().characters;
      const nameOf = (id: string) => list.find((c) => c.id === id)?.name ?? 'TA';
      const world = await worldRepo.ensureDefaultWorld(userId);
      const timeline = await buildTimeline({ userId, worldId: world.id, nameOf, limit: 120 });
      if (!alive) return;
      setItems(timeline);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [userId]);

  const groups = useMemo(() => groupByDay(items), [items]);

  return (
    <div className="h-full overflow-y-auto px-4 pb-6">
      <div className="pt-5">
        <SpaceHeading
          eyebrow="living world"
          title="时间线"
          detail="这个世界从开始到现在，发生过的事。"
          action={(
            <button
              type="button"
              onClick={() => useUIStore.getState().setActiveView('memory')}
              className="text-[11px] text-gray-500"
            >
              记忆 ›
            </button>
          )}
        />
      </div>

      {loading ? (
        <p className="mt-10 text-center text-sm text-gray-500">正在整理你们的时间线…</p>
      ) : items.length === 0 ? (
        <section className="mt-5 rounded-[24px] border border-line bg-surface/50 px-5 py-7 text-center">
          <p className="text-sm text-ink">时间线还是空的。</p>
          <p className="mt-2 text-xs leading-6 text-gray-500">世界里发生过的事会自动出现在这里。</p>
          <button
            type="button"
            onClick={() => useUIStore.getState().openCanvas(null)}
            className="mt-5 w-full rounded-xl bg-gene-purple px-4 py-2.5 text-sm font-medium text-white"
          >
            进入世界
          </button>
        </section>
      ) : (
        groups.map((group) => (
          <section key={`${group.label}-${group.items[0]?.id ?? ''}`}>
            <p className="vg-timeline-day">{group.label}</p>
            {group.items.map((item) => (
              <div key={item.id} className="vg-timeline-item">
                <p className="vg-timeline-kind">{item.label}</p>
                <p className="vg-timeline-title">{item.title}</p>
                {item.detail && <p className="vg-timeline-detail">{item.detail}</p>}
                {item.names.length > 0 && <p className="vg-timeline-names">{item.names.join(' · ')}</p>}
              </div>
            ))}
          </section>
        ))
      )}
    </div>
  );
}
