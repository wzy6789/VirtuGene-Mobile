import { useEffect, useState } from 'react';
import { liveQuery } from 'dexie';
import { readActionDay } from './query';
import { useAuthStore } from '../../store/auth-store';

export function useActionDay(userId: string | null) {
  const [state, setState] = useState<{ owner: string; data?: Awaited<ReturnType<typeof readActionDay>>; error?: string }>();
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    const subscription = liveQuery(() => readActionDay(userId)).subscribe({
      next: data => { if (alive && useAuthStore.getState().userId === userId) setState({ owner: userId, data }); },
      error: () => { if (alive && useAuthStore.getState().userId === userId) setState({ owner: userId, error: '事项读取失败，请重试。' }); },
    });
    const refresh = () => setRevision(v => v + 1);
    const visible = () => { if (!document.hidden) refresh(); };
    window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', visible);
    // Re-read after clock/timezone changes and deadline boundaries; no day cache.
    const timer = window.setInterval(() => { if (!document.hidden) refresh(); }, 60000);
    const now = new Date(), midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const dayTimer = window.setTimeout(refresh, midnight.getTime() - now.getTime() + 50);
    return () => { alive = false; subscription.unsubscribe(); window.clearInterval(timer); window.clearTimeout(dayTimer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', visible); };
  }, [userId, revision]);
  return { ...(state?.owner === userId ? state : {}), retry: () => setRevision(v => v + 1) };
}
