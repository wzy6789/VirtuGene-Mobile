import { useLayoutEffect, useRef, type RefObject } from 'react';
import { prefersReducedMotion, subscribeReducedMotion } from '../../lib/mobile-motion';

/** Keep one live disclosure: reversals and late data continue from its painted height. */
export function useSecretaryDisclosureMotion(
  expanded: boolean,
  ownerId: string | null | undefined,
  viewportRef: RefObject<HTMLDivElement | null>,
  contentRef: RefObject<HTMLDivElement | null>,
) {
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;
  const transitionRef = useRef<(() => void) | null>(null);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport || !content) return;

    let animation: Animation | undefined;
    let settledHeight = expandedRef.current ? content.getBoundingClientRect().height : 0;
    let contentHeight = content.getBoundingClientRect().height;
    let disposed = false;

    const settle = () => {
      const oldAnimation = animation;
      animation = undefined;
      oldAnimation?.cancel();
      viewport.style.removeProperty('height');
      viewport.dataset.disclosureState = expandedRef.current ? 'open' : 'closed';
      settledHeight = expandedRef.current ? content.getBoundingClientRect().height : 0;
    };

    const transition = (resizing = false) => {
      if (disposed) return;
      const open = expandedRef.current;
      const targetHeight = open ? content.getBoundingClientRect().height : 0;
      // At rest the height is auto. ResizeObserver runs before paint, so start a
      // data/width resize at the previous height rather than the new auto height.
      const fromHeight = animation ? viewport.getBoundingClientRect().height : settledHeight;
      const distance = Math.abs(targetHeight - fromHeight);
      if (prefersReducedMotion() || typeof viewport.animate !== 'function' || distance < .5) {
        settle();
        return;
      }

      animation?.cancel();
      viewport.dataset.disclosureState = open ? 'opening' : 'closing';
      viewport.style.height = `${targetHeight}px`;
      const duration = Math.min(resizing ? 280 : open ? 380 : 300, Math.max(150, 140 + distance * .9));
      const next = viewport.animate(
        [{ height: `${fromHeight}px` }, { height: `${targetHeight}px` }],
        { duration, easing: open ? 'cubic-bezier(.22,.8,.22,1)' : 'cubic-bezier(.3,0,.22,1)' },
      );
      animation = next;
      next.onfinish = () => { if (animation === next && !disposed) settle(); };
    };

    settle();
    transitionRef.current = () => transition();
    const observer = new ResizeObserver(() => {
      const nextHeight = content.getBoundingClientRect().height;
      if (Math.abs(nextHeight - contentHeight) < .5) return;
      contentHeight = nextHeight;
      if (expandedRef.current) transition(true);
    });
    observer.observe(content);
    const unsubscribe = subscribeReducedMotion(() => { if (prefersReducedMotion()) settle(); });
    return () => {
      disposed = true;
      observer.disconnect();
      unsubscribe();
      transitionRef.current = null;
      animation?.cancel();
      viewport.style.removeProperty('height');
      delete viewport.dataset.disclosureState;
    };
  }, [ownerId, viewportRef, contentRef]);

  useLayoutEffect(() => { transitionRef.current?.(); }, [expanded, ownerId]);
}
