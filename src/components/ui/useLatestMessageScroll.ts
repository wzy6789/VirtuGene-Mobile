import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { prefersReducedMotion } from '../../lib/mobile-motion';

/** Recheck after layout/keyboard animation; coalesce bursts and cancel on exit. */
export function useLatestMessageScroll(ref: RefObject<HTMLDivElement | null>, sessionKey?: string | null, onFollowingChange?: (following: boolean) => void) {
  const pending = useRef<{ frame: number; timers: ReturnType<typeof setTimeout>[] }>({ frame: 0, timers: [] });
  const following = useRef(true);
  const interacting = useRef(false);
  const returning = useRef(false);
  const sequence = useRef(0);
  const geometry = useRef({ node: null as HTMLDivElement | null, extent: 0, viewport: 0, dirty: true });
  const ownScrollTop = useRef<number | null>(null);
  const listener = useRef(onFollowingChange);
  listener.current = onFollowingChange;
  // Content/viewport observers invalidate dimensions. Animation frames reuse
  // them instead of forcing layout again after every scrollTop write.
  const measure = useCallback((node: HTMLDivElement, fresh = false) => {
    const size = geometry.current;
    if (fresh || size.dirty || size.node !== node) {
      size.node = node; size.extent = node.scrollHeight; size.viewport = node.clientHeight; size.dirty = false;
    }
    return size;
  }, []);
  const writeScroll = useCallback((node: HTMLDivElement, target: number, current = node.scrollTop) => {
    const top = Math.max(0, target);
    if (Math.abs(top - current) <= .5) return;
    ownScrollTop.current = top;
    node.scrollTop = top;
  }, []);
  const setFollowing = useCallback((value: boolean) => {
    if (following.current === value) return;
    following.current = value;
    listener.current?.(value);
  }, []);
  const cancel = useCallback(() => {
    sequence.current++;
    returning.current = false;
    cancelAnimationFrame(pending.current.frame);
    pending.current.frame = 0;
    pending.current.timers.forEach(clearTimeout);
    pending.current.timers = [];
  }, []);
  const scroll = useCallback((force = false, behavior: 'instant' | 'smooth' = 'instant') => {
    // The current return already tracks the live target. Token/layout updates
    // should not replace it with an instantaneous jump.
    if (returning.current && !force) return () => {};
    if (force) { interacting.current = false; setFollowing(true); }
    if (!following.current || interacting.current) return () => {};
    cancel();
    geometry.current.dirty = true;
    const requestSequence = sequence.current;
    const cancelRequest = () => { if (sequence.current === requestSequence) cancel(); };
    const bottom = () => {
      const element = ref.current;
      if (element && following.current && !interacting.current) {
        const size = measure(element);
        writeScroll(element, size.extent - size.viewport);
      }
    };
    const node = ref.current;
    if (force && behavior === 'smooth' && node && !prefersReducedMotion()) {
      const from = node.scrollTop;
      const size = measure(node);
      const distance = size.extent - size.viewport - from;
      if (distance > 2) {
        returning.current = true;
        const started = performance.now();
        const duration = Math.min(420, 240 + Math.log1p(distance) * 20);
        const advance = (now: number) => {
          if (!returning.current || !following.current || interacting.current || ref.current !== node) return;
          const progress = Math.min(1, (now - started) / duration);
          if (progress >= 1 || prefersReducedMotion()) {
            returning.current = false; pending.current.frame = 0; bottom();
            pending.current.timers = [setTimeout(bottom, 120), setTimeout(bottom, 360)];
            return;
          }
          const size = measure(node);
          const target = size.extent - size.viewport;
          const eased = 1 - Math.pow(1 - progress, 4);
          writeScroll(node, from + (target - from) * eased);
          pending.current.frame = requestAnimationFrame(advance);
        };
        pending.current.frame = requestAnimationFrame(advance);
        return cancelRequest;
      }
    }
    bottom();
    pending.current.frame = requestAnimationFrame(() => {
      bottom();
      pending.current.frame = requestAnimationFrame(bottom);
    });
    pending.current.timers = [setTimeout(bottom, 120), setTimeout(bottom, 360)];
    return cancelRequest;
  }, [ref, cancel, setFollowing, measure, writeScroll]);
  useEffect(() => {
    let resizeFrame = 0;
    const element = ref.current;
    interacting.current = false;
    geometry.current.dirty = true;
    ownScrollTop.current = null;
    setFollowing(true);
    const initial = element ? measure(element) : null;
    let previousExtent = initial?.extent ?? 0;
    let previousViewport = initial?.viewport ?? 0;
    let inputUntil = 0;
    const onScroll = () => {
      if (!element) return;
      if (returning.current) {
        previousExtent = geometry.current.extent; previousViewport = geometry.current.viewport;
        return;
      }
      const top = element.scrollTop;
      // Ignore feedback from our own animation; actual gestures clear this mark.
      // Layout changes are handled separately by the size/content observers.
      if (!interacting.current && ownScrollTop.current !== null && Math.abs(top - ownScrollTop.current) < 1) {
        previousExtent = geometry.current.extent; previousViewport = geometry.current.viewport;
        return;
      }
      ownScrollTop.current = null;
      const size = measure(element, true);
      const layoutChanged = size.extent !== previousExtent || size.viewport !== previousViewport;
      previousExtent = size.extent; previousViewport = size.viewport;
      // Virtual rows and composer panels can shift the browser's scroll anchor.
      // A layout adjustment is not a decision to stop following the conversation.
      if (following.current && layoutChanged && !interacting.current && performance.now() > inputUntil) { resize(); return; }
      setFollowing(size.extent - top - size.viewport < 72);
      if (!following.current) cancel();
    };
    const resize = () => {
      geometry.current.dirty = true;
      if (!following.current || interacting.current || returning.current || resizeFrame) return;
      let started: number | undefined;
      let previousFrame: number | undefined;
      const liveReply = ref.current?.querySelector('[data-streaming-reply]');
      const advance = (now: number) => {
        resizeFrame = 0;
        const node = ref.current;
        if (!following.current || interacting.current || returning.current || !node) return;
        const size = measure(node);
        previousExtent = size.extent; previousViewport = size.viewport;
        const target = Math.max(0, size.extent - size.viewport);
        const top = node.scrollTop;
        const gap = target - top;
        // A streamed line is a small layout change. Settle it over a few frames;
        // large bursts, explicit navigation and keyboard changes stay immediate.
        started ??= now;
        if (gap > 1 && gap <= 60 && now - started < 160 && !prefersReducedMotion() && liveReply?.isConnected) {
          const elapsed = previousFrame === undefined ? 1000 / 60 : Math.min(40, now - previousFrame);
          previousFrame = now;
          // Timestamp-based damping keeps the same response on 60/120Hz displays.
          writeScroll(node, top + Math.max(1, gap * (1 - Math.exp(-elapsed / 30))), top);
          resizeFrame = requestAnimationFrame(advance);
        } else writeScroll(node, target, top);
      };
      resizeFrame = requestAnimationFrame(advance);
    };
    const viewportResize = () => {
      const focused = document.activeElement;
      const editing = focused instanceof HTMLElement && element?.parentElement?.contains(focused)
        && focused.matches('textarea,input:not([type="checkbox"]):not([type="radio"]):not([type="range"]),[contenteditable="true"]');
      if (editing && following.current) scroll(); else resize();
    };
    const interruptReturn = () => {
      if (returning.current && element) setFollowing(element.scrollHeight - element.scrollTop - element.clientHeight < 72);
    };
    const takeOver = () => { ownScrollTop.current = null; interruptReturn(); interacting.current = true; inputUntil = performance.now() + 250; cancel(); cancelAnimationFrame(resizeFrame); resizeFrame = 0; };
    const release = () => { if (!interacting.current) return; interacting.current = false; onScroll(); };
    const wheel = () => { ownScrollTop.current = null; interruptReturn(); inputUntil = performance.now() + 250; cancel(); cancelAnimationFrame(resizeFrame); resizeFrame = 0; };
    const key = (event: KeyboardEvent) => { if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ', 'Escape'].includes(event.key)) wheel(); };
    const outsidePress = () => { if (returning.current) wheel(); };
    const outsideKey = (event: KeyboardEvent) => { if (returning.current) key(event); };
    element?.addEventListener('pointerdown', takeOver, { passive: true });
    element?.addEventListener('wheel', wheel, { passive: true });
    element?.addEventListener('keydown', key);
    window.addEventListener('pointerup', release); window.addEventListener('pointercancel', release);
    window.addEventListener('pointerdown', outsidePress, { passive: true });
    window.addEventListener('keydown', outsideKey);
    element?.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', viewportResize);
    window.visualViewport?.addEventListener('resize', viewportResize);
    const observer = new ResizeObserver(resize);
    const observed = new Set<Element>();
    const observeContent = () => {
      if (!element) return;
      // Late images and virtual-list measurements change child heights without
      // resizing the scroll container. Observe only its immediate layout nodes.
      const next = new Set<Element>([element, ...Array.from(element.children)]);
      observed.forEach(node => { if (!next.has(node)) { observer.unobserve(node); observed.delete(node); } });
      next.forEach(node => { if (!observed.has(node)) { observer.observe(node); observed.add(node); } });
    };
    observeContent();
    const children = new MutationObserver(() => { observeContent(); resize(); });
    if (element) children.observe(element, { childList: true });
    return () => {
      window.removeEventListener('resize', viewportResize);
      window.visualViewport?.removeEventListener('resize', viewportResize);
      observer.disconnect();
      children.disconnect();
      element?.removeEventListener('pointerdown', takeOver); element?.removeEventListener('wheel', wheel);
      element?.removeEventListener('keydown', key);
      window.removeEventListener('pointerup', release); window.removeEventListener('pointercancel', release);
      window.removeEventListener('pointerdown', outsidePress); window.removeEventListener('keydown', outsideKey);
      element?.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(resizeFrame);
      geometry.current.dirty = true;
      ownScrollTop.current = null;
      cancel();
    };
  }, [ref, scroll, cancel, sessionKey, setFollowing, measure, writeScroll]);
  return scroll;
}
