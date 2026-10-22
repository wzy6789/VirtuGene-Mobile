import { useEffect, useState } from 'react';
import { liveQuery } from 'dexie';
import { useAuthStore } from '../../store/auth-store';
import { readMemoryOriginal, type MemoryOriginal } from '../../lib/memory-original';

/** Mounted only while expanded. liveQuery rereads exact dependencies on change. */
export function MemoryOriginals({ userId, characterId, memoryId }: { userId: string; characterId: string; memoryId: string }) {
  const owner = useAuthStore(s => s.userId);
  const [state, setState] = useState<{ value?: MemoryOriginal; error?: boolean }>({});
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let alive = true;
    setState({});
    const current = () => alive && useAuthStore.getState().userId === userId;
    const subscription = liveQuery(() => readMemoryOriginal(userId, characterId, memoryId)).subscribe({
      next: value => { if (current()) setState({ value }); },
      error: () => { if (current()) setState({ error: true }); },
    });
    return () => { alive = false; subscription.unsubscribe(); };
  }, [userId, characterId, memoryId, retry]);
  if (owner !== userId) return null;
  return <div className="mt-1.5 space-y-1 border-l-2 border-life-cyan/40 pl-2">
    {state.error ? <div role="alert"><p className="text-xs text-sub">原话暂时没有读到</p><button type="button" className="vg-button vg-button-ghost" onClick={() => setRetry(n => n + 1)}>重新读取</button></div> : !state.value ?
      <p role="status" className="text-xs text-sub">正在核对原话…</p> : <>
        {state.value.quotes.map(quote => <p key={quote.id} className="text-sm leading-7 text-sub">{quote.text}</p>)}
        {(state.value.unavailable > 0 || !state.value.quotes.length) && <p role="status" className="text-xs leading-6 text-sub">{state.value.quotes.length ? '部分' : ''}{state.value.changed ? '原消息已修改，不再作为这条记忆的原话展示。' : '原话已不可用，可能已删除、清理或撤回。'}</p>}
      </>}
  </div>;
}
