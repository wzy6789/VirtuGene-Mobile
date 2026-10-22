import { useEffect, useState } from 'react';
import { liveQuery } from 'dexie';
import { Modal } from '../ui/Modal';
import { useAuthStore } from '../../store/auth-store';
import { readTimelineRecord, type TimelineRecordDetail, type TimelineRecordRef } from '../../lib/world/timeline-record';
import {useChatStore} from '../../store/chat-store';
import { Icon } from '../ui/Icon';
import '../../styles/record-paper.css';

export function TimelineRecordDialog({ userId, worldId, record, onClose, onRead, surface }: {
  userId: string; worldId: string; record: TimelineRecordRef; onClose(): void;
  onRead(record: TimelineRecordRef, detail: TimelineRecordDetail | undefined): void;
  /** Local reading sample; other consumers keep their existing presentation. */
  surface?: 'light-paper';
}) {
  const owner = useAuthStore(s => s.userId);
  const characters=useChatStore(s=>s.characters);
  const nameOf=(id:string)=>characters.find(c=>c.id===id&&c.createdBy===userId)?.name??'已移除的角色';
  const identity = JSON.stringify([userId, worldId, record.kind, record.id, record.revision]);
  const [result, setState] = useState<{ identity: string; loading: boolean; error?: boolean; detail?: TimelineRecordDetail }>({ identity, loading: true });
  const state = result.identity === identity ? result : { loading: true, detail: undefined, error: false };
  const [retry, setRetry] = useState(0);
  const [originLimit, setOriginLimit] = useState(8);
  useEffect(() => {
    let alive = true;
    setState(previous => previous.identity === identity && previous.detail ? previous : { identity, loading: true });
    const current = () => alive && useAuthStore.getState().userId === userId;
    const subscription = liveQuery(() => readTimelineRecord(userId, worldId, record, current, originLimit)).subscribe({
      next: detail => { if (current()) { setState({ identity, loading: false, detail }); onRead(record, detail); } },
      error: () => { if (current()) setState({ identity, loading: false, error: true }); },
    });
    return () => { alive = false; subscription.unsubscribe(); };
  }, [userId, worldId, record.kind, record.id, record.revision, retry, onRead, originLimit, identity]);
  if (owner !== userId) return null;
  const detail = state.detail;
  const date = detail && new Date(detail.recordedAt);
  const paper = surface === 'light-paper';
  const metadata = detail && <dl className="vg-record-metadata border-t border-default pt-4 space-y-3 text-sm">
    <div><dt className="text-sub">记录时间</dt><dd>{date && Number.isFinite(date.getTime()) ? <time dateTime={date.toISOString()}>{date.toLocaleString('zh-CN')}</time> : '时间未记录'}</dd></div>
    <div><dt className="text-sub">可见范围</dt><dd>{detail.scope}</dd></div>
    {detail.participants && <div><dt className="text-sub">一起经历</dt><dd>{detail.participants.flatMap(ref=>ref==='u:'+userId?['你']:ref.startsWith('c:')?[nameOf(ref.slice(2))]:[]).join(' · ')||'未记录参与者'}</dd></div>}
    {detail.visibleTo && <div><dt className="text-sub">允许知情的角色</dt><dd>{detail.visibleTo.map(nameOf).join(' · ')||'暂无指定角色'}</dd></div>}
    {detail.sourceLabel && <div><dt className="text-sub">记录来源</dt><dd>{detail.sourceLabel}</dd></div>}
  </dl>;
  return <Modal open onClose={onClose} title="记录详情" presentation={paper ? 'page' : 'dialog'} mobileFullHeight={paper} panelClassName={paper ? 'vg-light-paper vg-record-paper' : undefined} canSnapshotOnExit={() => false}>
    <div className="vg-record-paper-body p-5 space-y-4 text-ink">
      {state.loading ? <p role="status" className="text-sm text-sub">正在读取当前记录…</p> : state.error ?
        <div role="alert"><p>记录暂时没有读到</p><button type="button" className="vg-button vg-button-secondary mt-3" onClick={() => setRetry(n => n + 1)}>重新读取</button></div> : !detail ?
        <p role="status" className="text-sm leading-7 text-sub">这条记录已不可用，可能已删除、移出当前世界或调整为私密。旧内容不再展示。</p> : <>
          <h3 className="vg-record-title text-xl font-semibold break-words">{detail.title}</h3>
          {detail.changed && <p role="status" className="text-sm text-sub">记录已更新，下面展示当前保存的内容。</p>}
          {paper && metadata}
          {detail.body && <p className="vg-record-prose text-base leading-8 whitespace-pre-wrap break-words">{detail.body}</p>}
          {!paper && metadata}
          {detail.origin && <details className="border-t border-default pt-3">
            <summary className="vg-button vg-button-ghost"><Icon name="eye"/>来源原文（当前）</summary>
            <div className="mt-3 space-y-3">
              {detail.origin.status === 'unsupported' ? <p className="text-sm leading-7 text-sub">这条旧记录没有可核对的原文链接，不根据相似内容猜测来源。</p> : detail.origin.status === 'unavailable' ?
                <p role="status" className="text-sm leading-7 text-sub">原始来源已不可用，可能已删除、撤回或移出当前范围。上方仅保留当前保存的摘要。</p> : <>
                  <p className="text-xs leading-6 text-sub">以下是当前保存的来源片段，不是收藏时的历史快照。</p>
                  {detail.origin.passages.map(p => <div key={p.id} className="border-l-2 border-life-cyan/40 pl-3">
                    {p.kind && <p className="text-xs text-sub">{p.kind === 'user' || p.kind === 'user_input' ? '你' : p.speakerId ? nameOf(p.speakerId) : p.kind === 'assistant' ? '角色原话' : '场景记录'}</p>}
                    <p className="text-base leading-8 whitespace-pre-wrap break-words">{p.body || '这条来源没有文字内容。'}</p>
                  </div>)}
                  {!detail.origin.passages.length && <p className="text-sm text-sub">当前没有可展示的正文片段。</p>}
                  {detail.origin.hasMore && <button type="button" className="vg-button vg-button-secondary" onClick={() => setOriginLimit(n => n + 8)}>加载更早的片段</button>}
                </>}
            </div>
          </details>}
          <p className="text-xs leading-6 text-sub">这是当前保存的记录；不代表记录当时的原始对话或剧情原文。</p>
        </>}
    </div>
  </Modal>;
}
