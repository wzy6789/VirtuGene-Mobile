import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { beginSoulHandoff, soulElement } from '../../lib/soul-handoff';
import { animateVisual } from '../../lib/ui-visual-motion';
import { liveQuery } from 'dexie';
import { db, type TodoEvent } from '../../db';
import { todoRepo, localDateKey, type TodoWithOccurrence } from '../../db/todo-repo';
import { effectiveWork, scheduleDate, UNPLANNED_DATE, isOverdue } from '../../lib/action-cabin/query';
import { useActionDay } from '../../lib/action-cabin/useActionDay';
import { useAuthStore } from '../../store/auth-store';
import { useChatStore } from '../../store/chat-store';
import { useUIStore } from '../../store/ui-store';
import { FeedbackNotice } from '../ui/FeedbackNotice';
import { Icon } from '../ui/Icon';
import { LoadingSkeleton } from '../ui/LoadingSkeleton';
import { OrbEmptyState } from '../ui/OrbEmptyState';
import { AnimatedValue } from '../ui/AnimatedValue';
import { resonate } from '../../lib/haptics';
import { SoulOrb } from '../ui/SoulOrb';
import { Modal } from '../ui/Modal';
import { TodoEditor } from './TodoEditor';

type Filter = 'today' | 'all' | 'overdue' | 'waiting' | 'followup' | 'expired' | 'completed';
const labels: Record<Filter, string> = { today: '今日截止', all: '全部行动', overdue: '已逾期', waiting: '等待别人', followup: '需要跟进', expired: '过期重点', completed: '今日完成' };
const workLabels = { todo: '待开始', doing: '进行中', waiting: '等待别人', blocked: '遇到阻塞' };

