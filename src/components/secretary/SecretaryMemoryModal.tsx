import { useEffect, useRef, useState } from 'react';
import { liveQuery } from 'dexie';
import { db, type MemoryItem } from '../../db';
import { useAuthStore } from '../../store/auth-store';
import { editSecretaryMemory, readSecretaryMemories } from '../../lib/secretary/memory';
import { Modal } from '../ui/Modal';
import { FeedbackNotice } from '../ui/FeedbackNotice';
import { SecretarySurfaceIntro } from './SecretarySurfaceIntro';

export function SecretaryMemoryModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const userId = useAuthStore(s => s.userId) ?? '';
  const [rows, setRows] = useState<MemoryItem[]>([]);
  const [loaded, setLoaded] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [editing, setEditing] = useState<MemoryItem>(), [text, setText] = useState(''), [busy, setBusy] = useState(false);
  const visibleRows = rows.filter(row => row.userId === userId);
  const lock = useRef(false);
  useEffect(() => {
    setRows([]); setLoaded(false); setEditing(undefined); setText(''); setError(''); setNotice('');
    if (!open || !userId) return;
    const sub = liveQuery(async () => {
      const binding = await db.secretaryBindings.get(userId);
      return binding ? readSecretaryMemories(userId, binding.characterId) : [];
    }).subscribe({ next: items => { setRows(items); setLoaded(true); }, error: () => { setLoaded(true); setError('记忆读取失败，请关闭后重试。'); } });
    return () => sub.unsubscribe();
  }, [open, userId]);
  const change = async (row: MemoryItem, content: string | null) => {
    if (lock.current || row.userId !== userId) return;
    lock.current = true; setBusy(true); setError(''); setNotice('');
    try {
      await editSecretaryMemory(userId, row.characterId, row.id, content, row.updatedAt ?? row.createdAt);
      if (useAuthStore.getState().userId === userId) { setEditing(undefined); setNotice(content === null ? '已忘记，原聊天和办事记录保留。' : '记忆已纠正，下次交流开始使用。'); }
    } catch (e) { if (useAuthStore.getState().userId === userId) setError(e instanceof Error ? e.message : '没有修改成功。'); }
    finally { lock.current = false; setBusy(false); }
  };
  return <Modal open={open} onClose={() => { if (!lock.current) onClose(); }} title="助理记忆" width="max-w-md" mobileFullHeight panelClassName="vg-settings-panel" canSnapshotOnExit={() => useAuthStore.getState().userId === userId}>
    <div className="vg-settings-design vg-secretary-ui vg-secretary-memory space-y-4 p-5">
      <SecretarySurfaceIntro icon="diary" title="记住的事，由你管理" value={loaded ? `${visibleRows.length} 条记忆` : undefined} detail="记住你告诉助理的信息与偏好，换会话或聘用后保留。你可以随时纠正或忘记。办事进展以待办和收件箱中的实际记录为准。" />
      {error && <FeedbackNotice message={error} tone="error" />}
      {notice && <FeedbackNotice message={notice} tone="success" />}
      {!loaded ? <p role="status" className="text-sm text-sub">正在读取…</p> : !visibleRows.length ? <p className="rounded-xl border border-line p-4 text-sm leading-relaxed text-sub">还没有长期记忆。可以在聊天里说“记住：我喜欢简短的回复”。</p> : visibleRows.map(row => <section key={row.id} className="space-y-3 rounded-xl border border-line p-4">
        <p className="text-xs text-sub">{row.memoryKind === 'preference' ? '你的偏好' : '你告诉助理的事'}</p>
        {editing?.id === row.id ? <><textarea aria-label="纠正记忆内容" value={text} maxLength={240} disabled={busy} onChange={e => setText(e.target.value)} className="min-h-24 w-full rounded-xl border border-line bg-surface p-3 text-sm text-ink" /><div className="flex gap-2"><button type="button" disabled={busy || !text.trim()} onClick={() => void change(editing, text)} className="min-h-12 rounded-xl bg-gene-purple px-4 text-sm text-white disabled:opacity-40">保存纠正</button><button type="button" disabled={busy} onClick={() => setEditing(undefined)} className="min-h-12 px-4 text-sm text-sub">取消编辑</button></div></> : <><p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-ink">{row.content}</p><div className="flex gap-2"><button type="button" aria-label={`纠正：${row.content}`} disabled={busy} onClick={() => { setEditing(row); setText(row.content); setError(''); setNotice(''); }} className="min-h-12 rounded-xl border border-line px-4 text-sm text-ink">纠正</button><button type="button" aria-label={`忘记：${row.content}`} disabled={busy} onClick={() => void change(row, null)} className="min-h-12 rounded-xl px-4 text-sm text-sub">忘记</button></div></>}
      </section>)}
    </div>
  </Modal>;
}
