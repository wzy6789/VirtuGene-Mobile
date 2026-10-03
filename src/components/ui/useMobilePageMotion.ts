import { useCallback, useEffect, useRef } from 'react';
import { MOBILE_TABS, type MobileTab } from '../../store/ui-store';
import { prefersReducedMotion, restoreSnapshotScroll, settleFrames, subscribeReducedMotion, visualSnapshot } from '../../lib/mobile-motion';

interface PagePosition { key: string; tab: MobileTab; depth: number }

interface FrozenPage { node: HTMLElement; x: number; opacity: number }

/** Retain only a frozen outgoing frame, never a second live page or its effects. */
export function useMobilePageMotion(position: PagePosition) {
  const previous = useRef<PagePosition | null>(null);
  const frozen = useRef<FrozenPage | null>(null);
  const active = useRef<{ el: HTMLDivElement; stop: () => void } | null>(null);
  const ref = useCallback((el: HTMLDivElement | null) => {
    if (!el) {
      const live = active.current;
      const owners: HTMLElement[] = [];
      for (let owner = live?.el.parentElement; owner && !owner.classList.contains('mobile-layout'); owner = owner.parentElement) {
        if (owner.matches('[data-page-swipe],[data-swipe-back]')) owners.push(owner);
      }
      if (live && !prefersReducedMotion() && !document.hidden) {
        const style = getComputedStyle(live.el);
        const node = visualSnapshot(live.el);
        let x = style.transform === 'none' ? 0 : new DOMMatrixReadOnly(style.transform).m41;
        for (const owner of owners) {
          const transform = getComputedStyle(owner).transform;
          if (transform !== 'none') x += new DOMMatrixReadOnly(transform).m41;
        }
        frozen.current = node ? { node, x, opacity: Number(style.opacity) } : null;
      }
      // Remove gesture transforms in this same commit, after capturing their
      // visual offset and before the incoming page is mounted inside them.
      owners.forEach(owner => owner.dispatchEvent(new Event('vg:swipe-handoff')));
      live?.stop(); active.current = null;
      return;
    }
    const before = previous.current;
    previous.current = position;
    const frame = frozen.current; frozen.current = null;
    if (!before || before.key === position.key || prefersReducedMotion() || document.hidden) {
      active.current = { el, stop: () => {} }; return;
    }
    const index = (tab: MobileTab) => MOBILE_TABS.findIndex(item => item.key === tab);
    const direction = before.tab !== position.tab ? Math.sign(index(position.tab) - index(before.tab)) : position.depth < before.depth ? -1 : 1;
    const distance = before.depth !== position.depth ? Math.min(56, el.clientWidth * .12) : 26;
    const animations: Animation[] = [];
    let ghost: HTMLElement | null = frame?.node ?? null;
    if (ghost && frame) {
      ghost.classList.add('vg-page-exit'); ghost.style.willChange = 'transform,opacity';
      el.parentElement?.append(ghost);
      restoreSnapshotScroll(ghost);
      const exit = ghost.animate(settleFrames(frame.x, frame.x - direction * 18, frame.opacity, 0), { duration: 180, easing: 'linear' });
      exit.onfinish = () => { ghost?.remove(); ghost = null; };
      animations.push(exit);
    }
    el.style.willChange = 'transform,opacity';
    const enter = el.animate(settleFrames(direction * distance, 0, ghost ? .9 : .96, 1, 'x', 3), { duration: 300, easing: 'linear' });
    animations.push(enter);
    const stop = () => {
      animations.forEach(animation => animation.cancel());
      ghost?.remove(); ghost = null; el.style.willChange = '';
      unsubscribe(); window.removeEventListener('resize', stop);
      document.removeEventListener('visibilitychange', hidden);
    };
    const hidden = () => { if (document.hidden) stop(); };
    enter.onfinish = stop;
    const unsubscribe = subscribeReducedMotion(stop);
    window.addEventListener('resize', stop);
    document.addEventListener('visibilitychange', hidden);
    active.current = { el, stop };
  }, [position.key, position.tab, position.depth]);
  useEffect(() => () => { active.current?.stop(); active.current = null; frozen.current = null; }, []);
  return ref;
}
