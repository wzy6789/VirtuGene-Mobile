import { useEffect } from 'react';
import { prefersReducedMotion, subscribeReducedMotion } from '../../lib/mobile-motion';

/** Native/keyboard clicks stay native; a pointer released outside cancels before React. */
export function useSlideOutCancel() {
  useEffect(() => {
    let press: { id: number; button: HTMLButtonElement; outside: boolean; box: DOMRect; themed: boolean; x: number; y: number; moved: boolean } | null = null;
    const cancelled = new WeakMap<HTMLButtonElement, number>();
    const lightTimers = new Map<HTMLButtonElement, number>();
    let touchFrame = 0;
    let pendingTouch: { button: HTMLButtonElement; box: DOMRect; x: number; y: number } | null = null;
    const cancelPaint = () => {
      cancelAnimationFrame(touchFrame);
      touchFrame = 0;
      pendingTouch = null;
    };
    const forgetLight = (button: HTMLButtonElement) => {
      const timer = lightTimers.get(button);
      if (timer !== undefined) window.clearTimeout(timer);
      lightTimers.delete(button);
      button.style.removeProperty('--vg-touch-x');
      button.style.removeProperty('--vg-touch-y');
      button.style.removeProperty('--vg-touch-scale-x');
      button.style.removeProperty('--vg-touch-scale-y');
      button.style.removeProperty('--vg-touch-shift-x');
      button.style.removeProperty('--vg-touch-shift-y');
    };
    const clearLight = (immediate = false) => {
      cancelPaint();
      if (!press) return;
      const { button, themed } = press;
      button.removeAttribute('data-touch-pressed');
      if (!themed) return;
      if (immediate || prefersReducedMotion()) { forgetLight(button); return; }
      // Keep the light at its touch origin until its opacity has settled.
      const timer = lightTimers.get(button);
      if (timer !== undefined) window.clearTimeout(timer);
      lightTimers.set(button, window.setTimeout(() => forgetLight(button), 380));
    };
    const clear = (immediate = false) => { clearLight(immediate); press?.button.removeAttribute('data-press-cancelled'); press = null; };
    const outside = (box: DOMRect, x: number, y: number) => {
      return x < box.left || x > box.right || y < box.top || y > box.bottom;
    };
    const paintTouch = (button: HTMLButtonElement, box: DOMRect, x: number, y: number) => {
      const localX = Math.max(0, Math.min(box.width, x - box.left));
      const localY = Math.max(0, Math.min(box.height, y - box.top));
      button.style.setProperty('--vg-touch-x', `${localX}px`);
      button.style.setProperty('--vg-touch-y', `${localY}px`);
      button.style.setProperty('--vg-touch-shift-x', `${(localX / Math.max(1, box.width) - .5) * 1.2}px`);
      button.style.setProperty('--vg-touch-shift-y', `${(localY / Math.max(1, box.height) - .5) * 1.2}px`);
    };
    const queueTouch = (button: HTMLButtonElement, box: DOMRect, x: number, y: number) => {
      pendingTouch = { button, box, x, y };
      if (touchFrame) return;
      touchFrame = requestAnimationFrame(() => {
        touchFrame = 0;
        const next = pendingTouch;
        pendingTouch = null;
        if (!next || press?.button !== next.button || press.outside || press.moved || !next.button.isConnected) return;
        paintTouch(next.button, next.box, next.x, next.y);
      });
    };
    const down = (event: PointerEvent) => {
      if (!event.isPrimary) {
        if (press) cancelled.set(press.button, performance.now() + 800);
        clear();
        return;
      }
      const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button') : null;
      if (!button || button.disabled || event.button !== 0 || button.closest('.vg-voice-tools,[data-pointer-action]')) { clear(); return; }
      // Read the new hit box before clearing the previous material's styles.
      const box = button.getBoundingClientRect();
      const themed = !button.matches('.vg-press-card') && !!button.closest('.mobile-layout,.vg-mobile-page,.vg-mobile-dialog,.vg-settings-panel,.vg-settings-design,.vg-auth-shell');
      clear();
      cancelled.delete(button);
      forgetLight(button);
      press = { id: event.pointerId, button, outside: false, box, themed, x: event.clientX, y: event.clientY, moved: false };
      if (themed && !prefersReducedMotion()) {
        // The box is stable throughout a press; only its material compresses.
        button.style.setProperty('--vg-touch-scale-x', `${1 - Math.min(.045, 2.8 / Math.max(1, box.width))}`);
        button.style.setProperty('--vg-touch-scale-y', `${1 - Math.min(.045, 2.8 / Math.max(1, box.height))}`);
        paintTouch(button, box, event.clientX, event.clientY);
        button.setAttribute('data-touch-pressed', '');
      }
    };
    const move = (event: PointerEvent) => {
      if (!press || press.id !== event.pointerId) return;
      if (press.moved) return;
      // Yield before native scrolling starts, including motion still inside a tall button.
      if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > 10) {
        press.moved = true;
        clearLight(true);
        return;
      }
      const wasOutside = press.outside;
      press.outside = outside(press.box, event.clientX, event.clientY);
      if (wasOutside !== press.outside) press.button.toggleAttribute('data-press-cancelled', press.outside);
      if (press.themed) {
        const active = !press.outside && !prefersReducedMotion();
        if (press.button.hasAttribute('data-touch-pressed') !== active) press.button.toggleAttribute('data-touch-pressed', active);
        if (active) queueTouch(press.button, press.box, event.clientX, event.clientY);
        else cancelPaint();
      }
    };
    const finish = (event: PointerEvent) => {
      if (!press || press.id !== event.pointerId) return;
      // The final hit test remains fresh and synchronous. Only decorative writes
      // are coalesced; a release between frames must retain its last touch origin.
      const invalid = press.moved || event.type === 'pointercancel' || !press.button.isConnected
        || Math.hypot(event.clientX - press.x, event.clientY - press.y) > 10
        || outside(press.button.getBoundingClientRect(), event.clientX, event.clientY);
      if (invalid) cancelled.set(press.button, performance.now() + 800);
      else if (press.themed && !prefersReducedMotion()) paintTouch(press.button, press.box, event.clientX, event.clientY);
      clear();
    };
    const click = (event: MouseEvent) => {
      const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button') : null;
      if (button && event.detail !== 0 && (cancelled.get(button) ?? 0) > performance.now()) {
        event.preventDefault(); event.stopImmediatePropagation(); cancelled.delete(button);
      }
    };
    const blur = () => { if (press) cancelled.set(press.button, performance.now() + 800); clear(); };
    const hidden = () => { if (document.hidden) blur(); };
    // Scrolling invalidates the cached hit rectangle and cancels a held action.
    const scroll = (event: Event) => {
      if (!press || !(event.target instanceof Node) || !event.target.contains(press.button)) return;
      const box = press.button.getBoundingClientRect();
      if (Math.abs(box.top - press.box.top) > 1 || Math.abs(box.left - press.box.left) > 1) blur();
    };
    const unsubscribe = subscribeReducedMotion(() => {
      if (!prefersReducedMotion()) return;
      clearLight(true);
      for (const button of lightTimers.keys()) forgetLight(button);
    });
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('pointermove', move, true);
    document.addEventListener('pointerup', finish, true);
    document.addEventListener('pointercancel', finish, true);
    document.addEventListener('click', click, true);
    window.addEventListener('blur', blur);
    window.addEventListener('resize', blur);
    document.addEventListener('scroll', scroll, true);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      clear(true); for (const button of lightTimers.keys()) forgetLight(button);
      document.removeEventListener('pointerdown', down, true); document.removeEventListener('pointermove', move, true);
      document.removeEventListener('pointerup', finish, true); document.removeEventListener('pointercancel', finish, true);
      document.removeEventListener('click', click, true); window.removeEventListener('blur', blur);
      window.removeEventListener('resize', blur); document.removeEventListener('scroll', scroll, true);
      document.removeEventListener('visibilitychange', hidden); unsubscribe();
    };
  }, []);
}
