import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { Character } from '../../db';
import { memoryRepo } from '../../db/memory-repo';
import { useAuthStore } from '../../store/auth-store';
import { subscribeMemoryWrites, type MemoryWriteReceipt as Receipt } from '../../lib/memory-write-events';
import { Icon } from '../ui/Icon';
import '../../styles/conversation-continuity.css';

const Archive = lazy(() => import('../character/MemoryArchiveModal').then(module => ({ default: module.MemoryArchiveModal })));
export function MemoryWriteReceipt({ character, sessionId, userId }: { character: Character; sessionId: string; userId: string }) {
  const [receipt, setReceipt] = useState<Receipt>();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const activeOwner = useAuthStore(state => state.userId);
  const latest = useRef<Receipt | undefined>(undefined);
  const alive = useRef(true), locked = useRef(false);
  useEffect(() => {
    alive.current = true;
    const unsubscribe = subscribeMemoryWrites(next => {
      if (useAuthStore.getState().userId !== userId || next.memory.userId !== userId || next.memory.characterId !== character.id
        || (next.sessionId ?? next.memory.sourceSessionId) !== sessionId) return;
      latest.current = next; setReceipt(next); setNotice(''); setOpen(false);
    });
    return () => { alive.current = false; unsubscribe(); };
  }, [character.id, sessionId, userId]);
  const current = () => alive.current && useAuthStore.getState().userId === userId;
  const undo = async () => {
    if (!receipt || locked.current || !current()) return;
    const target = receipt;
    locked.current = true; setBusy(true);
    try {
      const result = await memoryRepo.undoRemember(target, userId, character.id, sessionId, current);
      if (!current() || latest.current !== target) return;
      setReceipt(value => value === target && result === 'undone' ? undefined : value);
      setNotice(result === 'undone' ? '已撤销这次记忆' : result === 'changed' ? '记忆后来已变化，未撤销；可打开查看。' : '这条记忆已不可用。');
    } catch { if (current()) setNotice('撤销未完成，请重试。'); }
    finally { locked.current = false; if (current()) setBusy(false); }
  };
  if (activeOwner !== userId || (!receipt && !notice)) return null;
  return <>
    <div className="vg-memory-receipt">
      <span role="status">{notice || (receipt?.created ? '已记住' : '这条已经记住')}</span>
      {receipt && <button type="button" disabled={busy} onClick={() => setOpen(true)}>查看记忆与来源</button>}
      {receipt?.created && !notice && <button type="button" disabled={busy} onClick={() => void undo()}>{busy ? '正在撤销…' : '撤销'}</button>}
      <button type="button" className="vg-receipt-close" aria-label="收起记忆提示" disabled={busy} onClick={() => { setReceipt(undefined); setNotice(''); setOpen(false); }}><Icon name="close" size={16}/></button>
    </div>
    {open && receipt && <Suspense fallback={null}><Archive open character={character} userId={userId} focusMemoryId={receipt.memory.id} onClose={() => setOpen(false)} /></Suspense>}
  </>;
}
