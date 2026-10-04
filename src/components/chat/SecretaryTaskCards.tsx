import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { liveQuery } from 'dexie';
import { db, type Todo } from '../../db';
import { useAuthStore } from '../../store/auth-store';
import { useUIStore } from '../../store/ui-store';
import { useChatStore } from '../../store/chat-store';
import { useSettingsStore } from '../../store/settings-store';
import { continueSecretaryAction, undoSecretaryAction, saveSecretaryDraft, dismissSecretaryAction, diaryAccessAllowed } from '../../lib/secretary/agent';
import type { SecretaryAction, SecretaryResult, SecretaryTask } from '../../lib/secretary/types';
import { AUDIENCE_MODE_LABELS } from '../../lib/moments/preferences';
import { readOwnedSecretaryTask } from '../../lib/secretary/inbox';
import { SECRETARY_DESTINATIONS } from '../../lib/secretary/capabilities';
import { isDiaryUnlocked, subscribeDiaryUnlock } from '../../lib/diary-unlock';
import { secretaryResultStatus } from '../../lib/secretary/feedback';
import { readTodoReceipt, readNotificationReceipt } from '../../lib/secretary/receipt';
import { REMINDER_STATUS_LABELS } from '../../lib/todo-reminders';
import { todoRepo } from '../../db/todo-repo';
import { requestNotificationPermission } from '../../lib/notify';
import { CharacterDispatchCard } from '../secretary/CharacterDispatchCard';

function ReminderState({ userId, todoId, date }: { userId: string; todoId: string; date?: string }) {
  const [state, setState] = useState<{ labels: string[]; retry: boolean; permission: boolean }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    setState(undefined);
    const subscription = liveQuery(async () => {
      const receipt = await readNotificationReceipt(userId, todoId, date);
      return receipt ? { labels: receipt.states.map(s => s === 'needs-time' ? '待补提醒时间' : REMINDER_STATUS_LABELS[s]), retry: receipt.retry, permission: receipt.permission } : undefined;
    }).subscribe({ next: setState, error: () => setState({ labels: ['提醒状态读取失败'], retry: true, permission: false }) });
    return () => subscription.unsubscribe();
  }, [userId, todoId, date]);
  if (!state || useAuthStore.getState().userId !== userId) return null;
  const retry = async () => {
    if (busy || useAuthStore.getState().userId !== userId) return;
    setBusy(true); setError('');
    try { if (state.permission) await requestNotificationPermission(); await todoRepo.rebuildReminders(userId); }
    catch { setError('提醒处理失败，请稍后重试。'); }
    finally { setBusy(false); }
  };
  return <div aria-label="当前提醒状态" className="mt-2 text-xs text-sub"><span>提醒：{state.labels.join('；') || '排队中'}</span>{(state.retry || state.permission) && <button type="button" disabled={busy} onClick={() => void retry()} className="ml-2 min-h-11 text-gene-purple">{state.permission ? '开启通知权限' : '重试提醒'}</button>}{error && <p role="alert">{error}</p>}</div>;
}

function TodoSteps({ userId, todoId, date }: { userId: string; todoId: string; date?: string }) {
  const [todo, setTodo] = useState<Todo>();
  useEffect(() => {
    setTodo(undefined);
    const subscription = liveQuery(async () => {
      return (await readTodoReceipt(userId, todoId, date)).todo;
    }).subscribe({ next: setTodo, error: () => setTodo(undefined) });
    return () => subscription.unsubscribe();
  }, [userId, todoId, date]);
  if (!todo || useAuthStore.getState().userId !== userId) return null;
  if (!todo.subtasks?.length) return <p aria-label="当前待办状态" className="vg-secretary-live-state text-xs text-sub">待办状态：{todo.status === 'completed' ? '已完成' : todo.status === 'cancelled' ? '已取消' : '未完成'}</p>;
  const done = todo.subtasks.filter(s => s.completed).length;
  return <div className="mt-2 w-full rounded-xl border border-line p-3" aria-label="当前待办步骤">
    <p aria-label="当前待办状态" className="mb-2 text-xs text-sub">待办状态：{todo.status === 'completed' ? '已完成' : todo.status === 'cancelled' ? '已取消' : '未完成'}</p>
    <p className="text-xs font-medium text-ink">当前步骤进度 {done}/{todo.subtasks.length}{todo.status === 'cancelled' ? ' · 待办已取消' : ''}</p>
    <progress aria-label="待办步骤完成进度" max={todo.subtasks.length} value={done} className="mt-2 h-2 w-full accent-purple-500" />
    <ol className="mt-2 space-y-2">{todo.subtasks.slice(0, 20).map((step, i) => <li key={step.id} className="flex gap-2 text-xs text-ink"><span aria-hidden="true">{step.completed ? '✓' : '○'}</span><span className={`break-words ${step.completed ? 'line-through text-sub' : ''}`}>{i + 1}. {step.title}</span></li>)}</ol>
    <p className="mt-3 text-xs leading-relaxed text-sub">{todo.recurrence.kind !== 'none' ? '重复系列的步骤请到待办页管理。' : '接着说“第一步完成了”或“恢复第二步”；步骤全部完成后，整件待办仍由你决定是否划掉。'}</p>
  </div>;
}
import { SecretaryIcon, type SecretaryIconName } from '../secretary/SecretaryIcon';


