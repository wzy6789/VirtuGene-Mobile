import { useEffect } from 'react';
import { prefersReducedMotion, subscribeReducedMotion } from '../../lib/mobile-motion';

/** Native/keyboard clicks stay native; a pointer released outside cancels before React. */
export function useSlideOutCancel() {
  useEffect(() => {
    let press: { id: number; button: HTMLButtonElement; outside: boolean; box: DOMRect; themed: boolean } | null = null;
    const cancelled = new WeakMap<HTMLButtonElement, number>();
    const lightTimers = new Map<HTMLButtonElement, number>();
    const forgetLight = (button: HTMLButtonElement) => {
      const timer = lightTimers.get(button);
      if (timer !== undefined) window.clearTimeout(timer);
      lightTimers.delete(button);
      button.style.removeProperty('--vg-touch-x');
      button.style.removeProperty('--vg-touch-y');
    };
    const clearLight = (immediate = false) => {
      if (!press) return;
      const { button, themed } = press;
      button.removeAttribute('data-touch-pressed');
      if (!themed) return;
      if (immediate || prefersReducedMotion()) { forgetLight(button); return; }
      // Keep the light at its touch origin until its opacity has settled.
      const timer = lightTimers.get(button);
      if (timer !== undefined) window.clearTimeout(timer);
      lightTimers.set(button, window.setTimeout(() => forgetLight(button), 300));
    };
    const clear = (immediate = false) => { clearLight(immediate); press?.button.removeAttribute('data-press-cancelled'); press = null; };
    const outside = (box: DOMRect, x: number, y: number) => {
      return x < box.left || x > box.right || y < box.top || y > box.bottom;
    };
    const down = (event: PointerEvent) => {
      clear();
      const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button') : null;
      if (!button || button.disabled || event.button !== 0 || !event.isPrimary || button.closest('.vg-voice-tools,[data-pointer-action]')) return;
      cancelled.delete(button);
      const box = button.getBoundingClientRect();
      const themed = !button.matches('.vg-press-card') && !!button.closest('.mobile-layout,.vg-mobile-sheet,.vg-settings-panel,.vg-settings-design');
      forgetLight(button);
      press = { id: event.pointerId, button, outside: false, box, themed };
      if (themed && !prefersReducedMotion()) {
        button.style.setProperty('--vg-touch-x', `${event.clientX - box.left}px`);
        button.style.setProperty('--vg-touch-y', `${event.clientY - box.top}px`);
        button.setAttribute('data-touch-pressed', '');
      }
    };
    const move = (event: PointerEvent) => {
      if (!press || press.id !== event.pointerId) return;
      press.outside = outside(press.box, event.clientX, event.clientY);
      press.button.toggleAttribute('data-press-cancelled', press.outside);
      if (press.themed) press.button.toggleAttribute('data-touch-pressed', !press.outside && !prefersReducedMotion());
    };
    const finish = (event: PointerEvent) => {
      if (!press || press.id !== event.pointerId) return;
      if (event.type === 'pointercancel' || outside(press.button.getBoundingClientRect(), event.clientX, event.clientY)) cancelled.set(press.button, performance.now() + 800);
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
