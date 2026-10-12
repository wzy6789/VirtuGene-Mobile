import { useEffect, useRef, useState } from 'react';
import { Modal } from '../ui/Modal';
import { voiceCallRepo } from '../../db/voice-call-repo';
import { confirmedCallSpeech, projectCallMessages, type VoiceCallRecord } from '../../lib/voice-call/record';
import { chunkCallSummary, summarizeVoiceCall } from '../../lib/voice-call/summary';
import { useAuthStore } from '../../store/auth-store';
import { extractVoiceCallMemory } from '../../lib/voice-call/memory';

export function VoiceCallHistory({ sessionId, userId, name, onClose }: { sessionId: string; userId: string; name: string; onClose: () => void }) {
  const [records, setRecords] = useState<VoiceCallRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [working, setWorking] = useState<string>();
  const [error, setError] = useState('');
  const live = useRef(true), request = useRef<AbortController | undefined>(undefined);
  const valid = () => live.current && useAuthStore.getState().userId === userId;
  const load = async (before?: number, beforeId?: string) => {
    setLoading(true); setError('');
    try {
      const rows = await voiceCallRepo.list(sessionId, userId, { before, beforeId, limit: 20 });
      if (valid()) { setRecords(previous => before === undefined ? rows : [...previous, ...rows]); setMore(rows.length === 20); }
    } catch { if (valid()) setError('记录暂未读到，请重新打开。'); }
    finally { if (valid()) setLoading(false); }
  };
  useEffect(() => {
    live.current = true; void load();
    const unsubscribe = useAuthStore.subscribe(state => { if (state.userId !== userId) { request.current?.abort(); setRecords([]); onClose(); } });
    return () => { live.current = false; request.current?.abort(); unsubscribe(); };
  }, [sessionId, userId]);
  const summarize = async (id: string, memory = false) => {
    if (working || !valid()) return;
    const signal = new AbortController(); request.current = signal; setWorking(id); setError('');
    try { if (memory) await extractVoiceCallMemory(id, userId, signal.signal); else await summarizeVoiceCall(id, userId, signal.signal); }
    catch { if (valid() && !signal.signal.aborted) setError('未完成的部分已保留，可以稍后继续。'); }
    finally {
      try {
        const row = await voiceCallRepo.get(id, userId);
        if (row && valid()) setRecords(previous => previous.map(item => item.id === id ? row : item));
      } finally { if (valid()) setWorking(undefined); }
    }
  };
  return <Modal open title={`${name} · 通话记录`} onClose={onClose} mobileFullHeight canSnapshotOnExit={() => useAuthStore.getState().userId === userId}>
    <div className="p-4 space-y-4">
      {loading && !records.length && <p role="status">正在打开交流记录…</p>}
      {!loading && !records.length && <p className="text-sm text-sub">还没有通话记录。结束后的交流会保留在这里。</p>}
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
      {records.map(record => <article key={record.id} className="rounded-xl border border-line p-4 space-y-3">
        <header className="flex justify-between gap-3 text-sm"><time>{new Date(record.startedAt).toLocaleString('zh-CN')}</time><span className="text-sub">{Math.floor(Math.max(0, record.endedAt - record.startedAt) / 60000)}:{String(Math.floor(Math.max(0, record.endedAt - record.startedAt) / 1000) % 60).padStart(2, '0')} · {record.voice}</span></header>
        <p className="text-sm leading-relaxed whitespace-pre-wrap">{record.summary || '原文已保留，尚未整理摘要。'}</p>
        {record.status === 'active' && <p className="text-xs text-sub">结束状态尚未确认，已保存 {record.exchanges.length} 轮交流。</p>}
        {record.status !== 'active' && <div className="text-xs text-sub"><p>记忆检查：{record.memoryProgress ? `已检查 ${record.memoryProgress.completed} 条 · 待检查 ${record.memoryProgress.pending} 条 · 异常 ${record.memoryProgress.failed} 条` : '尚未检查'}（检查完成不代表每条都写入记忆）</p>{(!record.memoryProgress || record.memoryProgress.pending > 0) && <button disabled={!!working} onClick={() => void summarize(record.id, true)} className="min-h-12 text-life-cyan">继续检查记忆（MiMo，最多 1 次）</button>}</div>}
        {record.summaryState !== 'ready' && <div><p className="text-xs text-sub">已整理 {record.summaryParts?.length ?? 0}/{record.summaryTotalParts ?? chunkCallSummary(projectCallMessages(record)).length} 段</p><button disabled={!!working} onClick={() => void summarize(record.id)} className="mt-2 min-h-12 text-sm text-life-cyan">{working === record.id ? '正在整理…' : '继续整理（调用 MiMo，最多 4 次）'}</button></div>}
        <details><summary className="min-h-12 flex items-center cursor-pointer text-sm">实际交流原文</summary><div className="space-y-3 pt-2">{record.exchanges.filter(exchange => exchange.userText).map(exchange => <div key={exchange.turnId} className="text-sm leading-relaxed whitespace-pre-wrap"><p><span className="text-sub">你：</span>{exchange.userText}</p>{confirmedCallSpeech(exchange) && <p><span className="text-sub">{name}：</span>{confirmedCallSpeech(exchange)}</p>}{exchange.interrupted && <small className="text-sub">本轮曾中断，仅列出完整播放的台词。</small>}</div>)}</div></details>
      </article>)}
      {more && <button disabled={loading} onClick={() => void load(records[records.length - 1]?.endedAt, records[records.length - 1]?.id)} className="min-h-12 w-full text-sm">{loading ? '正在读取…' : '更早的通话'}</button>}
    </div>
  </Modal>;
}
