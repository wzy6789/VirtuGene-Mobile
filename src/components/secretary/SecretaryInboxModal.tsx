import { readSecretaryFailureReason } from '../../lib/secretary/failure';
import { Fragment, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { liveQuery } from 'dexie';
import type { Character } from '../../db';
import { useAuthStore } from '../../store/auth-store';
import { useChatStore } from '../../store/chat-store';
import { useSettingsStore } from '../../store/settings-store';
import { diaryAccessAllowed, selectSecretaryConversation } from '../../lib/secretary/agent';
import { matchesSecretaryInbox, readSecretaryInbox, SECRETARY_INBOX_FILTERS, type SecretaryInboxFilter } from '../../lib/secretary/inbox';
import type { SecretaryTask } from '../../lib/secretary/types';
import { SecretaryTaskCards } from '../chat/SecretaryTaskCards';
import { Modal } from '../ui/Modal';
import { isDiaryUnlocked, subscribeDiaryUnlock } from '../../lib/diary-unlock';
import { SecretaryIcon } from './SecretaryIcon';
import { SecretarySurfaceIntro } from './SecretarySurfaceIntro';
import { LoadingSkeleton } from '../ui/LoadingSkeleton';
import { openAssistantWorkspace } from '../../lib/secretary/navigation';
import { OrbEmptyState } from '../ui/OrbEmptyState';
import { AnimatedValue } from '../ui/AnimatedValue';
import { pendingQuestion } from '../../lib/secretary/pending-context';
import { diaryProtectedTask } from '../../lib/secretary/privacy';

function requestDay(timestamp: number) {
  return new Date(timestamp).toLocaleDateString('zh-CN', { year: 'numeric', month: 'numeric', day: 'numeric' });
}

export function SecretaryInboxModal({ character, open, onClose, onDraft, busy = false, embedded = false, category }: {
  character: Character; open: boolean; onClose: () => void; onDraft: (request: string) => void; busy?: boolean;
  embedded?: boolean; category?: SecretaryInboxFilter;
}) {
  const userId = useAuthStore(s => s.userId);
  const current = useChatStore(s => s.characters.find(c => c.id === character.id)) ?? character;
  useSettingsStore(s => s.diaryPin);
  useSyncExternalStore(subscribeDiaryUnlock, isDiaryUnlocked, isDiaryUnlocked);
  const [tasks, setTasks] = useState<SecretaryTask[]>([]);
  const [filter, setFilter] = useState<SecretaryInboxFilter>('attention');
  const [limit, setLimit] = useState(20);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selecting, setSelecting] = useState('');
  const [selectionError, setSelectionError] = useState('');
  const selectingRef = useRef(false);
  useEffect(() => {
    setTasks([]); setLoading(true); setError(''); setFilter('attention'); setLimit(20);
    if (!open || !userId) return;
    const subscription = liveQuery(() => readSecretaryInbox(userId, character.id)).subscribe({
      next: value => { setTasks(value); setLoading(false); },
      error: () => { setTasks([]); setError('办事记录读取失败，请关闭后重试。'); setLoading(false); },
    });
    return () => subscription.unsubscribe();
  }, [open, userId, character.id]);
  if (!userId || character.createdBy !== userId) return null;
  const selectedFilter = category ?? filter;
  const filtered = tasks.filter(t => matchesSecretaryInbox(t, selectedFilter));
  const locked = !diaryAccessAllowed();
  const select = async (task: SecretaryTask) => {
    if (selectingRef.current || busy || locked && diaryProtectedTask(task) || current.secretaryStatus === 'dismissed') return;
    selectingRef.current = true;
    setSelecting(task.id); setSelectionError('');
    try {
      await selectSecretaryConversation(userId, task.id);
      if (useAuthStore.getState().userId === userId) onDraft('继续刚才那个');
    } catch (error) { if (useAuthStore.getState().userId === userId) setSelectionError(error instanceof Error ? error.message : '这件事暂时无法接续，请重新打开。'); }
    finally { selectingRef.current = false; setSelecting(''); }
  };
  const content =
    <div className="vg-settings-design vg-secretary-ui vg-secretary-inbox space-y-4 p-4">
      <SecretarySurfaceIntro icon="inbox" title="每件事，都有进展" value={loading ? '读取中' : `${tasks.length} 条请求`} detail="所有聊天里的办事记录都在这里。草稿先保存，你选择发布才发出；换助理后，旧事项也可以逐项接手。" />
      {current.secretaryStatus === 'dismissed' && <p role="status" className="rounded-xl bg-gene-purple/10 p-3 text-sm text-ink">助理空缺中，记录已保留。聘用新助理后可以继续办理。</p>}
      {selectionError && <p role="alert" className="text-sm text-red-400">{selectionError}</p>}
      {!category && <div role="group" aria-label="办事记录分类" className="vg-secretary-filters grid grid-cols-2 gap-2">
        {SECRETARY_INBOX_FILTERS.map(item => <button key={item.id} type="button" aria-label={`${item.label}（${tasks.filter(t => matchesSecretaryInbox(t, item.id)).length}）`} aria-pressed={filter === item.id} onClick={() => { setFilter(item.id); setLimit(20); }} className="vg-secretary-filter"><span>{item.id === 'drafts' ? '草稿' : item.label}</span><span className="vg-secretary-filter-count"><AnimatedValue value={tasks.filter(t => matchesSecretaryInbox(t, item.id)).length} /></span></button>)}
      </div>}
      {loading ? <LoadingSkeleton label="正在整理办事记录…" /> : error ? <p role="alert" className="text-sm text-red-400">{error}</p> : !filtered.length ? <OrbEmptyState title={filter === 'attention' ? '事情都理顺了' : '暂时没有办事记录'} detail={filter === 'attention' ? '暂时没有待处理事项。' : '你交代的事情，会保留在这里。'} action="和助理聊聊" onAction={() => { onClose(); openAssistantWorkspace('chat', 'chat'); }} emotion="happy" /> : filtered.slice(0, limit).map((task, index) => <Fragment key={task.id}>{(index === 0 || requestDay(filtered[index - 1].createdAt) !== requestDay(task.createdAt)) && <h3 className="vg-secretary-request-day">{requestDay(task.createdAt)}</h3>}<article data-secretary-task-id={task.id} className="vg-secretary-request min-w-0 space-y-3 rounded-2xl border border-line p-3" aria-label="办事请求">
        <div className="vg-secretary-request-source"><p className="text-xs text-sub">{new Date(task.createdAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · {task.assistantName ?? '助理'}</p><p className="mt-2 whitespace-pre-wrap break-words text-sm text-ink">{locked && diaryProtectedTask(task) ? '日记锁定期间，原请求内容暂不展示。' : task.request}</p></div>
        {task.results.length ? <SecretaryTaskCards taskId={task.id} context="inbox" /> : task.status === 'failed' ? <p role="status" className="text-sm text-red-400 break-words">{readSecretaryFailureReason(task.failureReason)}</p> : <p className="text-xs text-sub">{task.pendingContext && ['waiting', 'paused'].includes(task.pendingContext.state) ? locked && diaryProtectedTask(task) ? '日记锁定期间，待补信息暂不展示。' : pendingQuestion(task.pendingContext) : task.status === 'planning' || task.status === 'ready' ? '请求还在处理中，结果就绪后会显示在这里。' : '这次没有生成可办理的事项，可以重新描述你的请求。'}</p>}
        {!task.results.length && task.status === 'failed' && <button type="button" disabled={current.secretaryStatus === 'dismissed' || locked && diaryProtectedTask(task)} onClick={() => onDraft(task.request)} className="min-h-11 rounded-xl border border-gene-purple/30 px-3 text-xs text-gene-purple disabled:opacity-40">重新填写请求</button>}
        {!task.dailyReview && task.status === 'finished' && task.pendingContext && ['waiting', 'paused'].includes(task.pendingContext.state)
          && task.employmentId === (current.secretaryEmploymentId ?? `legacy:${current.id}`) && <button type="button" disabled={busy || !!selecting || current.secretaryStatus === 'dismissed' || locked && diaryProtectedTask(task)} onClick={() => void select(task)} className="min-h-11 rounded-xl border border-gene-purple/30 px-3 text-sm text-gene-purple disabled:opacity-40">{selecting === task.id ? '正在核对…' : '继续这件事'}</button>}
      </article></Fragment>)}
      {filtered.length > limit && <button type="button" onClick={() => setLimit(n => n + 20)} className="min-h-11 w-full rounded-xl border border-line text-sm text-ink">再显示20条</button>}
    </div>
  ;
  return embedded ? content : <Modal open={open} onClose={onClose} title="办事收件箱" width="max-w-lg" mobileFullHeight panelClassName="vg-settings-panel" canSnapshotOnExit={() => useAuthStore.getState().userId === userId && diaryAccessAllowed()}>{content}</Modal>;
}
