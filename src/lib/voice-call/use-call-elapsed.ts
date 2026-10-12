import { useEffect, useState } from 'react';

/** Wall-clock duration; hidden views do not run a clock or accumulate timer drift. */
export function useCallElapsed(startedAt: number | undefined, endedAt: number | undefined, running: boolean, visible: boolean) {
  const [clock, setClock] = useState(() => ({ startedAt, now: Date.now() }));
  useEffect(() => {
    const update = () => setClock({ startedAt, now: Date.now() });
    update();
    if (!startedAt || endedAt !== undefined || !running || !visible) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    const sync = () => {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
      if (!document.hidden) { update(); timer = setInterval(update, 1000); }
    };
    sync(); document.addEventListener('visibilitychange', sync);
    return () => { if (timer !== undefined) clearInterval(timer); document.removeEventListener('visibilitychange', sync); };
  }, [startedAt, endedAt, running, visible]);
  if (!startedAt) return 0;
  const now = endedAt ?? (clock.startedAt === startedAt ? clock.now : Date.now());
  return Math.max(0, Math.floor((now - startedAt) / 1000));
}