export interface ActionCabinPageProps {
  embedded?: boolean;
  page?: 'today' | 'inbox';
  onDiscuss?: (row: TodoWithOccurrence) => void;
  onAsk?: () => void;
  onActivity?: (state: { busy: boolean; failed: boolean; reaction: number }) => void;
}
export function ActionCabinPage(props: ActionCabinPageProps) {
  const userId = useAuthStore(s => s.userId);
  // Remount private local state when the account changes.
  return userId ? <Cabin key={userId} userId={userId} {...props} /> : null;
}
function Cabin({ userId, embedded = false, page, onDiscuss, onAsk, onActivity }: { userId: string } & ActionCabinPageProps) {
  const { data, error, retry } = useActionDay(userId);
  const rootRef = useRef<HTMLElement>(null);
  const recordFocus = useUIStore(s => s.lifeRecordFocus);
  const characters = useChatStore(s => s.characters);
  const audience = useMemo(() => characters.filter(c => c.createdBy === userId && c.agentProfile !== 'secretary'), [characters, userId]);
  const [localTab, setTab] = useState<'today' | 'inbox'>('today');
  const tab = page ?? localTab;
  const [filter, setFilter] = useState<Filter>('today');
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(40);
  const [editor, setEditor] = useState<{ todo?: TodoWithOccurrence['todo']; date: string }>();
  const [followup, setFollowup] = useState<TodoWithOccurrence>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [failure, setFailure] = useState('');
  const [undo, setUndo] = useState<{ label: string; run: () => Promise<void> }>();
  const [reaction, setReaction] = useState(0);
  const [completionEcho, setCompletionEcho] = useState<{rect:DOMRect;id:number}>();
  const completionEchoRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!completionEcho) return;
    const stop = animateVisual(completionEchoRef.current,[{opacity:0,transform:'scale(.7)'},{opacity:1,transform:'scale(1)',offset:.45},{opacity:0,transform:'scale(1.12)'}],320);
    const timer = setTimeout(() => setCompletionEcho(undefined),320);
    return () => { clearTimeout(timer); stop(); };
  },[completionEcho]);
  useEffect(() => { onActivity?.({ busy, failed: !!failure, reaction }); }, [busy, failure, reaction, onActivity]);
  const previousFocusCount = useRef<number | undefined>(undefined);
  useEffect(() => {
    const count = data?.focus.length;
    const before = previousFocusCount.current; previousFocusCount.current = count;
    if (count !== 0 || !before || tab !== 'today') return;
    const key = `action-cabin:${userId}`;
    return beginSoulHandoff(key, soulElement(key, 'cabin'), 'profile');
  },[data?.focus.length,tab,userId]);
  const day = data?.day ?? localDateKey();
  const assertOwner = () => { if (useAuthStore.getState().userId !== userId) throw new Error('账号已切换。'); };
  const act = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setFailure('');
    try { assertOwner(); await work(); }
    catch (e) { if (useAuthStore.getState().userId === userId) setFailure(e instanceof Error ? e.message : '操作失败，请重试。'); }
    finally { if (useAuthStore.getState().userId === userId) setBusy(false); }
  };
  const rebuild = () => { void todoRepo.rebuildReminders(userId).catch(() => { if (useAuthStore.getState().userId === userId) setFailure('事项已保存，系统提醒更新失败，请重试。'); }); };
  const complete = (row: TodoWithOccurrence) => act(async () => {
    const date = scheduleDate(row.occurrence);
    const source = [...(rootRef.current?.querySelectorAll<HTMLElement>('[data-occurrence-id]') ?? [])].find(node => node.dataset.occurrenceId === row.occurrence.id);
    const checkRect = source?.querySelector('.vg-cabin-check')?.getBoundingClientRect();
    const scroll = rootRef.current?.scrollTop;
    if (row.occurrence.status === 'completed') {
      await todoRepo.reopen(userId, row.todo.id, date); setUndo(undefined); setMessage('已重新打开，原完成记录保留');
    } else {
      const receipt = await todoRepo.complete(userId, row.todo.id, date, row.occurrence.updatedAt);
      if (receipt) { if (useAuthStore.getState().userId === userId) {
        resonate('success');
        if (checkRect && checkRect.top >= 0 && checkRect.bottom <= innerHeight && rootRef.current?.scrollTop === scroll) setCompletionEcho({rect:checkRect,id:Date.now()});
      } setUndo({ label: '撤销完成', run: () => todoRepo.reopen(userId, row.todo.id, receipt.date, receipt) }); setMessage('已完成'); setReaction(v => v + 1); }
    }
    rebuild();
  });
  const focus = (row: TodoWithOccurrence, clear = false) => act(async () => {
    const receipt = await todoRepo.updateOccurrence(userId, row.todo.id, scheduleDate(row.occurrence), { focusDate: clear ? null : day }, row.occurrence.updatedAt);
    if (receipt) { setUndo({ label: '撤销重点调整', run: () => todoRepo.undoOccurrence(userId, receipt) }); setMessage(clear ? '已清除重点' : '已接续为今日重点'); }
  });
  useEffect(() => { setLimit(40); }, [filter, tab, query]);
  useEffect(() => {
    if (!embedded || tab !== 'today' || !data || recordFocus?.userId !== userId || recordFocus.kind !== 'todo') return;
    const completed = data.completed.some(r => r.todo.id === recordFocus.id && (!recordFocus.date || scheduleDate(r.occurrence) === recordFocus.date));
    const targetFilter = completed ? 'completed' : 'all';
    const rows = completed ? data.completed : data.pending;
    const index = rows.findIndex(r => r.todo.id === recordFocus.id && (!recordFocus.date || scheduleDate(r.occurrence) === recordFocus.date));
    if (index < 0) { setMessage('这件事已不在当前列表中，请查看最新记录。'); useUIStore.setState({ lifeRecordFocus: null }); return; }
    if (filter !== targetFilter) { setFilter(targetFilter); return; }
    if (query) { setQuery(''); return; }
    if (limit <= index) { setLimit(Math.ceil((index + 1) / 40) * 40); return; }
    const target = rows[index].occurrence.id;
    const frame = requestAnimationFrame(() => {
      const card = [...(rootRef.current?.querySelectorAll<HTMLElement>('[data-occurrence-id]') ?? [])].find(el => el.dataset.occurrenceId === target);
      card?.scrollIntoView({ block: 'center', behavior: 'instant' });
      if (card) { card.tabIndex = -1; card.focus({ preventScroll: true }); }
      useUIStore.setState({ lifeRecordFocus: null });
    });
    return () => cancelAnimationFrame(frame);
  }, [data, recordFocus, userId, embedded, tab, filter, query, limit]);
  if (!data && !error) return <section className="vg-cabin"><LoadingSkeleton label="正在读取你的行动" stats /></section>;
  if (!data) return <section className="vg-cabin vg-cabin-loading"><button className="vg-cabin-back" onClick={() => useUIStore.getState().setActiveView('chat')}><Icon name="back" />返回</button><SoulOrb size={100} emotion={error ? 'error' : 'thinking'} /><p role={error ? 'alert' : 'status'}>{error ?? '正在读取你的行动…'}</p>{error && <button onClick={retry}>重新读取</button>}</section>;
  const unplanned = data.pending.filter(r => r.occurrence.dueDate === UNPLANNED_DATE);
  const sets: Record<Filter, TodoWithOccurrence[]> = { today: data.today, all: data.pending, overdue: data.overdue, waiting: data.waiting, followup: data.followup, expired: data.expiredFocus, completed: data.completed };
  const shown = (tab === 'inbox' ? unplanned : sets[filter]).filter(r => `${r.todo.title} ${r.todo.note ?? ''} ${effectiveWork(r).waitingFor ?? ''}`.toLowerCase().includes(query.trim().toLowerCase()));
  const rowCard = (row: TodoWithOccurrence, index?: number) => {
    const work = effectiveWork(row), done = row.occurrence.status === 'completed';
    const due = row.occurrence.dueDate;
    return <article className={`vg-cabin-task ${done ? 'is-done' : ''}`} key={row.occurrence.id} data-occurrence-id={row.occurrence.id} data-energy={!done && isOverdue(row, new Date(data.now)) ? 'overdue' : work.workStatus === 'waiting' ? 'waiting' : 'today'}>
      <button type="button" className="vg-cabin-task-main" disabled={busy} onClick={() => void complete(row)} aria-label={`${done ? '重新打开' : '完成'}：${row.todo.title}`}>
        <span className="vg-cabin-check" aria-hidden="true">{done ? <Icon name="check" size={20} /> : index !== undefined ? `0${index + 1}` : ''}</span>
        <span><strong>{row.todo.title}</strong><small>{due === UNPLANNED_DATE ? '未排期' : due === day ? '今天' : due}{row.occurrence.dueTime ? ` ${row.occurrence.dueTime}` : ''}{!done && isOverdue(row, new Date(data.now)) ? ' · 已逾期' : ''}{row.todo.priority !== 'normal' ? ' · 高优先级' : ''}{row.todo.recurrence.kind !== 'none' ? ' · 重复任务' : ''}</small></span>
      </button>
      <div className="vg-cabin-task-meta"><span data-status={work.workStatus}>{done ? '已完成' : workLabels[work.workStatus ?? 'todo']}</span>{work.focusDate === day && <span>{due === UNPLANNED_DATE ? '重点待排期' : '今日重点'}</span>}{work.focusDate && work.focusDate < day && <span>原重点 {work.focusDate}</span>}</div>
      {onDiscuss && <button type="button" className="vg-assistant-discuss" disabled={busy} onClick={() => onDiscuss(row)}>和助理聊这件事</button>}
      {work.workStatus === 'waiting' && work.waitingFor && <p>等待 {work.waitingFor}{work.followupDate ? ` · ${work.followupDate} 跟进` : ''}</p>}{work.blockedReason && work.workStatus === 'blocked' && <p>阻塞：{work.blockedReason}</p>}
      <div className="vg-cabin-task-actions"><button disabled={busy} onClick={() => setEditor({ todo: row.todo, date: scheduleDate(row.occurrence) })}>编辑</button>{!done && due !== UNPLANNED_DATE && (index === undefined || work.focusDate === day) && <button disabled={busy} onClick={() => void focus(row, work.focusDate === day)}>{work.focusDate === day ? '取消重点' : '设为今日重点'}</button>}{!done && work.workStatus === 'waiting' && <button disabled={busy} onClick={() => setFollowup(row)}>补记已跟进</button>}{work.focusDate && work.focusDate < day && <button disabled={busy} onClick={() => void focus(row, true)}>清除旧重点</button>}</div>
    </article>;
  };
  return <section ref={rootRef} className={`vg-cabin${embedded ? ' vg-cabin-embedded' : ''}`} aria-label={embedded ? tab === 'today' ? '今日安排' : '未安排事项' : '行动舱'}>
    {!embedded && <header className="vg-cabin-header"><button className="vg-cabin-back" aria-label="返回" onClick={() => useUIStore.getState().setActiveView('chat')}><Icon name="back" /></button><div><span>YOUR DAILY ORBIT</span><h1>行动舱</h1></div><SoulOrb size={58} interactive emotion={failure ? 'error' : busy ? 'working' : data.pending.length ? 'idle' : 'success'} reaction={reaction} soulKey={`action-cabin:${userId}`} soulRole="cabin" /></header>}
    {!embedded && <nav className="vg-cabin-tabs" aria-label="行动舱页面"><button aria-current={tab === 'today' ? 'page' : undefined} onClick={() => setTab('today')}>今日</button><button aria-current={tab === 'inbox' ? 'page' : undefined} onClick={() => setTab('inbox')}>收集箱{unplanned.length ? ` · ${unplanned.length}` : ''}</button></nav>}
    {onAsk && tab === 'today' && <button type="button" className="vg-assistant-ask" onClick={onAsk}>问助理 · 今天先做什么？ <Icon name="arrow" size={18} /></button>}
    <div className="vg-cabin-intro"><div><time>{new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(new Date(data.now))}</time><h2>{tab === 'today' ? '把注意力留给重要的事' : '先放下，再安排'}</h2><p>{tab === 'today' ? '真实日程，清晰下一步。' : '临时事项先记在这里；排上日期后进入今日行动。'}</p></div><button className="vg-cabin-primary" aria-label="＋ 记一件事" onClick={() => setEditor({ date: tab === 'inbox' ? UNPLANNED_DATE : day })}><Icon name="plus" size={17} />记一件事</button></div>
    {tab === 'today' && <><div className="vg-cabin-stats">{[[data.today.length, '今日待完成', 'today'], [data.completed.length, '今日已完成', 'completed'], [data.overdue.length, '已逾期', 'overdue'], [data.followup.length, '需要跟进', 'followup']].map(([count, label, key]) => <button key={key} onClick={() => setFilter(key as Filter)}><strong><AnimatedValue value={count as number} /></strong><span>{label}</span></button>)}</div><p className="vg-cabin-stat-note">今日及逾期共 {data.dueOrOverdue.length} 件 · 同一事项只计一次</p>
      <section className="vg-cabin-focus" aria-label="今日最重要的三件事"><div className="vg-cabin-section-title"><h2>{data.focus.length ? `今日先做这 ${data.focus.length} 件事` : '今日重点'}</h2><span>按优先级与截止时间排序</span></div>{data.focus.length ? data.focus.map((row, index) => rowCard(row, index)) : <OrbEmptyState soulKey={`action-cabin:${userId}`} soulRole="profile" title="今天暂无待做安排" detail={data.pending.some(row => row.occurrence.dueDate === UNPLANNED_DATE) ? '未排期事项仍在未安排中，确定日期后再加入日程。' : '留一点空白，给自己的生活。'} emotion={data.completed.length ? 'success' : 'idle'} action="记下一件事" onAction={() => setEditor({ date: day })} />}</section>
      <div className="vg-cabin-filters" aria-label="筛选行动">{(Object.keys(labels) as Filter[]).map(key => <button key={key} aria-pressed={filter === key} onClick={() => setFilter(key)}>{labels[key]} <span>{sets[key].length}</span></button>)}</div></>}
    <label className="vg-search-field vg-cabin-search"><Icon name="search" size={18} /><input aria-label="搜索行动" placeholder="搜索事项、备注或等待的人" value={query} onChange={e => setQuery(e.target.value)} /></label>
    <section aria-label={tab === 'inbox' ? '未排期事项' : labels[filter]}><div className="vg-cabin-section-title"><h2>{tab === 'inbox' ? '未排期事项' : labels[filter]}</h2><span>{shown.length} 件</span></div>{shown.slice(0, limit).map(row => rowCard(row))}{shown.length > limit && <button className="vg-cabin-more" onClick={() => setLimit(v => v + 40)}>再显示 40 件（剩余 {shown.length - limit}）</button>}{!shown.length && <OrbEmptyState title={query ? '没有匹配的事项' : tab === 'inbox' ? '收集箱清空了' : '这里暂时没有事项'} detail={query ? '试试其他关键词。' : tab === 'inbox' ? '突然想到的事，随时记下来。' : '切换筛选查看其他行动。'} emotion={query ? 'curious' : 'happy'} action={query ? '清除搜索' : '记下一件事'} onAction={() => query ? setQuery('') : setEditor({ date: tab === 'inbox' ? UNPLANNED_DATE : day })} />}</section>
    {completionEcho && createPortal(<span ref={completionEchoRef} className="vg-completion-echo" aria-hidden="true" style={{position:'fixed',left:completionEcho.rect.left,top:completionEcho.rect.top,width:completionEcho.rect.width,height:completionEcho.rect.height,zIndex:'var(--vg-z-toast)'}}><Icon name="check" size={20}/></span>,document.body)}
    {failure && <FeedbackNotice className="vg-cabin-notice" message={failure} tone="error"><button type="button" onClick={() => { setFailure(''); retry(); rebuild(); }}>重试</button></FeedbackNotice>}
    {(message || undo) && !failure && <FeedbackNotice className="vg-cabin-notice" message={message || '操作已完成'} tone="success">{undo && <button type="button" disabled={busy} onClick={() => void act(async () => { await undo.run(); setUndo(undefined); setMessage('已撤销'); rebuild(); })}>{undo.label}</button>}<button type="button" className="vg-feedback-dismiss" aria-label="关闭操作提示" onClick={() => { setMessage(''); setUndo(undefined); }}><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="m7 7 10 10M17 7 7 17" /></svg></button></FeedbackNotice>}
    {editor && <TodoEditor key={`${editor.todo?.id ?? 'new'}:${editor.date}`} userId={userId} {...editor} characters={audience} onClose={() => setEditor(undefined)} onSaved={text => { setEditor(undefined); setUndo(undefined); setMessage(text); }} />}
    {followup && <FollowupRecord userId={userId} row={followup} onClose={() => setFollowup(undefined)} onSaved={event => { setMessage('已记录真实跟进，未修改下次安排'); setUndo({ label: '撤销这条记录', run: () => todoRepo.voidEvent(userId, event.id) }); }} />}
  </section>;
}

