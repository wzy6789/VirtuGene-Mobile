import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { SWIPE_EDGE, swipeBlocked, swipeDirection } from '../../lib/swipe-policy';
import { prefersReducedMotion, settleFrames, subscribeReducedMotion } from '../../lib/mobile-motion';

import { breathe } from '../../lib/haptics';

interface Action { label: string; color: string; onClick: () => void }
interface Props {
  children: ReactNode;
  actions: Action[];
  onClick?: () => void;
  swipeDistance?: number;
  contentClassName?: string;
  itemId?: string;
}

/** Direct, frame-coalesced dragging; React only records the committed action state. */
export function SwipeActionItem({ children, actions, onClick, swipeDistance = 160, contentClassName = '', itemId }: Props) {
  const [expanded, setExpanded] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const suppressClickUntil = useRef(0);
  const controller = useRef<(open: boolean) => void>(() => {});
  const localId = useId();
  const id = itemId ?? localId;
  const distance = Math.max(0, Math.min(swipeDistance, actions.length * 64));

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    // Conversation rows already contain a native button. Only bare clickable
    // content needs its own keyboard stop; avoid nesting two button semantics.
    const standalone = !!onClick && !content.querySelector('button,a[href],[role="button"]');
    if (standalone) { content.setAttribute('role','button'); content.tabIndex=0; }
    else { content.removeAttribute('role'); content.removeAttribute('tabindex'); }
  }, [children, !!onClick]);

  useEffect(() => {
    const row = rowRef.current, content = contentRef.current, tray = actionsRef.current;
    if (!row || !content || !tray) return;
    type Gesture = { id: number; x: number; y: number; origin: number; lastX: number; time: number; velocity: number; dir: 'x' | 'y' | null; haptic: boolean; initialLanding: boolean };
    let gesture: Gesture | null = null;
    let frame = 0, painted = 0, nextX = 0;
    let opened = false;
    let animation: Animation | null = null;
    const read = () => animation ? new DOMMatrixReadOnly(getComputedStyle(content).transform).m41 : painted;
    const stop = () => { cancelAnimationFrame(frame); frame = 0; animation?.cancel(); animation = null; };
    const paint = (x: number) => {
      painted = x;
      content.style.transform = x ? `translate3d(${x}px,0,0)` : '';
      tray.style.visibility = Math.abs(x) > .5 ? 'visible' : 'hidden';
    };
    const releaseCapture = () => {
      const current = gesture; gesture = null;
      if (current && content.hasPointerCapture(current.id)) content.releasePointerCapture(current.id);
    };
    const settle = (open: boolean, immediate = false) => {
      const from = read(); stop(); releaseCapture();
      row.removeAttribute('data-swipe-dragging'); row.removeAttribute('data-swipe-landing');
      opened = open && distance > 0;
      setExpanded(opened);
      const target = opened ? -distance : 0;
      paint(target);
      if (!opened && document.activeElement && tray.contains(document.activeElement)) content.querySelector<HTMLElement>('button,a,[tabindex]')?.focus({ preventScroll: true });
      tray.inert = !opened;
      content.style.willChange = '';
      if (immediate || prefersReducedMotion() || document.hidden || Math.abs(from - target) < .5) return;
      tray.style.visibility = 'visible';
      content.style.willChange = 'transform';
      const motion = content.animate(settleFrames(from, target, 1, 1, 'x', 3), { duration: 280, easing: 'linear' });
      animation = motion;
      motion.onfinish = () => {
        if (animation !== motion) return;
        animation = null; motion.cancel(); paint(target); content.style.willChange = '';
      };
    };
    controller.current = settle;
    const down = (event: PointerEvent) => {
      if (!event.isPrimary) { if (gesture) settle(opened); return; }
      if (event.button !== 0 || !distance || event.clientX <= SWIPE_EDGE || event.clientX >= innerWidth - SWIPE_EDGE || swipeBlocked(event.target, content, true)) return;
      suppressClickUntil.current = 0;
      const origin = read(); stop(); paint(origin);
      const now = performance.now();
      gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, origin, lastX: event.clientX, time: now, velocity: 0, dir: null, haptic: false, initialLanding: origin < -distance / 2 };
      tray.inert = true;
    };
    const projectedOpen = (x: number, velocity: number) => x + Math.max(-48, Math.min(48, velocity * 90)) < -distance / 2;
    const move = (event: PointerEvent) => {
      const g = gesture;
      if (!g || g.id !== event.pointerId) return;
      const dx = event.clientX - g.x, dy = event.clientY - g.y;
      g.dir ??= swipeDirection(dx, dy);
      if (g.dir === 'y') { settle(opened); return; }
      if (g.dir !== 'x') return;
      if (event.cancelable) event.preventDefault();
      if (!content.hasPointerCapture(g.id)) content.setPointerCapture(g.id);
      row.setAttribute('data-swipe-dragging', ''); content.style.willChange = 'transform';
      const now = performance.now();
      g.velocity = (event.clientX - g.lastX) / Math.max(8, now - g.time);
      g.lastX = event.clientX; g.time = now;
      const raw = g.origin + dx;
      nextX = raw > 0 ? 18 * (1 - Math.exp(-raw / 80)) : raw < -distance ? -distance - 18 * (1 - Math.exp((raw + distance) / 80)) : raw;
      if (!frame) frame = requestAnimationFrame(() => {
        frame = 0;
        if (!gesture) return;
        paint(nextX);
        const landing = projectedOpen(nextX, gesture.velocity);
        row.setAttribute('data-swipe-landing', landing ? 'open' : 'closed');
        if (!gesture.haptic && landing !== gesture.initialLanding) { gesture.haptic = true; breathe(); }
      });
    };
    const up = (event: PointerEvent) => {
      const g = gesture;
      if (!g || g.id !== event.pointerId) return;
      if (g.dir !== 'x') { releaseCapture(); tray.inert = !opened; if (Math.abs(painted - (opened ? -distance : 0)) > .5) settle(opened); return; }
      suppressClickUntil.current = performance.now() + 400;
      cancelAnimationFrame(frame); frame = 0; paint(nextX);
      const velocity = performance.now() - g.time < 100 ? g.velocity : 0;
      const open = projectedOpen(nextX, velocity);
      settle(open);
      if (open) window.dispatchEvent(new CustomEvent('vg:swipe-action-open', { detail: { id } }));
    };
    const cancelGesture = () => { if (gesture?.dir === 'x') suppressClickUntil.current = performance.now() + 400; settle(opened); };
    const outside = (event: PointerEvent) => { if ((opened || gesture) && event.target instanceof Node && !row.contains(event.target)) settle(false); };
    const other = (event: Event) => { if ((event as CustomEvent<{ id?: string }>).detail?.id !== id) settle(false); };
    const reset = () => settle(false, true);
    const hidden = () => { if (document.hidden) reset(); };
    // Touch initially captures the child button. Its capture-loss bubbles when
    // the row takes over; only losing this surface's own capture cancels a drag.
    const lost = (event: PointerEvent) => { if (event.target === content && gesture?.id === event.pointerId) cancelGesture(); };
    const key = (event: KeyboardEvent) => {
      if (swipeBlocked(event.target, content, true)) return;
      if (event.key === 'ArrowLeft' && distance) { event.preventDefault(); settle(true); window.dispatchEvent(new CustomEvent('vg:swipe-action-open', { detail: { id } })); }
      if (event.key === 'ArrowRight' || event.key === 'Escape') { event.preventDefault(); settle(false); }
    };
    tray.inert = true; setExpanded(false);
    content.addEventListener('pointerdown', down);
    content.addEventListener('pointermove', move);
    content.addEventListener('pointerup', up);
    content.addEventListener('pointercancel', cancelGesture);
    content.addEventListener('lostpointercapture', lost);
    content.addEventListener('keydown', key);
    window.addEventListener('pointerdown', outside, true);
    window.addEventListener('vg:swipe-action-open', other);
    window.addEventListener('resize', reset); window.addEventListener('blur', reset);
    document.addEventListener('visibilitychange', hidden);
    const unsubscribe = subscribeReducedMotion(() => settle(opened, true));
    return () => {
      stop(); releaseCapture(); paint(0); content.style.willChange = ''; controller.current = () => {};
      content.removeEventListener('pointerdown', down); content.removeEventListener('pointermove', move);
      content.removeEventListener('pointerup', up); content.removeEventListener('pointercancel', cancelGesture);
      content.removeEventListener('lostpointercapture', lost); content.removeEventListener('keydown', key);
      window.removeEventListener('pointerdown', outside, true); window.removeEventListener('vg:swipe-action-open', other);
      window.removeEventListener('resize', reset); window.removeEventListener('blur', reset);
      document.removeEventListener('visibilitychange', hidden); unsubscribe();
    };
  }, [id, distance]);

  return <div ref={rowRef} data-swipe-action-item="true" className="vg-swipe-action relative overflow-hidden rounded-2xl" style={{ touchAction: 'pan-y' }} onKeyDown={event => { if (event.key === 'Escape') controller.current(false); }}
    onClickCapture={event => { if (event.detail !== 0 && performance.now() < suppressClickUntil.current && contentRef.current?.contains(event.target as Node)) { event.preventDefault(); event.stopPropagation(); } }}>
    <div ref={actionsRef} className="vg-swipe-actions absolute inset-y-0 right-0 flex" aria-hidden={!expanded} style={{ visibility: 'hidden' }}>
      {actions.map(action => <button type="button" key={action.label} tabIndex={expanded ? 0 : -1} onClick={() => { controller.current(false); action.onClick(); }} className={`w-16 text-xs font-medium text-white flex items-center justify-center transition-colors ${action.color}`}>{action.label}</button>)}
    </div>
    <div ref={contentRef} className={`vg-swipe-content relative bg-panel border border-line rounded-2xl ${contentClassName}`} onKeyDown={event => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); if (expanded) controller.current(false); else onClick?.(); } }} onClick={() => { if (expanded) controller.current(false); else onClick?.(); }} aria-keyshortcuts="ArrowLeft ArrowRight Escape">{children}</div>
  </div>;
}
