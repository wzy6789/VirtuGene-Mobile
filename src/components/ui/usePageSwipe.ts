import { useEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import { SWIPE_EDGE, swipeBlocked, swipeCommits, swipeDirection } from '../../lib/swipe-policy';
import { prefersReducedMotion, settleFrames, subscribeReducedMotion } from '../../lib/mobile-motion';
import { IS_CAPACITOR } from '../../lib/platform';

/** One gesture owns its surface; a second touch can take over an unfinished release. */
export function usePageSwipe(enabled: boolean, key: string, canMove: (dx: number) => boolean, commit: (dx: number) => void, back = false) {
  const ref = useRef<HTMLDivElement>(null);
  const latest = useRef({ canMove, commit });
  latest.current = { canMove, commit };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    type Gesture = { x: number; y: number; dx: number; origin: number; time: number; lastX: number; lastTime: number; velocity: number; dir: 'x' | 'y' | null };
    let gesture: Gesture | null = null;
    let frame = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let animation: Animation | null = null;
    let painted = 0;

    const readX = () => {
      if (!animation) return painted;
      const transform = getComputedStyle(el).transform;
      return transform === 'none' ? 0 : new DOMMatrixReadOnly(transform).m41;
    };
    const clearFrame = () => { if (frame) cancelAnimationFrame(frame); frame = 0; };
    const clearCommit = () => { if (timer !== undefined) clearTimeout(timer); timer = undefined; };
    const paint = (x: number, duration = 0, release = false) => {
      const from = readX();
      animation?.cancel();
      animation = null;
      painted = x;
      el.style.transition = 'none';
      el.style.transform = x ? `translate3d(${x}px,0,0)` : '';
      el.style.willChange = x ? 'transform' : '';
      if (!duration || prefersReducedMotion() || Math.abs(from - x) <= .5) return;
      el.style.willChange = 'transform';
      // Release keeps moving immediately; returning to rest uses the damped curve.
      const frames = release
        ? [{ transform: `translate3d(${from}px,0,0)` }, { transform: `translate3d(${x}px,0,0)` }]
        : settleFrames(from, x);
      const next = el.animate(frames, { duration, easing: release ? 'cubic-bezier(.16,1,.3,1)' : 'linear' });
      animation = next;
      next.onfinish = () => {
        if (animation !== next) return;
        animation = null;
        el.style.willChange = x ? 'transform' : '';
      };
    };
    const dragX = (g: Gesture) => {
      const width = el.clientWidth || 390;
      if (back) {
        const raw = Math.max(0, g.origin + g.dx);
        const edge = width * .85;
        return raw <= edge ? raw : edge + 32 * (1 - Math.exp(-(raw - edge) / 90));
      }
      const offset = latest.current.canMove(g.dx)
        ? width * (1 - Math.exp(-Math.abs(g.dx) / width)) * .85
        : 24 * (1 - Math.exp(-Math.abs(g.dx) / 120));
      const x = g.origin + Math.sign(g.dx) * offset;
      return x;
    };
    const cancel = () => {
      clearCommit();
      clearFrame();
      gesture = null;
      paint(0, 280);
    };
    const start = (event: TouchEvent) => {
      const touch = event.touches[0];
      // Native Android reserves its edge for system back; the browser preview
      // owns that edge while tabs continue to reserve both edges.
      const blockedEdge = touch && (touch.clientX <= SWIPE_EDGE && (!back || IS_CAPACITOR) || touch.clientX >= window.innerWidth - SWIPE_EDGE);
      if (!enabled || event.touches.length !== 1 || !touch || blockedEdge || swipeBlocked(event.target, el)) {
        if (gesture) cancel();
        return;
      }
      clearCommit();
      clearFrame();
      // Freeze at the actual displayed position, so grabbing a rebound cannot jump.
      const origin = readX();
      paint(origin);
      const now = performance.now();
      gesture = { x: touch.clientX, y: touch.clientY, dx: 0, origin, time: now, lastX: touch.clientX, lastTime: now, velocity: 0, dir: null };
    };
    const move = (event: TouchEvent) => {
      if (event.touches.length !== 1) { cancel(); return; }
      const g = gesture;
      const touch = event.touches[0];
      if (!g || !touch) return;
      const dx = touch.clientX - g.x;
      const dy = touch.clientY - g.y;
      g.dir ??= swipeDirection(dx, dy);
      if (g.dir === 'y') { cancel(); return; }
      if (g.dir !== 'x') return;
      if ((back && dx <= 0 && g.origin <= 0) || !event.cancelable) { cancel(); return; }
      event.preventDefault();
      const now = performance.now();
      g.velocity = (touch.clientX - g.lastX) / Math.max(8, now - g.lastTime);
      g.lastX = touch.clientX; g.lastTime = now;
      g.dx = dx;
      if (!frame) frame = requestAnimationFrame(() => {
        frame = 0;
        if (gesture) paint(dragX(gesture));
      });
    };
    const finish = () => {
      const g = gesture;
      // A duplicate touchend must not cancel a release that already owns its commit.
      if (!g) return;
      gesture = null;
      clearFrame();
      const now = performance.now();
      const velocity = now - g.lastTime < 100 ? g.velocity : 0;
      const distance = back ? Math.max(0, g.origin + g.dx) : g.dx;
      const commits = back
        ? velocity >= -.18 && (distance >= Math.min(110, Math.max(72, el.clientWidth * .25)) || distance >= 36 && velocity >= .55)
        : swipeCommits(distance, now - g.time, el.clientWidth);
      if (g.dir !== 'x' || !latest.current.canMove(back ? distance : g.dx) || !commits) {
        paint(0, 280);
        return;
      }
      paint(dragX(g));
      const releaseX = readX() + Math.sign(g.dx) * 22;
      const duration = prefersReducedMotion() ? 0 : 110;
      paint(releaseX, duration, true);
      timer = setTimeout(() => {
        timer = undefined;
        // The page ref captures this pose and emits a synchronous handoff before
        // mounting its replacement. This also works when history.back is async.
        flushSync(() => latest.current.commit(g.dx));
        if (Math.abs(readX()) > .5) {
          // Standalone consumers need not mount a replacement page.
          timer = setTimeout(() => { timer = undefined; paint(0, 180); }, 160);
        }
      }, duration);
    };
    const interrupted = () => {
      clearCommit();
      clearFrame();
      gesture = null;
      paint(0);
    };
    const hidden = () => { if (document.hidden) interrupted(); };
    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchmove', move, { passive: false });
    el.addEventListener('touchend', finish);
    el.addEventListener('touchcancel', cancel);
    el.addEventListener('vg:swipe-handoff', interrupted);
    window.addEventListener('resize', interrupted);
    document.addEventListener('visibilitychange', hidden);
    const unsubscribe = subscribeReducedMotion(interrupted);
    return () => {
      el.removeEventListener('touchstart', start);
      el.removeEventListener('touchmove', move);
      el.removeEventListener('touchend', finish);
      el.removeEventListener('touchcancel', cancel);
      el.removeEventListener('vg:swipe-handoff', interrupted);
      window.removeEventListener('resize', interrupted);
      document.removeEventListener('visibilitychange', hidden);
      unsubscribe();
      interrupted();
    };
  }, [enabled, key, back]);
  return ref;
}
