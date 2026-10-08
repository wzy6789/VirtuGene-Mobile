import { useEffect, useState } from 'react';
import type { Character, Message } from '../../db';
import { Modal } from '../ui/Modal';
import { useAuthStore } from '../../store/auth-store';
import { listSpeech, previewSpeech, removeSpeech, saveSpeech, type SpeechPreview, type ReviewedSpeechSample } from '../../lib/chat/reviewed-speech';

export function ReviewedSpeechModal({ character, message, onClose }: { character: Character; message?: Message; onClose: () => void }) {
  const owner = useAuthStore(s => s.userId) ?? '';
  const [preview, setPreview] = useState<SpeechPreview>(), [input, setInput] = useState(''), [reply, setReply] = useState('');
  const [rows, setRows] = useState<Array<{ sample: ReviewedSpeechSample; active: boolean }>>([]);
  const [busy, setBusy] = useState(true), [error, setError] = useState(''), [notice, setNotice] = useState('');
  useEffect(() => {
    let active = true; setBusy(true); setError(''); setPreview(undefined); setRows([]);
    void Promise.all([listSpeech(owner, character.id), message ? previewSpeech(owner, character.id, message.id) : undefined]).then(([items, draft]) => {
      if (!active) return; setRows(items); setPreview(draft); setInput(draft?.input ?? ''); setReply(draft?.reply ?? '');
    }).catch(e => { if (active) setError(e instanceof Error ? e.message : '读取失败。'); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [owner, character.id, message?.id]);
  return <Modal open onClose={onClose} title="角色表达样本" width="max-w-md"><div className="p-4 space-y-4">
    <p className="text-sm text-sub">只学习说话方式，示例中的经历不会成为事实记忆。请先删去姓名等私密细节；采用的内容会随聊天请求发给你使用的模型。</p>
    {preview && <section className="space-y-3">
      <label className="block text-sm">用户说<textarea aria-label="样本用户消息" value={input} maxLength={160} onChange={e => setInput(e.target.value)} rows={2} className="w-full mt-2 rounded-xl bg-surface border border-line p-3 resize-none" /></label>
      <label className="block text-sm">角色回复<textarea aria-label="样本角色回复" value={reply} maxLength={320} onChange={e => setReply(e.target.value)} rows={4} className="w-full mt-2 rounded-xl bg-surface border border-line p-3 resize-none" /></label>
      <button type="button" disabled={busy || !input.trim() || !reply.trim()} className="min-h-11 rounded-xl bg-gene-purple px-4 text-white disabled:opacity-40" onClick={async () => {
        setBusy(true); setError('');
        try { await saveSpeech(owner, preview, input, reply); setRows(await listSpeech(owner, character.id)); setPreview(undefined); setNotice('已采用，下次回复可参考。'); }
        catch (e) { setError(e instanceof Error ? e.message : '采用失败。'); }
        finally { setBusy(false); }
      }}>采用为表达样本</button>
      <button type="button" className="min-h-11 px-3 text-sub" onClick={() => setPreview(undefined)}>放弃预览</button>
    </section>}
    {notice && <p role="status" className="text-sm text-life-cyan">{notice}</p>}
    {busy && <p role="status" className="text-sm text-sub">正在处理…</p>}
    {!busy && !rows.length && <p className="text-sm text-sub">还没有采用的样本。可以长按完整的私聊回复，选择“表达样本”。</p>}
    {rows.map(({ sample, active }) => <section key={sample.id} className="rounded-xl border border-line p-3 space-y-2">
      <p className="text-xs text-sub">{active ? '可供下次回复参考' : '已停用：人物或来源已变化'}</p>
      <p className="text-sm break-words">用户说：{sample.input}</p><p className="text-sm break-words">角色回复：{sample.reply}</p>
      <button type="button" disabled={busy} className="min-h-11 text-sm text-sub" onClick={async () => {
        setBusy(true); setError('');
        try { await removeSpeech(owner, character.id, sample.id); setRows(await listSpeech(owner, character.id)); setNotice('已移除，不再用于后续回复。'); }
        catch (e) { setError(e instanceof Error ? e.message : '移除失败。'); }
        finally { setBusy(false); }
      }}>移除样本</button>
    </section>)}
    {error && <p role="alert" className="text-sm text-red-400 break-words">{error}</p>}
  </div></Modal>;
}
