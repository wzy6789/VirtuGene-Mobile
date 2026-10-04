import { useEffect, useMemo, useState } from 'react';
import { liveQuery } from 'dexie';
import { db, type TodoEvent } from '../../db';
import { todoRepo, localDateKey, type TodoWithOccurrence } from '../../db/todo-repo';
import { effectiveWork, scheduleDate, UNPLANNED_DATE, isOverdue } from '../../lib/action-cabin/query';
import { useActionDay } from '../../lib/action-cabin/useActionDay';
import { useAuthStore } from '../../store/auth-store';
import { useChatStore } from '../../store/chat-store';
import { useUIStore } from '../../store/ui-store';
import { SoulOrb } from '../ui/SoulOrb';
import { Modal } from '../ui/Modal';
import { TodoEditor } from './TodoEditor';

type Filter = 'today' | 'all' | 'overdue' | 'waiting' | 'followup' | 'expired' | 'completed';
const labels: Record<Filter, string> = { today: '今日截止', all: '全部行动', overdue: '已逾期', waiting: '等待别人', followup: '需要跟进', expired: '过期重点', completed: '今日完成' };
const workLabels = { todo: '待开始', doing: '进行中', waiting: '等待别人', blocked: '遇到阻塞' };

export function ActionCabinPage() {
  const userId = useAuthStore(s => s.userId);
  // Remount private local state when the account changes.
  return userId ? <Cabin key={userId} userId={userId} /> : null;
}
function Cabin({ userId }: { userId: string }) {
  const { data, error, retry } = useActionDay(userId);
  const characters = useChatStore(s => s.characters);
  const audience = useMemo(() => characters.filter(c => c.createdBy === userId && c.agentProfile !== 'secretary'), [characters, userId]);
  const [tab, setTab] = useState<'today' | 'inbox'>('today');
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
    if (row.occurrence.status === 'completed') {
      await todoRepo.reopen(userId, row.todo.id, date); setUndo(undefined); setMessage('已重新打开，原完成记录保留');
    } else {
      const receipt = await todoRepo.complete(userId, row.todo.id, date, row.occurrence.updatedAt);
      if (receipt) { setUndo({ label: '撤销完成', run: () => todoRepo.reopen(userId, row.todo.id, receipt.date, receipt) }); setMessage('已完成'); setReaction(v => v + 1); }
    }
    rebuild();
  });
  const focus = (row: TodoWithOccurrence, clear = false) => act(async () => {
    const receipt = await todoRepo.updateOccurrence(userId, row.todo.id, scheduleDate(row.occurrence), { focusDate: clear ? null : day }, row.occurrence.updatedAt);
    if (receipt) { setUndo({ label: '撤销重点调整', run: () => todoRepo.undoOccurrence(userId, receipt) }); setMessage(clear ? '已清除重点' : '已接续为今日重点'); }
  });
  useEffect(() => { setLimit(40); }, [filter, tab, query]);
  if (!data) return <section className="vg-cabin vg-cabin-loading"><button className="vg-cabin-back" onClick={() => useUIStore.getState().setActiveView('chat')}>‹ 返回</button><SoulOrb size={100} emotion={error ? 'error' : 'thinking'} /><p role={error ? 'alert' : 'status'}>{error ?? '正在读取你的行动…'}</p>{error && <button onClick={retry}>重新读取</button>}</section>;
  const unplanned = data.pending.filter(r => r.occurrence.dueDate === UNPLANNED_DATE);
  const sets: Record<Filter, TodoWithOccurrence[]> = { today: data.today, all: data.pending, overdue: data.overdue, waiting: data.waiting, followup: data.followup, expired: data.expiredFocus, completed: data.completed };
  const shown = (tab === 'inbox' ? unplanned : sets[filter]).filter(r => `${r.todo.title} ${r.todo.note ?? ''} ${effectiveWork(r).waitingFor ?? ''}`.toLowerCase().includes(query.trim().toLowerCase()));
  const rowCard = (row: TodoWithOccurrence, index?: number) => {
    const work = effectiveWork(row), done = row.occurrence.status === 'completed';
    const due = row.occurrence.dueDate;
    return <article className={`vg-cabin-task ${done ? 'is-done' : ''}`} key={row.occurrence.id} data-occurrence-id={row.occurrence.id}>
      <button type="button" className="vg-cabin-task-main" disabled={busy} onClick={() => void complete(row)} aria-label={`${done ? '重新打开' : '完成'}：${row.todo.title}`}>
        <span className="vg-cabin-check" aria-hidden="true">{done ? '✓' : index !== undefined ? `0${index + 1}` : ''}</span>
        <span><strong>{row.todo.title}</strong><small>{due === UNPLANNED_DATE ? '未排期' : due === day ? '今天' : due}{row.occurrence.dueTime ? ` ${row.occurrence.dueTime}` : ''}{!done && isOverdue(row, new Date(data.now)) ? ' · 已逾期' : ''}{row.todo.priority !== 'normal' ? ' · 高优先级' : ''}{row.todo.recurrence.kind !== 'none' ? ' · 重复任务' : ''}</small></span>
      </button>
      <div className="vg-cabin-task-meta"><span data-status={work.workStatus}>{done ? '已完成' : workLabels[work.workStatus ?? 'todo']}</span>{work.focusDate === day && <span>今日重点</span>}{work.focusDate && work.focusDate < day && <span>原重点 {work.focusDate}</span>}</div>
      {work.workStatus === 'waiting' && work.waitingFor && <p>等待 {work.waitingFor}{work.followupDate ? ` · ${work.followupDate} 跟进` : ''}</p>}{work.blockedReason && work.workStatus === 'blocked' && <p>阻塞：{work.blockedReason}</p>}
      <div className="vg-cabin-task-actions"><button disabled={busy} onClick={() => setEditor({ todo: row.todo, date: scheduleDate(row.occurrence) })}>编辑</button>{!done && (index === undefined || work.focusDate === day) && <button disabled={busy} onClick={() => void focus(row, work.focusDate === day)}>{work.focusDate === day ? '取消重点' : '设为今日重点'}</button>}{!done && work.workStatus === 'waiting' && <button disabled={busy} onClick={() => setFollowup(row)}>补记已跟进</button>}{work.focusDate && work.focusDate < day && <button disabled={busy} onClick={() => void focus(row, true)}>清除旧重点</button>}</div>
    </article>;
  };
  return <section className="vg-cabin" aria-label="行动舱">
    <header className="vg-cabin-header"><button className="vg-cabin-back" aria-label="返回" onClick={() => useUIStore.getState().setActiveView('chat')}>‹</button><div><span>YOUR DAILY ORBIT</span><h1>行动舱</h1></div><SoulOrb size={58} interactive emotion={failure ? 'error' : busy ? 'working' : data.pending.length ? 'idle' : 'success'} reaction={reaction} soulKey={`action-cabin:${userId}`} soulRole="cabin" /></header>
    <nav className="vg-cabin-tabs" aria-label="行动舱页面"><button aria-current={tab === 'today' ? 'page' : undefined} onClick={() => setTab('today')}>今日</button><button aria-current={tab === 'inbox' ? 'page' : undefined} onClick={() => setTab('inbox')}>收集箱{unplanned.length ? ` · ${unplanned.length}` : ''}</button></nav>
    <div className="vg-cabin-intro"><div><time>{new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(new Date(data.now))}</time><h2>{tab === 'today' ? '把注意力留给重要的事' : '先放下，再安排'}</h2><p>{tab === 'today' ? '真实日程，清晰下一步。' : '临时事项先记在这里；排上日期后进入今日行动。'}</p></div><button className="vg-cabin-primary" onClick={() => setEditor({ date: tab === 'inbox' ? UNPLANNED_DATE : day })}>＋ 记一件事</button></div>
    {tab === 'today' && <><div className="vg-cabin-stats">{[[data.today.length, '今日待完成', 'today'], [data.completed.length, '今日已完成', 'completed'], [data.overdue.length, '已逾期', 'overdue'], [data.followup.length, '需要跟进', 'followup']].map(([count, label, key]) => <button key={key} onClick={() => setFilter(key as Filter)}><strong>{count}</strong><span>{label}</span></button>)}</div><p className="vg-cabin-stat-note">今日及逾期共 {data.dueOrOverdue.length} 件 · 同一事项只计一次</p>
      <section className="vg-cabin-focus" aria-label="今日最重要的三件事"><div className="vg-cabin-section-title"><h2>今日先做这 {Math.min(3, data.focus.length)} 件事</h2><span>按优先级与截止时间排序</span></div>{data.focus.length ? data.focus.map((row, index) => rowCard(row, index)) : <div className="vg-cabin-empty"><SoulOrb size={100} emotion="success" /><strong>今天的行动都完成了</strong><p>留一点空白，给自己的生活。</p></div>}</section>
      <div className="vg-cabin-filters" aria-label="筛选行动">{(Object.keys(labels) as Filter[]).map(key => <button key={key} aria-pressed={filter === key} onClick={() => setFilter(key)}>{labels[key]} <span>{sets[key].length}</span></button>)}</div></>}
    <label className="vg-cabin-search"><span>⌕</span><input aria-label="搜索行动" placeholder="搜索事项、备注或等待的人" value={query} onChange={e => setQuery(e.target.value)} /></label>
    <section aria-label={tab === 'inbox' ? '未排期事项' : labels[filter]}><div className="vg-cabin-section-title"><h2>{tab === 'inbox' ? '未排期事项' : labels[filter]}</h2><span>{shown.length} 件</span></div>{shown.slice(0, limit).map(row => rowCard(row))}{shown.length > limit && <button className="vg-cabin-more" onClick={() => setLimit(v => v + 40)}>再显示 40 件（剩余 {shown.length - limit}）</button>}{!shown.length && <div className="vg-cabin-empty"><SoulOrb size={80} emotion={query ? 'curious' : 'happy'} /><strong>{query ? '没有匹配的事项' : tab === 'inbox' ? '收集箱清空了' : '这里暂时没有事项'}</strong><p>{query ? '试试其他关键词。' : tab === 'inbox' ? '突然想到的事，随时记下来。' : '切换筛选查看其他行动。'}</p></div>}</section>
    {failure && <div className="vg-cabin-notice is-error" role="alert"><span>{failure}</span><button onClick={() => { setFailure(''); retry(); rebuild(); }}>重试读取与提醒</button></div>}
    {(message || undo) && <div className="vg-cabin-notice" role="status"><span>{message}</span>{undo && <button disabled={busy} onClick={() => void act(async () => { await undo.run(); setUndo(undefined); setMessage('已撤销'); rebuild(); })}>{undo.label}</button>}<button aria-label="关闭操作提示" onClick={() => { setMessage(''); setUndo(undefined); }}>×</button></div>}
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
