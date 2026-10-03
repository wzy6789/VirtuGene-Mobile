import { useCallback, useEffect, useRef } from 'react';
import { prefersReducedMotion, subscribeReducedMotion, restoreSnapshotScroll, settleFrames, visualSnapshot } from '../../lib/mobile-motion';

interface DetailMotionOptions {
  page: string;
  open: boolean;
  owner: string | null;
  direction: 1 | -1;
  scrollTop: number;
  allowSnapshot: boolean;
}

/** One live form; the outgoing, non-sensitive page is only a short visual. */
export function useSettingsDetailMotion(options: DetailMotionOptions) {
  const latest = useRef(options);
  latest.current = options;
  const previous = useRef<{ page: string; owner: string | null } | null>(null);
  const active = useRef<{ node: HTMLDivElement; page: string; owner: string | null; allowSnapshot: boolean; clear: () => void } | null>(null);
  const pending = useRef<{ node: HTMLElement; page: string; owner: string | null; x: number; opacity: number; scrollTop: number } | null>(null);

  const ref = useCallback((node: HTMLDivElement | null) => {
    const next = latest.current;
    if (!node) {
      const live = active.current;
      pending.current = null;
      if (!live) return;
      if (next.open && live.owner === next.owner && live.page !== next.page && live.allowSnapshot && !prefersReducedMotion() && !document.hidden) {
        const style = getComputedStyle(live.node);
        const snapshot = visualSnapshot(live.node);
        if (snapshot) pending.current = {
          node: snapshot, page: live.page, owner: live.owner,
          x: style.transform === 'none' ? 0 : new DOMMatrixReadOnly(style.transform).m41,
          opacity: Number(style.opacity),
          scrollTop: live.node.closest('[data-modal-scroll]')?.scrollTop ?? 0,
        };
      }
      live.clear(); active.current = null;
      return;
    }

    const frame = pending.current;
    pending.current = null;
    const before = previous.current;
    previous.current = { page: next.page, owner: next.owner };
    const scroller = node.closest('[data-modal-scroll]');
    if (scroller) scroller.scrollTop = next.scrollTop;
    let ghost: HTMLElement | null = null;
    let unsubscribe = () => {};
    const animations: Animation[] = [];
    const clear = () => {
      animations.forEach(animation => animation.cancel());
      ghost?.remove(); ghost = null;
      node.style.willChange = '';
      node.removeAttribute('data-settings-entering');
      unsubscribe();
      window.removeEventListener('resize', clear);
      window.visualViewport?.removeEventListener('resize', clear);
      document.removeEventListener('visibilitychange', hidden);
    };
    const hidden = () => { if (document.hidden) clear(); };
    if (next.open && before?.owner === next.owner && before.page !== next.page && !prefersReducedMotion() && !document.hidden) {
      if (frame && frame.owner === next.owner && frame.page !== next.page) {
        ghost = frame.node;
        ghost.classList.add('vg-settings-detail-exit');
        ghost.style.top = `${node.offsetTop + (scroller?.scrollTop ?? 0) - frame.scrollTop}px`;
        node.parentElement?.append(ghost);
        restoreSnapshotScroll(ghost);
        const exit = ghost.animate(settleFrames(frame.x, frame.x - next.direction * 14, frame.opacity, 0, 'x', 3), { duration: 190, easing: 'linear' });
        exit.onfinish = () => { ghost?.remove(); ghost = null; };
        animations.push(exit);
      }
      node.style.willChange = 'transform,opacity';
      node.setAttribute('data-settings-entering', next.direction === 1 ? 'forward' : 'back');
      const enter = node.animate(settleFrames(next.direction * 24, 0, .92, 1, 'x', 3), { duration: 320, easing: 'linear' });
      enter.onfinish = clear;
      animations.push(enter);
      unsubscribe = subscribeReducedMotion(clear);
      window.addEventListener('resize', clear);
      window.visualViewport?.addEventListener('resize', clear);
      document.addEventListener('visibilitychange', hidden);
    }
    active.current = { node, page: next.page, owner: next.owner, allowSnapshot: next.allowSnapshot, clear };
  }, [options.page, options.open, options.owner]);

  useEffect(() => () => { active.current?.clear(); active.current = null; pending.current = null; }, []);
  return ref;
}