function SearchRecords({ task, result }: { task: SecretaryTask; result: SecretaryResult }) {
  const [rows, setRows] = useState<SecretaryResult['recordRows']>([]);
  const [error, setError] = useState('');
  const diary = result.action.kind === 'diary.search';
  useEffect(() => {
    setRows([]); setError('');
    const subscription = liveQuery(async () => {
      const table = diary ? db.diaries : db.moments;
      const records = await table.bulkGet((result.recordRows ?? []).map(r => r.id));
      if (useAuthStore.getState().userId !== task.userId) return [];
      return (result.recordRows ?? []).flatMap((row, i) => {
        const record = records[i];
        const valid = record?.userId === task.userId && record.updatedAt === row.version
          && !('deletedAt' in record && record.deletedAt) && !('deleted' in record && record.deleted)
          && !('characterId' in record && record.characterId) && !('authorCharacterId' in record && record.authorCharacterId);
        if (!valid || !record) return [];
        // Restored cards display the owned current record, never untrusted excerpt snapshots.
        return [{ ...row, date: 'content' in record ? record.date : new Date(record.createdAt).toLocaleDateString('sv-SE'), title: 'content' in record ? record.title || '未命名日记' : '我的朋友圈', excerpt: ('content' in record ? record.content : record.text).slice(0, 300) }];
      });
    }).subscribe({ next: setRows, error: () => { setRows([]); setError('记录读取失败，请重试查找。'); } });
    return () => subscription.unsubscribe();
  }, [task.userId, result.recordRows, diary]);
  const open = async (id: string, date: string) => {
    if (useAuthStore.getState().userId !== task.userId) return;
    const record = await (diary ? db.diaries : db.moments).get(id);
    if (useAuthStore.getState().userId !== task.userId || !record || record.userId !== task.userId) return;
    useUIStore.setState({ chatFromList: false, chatFromCharacters: false, mobileTab: 'world', activeView: diary ? 'diary' : 'moments',
      lifeRecordFocus: diary && !diaryAccessAllowed() ? null : { userId: task.userId, kind: diary ? 'diary' : 'moments', id, date } });
  };
  return <div className="mt-3 space-y-2">
    {rows?.map(r => <button key={r.id} type="button" onClick={() => void open(r.id, r.date)} className="block w-full rounded-xl border border-line p-3 text-left">
      <span className="block text-xs text-sub">{r.date} · 点击查看原记录</span><span className="mt-1 block text-sm font-medium text-ink break-words">{r.title}</span><span className="mt-2 block whitespace-pre-wrap break-words text-xs leading-relaxed text-sub">{r.excerpt}</span>
    </button>)}
    {error ? <p role="alert" className="text-xs text-red-400">{error}</p> : rows && rows.length < (result.recordRows?.length ?? 0) && <p className="text-xs text-sub">部分记录已修改或删除，请重新查找以查看最新内容。</p>}
  </div>;
}

