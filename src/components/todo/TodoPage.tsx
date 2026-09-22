import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { db, type Todo, type TodoPriority, type TodoRecurrence, type TodoVisibility } from '../../db';
import { todoRepo, addLocalDays, dateLabel, localDateKey, type TodoWithOccurrence } from '../../db/todo-repo';
import { cancelTodoNotification, requestNotificationPermission, scheduleTodoNotification } from '../../lib/notify';
import { useAuthStore } from '../../store/auth-store';
import { useChatStore } from '../../store/chat-store';
import { useUIStore } from '../../store/ui-store';

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
  const userId = useAuthStore((s) => s.userId);
  const characters = useChatStore((s) => s.characters);
  const [view, setView] = useState<ViewMode>('schedule');
  const [range, setRange] = useState<'today' | 'week' | 'all' | 'overdue'>('today');
  const [rows, setRows] = useState<TodoWithOccurrence[]>([]);
  const [overviewRows, setOverviewRows] = useState<TodoWithOccurrence[]>([]);
  const [selectedDate, setSelectedDate] = useState(localDateKey());
  const [monthCursor, setMonthCursor] = useState(localDateKey().slice(0, 7) + '-01');
  const [editor, setEditor] = useState<{ todo?: Todo; date?: string } | null>(null);
  const [query, setQuery] = useState('');
  const [toast, setToast] = useState('');
  const overviewRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!userId) return;
    const to = range === 'today' || range === 'overdue' ? localDateKey() : range === 'week' ? addLocalDays(localDateKey(), 7) : RANGE_END;
    const [nextRows, nextOverview] = await Promise.all([
      todoRepo.list(userId, range === 'all' || range === 'overdue' ? RANGE_START : localDateKey(), to),
      todoRepo.list(userId, OVERVIEW_START, OVERVIEW_END),
    ]);
    setRows(nextRows.filter(({ occurrence }) => range !== 'overdue' || occurrence.dueDate < localDateKey()));
    setOverviewRows(nextOverview);
    void todoRepo.rebuildReminders(userId);
  }, [range, userId]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!overviewRows.length) return;
    // 概览默认把最新的有日期事项放在底部并让它成为视觉焦点。
    const frame = window.requestAnimationFrame(() => {
      if (overviewRef.current) overviewRef.current.scrollTop = overviewRef.current.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [overviewRows.length, view]);
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(''), 2800); return () => window.clearTimeout(timer); }, [toast]);

  const filteredRows = useMemo(() => rows.filter(({ todo }) => !query.trim() || `${todo.title} ${todo.note ?? ''}`.toLowerCase().includes(query.trim().toLowerCase())), [query, rows]);
  const todayRows = filteredRows.filter(({ occurrence }) => occurrence.dueDate === selectedDate);
  const grouped = useMemo(() => {
    const map = new Map<string, TodoWithOccurrence[]>();
    for (const row of filteredRows) {
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
    if (checked) await todoRepo.complete(userId, todo.id, date); else await todoRepo.reopen(userId, todo.id, date);
    await load();
  };

  return (
    <section className="vg-todo-page h-full overflow-y-auto px-4 pb-24" aria-label="待办">
      <header className="vg-todo-header">
        <button type="button" className="vg-todo-back" onClick={() => useUIStore.getState().setActiveView('chat')} aria-label="返回世界">‹</button>
        <div><span className="vg-todo-kicker">REAL LIFE / TODAY</span><h1>待办</h1></div>
        <button type="button" className="vg-todo-add" onClick={() => openEditor()} aria-label="新建待办">＋</button>
      </header>
      <section className="vg-todo-overview">
        <div><span>今天</span><strong>{rows.filter(({ occurrence }) => occurrence.dueDate === localDateKey() && occurrence.status === 'todo').length}</strong><small>件待完成</small></div>
        <p>把想做的事放在时间里，世界会替你记得。</p>
      </section>
      <div className="vg-todo-toolbar">
        <div className="vg-todo-segment"><button className={view === 'schedule' ? 'active' : ''} onClick={() => setView('schedule')}>日程表</button><button className={view === 'calendar' ? 'active' : ''} onClick={() => setView('calendar')}>月历</button><button className={view === 'overview' ? 'active' : ''} onClick={() => setView('overview')}>全部</button></div>
        <button className="vg-todo-search" onClick={() => setQuery(query ? '' : ' ')}>{query ? '清除' : '⌕'}</button>
      </div>
      {query !== '' && <input autoFocus className="vg-todo-search-input" value={query.trimStart()} onChange={(e) => setQuery(e.target.value)} placeholder="搜索待办、备注或标签" />}
      {view === 'schedule' ? (
        <>
          <div className="vg-todo-filters">{(['today', 'week', 'all', 'overdue'] as const).map((key) => <button key={key} className={range === key ? 'active' : ''} onClick={() => setRange(key)}>{key === 'today' ? '今天' : key === 'week' ? '本周' : key === 'overdue' ? '已逾期' : '全部'}</button>)}</div>
          {grouped.length === 0 ? <EmptyState onCreate={() => openEditor()} /> : grouped.map(([date, items]) => <div className="vg-todo-day" key={date}><div className="vg-todo-day-title"><strong>{dateLabel(date)}</strong><span>{formatWeekday(date)} · {date}</span><button onClick={() => openEditor(date)}>＋</button></div>{items.map(({ todo, occurrence }) => <TodoRow key={occurrence.id} todo={todo} occurrence={occurrence} onToggle={(checked) => void finish(todo, occurrence.dueDate, checked)} onEdit={() => setEditor({ todo, date: occurrence.dueDate })} />)}</div>)}
          {filteredRows.some(({ occurrence }) => occurrence.dueDate === '9999-12-31') && <div className="vg-todo-unplanned"><strong>未安排日期</strong><span>有想法，也可以先放在这里</span>{filteredRows.filter(({ occurrence }) => occurrence.dueDate === '9999-12-31').map(({ todo, occurrence }) => <TodoRow key={occurrence.id} todo={todo} occurrence={occurrence} onToggle={(checked) => void finish(todo, localDateKey(), checked)} onEdit={() => setEditor({ todo })} />)}</div>}
        </>
      ) : view === 'calendar' ? <CalendarView cursor={monthCursor} selected={selectedDate} rows={filteredRows} onCursor={setMonthCursor} onSelect={(date) => { setSelectedDate(date); setView('schedule'); setRange('all'); }} /> : <TodoOverview rows={overviewRows} scrollRef={overviewRef} onEdit={(todo, date) => setEditor({ todo, date })} />}
      {editor && userId && <TodoEditor userId={userId} todo={editor.todo} date={editor.date ?? selectedDate} characters={characters} onClose={closeEditor} onSaved={(message) => { closeEditor(); setToast(message); void load(); }} />}
      {toast && <div className="vg-todo-toast" role="status">{toast}</div>}
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
    <div className="vg-todo-overview-list-head"><div><span>ALL TASKS</span><strong>全部待办</strong></div><small>{ordered.length} 件</small></div>
    {ordered.length === 0 ? <p className="vg-todo-overview-empty">还没有可概览的事项</p> : <div className="vg-todo-overview-scroll" ref={scrollRef} tabIndex={0}>
      {ordered.map(({ todo, occurrence }) => {
        const unplanned = occurrence.dueDate === '9999-12-31';
        const time = unplanned ? '待定' : `${dateLabel(occurrence.dueDate)}${occurrence.dueTime ? ` ${occurrence.dueTime}` : ''}`;
        return <button type="button" className={`vg-todo-overview-item ${occurrence.status === 'completed' ? 'is-done' : ''}`} key={occurrence.id} onClick={() => onEdit(todo, occurrence.dueDate)}>
          <time>{time}</time><span><b>{todo.title}</b>{todo.note && <small>{todo.note}</small>}</span>
        </button>;
      })}
    </div>}
  </section>;
}

function TodoRow({ todo, occurrence, onToggle, onEdit }: { todo: Todo; occurrence: TodoWithOccurrence['occurrence']; onToggle: (checked: boolean) => void; onEdit: () => void }) {
  const done = occurrence.status === 'completed';
  return <article className={`vg-todo-row ${done ? 'is-done' : ''}`}><button className="vg-todo-check" onClick={() => onToggle(!done)} aria-label={done ? '标记未完成' : '标记完成'}>{done ? '✓' : ''}</button><button className="vg-todo-row-main" onClick={onEdit}><strong>{todo.title}</strong><span>{todo.dueTime ? todo.dueTime : '全天'}{priorityLabel(todo.priority) && ` · ${priorityLabel(todo.priority)}`}{todo.note ? ` · ${todo.note}` : ''}</span></button>{todo.recurrence.kind !== 'none' && <em>↻</em>}</article>;
}

function EmptyState({ onCreate }: { onCreate: () => void }) { return <div className="vg-todo-empty"><span>◌</span><strong>今天还没有安排</strong><p>给未来的自己留一件小事。</p><button onClick={onCreate}>写下第一件事</button></div>; }

function CalendarView({ cursor, selected, rows, onCursor, onSelect }: { cursor: string; selected: string; rows: TodoWithOccurrence[]; onCursor: (v: string) => void; onSelect: (v: string) => void }) {
  const [year, month] = cursor.split('-').map(Number);
  const first = new Date(year, month - 1, 1).getDay();
  const days = new Date(year, month, 0).getDate();
  const cells = Array.from({ length: first + days }, (_, i) => i < first ? null : `${year}-${String(month).padStart(2, '0')}-${String(i - first + 1).padStart(2, '0')}`);
  const count = (date: string) => rows.filter(({ occurrence }) => occurrence.dueDate === date && occurrence.dueDate !== '9999-12-31').length;
  return <div className="vg-todo-calendar"><div className="vg-todo-month-head"><button onClick={() => onCursor(addLocalDays(cursor, -1).slice(0, 7) + '-01')}>‹</button><strong>{monthTitle(cursor)}</strong><button onClick={() => onCursor(addLocalDays(`${year}-${String(month).padStart(2, '0')}-28`, 8).slice(0, 7) + '-01')}>›</button></div><div className="vg-todo-weekdays">{['日', '一', '二', '三', '四', '五', '六'].map((d) => <span key={d}>{d}</span>)}</div><div className="vg-todo-grid">{cells.map((date, i) => date ? <button key={date} className={date === selected ? 'selected' : ''} onClick={() => onSelect(date)}><b>{Number(date.slice(8))}</b>{count(date) > 0 && <i>{count(date)}</i>}</button> : <span key={`blank-${i}`} />)}</div><div className="vg-todo-calendar-hint">点日期查看当天安排 · 小点代表待办数量</div></div>;
}

function TodoEditor({ userId, todo, date, characters, onClose, onSaved }: { userId: string; todo?: Todo; date: string; characters: { id: string; name: string }[]; onClose: () => void; onSaved: (message: string) => void }) {
  const [title, setTitle] = useState(todo?.title ?? '');
  const [note, setNote] = useState(todo?.note ?? '');
  const [dueDate, setDueDate] = useState(todo?.dueDate ?? (date === '9999-12-31' ? '' : date));
  const [dueTime, setDueTime] = useState(todo?.dueTime ?? '');
  const [priority, setPriority] = useState<TodoPriority>(todo?.priority ?? 'normal');
  const [reminder, setReminder] = useState(String(todo?.reminderMinutes?.[0] ?? ''));
  const [repeat, setRepeat] = useState<TodoRecurrence>(todo?.recurrence ?? { kind: 'none' });
  const [visibility, setVisibility] = useState<TodoVisibility>(todo?.visibility ?? 'private');
  const [visibleTo, setVisibleTo] = useState(todo?.visibleTo ?? []);
  const [subtasks, setSubtasks] = useState(todo?.subtasks ?? []);
  const [subtaskDraft, setSubtaskDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!title.trim() || saving) return;
    setSaving(true);
    const minutes = reminder === '' ? [] : [Number(reminder)];
    const payload = { title: title.trim(), note: note.trim() || undefined, subtasks: subtasks.length ? subtasks : undefined, dueDate: dueDate || undefined, dueTime: dueTime || undefined, priority, reminderMinutes: minutes, recurrence: repeat, visibility, visibleTo: visibility === 'selected' ? visibleTo : undefined, source: 'manual' as const };
    if (todo) {
      const oldReminders = await todoRepo.reminders(userId, todo.id);
      await Promise.all(oldReminders.filter((item) => item.notificationId > 0).map((item) => cancelTodoNotification(item.notificationId)));
      await db.todoReminders.where('todoId').equals(todo.id).filter((item) => item.userId === userId).delete();
    }
    const saved = todo ? await todoRepo.update(userId, todo.id, payload) : await todoRepo.create({ ...payload, userId });
    if (minutes.length && saved.dueDate && saved.dueTime) {
      const occurrence = { id: `preview:${saved.id}:${saved.dueDate}`, userId, todoId: saved.id, dueDate: saved.dueDate, dueTime: saved.dueTime, originalDueDate: saved.dueDate, status: 'todo' as const, createdAt: Date.now(), updatedAt: Date.now() };
      const at = new Date(`${saved.dueDate}T${saved.dueTime}:00`).getTime() - minutes[0] * 60000;
      if (at > Date.now()) {
        const granted = await requestNotificationPermission();
        if (granted) {
          const scheduled = await scheduleTodoNotification(saved, occurrence, at);
          await db.todoReminders.put({ id: `todo-reminder:${saved.id}:${at}`, userId, todoId: saved.id, occurrenceId: occurrence.id, notificationId: scheduled.id, remindAt: at, status: scheduled.ok ? 'scheduled' : 'failed', createdAt: Date.now(), updatedAt: Date.now() });
        }
      }
    }
    onSaved('已保存到你的日程');
  };
  return <div className="vg-todo-sheet-backdrop" onMouseDown={(e) => { if (e.currentTarget === e.target) onClose(); }}><div className="vg-todo-sheet"><div className="vg-todo-sheet-head"><strong>{todo ? '编辑待办' : '新建待办'}</strong><button onClick={onClose}>关闭</button></div><input className="vg-todo-title-input" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="要做什么？" maxLength={80} /><textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="备注（可选）" rows={2} /><div className="vg-todo-subtasks"><div className="vg-todo-subtask-add"><input value={subtaskDraft} onChange={(e) => setSubtaskDraft(e.target.value)} placeholder="添加一个步骤" onKeyDown={(e) => { if (e.key === 'Enter' && subtaskDraft.trim()) { setSubtasks((old) => [...old, { id: crypto.randomUUID(), title: subtaskDraft.trim(), completed: false }]); setSubtaskDraft(''); } }} /><button onClick={() => { if (subtaskDraft.trim()) { setSubtasks((old) => [...old, { id: crypto.randomUUID(), title: subtaskDraft.trim(), completed: false }]); setSubtaskDraft(''); } }}>＋</button></div>{subtasks.map((step) => <label key={step.id}><input type="checkbox" checked={step.completed} onChange={(e) => setSubtasks((old) => old.map((item) => item.id === step.id ? { ...item, completed: e.target.checked } : item))} />{step.title}</label>)}</div><div className="vg-todo-fields"><label>日期<input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></label><label>时间<input type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} /></label></div><div className="vg-todo-fields"><label>提醒<select value={reminder} onChange={(e) => setReminder(e.target.value)}><option value="">不提醒</option><option value="0">准时</option><option value="10">提前 10 分钟</option><option value="30">提前 30 分钟</option><option value="60">提前 1 小时</option><option value="1440">提前 1 天</option></select></label><label>优先级<select value={priority} onChange={(e) => setPriority(e.target.value as TodoPriority)}><option value="normal">普通</option><option value="important">重点</option><option value="urgent">重要</option></select></label></div><label className="vg-todo-wide-field">重复<select value={repeat.kind} onChange={(e) => setRepeat(e.target.value === 'daily' ? { kind: 'daily' } : e.target.value === 'weekdays' ? { kind: 'weekdays' } : e.target.value === 'weekly' ? { kind: 'weekly', weekdays: [new Date().getDay()] } : e.target.value === 'monthly' ? { kind: 'monthly', day: Number(dueDate.slice(8)) || 1 } : { kind: 'none' })}><option value="none">不重复</option><option value="daily">每天</option><option value="weekdays">工作日</option><option value="weekly">每周</option><option value="monthly">每月</option></select></label><fieldset className="vg-todo-share"><legend>世界里的知情范围</legend><label><input type="radio" checked={visibility === 'private'} onChange={() => setVisibility('private')} /> 仅自己</label><label><input type="radio" checked={visibility === 'selected'} onChange={() => setVisibility('selected')} /> 告诉某个角色</label>{visibility === 'selected' && <div className="vg-todo-character-list">{characters.map((character) => <label key={character.id}><input type="checkbox" checked={visibleTo.includes(character.id)} onChange={(e) => setVisibleTo((old) => e.target.checked ? [...old, character.id] : old.filter((id) => id !== character.id))} /> {character.name}</label>)}</div>}</fieldset>{todo && <button className="vg-todo-delete" onClick={async () => { await todoRepo.remove(userId, todo.id); onSaved('已移入回收站'); }}>删除这件待办</button>}<button className="vg-todo-save" disabled={!title.trim() || saving} onClick={() => void save()}>{saving ? '保存中…' : '保存待办'}</button></div></div>;
}
