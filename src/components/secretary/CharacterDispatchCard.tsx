import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { liveQuery } from 'dexie';
import { db, type Character, type Message } from '../../db';
import { useAuthStore } from '../../store/auth-store';
import { useChatStore } from '../../store/chat-store';
import { useUIStore } from '../../store/ui-store';
import { useSettingsStore } from '../../store/settings-store';
import { isDiaryUnlocked, subscribeDiaryUnlock } from '../../lib/diary-unlock';
import type { SecretaryTask } from '../../lib/secretary/types';
import { messagingRecipients, readCharacterDispatchReplies, updateCharacterDispatch } from '../../lib/secretary/character-messaging';
import { DISPATCH_LABELS } from '../../lib/secretary/dispatch-status';
import { Avatar } from '../ui/Avatar';
import { ModelPickModal } from '../chat/ModelPickModal';

export function CharacterDispatchCard({ userId, taskId }: { userId: string; taskId: string }) {
  const [task, setTask] = useState<SecretaryTask>();
  const [characters, setCharacters] = useState<Character[]>([]);
  const [replies, setReplies] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const [recipient, setRecipient] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [modelPick, setModelPick] = useState(false);
  const lock = useRef(false);
  const authId = useAuthStore(s => s.userId);
  const diaryPin = useSettingsStore(s => s.diaryPin);
  const unlocked = useSyncExternalStore(subscribeDiaryUnlock, isDiaryUnlocked, isDiaryUnlocked);
  const locked = task?.privacyScope !== 'plain' && !!diaryPin && !unlocked;
  useEffect(() => {
    setTask(undefined); setReplies([]);
    const sub = liveQuery(async () => {
      const task = await db.secretaryTasks.get(taskId);
      if (!task || task.userId !== userId || useAuthStore.getState().userId !== userId) return undefined;
      const characters = await messagingRecipients(userId);
      const assistant = await db.characters.get(task.characterId);
      const binding = await db.secretaryBindings.get(userId);
      const inactive = !assistant || assistant.secretaryStatus === 'dismissed' || !!binding && (binding.status === 'dismissed' || binding.characterId !== task.characterId || binding.employmentId !== task.employmentId);
      return { task, characters, replies: await readCharacterDispatchReplies(userId, taskId), inactive };
    }).subscribe({ next: value => { setTask(value?.task); setCharacters(value?.characters ?? []); setReplies(value?.replies ?? []); setInactive(value?.inactive ?? true); }, error: () => { setTask(undefined); setReplies([]); } });
    return () => sub.unsubscribe();
  }, [userId, taskId]);
  const [inactive, setInactive] = useState(false);
  const result = task?.results[0], d = result?.dispatch;
  useEffect(() => { setText(result?.action.content ?? ''); setRecipient(d?.recipientId ?? ''); }, [result?.action.content, d?.recipientId]);
  const run = async (patch: Parameters<typeof updateCharacterDispatch>[3]) => {
    if (!task || locked || lock.current && !patch.cancel && !patch.pause || authId !== userId) return;
    lock.current = true; setBusy(true); setError(''); setNotice('');
    try {
      await updateCharacterDispatch(userId, taskId, task.updatedAt, patch);
      if (!patch.send && !patch.cancel && !patch.pause && !patch.resume) setNotice('草稿已保存，尚未发送。');
    }
    catch (e) { setError(e instanceof Error ? e.message : '代发未能继续，请重试。'); }
    finally { lock.current = false; setBusy(false); }
  };
  const open = async () => {
    if (!d?.recipientId || authId !== userId) return;
    const target = await db.characters.get(d.recipientId);
    const session = d.targetSessionId ? await db.sessions.get(d.targetSessionId) : undefined;
    if (!target || target.createdBy !== userId || target.agentProfile === 'secretary' || !session || session.userId !== userId) { setError('原聊天已不可用。'); return; }
    // Open this specific conversation, rather than guessing the latest character session.
    await useChatStore.getState().selectCharacter(target.id, session.id);
    if (useAuthStore.getState().userId !== userId) return;
    useUIStore.setState({ mobileTab: 'chat', activeView: 'chat', chatFromList: true, chatFromCharacters: false });
  };
  if (!task || !d || authId !== userId) return null;
  if (locked) return <section className="rounded-2xl border border-line bg-panel p-3"><p className="text-sm text-sub">这份恢复记录的资料来源尚未核实，请先解锁日记再查看。</p></section>;
  const target = characters.find(c => c.id === d.recipientId);
  const editable = !d.outboundMessageId && ['needs-recipient', 'needs-content', 'draft', 'needs-model', 'paused'].includes(d.state);
  const dirty = text !== (result.action.content ?? '') || recipient !== (d.recipientId ?? '');
  const stoppable = ['queued', 'generating'].includes(d.state);
  const choices = [...characters].sort((a, b) => Number(d.candidates?.some(c => c.id === b.id) ?? false) - Number(d.candidates?.some(c => c.id === a.id) ?? false));
  return <section className="vg-secretary-ui rounded-2xl border border-line bg-panel p-3 min-w-0" aria-label="角色代发消息" data-dispatch-state={d.state}>
    <div className="flex items-center gap-2 min-w-0">{target && <Avatar avatar={target.avatar} size="sm" />}<div className="min-w-0"><p className="text-sm font-medium text-ink break-words">{target?.name ?? d.recipientName ?? '选择收件角色'}</p><p role="status" className="mt-1 text-xs text-sub break-words">{d.stopRequested && d.state === 'generating' ? '正在停止回复生成…' : d.state === 'replied' && !replies.length ? '回复记录已不可用' : DISPATCH_LABELS[d.state]}</p></div></div>
    {editable ? <div className="mt-3 space-y-2">
      <label className="block text-xs text-sub">收件角色<select aria-label="代发收件角色" value={recipient} disabled={busy || inactive} onChange={e => setRecipient(e.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-line bg-surface px-3 text-sm text-ink"><option value="">请选择</option>{choices.map(c => <option key={c.id} value={c.id}>{c.name}{c.signature ? ` · ${c.signature.slice(0, 36)}` : ''}</option>)}</select></label>
      <textarea aria-label="代发消息正文" value={text} maxLength={6000} rows={3} disabled={busy || inactive} onChange={e => setText(e.target.value)} placeholder="想对这个角色说什么？" className="w-full rounded-xl border border-line bg-surface p-3 text-sm text-ink" />
      <div className="flex flex-wrap gap-2">
        {d.state !== 'needs-model' && <button type="button" disabled={busy || inactive || !recipient || !text.trim()} onClick={() => void run({ recipientId: recipient, content: text, send: true })} className="min-h-11 rounded-xl bg-gene-purple px-4 text-sm text-white">{busy ? '正在处理…' : '发送这一版'}</button>}
        <button type="button" disabled={busy || inactive || !dirty} onClick={() => void run({ recipientId: recipient, content: text })} className="min-h-11 rounded-xl border border-line px-3 text-sm text-ink">保存草稿</button>
      </div>
    </div> : <p className="mt-2 line-clamp-2 text-sm text-ink whitespace-pre-wrap break-words">{result.action.content}</p>}
    {editable && <p role="status" className="mt-2 text-xs text-sub">{dirty ? '修改尚未保存。保存或暂停都会保留当前内容。' : notice}</p>}
    {replies.length > 0 && <div className="mt-3 rounded-xl bg-surface p-3"><p className="text-xs text-sub">角色的实际回复</p><p className="mt-1 line-clamp-3 whitespace-pre-wrap break-words text-sm text-ink">{replies.map(m => m.content).join('\n')}</p></div>}
    {inactive && <p className="mt-2 text-xs text-sub">助理任期已变化，记录保留；原代发不会自动继续。</p>}
    {(error || d.error) && <p role="alert" className="mt-2 text-xs text-red-400">{error || d.error}</p>}
    <div className="mt-2 flex flex-wrap gap-2">
      {d.state === 'needs-model' && <button type="button" disabled={busy || inactive || !recipient || !text.trim()} onClick={() => setModelPick(true)} className="min-h-11 rounded-xl bg-gene-purple px-3 text-sm text-white">选择角色对话模型</button>}
      {d.outboundMessageId && <button type="button" onClick={() => void open()} className="min-h-11 rounded-xl border border-line px-3 text-sm text-ink">{replies.length ? '查看完整回复' : '查看原聊天'}</button>}
      {['reply-failed', 'reply-unavailable', 'interrupted'].includes(d.state) && !d.replyMessageIds.length && <button type="button" disabled={busy || inactive} onClick={() => void run({ send: true })} className="min-h-11 rounded-xl border border-gene-purple/30 px-3 text-sm text-gene-purple">只重试回复</button>}
      {(editable || stoppable || d.state === 'needs-model') && <button type="button" disabled={inactive || d.stopRequested} onClick={() => void run({ cancel: true })} className="min-h-11 px-3 text-sm text-sub">{d.outboundMessageId ? '停止回复生成' : '取消发送'}</button>}
      {editable && d.state !== 'paused' && <button type="button" disabled={busy || inactive} onClick={() => void run({ recipientId: recipient, content: text, pause: true })} className="min-h-11 px-3 text-sm text-sub">先放着</button>}
      {editable && d.state === 'paused' && <button type="button" disabled={busy || inactive} onClick={() => void run({ recipientId: recipient, content: text, resume: true })} className="min-h-11 px-3 text-sm text-sub">继续编辑</button>}
    </div>
    <details className="mt-2 text-xs text-sub"><summary className="min-h-11 flex items-center cursor-pointer">正文与来源</summary><p className="whitespace-pre-wrap break-words">{result.action.content}</p>{replies.map(reply => <p key={reply.id} className="mt-2 whitespace-pre-wrap break-words">{reply.content}</p>)}<p className="mt-2">{task.assistantName}代发 · {d.bodyOrigin === 'literal' ? '用户原话' : d.bodyOrigin === 'edited' ? '用户编辑稿' : '助理拟稿，经用户确认后才发送'}</p></details>
    {modelPick && <ModelPickModal onClose={() => setModelPick(false)} onPick={model => { setModelPick(false); void run({ recipientId: recipient, content: text, model, send: true }); }} />}
  </section>;
}
