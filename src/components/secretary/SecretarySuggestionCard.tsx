import { useEffect, useRef, useState } from 'react';
import { liveQuery } from 'dexie';
import { useAuthStore } from '../../store/auth-store';
import { useUIStore } from '../../store/ui-store';
import { db } from '../../db';
import { disableSecretarySuggestions, dismissSecretarySuggestion, readSecretarySuggestion, markSecretarySuggestionShown, type SecretarySuggestion } from '../../lib/secretary/proactive';

export function SecretarySuggestionCard({ userId, onContinue }: { userId: string; onContinue: () => void }) {
  const [suggestion, setSuggestion] = useState<SecretarySuggestion>();
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [revision, setRevision] = useState(0);
  const visible = useRef<{ userId: string; key?: string }>({ userId });
  if (visible.current.userId !== userId) visible.current = { userId };
  useEffect(() => {
    setSuggestion(undefined); setError('');
    const subscription = liveQuery(() => readSecretarySuggestion(userId, new Date(), visible.current.key)).subscribe({ next: value => {
      visible.current.key = value?.key;
      setSuggestion(value);
    }, error: () => setSuggestion(undefined) });
    const refresh = () => { if (document.visibilityState === 'visible') setRevision(r => r + 1); };
    document.addEventListener('visibilitychange', refresh);
    const timer = setTimeout(refresh, 60000);
    return () => { subscription.unsubscribe(); document.removeEventListener('visibilitychange', refresh); clearTimeout(timer); };
  }, [userId, revision]);
  useEffect(() => {
    if (suggestion && document.visibilityState === 'visible') void markSecretarySuggestionShown(userId, suggestion.key).catch(() => undefined);
  }, [userId, suggestion]);
  if (!suggestion || useAuthStore.getState().userId !== userId) return null;
  const run = async (work: () => Promise<unknown>) => {
    if (busy) return; setBusy(true); setError('');
    try { await work(); } catch { setError('未处理成功，请重试。'); } finally { setBusy(false); }
  };
  const view = async () => {
    if (!suggestion.todoId) { onContinue(); return; }
    const todo = await db.todos.get(suggestion.todoId);
    if (todo?.userId !== userId || todo.status !== 'todo' || useAuthStore.getState().userId !== userId) return;
    useUIStore.setState({ chatFromList: false, chatFromCharacters: false, activeView: 'todo', mobileTab: 'world', lifeRecordFocus: { userId, kind: 'todo', id: todo.id, date: suggestion.date } });
  };
  return <aside aria-label="助理主动协助" className="mx-3 mb-3 rounded-xl border border-line p-3 text-sm text-ink">
    <p className="break-words leading-relaxed">{suggestion.text}</p>
    <div className="mt-2 flex flex-wrap gap-3"><button type="button" disabled={busy} onClick={() => void run(view)} className="min-h-11 text-gene-purple">{suggestion.todoId ? '查看安排' : '进入对话'}</button>
      <button type="button" disabled={busy} onClick={() => void run(() => dismissSecretarySuggestion(userId, suggestion.key))} className="min-h-11 text-sub">忽略</button>
      <button type="button" disabled={busy} onClick={() => void run(() => dismissSecretarySuggestion(userId, suggestion.key, Date.now() + 3600000))} className="min-h-11 text-sub">一小时后再看</button>
      <button type="button" disabled={busy} onClick={() => void run(() => disableSecretarySuggestions(userId))} className="min-h-11 text-sub">关闭协助</button>
    </div>{error && <p role="alert">{error}</p>}
  </aside>;
}
