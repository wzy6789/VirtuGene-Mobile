import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNotificationStore, type NotifyItem } from '../../store/notification-store';
import { useChatStore } from '../../store/chat-store';
import { useUIStore } from '../../store/ui-store';
import { useAuthStore } from '../../store/auth-store';
import { IS_MOBILE } from '../../lib/platform';
import { prefersReducedMotion, settleFrames, subscribeReducedMotion } from '../../lib/mobile-motion';
import { normalizeBubbleText } from '../../lib/chat-pacing';
import { Avatar } from '../ui/Avatar';

const DISMISS_MS = 5500;

const MessageNotification = memo(function MessageNotification({ item }: { item: NotifyItem }) {
  const preview = useMemo(() => normalizeBubbleText(item.preview) || '发来一条新消息', [item.preview]);
  const ref = useRef<HTMLDivElement>(null);
  const motion = useRef<Animation | null>(null);
  const deadline = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const clock = useRef({ remaining: DISMISS_MS, started: 0, hover: false, focus: false, press: false });
  const closing = useRef(false);
  const [leaving, setLeaving] = useState(false);
  const gesture = useRef<{ id: number; x: number; y: number; lastY: number; lastTime: number; velocity: number; offset: number; locked: boolean; cancelled: boolean } | null>(null);
  const ignoreClick = useRef(false);
  const drawFrame = useRef(0);
  const finishGesture = useRef<(cancelled: boolean) => void>(() => {});

  const dismiss = useCallback(() => {
    if (closing.current) return;
    closing.current = true; setLeaving(true);
    clearTimeout(deadline.current); deadline.current = undefined;
    cancelAnimationFrame(drawFrame.current);
    const node = ref.current;
    const remove = () => useNotificationStore.getState().dismiss(item.id);
    if (!node || document.hidden || prefersReducedMotion()) { remove(); return; }
    const style = getComputedStyle(node);
    const y = style.transform === 'none' ? 0 : new DOMMatrixReadOnly(style.transform).m42;
    const opacity = Number(style.opacity);
    motion.current?.cancel();
    node.style.removeProperty('transform'); node.style.removeProperty('opacity');
    const animation = node.animate([
      { opacity, transform: `translate3d(0,${y}px,0)` },
      { opacity: 0, transform: `translate3d(0,${Math.min(y - 12, -16)}px,0)` },
    ], { duration: 190, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' });
    motion.current = animation;
    animation.onfinish = remove;
  }, [item.id]);

  const pause = useCallback(() => {
    const state = clock.current;
    if (deadline.current !== undefined) {
      state.remaining = Math.max(0, state.remaining - (performance.now() - state.started));
      clearTimeout(deadline.current); deadline.current = undefined;
    }
  }, []);
  const resume = useCallback(() => {
    const state = clock.current;
    if (closing.current || state.hover || state.focus || state.press || document.hidden || deadline.current !== undefined) return;
    state.started = performance.now();
    deadline.current = setTimeout(dismiss, state.remaining);
  }, [dismiss]);

  useLayoutEffect(() => {
    if (!ref.current || prefersReducedMotion()) return;
    const animation = ref.current.animate(settleFrames(-16, 0, .15, 1, 'y', 3), { duration: 360, easing: 'linear' });
    motion.current = animation;
    animation.onfinish = () => { animation.cancel(); if (motion.current === animation) motion.current = null; };
    return () => animation.cancel();
  }, []);
  useEffect(() => {
    resume();
    const visibility = () => document.hidden ? pause() : resume();
    const release = (event: PointerEvent) => { if (gesture.current?.id === event.pointerId) finishGesture.current(false); };
    const cancelPress = (event: PointerEvent) => { if (gesture.current?.id === event.pointerId) finishGesture.current(true); };
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pointerup', release); window.addEventListener('pointercancel', cancelPress);
    const quiet = subscribeReducedMotion(() => {
      if (!prefersReducedMotion()) return;
      cancelAnimationFrame(drawFrame.current);
      motion.current?.cancel(); motion.current = null;
      ref.current?.style.removeProperty('transform'); ref.current?.style.removeProperty('opacity');
      if (closing.current) useNotificationStore.getState().dismiss(item.id);
    });
    return () => { clearTimeout(deadline.current); deadline.current = undefined; cancelAnimationFrame(drawFrame.current); motion.current?.cancel(); quiet(); document.removeEventListener('visibilitychange', visibility); window.removeEventListener('pointerup', release); window.removeEventListener('pointercancel', cancelPress); };
  }, [item.id, pause, resume]);

  const endGesture = (cancelled: boolean) => {
    const drag = gesture.current; gesture.current = null;
    clock.current.press = false;
    if (!drag) { resume(); return; }
    cancelAnimationFrame(drawFrame.current); drawFrame.current = 0;
    const freshVelocity = performance.now() - drag.lastTime < 100 ? drag.velocity : 0;
    if (drag.locked && !cancelled && (drag.offset < -38 || (drag.offset < -14 && freshVelocity < -.45))) { dismiss(); return; }
    const node = ref.current;
    if (node && (drag.locked || node.style.transform)) {
      const style = getComputedStyle(node);
      const from = style.transform === 'none' ? 0 : new DOMMatrixReadOnly(style.transform).m42;
      const opacity = Number(style.opacity);
      motion.current?.cancel(); node.style.removeProperty('transform'); node.style.removeProperty('opacity');
      if (!prefersReducedMotion()) {
        const animation = node.animate(settleFrames(from, 0, opacity, 1, 'y', 3), { duration: 260, easing: 'linear' });
        motion.current = animation;
        animation.onfinish = () => { animation.cancel(); if (motion.current === animation) motion.current = null; };
      }
    }
    resume();
  };
  finishGesture.current = endGesture;

  const open = () => {
    if (closing.current || ignoreClick.current) return;
    void useChatStore.getState().selectCharacter(item.characterId);
    if (IS_MOBILE) {
      const ui = useUIStore.getState();
      ui.setMobileTab('chat'); ui.setChatFromList(true); ui.setChatFromCharacters(false);
    }
    useNotificationStore.getState().dismiss(item.id);
  };

  return <div ref={ref} className="vg-message-notification" data-notification-id={item.id} data-leaving={leaving || undefined} inert={leaving} aria-hidden={leaving || undefined}
    onPointerEnter={event => { if (event.pointerType === 'mouse') { clock.current.hover = true; pause(); } }}
    onPointerLeave={event => { if (event.pointerType === 'mouse') { clock.current.hover = false; resume(); } }}
    onFocusCapture={() => { clock.current.focus = true; pause(); }}
    onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) { clock.current.focus = false; resume(); } }}
    onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dismiss(); } }}
    onClickCapture={event => { if (ignoreClick.current && event.detail !== 0) { event.preventDefault(); event.stopPropagation(); } }}
    onPointerDown={event => {
      ignoreClick.current = false;
      if (!event.isPrimary || event.button !== 0 || closing.current || (event.target as HTMLElement).closest('[data-notification-dismiss]')) return;
      clock.current.press = true; pause();
      if (motion.current) {
        const style = getComputedStyle(event.currentTarget);
        const transform = style.transform, opacity = style.opacity;
        motion.current.cancel(); motion.current = null;
        event.currentTarget.style.transform = transform;
        event.currentTarget.style.opacity = opacity;
      }
      gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, lastY: event.clientY, lastTime: performance.now(), velocity: 0, offset: 0, locked: false, cancelled: false };
    }}
    onPointerMove={event => {
      const drag = gesture.current;
      if (!drag || drag.id !== event.pointerId || drag.cancelled) return;
      const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
      if (!drag.locked && Math.hypot(dx, dy) > 8) {
        ignoreClick.current = true;
        if (Math.abs(dx) > Math.abs(dy) * 1.2) { drag.cancelled = true; return; }
        drag.locked = true;
        const node = event.currentTarget;
        const style = getComputedStyle(node);
        const from = style.transform === 'none' ? 0 : new DOMMatrixReadOnly(style.transform).m42;
        motion.current?.cancel(); motion.current = null;
        drag.y -= from;
        node.setPointerCapture(event.pointerId);
      }
      if (!drag.locked) return;
      const now = performance.now();
      drag.velocity = (event.clientY - drag.lastY) / Math.max(1, now - drag.lastTime);
      drag.lastY = event.clientY; drag.lastTime = now;
      const distance = event.clientY - drag.y;
      drag.offset = distance < 0 ? Math.max(-100, distance) : 9 * distance / (distance + 36);
      if (!drawFrame.current) drawFrame.current = requestAnimationFrame(() => {
        drawFrame.current = 0;
        if (!ref.current || !gesture.current) return;
        ref.current.style.transform = `translate3d(0,${gesture.current.offset}px,0)`;
        ref.current.style.opacity = String(1 - Math.min(.4, Math.abs(gesture.current.offset) / 220));
      });
    }}
    onPointerUp={() => endGesture(false)} onPointerCancel={() => { ignoreClick.current = true; endGesture(true); }}
    onLostPointerCapture={event => { if (event.target === event.currentTarget && gesture.current) endGesture(true); }}
  >
    <button type="button" className="vg-notification-open" onClick={event => { if (event.detail === 0) ignoreClick.current = false; open(); }} aria-label={`打开${item.characterName}的消息：${preview}`}>
      <span className="vg-notification-avatar" aria-hidden="true"><Avatar avatar={item.avatar} size="md" /><i /></span>
      <span className="vg-notification-copy"><span className="vg-notification-heading"><strong>{item.characterName}</strong><span>新消息</span></span>
        <span className="vg-notification-preview">{preview}</span>
      </span>
    </button>
    <button type="button" data-notification-dismiss className="vg-notification-dismiss" aria-label={`关闭${item.characterName}的消息提醒`} onClick={dismiss}>
      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="m7 7 10 10M17 7 7 17" /></svg>
    </button>
  </div>;
});

