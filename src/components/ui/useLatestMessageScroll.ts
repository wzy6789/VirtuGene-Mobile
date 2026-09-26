import { useCallback, useEffect, useRef, type RefObject } from 'react';

/** Recheck after layout/keyboard animation; coalesce bursts and cancel on exit. */
export function useLatestMessageScroll(ref: RefObject<HTMLDivElement | null>) {
  const pending = useRef<{ frame: number; timers: ReturnType<typeof setTimeout>[] }>({ frame: 0, timers: [] });
  const cancel = useCallback(() => {
    cancelAnimationFrame(pending.current.frame);
    pending.current.timers.forEach(clearTimeout);
    pending.current.timers = [];
  }, []);
  const scroll = useCallback(() => {
    cancel();
    const bottom = () => { const element = ref.current; if (element) element.scrollTop = element.scrollHeight; };
    bottom();
    pending.current.frame = requestAnimationFrame(() => {
      bottom();
      pending.current.frame = requestAnimationFrame(bottom);
    });
    pending.current.timers = [setTimeout(bottom, 120), setTimeout(bottom, 360)];
    return cancel;
  }, [ref, cancel]);
  useEffect(() => {
    const resize = () => { scroll(); };
    window.addEventListener('resize', resize);
    window.visualViewport?.addEventListener('resize', resize);
    const observer = new ResizeObserver(resize);
    if (ref.current) observer.observe(ref.current);
    return () => {
      window.removeEventListener('resize', resize);
      window.visualViewport?.removeEventListener('resize', resize);
      observer.disconnect();
      cancel();
    };
  }, [ref, scroll, cancel]);
  return scroll;
}