function FollowupRecord({ userId, row, onClose, onSaved }: { userId: string; row: TodoWithOccurrence; onClose: () => void; onSaved: (event: TodoEvent) => void }) {
  const [date, setDate] = useState(localDateKey());
  const [method, setMethod] = useState<NonNullable<TodoEvent['method']>>('message');
  const [detail, setDetail] = useState(''); const [note, setNote] = useState('');
  const [error, setError] = useState(''); const [saving, setSaving] = useState(false);
  const [events, setEvents] = useState<TodoEvent[]>([]);
  useEffect(() => {
    let alive = true;
    const sub = liveQuery(() => db.todoEvents.where('[userId+occurrenceId]').equals([userId, row.occurrence.id]).toArray()).subscribe({ next: value => { if (alive && useAuthStore.getState().userId === userId) setEvents(value.filter(e => e.kind === 'followup-recorded' && !e.voidedAt && !e.deletedAt).sort((a, b) => b.recordedAt - a.recordedAt)); }, error: () => setError('跟进记录读取失败，请关闭后重试。') });
    return () => { alive = false; sub.unsubscribe(); };
  }, [userId, row.occurrence.id]);
  const names = { phone: '电话', message: '消息', email: '邮件', meeting: '会议', other: '其他' };
  return <Modal open title="补记已跟进" onClose={onClose} canSnapshotOnExit={() => useAuthStore.getState().userId === userId}><div className="vg-todo-sheet"><strong>{row.todo.title}</strong><label className="vg-todo-wide-field">实际发生日期<input type="date" min={localDateKey(new Date(row.todo.createdAt))} max={localDateKey()} value={date} onChange={e => setDate(e.target.value)} /></label><label className="vg-todo-wide-field">联系方式<select value={method} onChange={e => setMethod(e.target.value as typeof method)}>{Object.entries(names).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>{method === 'other' && <input aria-label="具体方式" placeholder="具体方式" maxLength={40} value={detail} onChange={e => setDetail(e.target.value)} />}<textarea aria-label="反馈与结果" placeholder="真实反馈与结果（必填）" maxLength={2000} value={note} onChange={e => setNote(e.target.value)} /><p className="text-xs text-sub">只保存你确认的实际联系，不代表软件代你发送消息。补记不会调整下次跟进时间。</p>{error && <p role="alert" className="text-red-400">{error}</p>}<button className="vg-todo-save" disabled={saving || !note.trim() || !date || method === 'other' && !detail.trim()} onClick={async () => { setSaving(true); setError(''); try { const event = await todoRepo.recordFollowup(userId, row.todo.id, scheduleDate(row.occurrence), { occurredDate: date, method, note, ...(method === 'other' ? { methodDetail: detail.trim() } : {}) }); if (useAuthStore.getState().userId === userId) { onSaved(event); onClose(); } } catch (e) { setError(e instanceof Error ? e.message : '记录失败，输入已保留'); } finally { setSaving(false); } }}>{saving ? '保存中…' : '确认记录'}</button>{events.length > 0 && <section aria-label="实际跟进记录"><h3>已确认的跟进</h3>{events.slice(0, 20).map(e => <p key={e.id}>{e.occurredDate} · {names[e.method!]} · 补记于 {localDateKey(new Date(e.recordedAt))}<br />{e.note}</p>)}</section>}</div></Modal>;
}
