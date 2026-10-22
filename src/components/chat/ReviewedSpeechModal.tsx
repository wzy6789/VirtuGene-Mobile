import { useEffect, useRef, useState } from 'react';
import type { Character, Message } from '../../db';
import { Modal } from '../ui/Modal';
import { useAuthStore } from '../../store/auth-store';
import { listSpeech, previewSpeech, removeSpeech, saveSpeech, type SpeechPreview, type ReviewedSpeechSample } from '../../lib/chat/reviewed-speech';
import { LoadingSkeleton } from '../ui/LoadingSkeleton';
import { FeedbackNotice } from '../ui/FeedbackNotice';

export function ReviewedSpeechModal({ character, message, onClose }: { character: Character; message?: Message; onClose: () => void }) {
  const owner = useAuthStore(s => s.userId) ?? '';
  const initialOwner = useRef(owner);
  const valid = !!owner && owner === initialOwner.current;
  useEffect(() => { if (!valid) onClose(); }, [valid, onClose]);
  return valid ? <ReviewedSpeechContent key={`${owner}:${character.id}:${message?.id ?? ''}`} character={character} message={message} onClose={onClose} owner={owner} /> : null;
}

function ReviewedSpeechContent({ character, message, onClose, owner }: { character: Character; message?: Message; onClose: () => void; owner: string }) {
  const [preview, setPreview] = useState<SpeechPreview>(), [input, setInput] = useState(''), [reply, setReply] = useState('');
  const [rows, setRows] = useState<Array<{ sample: ReviewedSpeechSample; active: boolean }>>([]);
  const [busy, setBusy] = useState(true), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [attempt, setAttempt] = useState(0), [readFailed, setReadFailed] = useState(false);
  const lock = useRef(false), mounted = useRef(true), adopted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const current = () => mounted.current && useAuthStore.getState().userId === owner;
  useEffect(() => {
    let active = true; setBusy(true); setError(''); setReadFailed(false); setPreview(undefined); setRows([]);
    void Promise.all([listSpeech(owner, character.id), message && !adopted.current ? previewSpeech(owner, character.id, message.id) : undefined]).then(([items, draft]) => {
      if (!active) return; setRows(items); setPreview(draft); setInput(draft?.input ?? ''); setReply(draft?.reply ?? '');
    }).catch(e => { if (active) { setReadFailed(true); setError(e instanceof Error ? e.message : '读取失败。'); } }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [owner, character.id, message?.id, attempt]);
  const mutate = async (operation: () => Promise<void>, success: string, adopting = false) => {
    if (lock.current || busy || !current()) return;
    lock.current = true; setBusy(true); setError(''); setNotice('');
    try {
      await operation();
      if (!current()) return;
      if (adopting) { adopted.current = true; setPreview(undefined); }
      setNotice(success);
      try { const items = await listSpeech(owner, character.id); if (current()) setRows(items); }
      catch { if (current()) { setReadFailed(true); setError('操作已保存，但列表刷新失败，请重新读取。'); } }
    } catch (e) { if (current()) setError(e instanceof Error ? e.message : '操作失败，请重试。'); }
    finally { lock.current = false; if (current()) setBusy(false); }
  };
  return <Modal open onClose={() => { if (!lock.current) onClose(); }} canSnapshotOnExit={() => false} title="角色表达样本" width="max-w-md"><div className="p-4 space-y-4">
    <p className="text-sm text-sub">只学习说话方式，示例中的经历不会成为事实记忆。请先删去姓名等私密细节；采用的内容会随聊天请求发给你使用的模型。</p>
    {preview && <fieldset disabled={busy} className="space-y-3">
      <label className="block text-sm">用户说<textarea aria-label="样本用户消息" value={input} maxLength={160} onChange={e => setInput(e.target.value)} rows={2} className="w-full mt-2 rounded-xl bg-surface border border-line p-3 resize-none" /></label>
      <label className="block text-sm">角色回复<textarea aria-label="样本角色回复" value={reply} maxLength={320} onChange={e => setReply(e.target.value)} rows={4} className="w-full mt-2 rounded-xl bg-surface border border-line p-3 resize-none" /></label>
      <button type="button" disabled={busy || !input.trim() || !reply.trim()} className="vg-button vg-button-primary" onClick={() => void mutate(() => saveSpeech(owner, preview, input, reply), '已采用，下次回复可参考。', true)}>采用为表达样本</button>
      <button type="button" className="min-h-11 px-3 text-sub" onClick={() => setPreview(undefined)}>放弃预览</button>
    </fieldset>}
    {notice && <p role="status" className="text-sm text-life-cyan">{notice}</p>}
    {busy && <LoadingSkeleton label={lock.current ? '正在保存表达样本' : '正在读取表达样本'} rows={2} />}
    {!busy && !readFailed && !rows.length && <p className="text-sm text-sub">还没有采用的样本。可以长按完整的私聊回复，选择“表达样本”。</p>}
    {rows.map(({ sample, active }) => <section key={sample.id} className="rounded-xl border border-line p-3 space-y-2">
      <p className="text-xs text-sub">{active ? '可供下次回复参考' : '已停用：人物或来源已变化'}</p>
      <p className="text-sm break-words">用户说：{sample.input}</p><p className="text-sm break-words">角色回复：{sample.reply}</p>
      <button type="button" disabled={busy} className="min-h-11 text-sm text-sub" onClick={() => void mutate(() => removeSpeech(owner, character.id, sample.id), '已移除，不再用于后续回复。')}>移除样本</button>
    </section>)}
    {error && <FeedbackNotice tone="error" message={error}>{readFailed && <button disabled={busy} type="button" className="min-h-11" onClick={() => setAttempt(n => n + 1)}>重新读取</button>}</FeedbackNotice>}
  </div></Modal>;
}
