/**
 * 世界时间线（5.0.0 Living World §46）
 *
 * 用户看到的是**一段生活史**：现实生活、世界事件、关系变化、共同经历、
 * 重要设定、时间跳跃混在一起按时间排列，**不显示任何数据库类型**。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {liveQuery} from 'dexie';
import {db} from '../../db';
import type { TimelineRecordDetail, TimelineRecordRef } from '../../lib/world/timeline-record';
import { useAuthStore } from '../../store/auth-store';
import { useChatStore } from '../../store/chat-store';
import { useUIStore } from '../../store/ui-store';
import { worldRepo } from '../../db/world-repo';
import { buildTimeline, groupByDay, type TimelineItem } from '../../lib/world/world-timeline';
import { Icon } from '../ui/Icon';
import { LoadingSkeleton } from '../ui/LoadingSkeleton';
import { OrbEmptyState } from '../ui/OrbEmptyState';
import { TimelineRecordDialog } from './TimelineRecordDialog';
import '../../styles/timeline-paper.css';

export function WorldTimelinePage() {
  const userId = useAuthStore((s) => s.userId);
  return <WorldTimelineContent key={userId ?? 'signed-out'} userId={userId} />;
}

function WorldTimelineContent({ userId }: { userId: string | null }) {
  const [items, setItems] = useState<TimelineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  const [worldId, setWorldId] = useState<string>();
  const [selected, setSelected] = useState<TimelineItem['record']>();
  const scrollRoot=useRef<HTMLDivElement>(null);
  const returnTo=useRef<{id:string;index:number;top:number}|undefined>(undefined);
  const closeRecord=useCallback(()=>{
    setSelected(undefined);
    requestAnimationFrame(()=>{
      const root=scrollRoot.current,saved=returnTo.current;
      if(!root||!saved||useAuthStore.getState().userId!==userId)return;
      root.scrollTop=saved.top;
      const rows=[...root.querySelectorAll<HTMLElement>('[data-timeline-id]')];
      const row=rows.find(item=>item.dataset.timelineId===saved.id)??rows[Math.min(saved.index,rows.length-1)];
      (row?.querySelector<HTMLButtonElement>('button')??root.querySelector<HTMLButtonElement>('.vg-timeline-header button'))?.focus({preventScroll:true});
    });
  },[userId]);
  const updateRecord = useCallback((ref: TimelineRecordRef, detail: TimelineRecordDetail | undefined) => {
    setItems(previous => previous.flatMap(item => item.record?.kind === ref.kind && item.record.id === ref.id
      ? detail ? [{ ...item, title: detail.title, detail: detail.body, timestamp: detail.recordedAt }] : [] : [item]));
  }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true); setItems([]); setError(false); setSelected(undefined); setWorldId(undefined);
    void (async () => {
      if (!userId) { setLoading(false); return; }
      await useChatStore.getState().loadCharacters();
      const list = useChatStore.getState().characters;
      const nameOf = (id: string) => list.find((c) => c.id === id)?.name ?? 'TA';
      const world = await worldRepo.ensureDefaultWorld(userId);
      const timeline = await buildTimeline({ userId, worldId: world.id, nameOf, limit: 120 });
      if (!alive) return;
      setWorldId(world.id);
      setItems(timeline);
      setLoading(false);
    })().catch(() => { if (alive) { setError(true); setLoading(false); } });
    return () => { alive = false; };
  }, [userId, revision]);

  useEffect(()=>{
    if(!userId||!worldId)return;
    let alive=true;
    const unavailable=()=>{if(alive&&useAuthStore.getState().userId===userId){setItems([]);setSelected(undefined);setError(true);}};
    // Observe the selected world's primary key only; do not rebuild every source
    // or scan source records when a cached timeline merely needs scope validation.
    const subscription=liveQuery(()=>db.worlds.get(worldId)).subscribe({next:world=>{if(world?.userId!==userId)unavailable();},error:unavailable});
    return()=>{alive=false;subscription.unsubscribe();};
  },[userId,worldId]);

  const groups = useMemo(() => groupByDay(items), [items]);

  return (
    <div ref={scrollRoot} className="vg-world-archive vg-timeline-page vg-light-paper h-full overflow-y-auto">
      <header className="vg-timeline-header">
        <button type="button" aria-label="返回星域" onClick={()=>useUIStore.getState().setActiveView('chat')}><Icon name="back" size={22}/></button>
        <h1>时间线</h1>
        <button type="button" aria-label="记忆馆" onClick={()=>useUIStore.getState().setActiveView('memory')}><Icon name="diary" size={22}/></button>
      </header>
      <p className="vg-timeline-intro">这个世界从开始到现在，发生过的事。</p>

      {loading ? (
        <LoadingSkeleton label="正在整理你们的时间线" rows={3} />
      ) : error ? (
        <section className="vg-world-archive-empty" role="alert"><OrbEmptyState title="时间线暂时没有读到" detail="请重新读取这台设备上的记录。" emotion="error" action="重新读取" onAction={() => setRevision(value => value + 1)} /></section>
      ) : items.length === 0 ? (
        <section className="vg-world-archive-empty">
          <OrbEmptyState title="世界的故事，等你翻开第一页" detail="一起经历的事、关系的变化与生活片段，会沿着时间留在这里。" emotion="curious" action="进入世界" onAction={() => useUIStore.getState().openCanvas(null)} />
        </section>
      ) : (
        groups.map((group) => (
          <section key={group.key}>
            <h2 className="vg-timeline-day">{group.label}</h2>
            {group.items.map((item) => (
              <article key={item.id} data-timeline-id={item.id} className={`vg-timeline-item${item.record?' vg-timeline-item-readable':''}`}>
                <p className="vg-timeline-kind">{item.label}{Number.isFinite(new Date(item.timestamp).getTime())&&<time dateTime={new Date(item.timestamp).toISOString()}>{new Date(item.timestamp).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})}</time>}</p>
                <h3 className="vg-timeline-title">{item.title}</h3>
                {item.detail && <p className="vg-timeline-detail">{item.detail}</p>}
                {item.names.length > 0 && <p className="vg-timeline-names">{item.names.join(' · ')}</p>}
                {item.record && <button type="button" className="vg-button vg-button-ghost mt-2" aria-haspopup="dialog" onClick={() => {const rows=[...scrollRoot.current!.querySelectorAll<HTMLElement>('[data-timeline-id]')];returnTo.current={id:item.id,index:rows.findIndex(row=>row.dataset.timelineId===item.id),top:scrollRoot.current?.scrollTop??0};setSelected(item.record);}}>查看记录<Icon name="chevron" size={16}/></button>}
              </article>
            ))}
          </section>
        ))
      )}
      {!loading&&!error&&items.length>0&&<p className="vg-timeline-note">这里展示当前资料中的最近记录，按发生时间整理。</p>}
      {selected && userId && worldId && <TimelineRecordDialog key={`${selected.kind}:${selected.id}`} userId={userId} worldId={worldId} record={selected} onRead={updateRecord} onClose={closeRecord} surface="light-paper"/>}
    </div>
  );
}