/** Quiet message previews above the current page, with independent lifetimes. */
export function NotificationCloud() {
  const items = useNotificationStore(s => s.items);
  const userId = useAuthStore(s => s.userId);
  const owner = useRef(userId);
  const root = useRef<HTMLDivElement>(null);
  const positions = useRef(new Map<string, number>());
  const shifts = useRef(new Map<string, Animation>());
  useEffect(() => useAuthStore.subscribe((next, previous) => {
    if (next.userId !== previous.userId) useNotificationStore.getState().clear();
  }), []);
  useLayoutEffect(() => {
    const nextPositions = new Map<string, number>();
    // Measure the entire stack before cancelling or starting any animation.
    // Interleaved reads/writes force a fresh layout for every remaining card.
    const measurements = Array.from(root.current?.querySelectorAll<HTMLElement>('[data-notification-slot]') ?? []).map(node => {
      const id = node.dataset.notificationSlot!;
      const style = getComputedStyle(node);
      const currentY = style.transform === 'none' ? 0 : new DOMMatrixReadOnly(style.transform).m42;
      const top = node.getBoundingClientRect().top - currentY;
      const before = positions.current.get(id);
      return { node, id, top, offset: before === undefined ? 0 : before + currentY - top };
    });
    const quiet = prefersReducedMotion();
    measurements.forEach(({ node, id, top, offset }) => {
      shifts.current.get(id)?.cancel(); shifts.current.delete(id);
      if (Math.abs(offset) > 1 && !quiet) {
        const animation = node.animate(settleFrames(offset, 0, 1, 1, 'y', 3), { duration: 280, easing: 'linear' });
        shifts.current.set(id, animation);
        animation.onfinish = () => { animation.cancel(); if (shifts.current.get(id) === animation) shifts.current.delete(id); };
      }
      nextPositions.set(id, top);
    });
    shifts.current.forEach((animation, id) => { if (!nextPositions.has(id)) { animation.cancel(); shifts.current.delete(id); } });
    positions.current = nextPositions;
  }, [items]);
  useEffect(() => {
    const clear = () => { shifts.current.forEach(animation => animation.cancel()); shifts.current.clear(); };
    const unsubscribe = subscribeReducedMotion(() => { if (prefersReducedMotion()) clear(); });
    return () => { unsubscribe(); clear(); };
  }, []);
  useLayoutEffect(() => { owner.current = userId; }, [userId]);
  if (userId !== owner.current || !items.length) return null;
  return <div ref={root} className="vg-notification-viewport" role="region" aria-label="新消息提醒" data-no-page-swipe data-no-back-swipe>
    <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">{items[items.length - 1]?.characterName}发来新消息</span>
    {items.map(item => <div key={item.id} data-notification-slot={item.id}><MessageNotification item={item} /></div>)}
  </div>;
}
