import { useFeedback } from '../../lib/feedback';
import { TodoEditor } from './TodoEditor';
import { readTodoInstances, UNPLANNED_DATE, scheduleDate } from '../../lib/action-cabin/query';
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { db, type Todo, type TodoPriority } from '../../db';
import { todoRepo, addLocalDays, dateLabel, localDateKey, type TodoWithOccurrence } from '../../db/todo-repo';
import { useAuthStore } from '../../store/auth-store';
import { useChatStore } from '../../store/chat-store';
import { useUIStore } from '../../store/ui-store';
import { Icon } from '../ui/Icon';
import { LoadingSkeleton } from '../ui/LoadingSkeleton';
import { FeedbackNotice } from '../ui/FeedbackNotice';

type ViewMode = 'schedule' | 'calendar' | 'overview';
const RANGE_START = addLocalDays(localDateKey(), -30);
const RANGE_END = addLocalDays(localDateKey(), 365);
const OVERVIEW_START = addLocalDays(localDateKey(), -365);
const OVERVIEW_END = addLocalDays(localDateKey(), 365);

function formatWeekday(date: string) {
  const [y, m, d] = date.split('-').map(Number);
  return new Intl.DateTimeFormat('zh-CN', { weekday: 'short' }).format(new Date(y, m - 1, d));
}
function monthTitle(cursor: string) {
  const [y, m] = cursor.split('-').map(Number);
  return `${y}年${m}月`;
}
function priorityLabel(priority: TodoPriority) { return priority === 'urgent' ? '重要' : priority === 'important' ? '重点' : ''; }