function ResultCard({ task, result, index }: { task: SecretaryTask; result: SecretaryResult; index: number }) {
  const [text, setText] = useState(result.action.content ?? '');
  const [title, setTitle] = useState(result.action.title ?? '');
  const [date, setDate] = useState(result.action.date ?? '');
  const [time, setTime] = useState(result.action.time ?? '');
  const [intervalDays, setIntervalDays] = useState(String(result.action.intervalDays ?? ''));
  const [visibility, setVisibility] = useState(result.action.visibility ?? '');
  const [audience, setAudience] = useState<string[]>(result.action.audienceIds ?? []);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const ownedCharacters = useChatStore(s => s.characters).filter(c => c.createdBy === task.userId && !c.isPreset);
  const characters = ownedCharacters.filter(c => c.agentProfile !== 'secretary');
  useSettingsStore(s => s.diaryPin);
  useSyncExternalStore(subscribeDiaryUnlock, isDiaryUnlocked, isDiaryUnlocked);
  const isMoment = result.action.kind.startsWith('moment.');
  const inactive = ownedCharacters.find(c => c.id === task.characterId)?.secretaryStatus === 'dismissed';
  const editable = ['moment.draft', 'moment.publish'].includes(result.action.kind) && (['draft', 'needs-input'].includes(result.status) || !!task.dailyReview && result.status === 'failed') && !inactive;
  const lockedDiary = (result.action.kind.startsWith('diary.') || task.privacyScope !== 'plain' || !!task.dailyReview?.includeDiary) && !diaryAccessAllowed();
  const reviewEditable = !!task.dailyReview && ['needs-input', 'failed'].includes(result.status) && !inactive && !lockedDiary;
  useEffect(() => { setText(result.action.content ?? ''); }, [result.action.content]);
  useEffect(() => { setIntervalDays(String(result.action.intervalDays ?? '')); }, [result.action.intervalDays]);
  useEffect(() => { setTitle(result.action.title ?? ''); setDate(result.action.date ?? ''); setTime(result.action.time ?? ''); setVisibility(result.action.visibility ?? ''); setAudience(result.action.audienceIds ?? []); }, [result.action.title, result.action.date, result.action.time, result.action.visibility, result.action.audienceIds]);
  const run = async (work: () => Promise<unknown>) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(''); setNotice('');
    try { await work(); } catch (e) { setError(e instanceof Error ? e.message : '操作未完成，请重试。'); }
    finally { lock.current = false; setBusy(false); }
  };
  const proceed = (patch: Partial<SecretaryAction> = {}) => run(() => continueSecretaryAction(task.userId, task.id, index, patch));
  const view = async () => {
    if (lockedDiary) {
      useUIStore.setState({ chatFromList: false, chatFromCharacters: false, mobileTab: 'world', activeView: 'diary', lifeRecordFocus: null });
      return;
    }
    const kind = result.action.kind;
    if (useAuthStore.getState().userId !== task.userId) return;
    if (kind === 'app.open' && result.action.destination) {
      useUIStore.setState({ chatFromList: false, chatFromCharacters: false, mobileTab: 'world', activeView: result.action.destination, lifeRecordFocus: null });
      return;
    }
    const destination = kind.startsWith('diary.') ? 'diary' : isMoment ? 'moments' : 'todo';
    const record = result.targetId ? await (destination === 'diary' ? db.diaries : destination === 'moments' ? db.moments : db.todos).get(result.targetId) : undefined;
    if (useAuthStore.getState().userId !== task.userId) return;
    if (result.targetId && (!record || record.userId !== task.userId)) throw new Error('没有找到这项记录。');
    useUIStore.setState({ chatFromList: false, chatFromCharacters: false, mobileTab: 'world', activeView: destination,
      lifeRecordFocus: record ? { userId: task.userId, kind: destination, id: record.id, date: result.targetDate ?? ('date' in record ? record.date : 'dueDate' in record ? record.dueDate : undefined) } : null });
  };
  const icon: SecretaryIconName = result.action.kind.startsWith('diary.') ? 'diary' : isMoment ? 'moment' : result.action.kind === 'app.open' ? 'chevron' : 'todo';
  const compact = result.status === 'done' && !lockedDiary && !result.todoRows && !result.recordRows;
  return <section aria-label={`${result.label} ${secretaryResultStatus(result)}`} data-status={result.status} className={`vg-secretary-ui vg-secretary-result ${compact ? 'is-compact' : ''} rounded-2xl border border-line bg-panel p-4`}>
    <div className="vg-secretary-result-heading flex items-center justify-between gap-3"><h3 className="flex min-w-0 items-center gap-2 text-sm font-medium text-ink"><SecretaryIcon name={icon} size={17} className="shrink-0" /><span className="break-words min-w-0">{compact ? result.action.title || result.label : result.label}</span></h3><span key={result.status} className="vg-secretary-result-status shrink-0 rounded-full px-2 py-1 text-xs">{result.status === 'done' && <SecretaryIcon name="check" size={12} />}{secretaryResultStatus(result)}</span></div>
    {(lockedDiary || result.status !== 'done') && <p className="vg-secretary-result-detail mt-2 text-xs leading-relaxed text-sub whitespace-pre-wrap">{lockedDiary ? '日记已锁定，请先到日记页解锁。' : result.detail}</p>}
    {inactive && <p className="mt-2 text-xs text-sub">助理已离职，记录保留。聘用后可以手动继续处理。</p>}
    {result.action.title && !lockedDiary && !compact && <p className="mt-2 text-sm font-medium text-ink break-words">{result.action.title}</p>}
    {result.status === 'done' && !lockedDiary && <div className="vg-secretary-result-meta flex flex-wrap items-center gap-x-3 gap-y-1 mt-2">
      {result.action.date && <p className="text-xs text-sub">{result.action.date}{result.action.time ? ` · ${result.action.time}` : ''}</p>}
      {result.action.kind.startsWith('todo.') && result.targetId && <TodoSteps userId={task.userId} todoId={result.targetId} date={result.targetDate} />}
    </div>}
    {editable && !lockedDiary ? <textarea aria-label="朋友圈文案" value={text} onChange={e => setText(e.target.value)} maxLength={2000} rows={4} disabled={busy} className="mt-3 w-full rounded-xl border border-line bg-surface p-3 text-sm text-ink outline-none focus:border-gene-purple" /> : result.status !== 'done' && result.action.content && !lockedDiary && !reviewEditable && <p className="mt-3 text-sm text-ink whitespace-pre-wrap break-words">{result.action.content}</p>}
    {reviewEditable && (result.action.kind === 'diary.save' || result.action.kind === 'todo.create') && <div className="mt-3 space-y-2">
      <label className="block text-xs text-sub">{result.action.kind === 'diary.save' ? '日记标题' : '待办名称'}<input aria-label={result.action.kind === 'diary.save' ? '整理日记标题' : '整理待办名称'} value={title} onChange={e => setTitle(e.target.value)} maxLength={120} disabled={busy} className="mt-2 min-h-11 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink" /></label>
      <textarea aria-label={result.action.kind === 'diary.save' ? '整理日记正文' : '整理待办备注'} value={text} onChange={e => setText(e.target.value)} maxLength={6000} rows={result.action.kind === 'diary.save' ? 5 : 2} disabled={busy} className="w-full rounded-xl border border-line bg-surface p-3 text-sm text-ink" />
      <p className="text-xs text-sub">{date} · {result.action.kind === 'diary.save' ? '采用后追加到当日日记，保留原文；没有日记时新建私密记录。' : '采用后创建无提醒待办；已有同名事项会提示你处理。'}</p>
      <button type="button" disabled={busy || (result.action.kind === 'diary.save' ? !text.trim() : !title.trim())} onClick={() => void proceed({ title, content: text })} className="min-h-11 rounded-xl bg-gene-purple px-3 text-xs text-white">{result.action.kind === 'diary.save' ? '采用并保存日记' : '采用并创建待办'}</button>
    </div>}
    {editable && !lockedDiary && <div className="mt-3 space-y-2">
      <label className="block text-xs text-sub">发布给谁看<select aria-label="朋友圈可见范围" value={visibility} onChange={e => setVisibility(e.target.value)} className="mt-2 w-full min-w-0 min-h-11 rounded-lg border border-line bg-surface px-2 text-sm text-ink"><option value="">沿用已保存的发布偏好</option>{Object.entries(AUDIENCE_MODE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      {(visibility === 'selected' || visibility === 'excluded') && <div className="flex flex-wrap gap-2">{characters.map(c => <label key={c.id} className="flex min-h-11 items-center gap-2 text-xs text-ink"><input type="checkbox" checked={audience.includes(c.id)} onChange={e => setAudience(ids => e.target.checked ? [...ids, c.id] : ids.filter(id => id !== c.id))} />{c.name}</label>)}</div>}
      <div className="flex flex-wrap gap-2"><button disabled={busy || !text.trim()} onClick={() => void run(async () => { await saveSecretaryDraft(task.userId, task.id, index, text); setNotice('草稿已保存。'); })} className="min-h-11 rounded-xl border border-line px-3 text-xs text-ink">保存草稿</button>
        <button disabled={busy || !text.trim()} onClick={() => void proceed({ kind: 'moment.publish', content: text, ...(visibility ? { visibility: visibility as SecretaryAction['visibility'], audienceIds: audience } : {}) })} className="min-h-11 rounded-xl bg-gene-purple px-4 text-xs text-white">{busy ? '正在处理…' : '发布朋友圈'}</button></div>
    </div>}
    {result.candidates && !lockedDiary && !inactive && <div className="mt-3 space-y-2">{result.candidates.map(c => <button key={`${c.id}:${c.date}`} disabled={busy} onClick={() => void proceed({ targetId: c.id })} className="block w-full min-h-11 rounded-xl border border-line px-3 py-2 text-left text-sm text-ink">{c.label}<span className="ml-2 text-xs text-sub">{c.date === '9999-12-31' ? '未安排日期' : c.date}</span></button>)}</div>}
    {result.stepCandidates && !lockedDiary && !inactive && <div className="mt-3 space-y-2">{result.stepCandidates.map(step => <button key={step.index} type="button" disabled={busy} onClick={() => void proceed({ stepIndex: step.index })} className="block min-h-11 w-full rounded-xl border border-line px-3 py-2 text-left text-sm text-ink">第{step.index}步 · {step.title}</button>)}</div>}
    {result.action.kind === 'todo.create' && result.status === 'needs-input' && result.action.steps?.length && result.action.recurrence && result.action.recurrence !== 'none' && !inactive && <button type="button" disabled={busy} onClick={() => void proceed({ recurrence: 'none' })} className="mt-3 min-h-11 rounded-xl border border-line px-3 text-xs text-ink">改为单次待办，保留步骤</button>}
    {result.status === 'needs-input' && !task.dailyReview && !inactive && (['todo.create', 'todo.reschedule'].includes(result.action.kind) || result.action.kind === 'todo.update' && /日期|时间|哪一天|重复间隔/u.test(result.detail ?? '')) && !result.candidates && <div className="mt-3 flex flex-wrap gap-2">
      {result.action.kind === 'todo.create' && <input aria-label="待办名称" placeholder="要做什么？" value={title} onChange={e => setTitle(e.target.value)} maxLength={120} className="w-full min-h-11 rounded-lg border border-line bg-surface px-3 text-sm text-ink" />}
      <input aria-label="待办日期" type="date" value={date} onChange={e => setDate(e.target.value)} className="min-w-0 min-h-11 flex-1 rounded-lg border border-line bg-surface px-2 text-sm text-ink" />
      <input aria-label="待办时间" type="time" value={time} onChange={e => setTime(e.target.value)} className="min-w-0 min-h-11 flex-1 rounded-lg border border-line bg-surface px-2 text-sm text-ink" />
      {result.action.recurrence === 'interval' && <label className="flex w-full items-center gap-2 text-xs text-sub">每隔<input aria-label="重复间隔天数" type="number" min={1} max={365} value={intervalDays} onChange={e => setIntervalDays(e.target.value)} className="min-h-11 w-20 rounded-lg border border-line bg-surface px-2 text-sm text-ink" />天重复</label>}
      <button disabled={busy || !date || result.action.kind === 'todo.create' && !title.trim() || !!(result.action.reminder || result.action.reminderMinutes?.length) && !time || result.action.recurrence === 'interval' && (!Number.isInteger(Number(intervalDays)) || Number(intervalDays) < 1 || Number(intervalDays) > 365)} onClick={() => void proceed({ date, ...(result.action.kind === 'todo.create' ? { title } : {}), ...(time ? { time } : {}), ...(result.action.recurrence === 'interval' ? { intervalDays: Number(intervalDays) } : {}) })} className="min-h-11 rounded-xl bg-gene-purple px-3 text-xs text-white">{result.action.kind === 'todo.create' ? '补充并创建' : '保存新安排'}</button>
    </div>}
    {result.status === 'needs-input' && result.action.kind === 'app.open' && !inactive && <div className="mt-3 flex flex-wrap gap-2">{Object.entries(SECRETARY_DESTINATIONS).map(([destination, label]) => <button key={destination} type="button" disabled={busy} onClick={() => void proceed({ destination: destination as SecretaryAction['destination'] })} className="min-h-11 rounded-xl border border-line px-3 text-xs text-ink">{label}</button>)}</div>}
    {result.todoRows && <ol className="mt-3 space-y-2">{result.todoRows.map((r, rowIndex) => <li key={`${r.id}:${r.date}`} className="flex items-start gap-2 text-sm text-ink"><span>{rowIndex + 1}.</span><span>{r.completed ? '✓' : '○'}</span><span className={r.completed ? 'line-through text-sub' : ''}>{r.title}<small className="block text-xs text-sub">{r.date === '9999-12-31' ? '未安排日期' : r.date}{r.time ? ' ' + r.time : ''}{r.stepsTotal ? ` · 步骤 ${r.stepsDone ?? 0}/${r.stepsTotal}` : ''}</small></span></li>)}</ol>}
    {result.recordRows && !lockedDiary && <SearchRecords task={task} result={result} />}
    {result.status === 'done' && result.action.kind.startsWith('todo.') && result.targetId && <ReminderState userId={task.userId} todoId={result.targetId} date={result.targetDate} />}
    <div className="vg-secretary-result-actions mt-3 flex flex-wrap gap-2">
      {(result.status === 'done' || lockedDiary) && <button type="button" onClick={() => void run(view)} className="min-h-11 rounded-xl border border-line px-3 text-xs text-ink">{lockedDiary ? '去解锁日记' : result.action.kind === 'app.open' && result.action.destination ? `打开${SECRETARY_DESTINATIONS[result.action.destination]}` : '去查看'}</button>}
      {['draft', 'needs-input', 'failed'].includes(result.status) && <button disabled={busy || inactive} onClick={() => void run(() => dismissSecretaryAction(task.userId, task.id, index))} className="min-h-11 rounded-xl border border-line px-3 text-xs text-sub">{isMoment ? '丢弃草稿' : '不处理这项'}</button>}
      {!task.dailyReview && (result.status === 'failed' || result.status === 'pending' || result.status === 'needs-input' && !editable && !result.candidates && result.action.kind !== 'todo.create') && <button disabled={busy || lockedDiary || inactive} onClick={() => void proceed()} className="min-h-11 rounded-xl border border-gene-purple/30 px-3 text-xs text-gene-purple">重试这一项</button>}
    {result.status === 'done' && !lockedDiary && <details className="vg-secretary-result-more text-xs text-sub"><summary className="min-h-11 cursor-pointer py-3">详情与撤销</summary>
      <p className="whitespace-pre-wrap break-words leading-relaxed">{result.detail}</p>
      {result.action.content && <p className="mt-2 whitespace-pre-wrap break-words text-sm text-ink">{result.action.content}</p>}
      <p className="mt-2 break-words">来自你的请求：{task.request}</p>
      {result.targetId && Number.isFinite(result.afterVersion) && <button disabled={busy || inactive} onClick={() => void run(() => undoSecretaryAction(task.userId, task.id, index))} className="mt-2 min-h-11 rounded-xl border border-line px-3 text-xs text-sub">{isMoment ? '撤回发布' : '撤销这次操作'}</button>}
    </details>}
    </div>
    {notice && <p role="status" className="mt-2 text-xs text-life-cyan">{notice}</p>}
    {error && <p role="alert" className="mt-2 text-xs text-red-400">{error}</p>}
  </section>;
}

function PendingControls({ task, onAnswer, disabled }: { task: SecretaryTask; onAnswer: (answer: string) => void; disabled?: boolean }) {
  const [date, setDate] = useState(task.pendingContext?.knownAction.date ?? '');
  const [time, setTime] = useState(task.pendingContext?.knownAction.time ?? '');
  const [text, setText] = useState('');
  const pending = task.pendingContext!;
  const fields = pending.awaitingFields;
  if (pending.state === 'paused') return <section aria-label="已暂停的事项" className="vg-secretary-ui rounded-2xl border border-line bg-panel p-3">
    <p className="text-sm text-sub">{fields.includes('operation') ? '这几件事' : pending.knownAction.title || '这件事'}先放着，想好了再继续。</p>
    <div className="mt-2 flex gap-4"><button disabled={disabled} onClick={() => onAnswer('继续')} className="min-h-11 text-sm text-gene-purple">继续处理</button><button disabled={disabled} onClick={() => onAnswer('不记了')} className="min-h-11 text-sm text-sub">取消这件事</button></div>
  </section>;
  return <section aria-label="当前事项补充信息" className="vg-secretary-ui rounded-2xl border border-line bg-panel p-3 space-y-2">
    <span className="sr-only">补充当前事项</span>
    {pending.knownAction.title && !fields.includes('operation') && <div><p className="break-words text-sm font-medium text-ink">{pending.knownAction.title}</p>{(pending.knownAction.date || pending.knownAction.time) && <p className="mt-1 text-xs text-sub">{[pending.knownAction.date, pending.knownAction.time].filter(Boolean).join(' ')}</p>}</div>}
    {fields.includes('operation') && pending.operationChoices?.map((choice, index) => <div key={choice.index} className="flex min-w-0 items-center gap-2"><button disabled={disabled} type="button" onClick={() => onAnswer(`第${index + 1}个`)} className="min-h-11 min-w-0 flex-1 rounded-xl border border-line px-3 py-2 text-left text-sm break-words">{index + 1}. {choice.label}</button><button type="button" disabled={disabled} aria-label={`取消第${index + 1}个待处理事项`} onClick={() => onAnswer(`取消第${index + 1}个`)} className="min-h-11 shrink-0 px-2 text-sm text-sub">取消</button></div>)}
    {fields.includes('purpose') && <div className="flex gap-2">{['待办', '日记'].map(value => <button key={value} type="button" disabled={disabled} onClick={() => onAnswer(value)} className="min-h-11 rounded-xl border border-line px-4 text-sm">{value}</button>)}</div>}
    {fields.includes('destination') && <div className="flex flex-wrap gap-2">{Object.entries(SECRETARY_DESTINATIONS).map(([id, label]) => <button key={id} type="button" disabled={disabled} onClick={() => onAnswer(label)} className="min-h-11 rounded-xl border border-line px-3 text-sm">{label}</button>)}</div>}
    {fields.includes('target') && pending.candidates?.map((candidate, index) => <button key={candidate.id} type="button" disabled={disabled} onClick={() => onAnswer(`第${index + 1}个`)} className="min-h-11 w-full rounded-xl border border-line px-3 text-left text-sm">{candidate.label}</button>)}
    {fields.includes('audience') && <div className="flex flex-wrap gap-2">{['仅自己可见', '全部角色可见'].map(value => <button key={value} disabled={disabled} type="button" onClick={() => onAnswer(value)} className="min-h-11 rounded-xl border border-line px-3 text-sm">{value}</button>)}</div>}
    {pending.confirmation && <button type="button" disabled={disabled} onClick={() => onAnswer('发布')} className="min-h-11 rounded-xl bg-gene-purple px-3 text-sm text-white">确认发布</button>}
    {pending.conflict && <div className="flex flex-wrap gap-2">{pending.conflict.choices.map((value, index) => <button key={value} disabled={disabled} type="button" onClick={() => onAnswer(`第${index + 1}个`)} className="min-h-11 rounded-xl border border-line px-3 text-sm"><span className="mr-2 text-sub">{index + 1}.</span>{value}</button>)}</div>}
    {(fields.includes('date') || fields.includes('time')) && <div className="flex flex-wrap gap-2">
      {fields.includes('date') && <input aria-label="补充日期" type="date" value={date} disabled={disabled} onChange={e => setDate(e.target.value)} className="min-h-11 min-w-0 rounded-lg border border-line bg-surface px-2 text-sm" />}
      {fields.includes('time') && <input aria-label="补充时间" type="time" value={time} disabled={disabled} onChange={e => setTime(e.target.value)} className="min-h-11 min-w-0 rounded-lg border border-line bg-surface px-2 text-sm" />}
      <button disabled={disabled || !(date || time)} type="button" onClick={() => onAnswer([date, time].filter(Boolean).join(' '))} className="min-h-11 rounded-xl bg-gene-purple px-3 text-sm text-white">补充</button>
    </div>}
    {fields.some(f => ['title', 'content', 'query'].includes(f)) && <div className="flex gap-2"><input aria-label="补充内容" value={text} disabled={disabled} onChange={e => setText(e.target.value)} className="min-h-11 min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 text-sm" /><button disabled={disabled || !text.trim()} onClick={() => onAnswer(`${fields.includes('title') ? '标题' : fields.includes('content') ? '正文' : '关键词'}：${text.trim()}`)} className="min-h-11 rounded-xl bg-gene-purple px-3 text-sm text-white">补充</button></div>}
    {fields.includes('intervalDays') && <div className="flex items-center gap-2"><label className="flex min-w-0 flex-1 items-center gap-2 text-sm">每隔<input type="number" aria-label="补充重复间隔天数" min={1} max={365} value={text} disabled={disabled} onChange={e => setText(e.target.value)} className="min-h-11 min-w-0 w-20 rounded-lg border border-line bg-surface px-2 text-sm" />天</label><button type="button" disabled={disabled || !Number.isInteger(Number(text)) || Number(text) < 1 || Number(text) > 365} onClick={() => onAnswer(`每隔${text}天`)} className="min-h-11 rounded-xl bg-gene-purple px-3 text-sm text-white">补充</button></div>}
    {pending.knownAction.kind === 'todo.create' && pending.knownAction.reminder && !fields.includes('operation') && <button type="button" disabled={disabled} onClick={() => onAnswer('只记录，不提醒')} className="min-h-11 text-sm text-gene-purple">只记录，不提醒</button>}
    <div className="flex gap-3"><button disabled={disabled} onClick={() => onAnswer('先别弄')} className="min-h-11 text-sm text-sub">稍后继续</button><button disabled={disabled} onClick={() => onAnswer('不记了')} className="min-h-11 text-sm text-sub">{fields.includes('operation') ? '取消剩余事项' : '取消这件事'}</button></div>
  </section>;
}

export function SecretaryTaskCards({ taskId, context = 'chat', onAnswer, busy }: { taskId: string; context?: 'chat' | 'inbox'; onAnswer?: (answer: string) => void; busy?: boolean }) {
  const userId = useAuthStore(s => s.userId) ?? '';
  const sessionId = useChatStore(s => s.currentSessionId);
  const [task, setTask] = useState<SecretaryTask>();
  const [activeFocus, setActiveFocus] = useState(false);
  const [continuation, setContinuation] = useState<SecretaryTask>();
  useEffect(() => {
    setTask(undefined); setContinuation(undefined);
    const subscription = liveQuery(async () => {
      const task = await readOwnedSecretaryTask(userId, taskId);
      const binding = await db.secretaryBindings.get(userId);
      const focusId = binding?.pendingFocusTaskId;
      const focus = focusId && task?.continuationFocus?.taskId === focusId ? await readOwnedSecretaryTask(userId, focusId) : undefined;
      const continuation = focus && focus.updatedAt === task?.continuationFocus?.version && focus.characterId === task.characterId && focus.employmentId === task.employmentId
        && binding?.pendingFocusDisplayTaskId === taskId && focus.pendingContext && ['waiting', 'paused'].includes(focus.pendingContext.state) ? focus : undefined;
      return { task, active: focusId === taskId && (!binding?.pendingFocusDisplayTaskId || binding.pendingFocusDisplayTaskId === taskId), continuation };
    }).subscribe({ next: value => { setTask(value.task); setActiveFocus(value.active); setContinuation(value.continuation); }, error: () => { setTask(undefined); setContinuation(undefined); } });
    return () => subscription.unsubscribe();
  }, [taskId, userId]);
  if (!task || task.userId !== userId || context === 'chat' && task.sessionId !== sessionId) return null;
  const displayed = continuation ? { ...task, pendingContext: continuation.pendingContext } : task;
  const pending = (activeFocus || continuation) && displayed.pendingContext && ['waiting', 'paused'].includes(displayed.pendingContext.state) && onAnswer && (!!continuation || !task.results.length || displayed.pendingContext.awaitingFields.includes('operation'));
  if (!task.results.length && !pending) return null;
  return <div className={`vg-secretary-results ${context === 'chat' ? 'ml-10 mb-4 is-chat' : ''} max-w-lg space-y-3`} data-no-page-swipe>{task.assistantName && context === 'chat' && !!task.results.length && <p className="vg-secretary-receipt text-xs text-sub"><SecretaryIcon name="inbox" size={13} />{task.assistantName} · 当时的办事记录</p>}{pending && <PendingControls key={`${task.id}:${continuation?.updatedAt ?? ''}`} task={displayed} onAnswer={onAnswer} disabled={busy} />}{task.results.map((result, index) => result.dispatch ? <CharacterDispatchCard key={index} userId={userId} taskId={result.dispatch.taskId} /> : <ResultCard key={index} task={task} result={result} index={index} />)}</div>;
}
