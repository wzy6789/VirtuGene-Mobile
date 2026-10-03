import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { liveQuery } from 'dexie';
import { db, type Character } from '../../db';
import { useAuthStore } from '../../store/auth-store';
import { useChatStore } from '../../store/chat-store';
import { useSettingsStore } from '../../store/settings-store';
import { localDateKey } from '../../db/todo-repo';
import { collectDailyReview, DAILY_REVIEW_OUTPUTS, validateDailyReview, type DailyReviewTodoRow } from '../../lib/secretary/daily-review';
import type { DailyReviewOutput } from '../../lib/secretary/types';
import { diaryAccessAllowed } from '../../lib/secretary/agent';
import { startDailyReview } from '../../lib/secretary/start-daily-review';
import { SecretaryTaskCards } from '../chat/SecretaryTaskCards';
import { Modal } from '../ui/Modal';
import { SecretaryIcon } from './SecretaryIcon';
import { SecretaryReviewProgress } from './SecretaryReviewProgress';
import { isDiaryUnlocked, subscribeDiaryUnlock } from '../../lib/diary-unlock';
import { useUIStore } from '../../store/ui-store';

export function SecretaryDailyReviewModal({ character, open, onClose }: { character: Character; open: boolean; onClose: () => void }) {
  const userId = useAuthStore(s => s.userId);
  const sessionId = useChatStore(s => s.currentSessionId);
  const current = useChatStore(s => s.characters.find(c => c.id === character.id)) ?? character;
  useSettingsStore(s => s.diaryPin);
  useSyncExternalStore(subscribeDiaryUnlock, isDiaryUnlocked);
  const [date, setDate] = useState(localDateKey());
  const [includeDiary, setIncludeDiary] = useState(false);
  const [includeTodos, setIncludeTodos] = useState(true);
  const [notes, setNotes] = useState('');
  const [outputs, setOutputs] = useState<DailyReviewOutput[]>(DAILY_REVIEW_OUTPUTS.map(output => output.id));
  const [preview, setPreview] = useState<{ diaries: number; completed: number; pending: number; next: number; rows: DailyReviewTodoRow[]; userId: string; requestKey: string; includeDiary: boolean }>();
  const [taskId, setTaskId] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const editedChoices = useRef(false);
  useEffect(() => {
    if (!open || !userId) return;
    let alive = true;
    void db.secretaryBindings.get(userId).then(binding => {
      if (!alive || editedChoices.current || useAuthStore.getState().userId !== userId || binding?.characterId !== character.id || !binding.reviewPreferences) return;
      const saved = binding.reviewPreferences;
      const choices = DAILY_REVIEW_OUTPUTS.map(o => o.id).filter(id => saved.outputs.includes(id));
      if (choices.length) setOutputs(choices);
      setIncludeTodos(saved.includeTodos === true);
    }).catch(() => undefined);
    return () => { alive = false; };
  }, [open, userId, character.id]);
  const locked = !diaryAccessAllowed();
  const requestKey = JSON.stringify({ date, includeDiary, includeTodos, notes, outputs });
  useEffect(() => {
    setPreview(undefined); setNotice('');
    if (!open || !userId) return;
    try {
      const options = validateDailyReview({ date, includeDiary, includeTodos, notes, outputs });
      const subscription = liveQuery(async () => {
        try { return { material: await collectDailyReview(userId, options, !locked) }; }
        catch (error) { return { error: error instanceof Error ? error.message : '资料未就绪。' }; }
      }).subscribe({ next: result => {
        if (useAuthStore.getState().userId !== userId) return;
        if (!result.material) { setPreview(undefined); setNotice(result.error ?? '资料未就绪。'); return; }
        const material = result.material;
        setNotice(''); setPreview({ diaries: material.diaries.length, completed: material.todos.filter(t => t.state === 'completed-that-day').length,
          pending: material.todos.filter(t => t.state === 'pending').length, next: material.todos.filter(t => t.state === 'next-day').length,
          rows: material.todos, userId, requestKey, includeDiary });
      }, error: () => { setPreview(undefined); setNotice('资料读取失败，请重新打开整理。'); } });
      return () => subscription.unsubscribe();
    } catch (e) { setNotice(e instanceof Error ? e.message : '资料未就绪。'); }
  }, [open, userId, date, includeDiary, includeTodos, notes, outputs, locked, requestKey]);
  const safePreview = preview?.userId === userId && preview.requestKey === requestKey && (!preview.includeDiary || !locked) ? preview : undefined;
  const close = () => { if (!lock.current) onClose(); };
  const generate = async () => {
    if (lock.current || !userId || !sessionId || !safePreview || !outputs.length || current.secretaryStatus === 'dismissed') return;
    lock.current = true; setBusy(true); setError('');
    try {
      const task = await startDailyReview(userId, character.id, sessionId, { date, includeDiary, includeTodos, notes, outputs }, current.secretaryEmploymentId ?? `legacy:${character.id}`);
      await db.transaction('rw', db.secretaryBindings, async () => {
        const binding = await db.secretaryBindings.get(userId);
        if (useAuthStore.getState().userId === userId && binding?.characterId === character.id && binding.employmentId === task.employmentId)
          await db.secretaryBindings.update(userId, { reviewPreferences: { includeTodos, outputs } });
      });
      if (useAuthStore.getState().userId === userId) {
        setTaskId(task.id);
        if (!task.results.length) setNotice(task.reply || '资料不足以生成建议，补充当日事实后再试。');
      }
    } catch (e) { if (useAuthStore.getState().userId === userId) setError(e instanceof Error ? e.message : '每日整理未完成，可以重试。'); }
    finally { lock.current = false; setBusy(false); }
  };
  if (!userId || character.createdBy !== userId) return null;
  return <Modal open={open} onClose={close} title="每日整理" width="max-w-lg" closeOnBackdrop={false} mobileFullHeight panelClassName="vg-settings-panel" canSnapshotOnExit={() => useAuthStore.getState().userId === character.createdBy && (!includeDiary || diaryAccessAllowed())} footer={<div className="vg-secretary-ui vg-secretary-form-footer">
    {notice && <p role="status" className="mb-3 text-sm text-sub">{notice}</p>}
    {error && <p role="alert" className="mb-3 text-sm">{error}</p>}
    {taskId ? <button type="button" disabled={busy} onClick={close} className="vg-secretary-footer-secondary w-full">稍后处理，保留建议</button> : <div className="flex gap-3"><button type="button" disabled={busy} onClick={close} className="vg-secretary-footer-secondary">关闭每日整理</button><button type="button" disabled={busy || !safePreview || !outputs.length || current.secretaryStatus === 'dismissed'} onClick={() => void generate()} className="min-h-12 min-w-0 flex-1 rounded-xl bg-gene-purple px-3 text-sm font-medium text-white disabled:opacity-40">{busy ? '正在整理真实资料…' : '生成整理建议'}</button></div>}
  </div>}>
    <div className="vg-settings-design vg-secretary-ui vg-secretary-review space-y-4 p-5">
      <div className="vg-secretary-review-intro rounded-2xl border border-line p-4"><span className="vg-secretary-icon-tile mb-3"><SecretaryIcon name="spark" size={22} /></span><p className="text-base font-medium text-ink">理一理今天，轻一点过明天。</p><p className="mt-2 text-xs leading-relaxed text-sub">选择需要的建议，先看看真实进展，再决定采用哪些内容。已有待办不会自动改期，也不会自动划掉。</p></div>
      {!taskId && <fieldset disabled={busy} className="min-w-0 space-y-4">
        <fieldset className="vg-secretary-output-choices space-y-2"><legend className="mb-2 text-sm font-medium text-ink">这次想整理什么</legend>{DAILY_REVIEW_OUTPUTS.map(output => <label key={output.id} className="flex min-h-11 items-center gap-3 text-sm text-ink"><input type="checkbox" checked={outputs.includes(output.id)} onChange={e => { editedChoices.current = true; setOutputs(value => e.target.checked ? [...value, output.id] : value.filter(id => id !== output.id)); }} className="accent-gene-purple" />{output.label}</label>)}<p className="text-xs leading-relaxed text-sub">只生成你勾选的类型，日记和待办逐项采用才保存，朋友圈始终先留草稿。</p></fieldset>
        <div className="vg-secretary-sources space-y-2"><label className="vg-secretary-source flex min-h-12 items-center gap-3 text-sm text-ink"><input type="checkbox" checked={includeDiary} disabled={locked || busy} onChange={e => setIncludeDiary(e.target.checked)} className="accent-gene-purple" /><SecretaryIcon name="diary" size={17} />使用所选日期的日记</label><p className="text-xs leading-relaxed text-sub">{locked ? '日记已锁定，先到日记页解锁后才能使用。' : '由你选择是否使用私密日记；角色关联日记和世界记录不参与整理。'}</p><label className="vg-secretary-source flex min-h-12 items-center gap-3 text-sm text-ink"><input type="checkbox" checked={includeTodos} onChange={e => { editedChoices.current = true; setIncludeTodos(e.target.checked); }} className="accent-gene-purple" /><SecretaryIcon name="todo" size={17} />使用真实待办</label></div>
        <details className="rounded-xl border border-line p-3"><summary className="min-h-11 cursor-pointer text-sm text-ink"><span>日期与补充事实</span><span className="ml-2 text-sub">{date}</span></summary><div className="space-y-3 pt-2">
          <label className="block text-sm text-ink">整理哪一天<input type="date" aria-label="整理日期" value={date} max={localDateKey()} onChange={e => setDate(e.target.value)} className="mt-2 min-h-11 w-full min-w-0 rounded-xl border border-line bg-surface px-3 text-sm text-ink" /></label>
          <label className="block text-sm text-ink">补充当天发生的事情<textarea aria-label="每日整理补充事实" value={notes} maxLength={2000} rows={4} onChange={e => setNotes(e.target.value)} placeholder="例如：今天交完报告，晚上散步了；明天想读20页书。" className="mt-2 w-full rounded-xl border border-line bg-surface p-3 text-sm text-ink" /><span className="mt-1 block text-xs text-sub">只整理这里的补充事实和你选择的资料，不读取其他角色聊天。</span></label>
        </div></details>
        {safePreview && <><div aria-label="每日整理资料范围" className="vg-secretary-review-stats grid grid-cols-2 gap-2 text-center text-xs text-sub">{[[safePreview.diaries, '当日日记'], [safePreview.completed, '当日完成'], [safePreview.pending, '未完成事项'], [safePreview.next, '次日已有安排']].map(([count, label]) => <p key={label} className="rounded-xl bg-surface p-3"><span className="mb-1 block text-lg font-semibold text-ink">{count}</span>{label}</p>)}</div>{includeTodos && <SecretaryReviewProgress key={date} rows={safePreview.rows} date={date} onOpen={row => {
          if (lock.current || useAuthStore.getState().userId !== userId) return;
          useUIStore.setState({ activeView: 'todo', lifeRecordFocus: { userId, kind: 'todo', id: row.id, date: row.date } }); onClose();
        }} />}</>}
      </fieldset>}
      {taskId && <><p className="text-xs text-life-cyan">建议已保留到办事收件箱，可以稍后继续。日记默认私密，朋友圈选择发布才发出。</p><SecretaryTaskCards taskId={taskId} context="inbox" /><button type="button" onClick={() => { setTaskId(''); setError(''); }} className="min-h-11 w-full rounded-xl border border-line text-sm text-ink">调整资料，重新整理</button></>}
    </div>
  </Modal>;
}