export function TodoPage() {
  const owner=useAuthStore(s=>s.userId);
  return owner?<TodoPageForUser key={owner}/>:null;
}
function TodoPageForUser() {
  const userId = useAuthStore((s) => s.userId);
  const allCharacters = useChatStore((s) => s.characters);
  const characters = useMemo(() => allCharacters.filter(c => c.agentProfile !== 'secretary'), [allCharacters]);
  const [view, setView] = useState<ViewMode>('schedule');
  const [range, setRange] = useState<'today' | 'week' | 'all' | 'overdue'>('today');
  const [rows, setRows] = useState<TodoWithOccurrence[]>([]);
  const [overviewRows, setOverviewRows] = useState<TodoWithOccurrence[]>([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');
  const readEpoch = useRef(0);
  const alive = useRef(false);
  const currentRange = useRef(range);
  currentRange.current = range;
  useEffect(() => { alive.current = true; return () => { alive.current = false; readEpoch.current++; }; }, []);
  const [selectedDate, setSelectedDate] = useState(localDateKey());
  const [monthCursor, setMonthCursor] = useState(localDateKey().slice(0, 7) + '-01');
  const [editor, setEditor] = useState<{ todo?: Todo; date?: string } | null>(null);
  const [query, setQuery] = useState('');
  const setToast = useFeedback();
  const overviewRef = useRef<HTMLDivElement>(null);
  const lifeRecordFocus = useUIStore(s => s.lifeRecordFocus);
  useEffect(() => {
    if (lifeRecordFocus?.kind !== 'todo') return;
    let alive = true;
    if (lifeRecordFocus.userId === userId && userId) {
      void todoRepo.get(userId, lifeRecordFocus.id).then(todo => {
        if (!alive || useAuthStore.getState().userId !== userId) return;
        if (todo) setEditor({ todo, date: lifeRecordFocus.date ?? todo.dueDate });
        if (useUIStore.getState().lifeRecordFocus === lifeRecordFocus) useUIStore.setState({ lifeRecordFocus: null });
      }).catch(() => {
        if (alive && useUIStore.getState().lifeRecordFocus === lifeRecordFocus) useUIStore.setState({ lifeRecordFocus: null });
      });
    } else {
      useUIStore.setState({ lifeRecordFocus: null });
    }
    return () => { alive = false; };
  }, [lifeRecordFocus, userId]);

  const load = useCallback(async () => {
    if (!userId || !alive.current) return;
    const requestedRange = currentRange.current;
    const epoch = ++readEpoch.current;
    const isCurrent = () => alive.current && readEpoch.current === epoch && currentRange.current === requestedRange && useAuthStore.getState().userId === userId;
    setLoading(true); setLoadError('');
    try {
      const to = requestedRange === 'today' || requestedRange === 'overdue' ? localDateKey() : requestedRange === 'week' ? addLocalDays(localDateKey(), 7) : RANGE_END;
      const allRows=await readTodoInstances(userId,OVERVIEW_END);
      if (!isCurrent()) return;
      const from=requestedRange==='all'||requestedRange==='overdue'?RANGE_START:localDateKey();
      const nextRows=allRows.filter(({occurrence:o})=>o.dueDate===UNPLANNED_DATE||o.dueDate>=from&&o.dueDate<=to);
      const nextOverview=allRows.filter(({occurrence:o})=>o.dueDate===UNPLANNED_DATE||o.dueDate>=OVERVIEW_START&&o.dueDate<=OVERVIEW_END);
      setRows(nextRows.filter(({ occurrence }) => requestedRange !== 'overdue' || occurrence.dueDate < localDateKey()));
      setOverviewRows(nextOverview); setLoaded(true);
      void todoRepo.rebuildReminders(userId).catch(()=>{if(isCurrent())setToast('事项已读取，提醒更新失败，请稍后重试。', { tone: 'error' });});
    } catch {
      if (isCurrent()) setLoadError('待办读取失败，请重试。');
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [range, userId]);
  useEffect(() => {
    const reload=()=>{void load();};
    reload();
    const refresh = (event: Event) => { if ((event as CustomEvent).detail?.userId === userId) reload(); };
    window.addEventListener('virtugene:todos-updated', refresh);
    return () => { readEpoch.current++; window.removeEventListener('virtugene:todos-updated', refresh); };
  }, [load, userId]);
  useEffect(() => {
    if (!overviewRows.length) return;
    // 概览默认把最新的有日期事项放在底部并让它成为视觉焦点。
    const frame = window.requestAnimationFrame(() => {
      if (overviewRef.current) overviewRef.current.scrollTop = overviewRef.current.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [overviewRows.length, view]);

  const filteredRows = useMemo(() => rows.filter(({ todo }) => !query.trim() || `${todo.title} ${todo.note ?? ''}`.toLowerCase().includes(query.trim().toLowerCase())), [query, rows]);
  const todayRows = filteredRows.filter(({ occurrence }) => occurrence.dueDate === selectedDate);
  const grouped = useMemo(() => {
    const map = new Map<string, TodoWithOccurrence[]>();
    for (const row of filteredRows) {
      if(row.occurrence.dueDate==='9999-12-31')continue;
      const key = row.occurrence.dueDate;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(row);
    }
    return [...map.entries()];
  }, [filteredRows]);
  const openEditor = (date = selectedDate) => setEditor({ date });
  const closeEditor = () => setEditor(null);
  const finish = async (todo: Todo, date: string, checked: boolean) => {
    if (!userId) return;
    try{if (checked) await todoRepo.complete(userId,todo.id,date);else await todoRepo.reopen(userId,todo.id,date);await load();}catch(e){setToast(e instanceof Error?e.message:'操作失败，请重试', { tone: 'error' });}
  };

  return (
    <section className="vg-todo-page h-full overflow-y-auto px-4 pb-24" aria-label="待办">
      <header className="vg-todo-header">
        <button type="button" className="vg-todo-back" onClick={() => useUIStore.getState().setActiveView('chat')} aria-label="返回世界"><Icon name="back" size={22} /></button>
        <div><h1>待办</h1></div>
        <button type="button" className="vg-todo-add" onClick={() => openEditor()} aria-label="新建待办"><Icon name="plus" size={22} /></button>
      </header>
      <section className="vg-todo-overview">
        <div><span>今天</span><strong>{loaded ? overviewRows.filter(({ occurrence }) => occurrence.dueDate === localDateKey() && occurrence.status === 'todo').length : '—'}</strong><small>件待完成</small></div>
        <p>把想做的事放在时间里，世界会替你记得。</p>
      </section>
      <div className="vg-todo-toolbar">
        <div className="vg-todo-segment" role="group" aria-label="待办视图"><button aria-pressed={view === 'schedule'} className={view === 'schedule' ? 'active' : ''} onClick={() => setView('schedule')}>日程表</button><button aria-pressed={view === 'calendar'} className={view === 'calendar' ? 'active' : ''} onClick={() => setView('calendar')}>月历</button><button aria-pressed={view === 'overview'} className={view === 'overview' ? 'active' : ''} onClick={() => setView('overview')}>全部</button></div>
        <button className="vg-todo-search" aria-label={query ? '关闭待办搜索' : '搜索待办'} aria-expanded={query !== ''} onClick={() => setQuery(query ? '' : ' ')}><Icon name={query ? 'close' : 'search'} size={20} /></button>
      </div>
      {query !== '' && <input aria-label="搜索待办" autoFocus className="vg-text-field vg-todo-search-input" value={query.trimStart()} onChange={(e) => setQuery(e.target.value)} placeholder="搜索待办、备注或标签" />}
      {loadError && <FeedbackNotice message={loadError} tone="error"><button type="button" className="vg-button vg-button-secondary" aria-label="重新读取待办" onClick={() => void load()}>重新读取</button></FeedbackNotice>}
      {loading && loaded && <p role="status" className="text-sm text-sub">正在更新待办…</p>}
      {!loaded ? loading ? <LoadingSkeleton label="正在读取待办" rows={3} /> : null : view === 'schedule' ? (
        <>
          <div className="vg-todo-filters" role="group" aria-label="日程范围">{(['today', 'week', 'all', 'overdue'] as const).map((key) => <button key={key} aria-pressed={range === key} className={range === key ? 'active' : ''} onClick={() => setRange(key)}>{key === 'today' ? '今天' : key === 'week' ? '本周' : key === 'overdue' ? '已逾期' : '全部'}</button>)}</div>
          {grouped.length === 0 ? <EmptyState onCreate={() => openEditor()} title={query.trim() ? '没有找到相关事项' : range === 'overdue' ? '没有逾期事项' : range === 'today' ? '今天还没有安排' : '这里还没有安排'} /> : grouped.map(([date, items]) => <div className="vg-todo-day" key={date}><div className="vg-todo-day-title"><strong>{dateLabel(date)}</strong><span>{formatWeekday(date)} · {date}</span><button aria-label={`为${dateLabel(date)}新建待办`} onClick={() => openEditor(date)}><Icon name="plus" size={20} /></button></div>{items.map(({ todo, occurrence }) => <TodoRow key={occurrence.id} todo={todo} occurrence={occurrence} onToggle={(checked) => void finish(todo, scheduleDate(occurrence), checked)} onEdit={() => setEditor({ todo, date: scheduleDate(occurrence) })} />)}</div>)}
          {filteredRows.some(({ occurrence }) => occurrence.dueDate === '9999-12-31') && <div className="vg-todo-unplanned"><strong>未安排日期</strong><span>有想法，也可以先放在这里</span>{filteredRows.filter(({ occurrence }) => occurrence.dueDate === '9999-12-31').map(({ todo, occurrence }) => <TodoRow key={occurrence.id} todo={todo} occurrence={occurrence} onToggle={(checked) => void finish(todo, '9999-12-31', checked)} onEdit={() => setEditor({ todo })} />)}</div>}
        </>
      ) : view === 'calendar' ? <CalendarView cursor={monthCursor} selected={selectedDate} rows={filteredRows} onCursor={setMonthCursor} onSelect={(date) => { setSelectedDate(date); setView('schedule'); setRange('all'); }} /> : <TodoOverview rows={overviewRows} scrollRef={overviewRef} onEdit={(todo, date) => setEditor({ todo, date })} />}
      {editor && userId && <TodoEditor userId={userId} todo={editor.todo} date={editor.date ?? selectedDate} characters={characters} onClose={closeEditor} onSaved={(message) => { closeEditor(); setToast(message, { tone: 'success' }); void load(); }} />}
    </section>
  );
}

function TodoOverview({ rows, scrollRef, onEdit }: { rows: TodoWithOccurrence[]; scrollRef: RefObject<HTMLDivElement | null>; onEdit: (todo: Todo, date: string) => void }) {
  const ordered = useMemo(() => [...rows].sort((a, b) => {
    const dateA = a.occurrence.dueDate === '9999-12-31' ? '' : a.occurrence.dueDate;
    const dateB = b.occurrence.dueDate === '9999-12-31' ? '' : b.occurrence.dueDate;
    return dateA.localeCompare(dateB)
      || (a.occurrence.dueTime ?? '23:59').localeCompare(b.occurrence.dueTime ?? '23:59')
      || a.todo.title.localeCompare(b.todo.title, 'zh-CN');
  }), [rows]);
  return <section className="vg-todo-overview-list" aria-label="全部待办概览">
    <div className="vg-todo-overview-list-head"><div><strong>全部待办</strong></div><small>{ordered.length} 件</small></div>
    {ordered.length === 0 ? <p className="vg-todo-overview-empty">还没有可概览的事项</p> : <div className="vg-todo-overview-scroll" ref={scrollRef} tabIndex={0}>
      {ordered.map(({ todo, occurrence }) => {
        const unplanned = occurrence.dueDate === '9999-12-31';
        const time = unplanned ? '待定' : `${dateLabel(occurrence.dueDate)}${occurrence.dueTime ? ` ${occurrence.dueTime}` : ''}`;
        return <button type="button" className={`vg-todo-overview-item ${occurrence.status === 'completed' ? 'is-done' : ''}`} key={occurrence.id} onClick={() => onEdit(todo, scheduleDate(occurrence))}>
          <time>{time}</time><span><b>{todo.title}</b>{todo.note && <small>{todo.note}</small>}</span>
        </button>;
      })}
    </div>}
  </section>;
}

function TodoRow({ todo, occurrence, onToggle, onEdit }: { todo: Todo; occurrence: TodoWithOccurrence['occurrence']; onToggle: (checked: boolean) => void; onEdit: () => void }) {
  const done = occurrence.status === 'completed';
  const state = occurrence.workStatus ?? todo.workStatus ?? 'todo';
  const tone = done ? 'done' : state === 'waiting' ? 'waiting' : state === 'blocked' || occurrence.dueDate < localDateKey() ? 'overdue' : 'default';
  const statusLabel = done ? '已完成' : state === 'waiting' ? '等待别人' : state === 'blocked' ? '遇到阻塞' : occurrence.dueDate < localDateKey() ? '已逾期' : state === 'doing' ? '进行中' : '待开始';
  return <article className={`vg-todo-row ${done ? 'is-done' : ''}`} data-tone={tone}><button className="vg-todo-check" onClick={() => onToggle(!done)} aria-pressed={done} aria-label={done ? '标记未完成' : '标记完成'}><span>{done && <Icon name="check" size={16} />}</span></button><button className="vg-todo-row-main" onClick={onEdit}><strong>{todo.title}</strong><span>{statusLabel} · {occurrence.dueTime ? occurrence.dueTime : occurrence.dueDate === UNPLANNED_DATE ? '未排期' : '全天'}{priorityLabel(todo.priority) && ` · ${priorityLabel(todo.priority)}`}{todo.note ? ` · ${todo.note}` : ''}</span></button>{todo.recurrence.kind !== 'none' && <em aria-label="重复事项"><Icon name="refresh" size={16} /></em>}</article>;
}

function EmptyState({ onCreate, title }: { onCreate: () => void; title: string }) { return <div className="vg-todo-empty"><span><Icon name="calendar" size={36} /></span><strong>{title}</strong><p>给未来的自己留一件小事。</p><button onClick={onCreate}>写下第一件事</button></div>; }

function CalendarView({ cursor, selected, rows, onCursor, onSelect }: { cursor: string; selected: string; rows: TodoWithOccurrence[]; onCursor: (v: string) => void; onSelect: (v: string) => void }) {
  const [year, month] = cursor.split('-').map(Number);
  const first = new Date(year, month - 1, 1).getDay();
  const days = new Date(year, month, 0).getDate();
  const cells = Array.from({ length: first + days }, (_, i) => i < first ? null : `${year}-${String(month).padStart(2, '0')}-${String(i - first + 1).padStart(2, '0')}`);
  const count = (date: string) => rows.filter(({ occurrence }) => occurrence.dueDate === date && occurrence.dueDate !== '9999-12-31').length;
  return <div className="vg-todo-calendar"><div className="vg-todo-month-head"><button aria-label="上个月" onClick={() => onCursor(addLocalDays(cursor, -1).slice(0, 7) + '-01')}><Icon name="back" size={20} /></button><strong>{monthTitle(cursor)}</strong><button aria-label="下个月" onClick={() => onCursor(addLocalDays(`${year}-${String(month).padStart(2, '0')}-28`, 8).slice(0, 7) + '-01')}><Icon name="chevron" size={20} /></button></div><div className="vg-todo-weekdays">{['日', '一', '二', '三', '四', '五', '六'].map((d) => <span key={d}>{d}</span>)}</div><div className="vg-todo-grid">{cells.map((date, i) => date ? <button key={date} aria-label={`${date}，${count(date)}件事项`} aria-pressed={date === selected} className={date === selected ? 'selected' : ''} onClick={() => onSelect(date)}><b>{Number(date.slice(8))}</b>{count(date) > 0 && <i>{count(date)}</i>}</button> : <span key={`blank-${i}`} />)}</div><div className="vg-todo-calendar-hint">点日期查看当天安排 · 小点代表待办数量</div></div>;
}
