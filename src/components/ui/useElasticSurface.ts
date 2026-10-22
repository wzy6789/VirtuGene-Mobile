import { useLayoutEffect, useRef, type RefObject } from 'react';
import { prefersReducedMotion, settleProgress, subscribeReducedMotion } from '../../lib/mobile-motion';
import { SWIPE_EDGE } from '../../lib/swipe-policy';

export type ElasticPhase = 'idle' | 'tracking' | 'dragging' | 'settling';

/** One short release window for local controls; pointer tracking never uses easing. */
export function elasticReleaseDuration(distance: number, velocity = 0): number {
  return Math.min(220, Math.max(180, 190 + Math.abs(distance) * .12 - Math.abs(velocity) * 16));
}

/** Reuse the page settle curve, retaining signed px/ms velocity on interruption. */
export function elasticSettleFrames(from: number, to: number, velocity: number, duration: number): Keyframe[] {
  return settleProgress().map(({ offset, progress }) => ({
    offset,
    // This correction has the incoming derivative at zero and vanishes at rest.
    transform: `translate3d(${from + (to - from) * progress + Math.max(-28, Math.min(28, velocity * duration * offset * (1 - offset) ** 3))}px,0,0)`,
  }));
}

export function elasticDirection(dx: number, dy: number): 'x' | 'y' | null {
  if (Math.max(Math.abs(dx), Math.abs(dy)) < 10) return null;
  return Math.abs(dx) > Math.abs(dy) * 1.25 ? 'x' : 'y';
}

/** Measure the running WAAPI pose, including the direction of its visible rebound. */
export function elasticPosition(element: HTMLElement): number {
  const transform = getComputedStyle(element).transform;
  return transform === 'none' ? 0 : new DOMMatrixReadOnly(transform).m41;
}

export function elasticVelocity(element: HTMLElement, animation: Animation | null): number {
  const time = animation?.currentTime;
  if (!animation || typeof time !== 'number' || time <= 0) return 0;
  const current = elasticPosition(element);
  const before = Math.max(0, time - 8);
  animation.currentTime = before;
  const previous = elasticPosition(element);
  animation.currentTime = time;
  return (current - previous) / Math.max(1, time - before);
}

interface ElasticSurfaceOptions {
  index: number;
  count: number;
  enabled?: boolean;
  gestureKey?: string;
  contentRef?: RefObject<HTMLElement | null>;
  onCommit: (index: number) => void;
  onReselect?: (index: number) => void;
}

/** A local gesture/WAAPI owner. Neither its host nor its content is ever scaled. */
export function useElasticSurface(options: ElasticSurfaceOptions) {
  const rootRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLSpanElement>(null);
  const latest = useRef(options);
  latest.current = options;
  const controller = useRef<{ select: (index: number) => void; sync: () => void; cancel: () => void } | null>(null);

  useLayoutEffect(() => {
    const root = rootRef.current;
    const surface = surfaceRef.current;
    const material = surface?.firstElementChild as HTMLElement | null;
    if (!root || !surface || !material) return;
    type Gesture = { id: number; x: number; y: number; origin: number; lastX: number; lastTime: number; velocity: number; dragging: boolean };
    let gesture: Gesture | null = null;
    let sequence = 0;
    let phase: ElasticPhase = 'idle';
    let settlingIndex: number | undefined;
    let committedIndex = options.index;
    let measuredWidth = -1, measuredHeight = -1;
    let slots: { button: HTMLButtonElement; left: number; width: number }[] = [];
    let animation: Animation | null = null;
    let materialAnimation: Animation | null = null;
    let contentAnimation: Animation | null = null;
    let content: HTMLElement | null = null;
    let suppressClick = false;
    let alive = true;
    const items = () => slots.map(slot => slot.button);
    const location = (index: number) => slots[index]?.left ?? 0;
    const setPhase = (next: ElasticPhase) => {
      phase = next;
      root.dataset.elasticPhase = next;
      root.dataset.elasticSequence = String(sequence);
    };
    const releaseCapture = () => {
      const previous = gesture;
      gesture = null;
      if (previous && root.hasPointerCapture(previous.id)) root.releasePointerCapture(previous.id);
    };
    const resetContent = () => {
      contentAnimation?.cancel(); contentAnimation = null;
      if (content) { content.style.transform = ''; content.style.willChange = ''; }
      content = null;
    };
    const freeze = () => {
      const x = elasticPosition(surface);
      const velocity = elasticVelocity(surface, animation);
      const shape = getComputedStyle(material).transform;
      animation?.cancel(); animation = null;
      materialAnimation?.cancel(); materialAnimation = null;
      if (contentAnimation && content) {
        const transform = getComputedStyle(content).transform;
        contentAnimation.cancel(); contentAnimation = null;
        content.style.transform = transform;
      }
      surface.style.transform = `translate3d(${x}px,0,0)`;
      material.style.transform = shape;
      return { x, velocity };
    };
    const contentX = (x: number) => Math.max(-18, Math.min(18, (location(latest.current.index) - x) * .14));
    const prepareContent = () => {
      const next = latest.current.contentRef?.current ?? null;
      if (next !== content) { resetContent(); content = next; }
      if (content) content.style.willChange = 'transform';
    };
    const shape = (velocity: number, pressed = false) => {
      const stretch = Math.min(.03, Math.abs(velocity) * .018);
      return `scale(${(pressed ? .98 : 1) + stretch},${(pressed ? .98 : 1) - stretch * .55})`;
    };
    const paint = (x: number, velocity: number, pressed = false) => {
      surface.style.transform = `translate3d(${x}px,0,0)`;
      material.style.transform = shape(velocity, pressed);
      if (content) content.style.transform = `translate3d(${contentX(x)}px,0,0)`;
    };
    const commitNow = (index:number, allowReselect = false) => {
      if(!alive||document.hidden||latest.current.enabled===false||items()[index]?.disabled||!items()[index]||document.querySelector('[aria-modal="true"],[data-group-dialog]'))return;
      if(index!==committedIndex){committedIndex=index;latest.current.onCommit(index);}
      else if (allowReselect) latest.current.onReselect?.(index);
    };
    const finish = (index: number, token: number) => {
      if (!alive || token !== sequence) return;
      ++sequence;
      // An overlay may have taken control while the release was running.
      const covered = !!document.querySelector('[aria-modal="true"],[data-group-dialog]');
      animation?.cancel(); animation = null;
      materialAnimation?.cancel(); materialAnimation = null;
      surface.style.transform = `translate3d(${location(index)}px,0,0)`;
      surface.style.width = `${slots[index]?.width ?? 0}px`;
      material.style.transform = '';
      surface.style.willChange = '';
      resetContent();
      settlingIndex=undefined;
      setPhase('idle');
      if (covered) surface.style.transform = `translate3d(${location(latest.current.index)}px,0,0)`;
    };
    const settle = (index: number, commit: boolean, inheritedVelocity?: number, allowReselect = false) => {
      const token = ++sequence;
      const pose = freeze();
      const target = location(index);
      const duration = elasticReleaseDuration(target - pose.x, inheritedVelocity ?? pose.velocity);
      const velocity = inheritedVelocity ?? (Math.abs(pose.velocity)>.01?pose.velocity:(target-pose.x)*2.5/duration);
      settlingIndex=index;
      surface.style.width = `${slots[index]?.width ?? 0}px`;
      setPhase('settling');
      if (prefersReducedMotion() || document.hidden || Math.abs(target - pose.x) < .3 && Math.abs(velocity) < .01) {
        finish(index, token);if(commit)commitNow(index, allowReselect);return;
      }
      surface.style.willChange = 'transform';
      const frames = elasticSettleFrames(pose.x, target, velocity, duration);
      animation = surface.animate(frames, { duration, easing: 'linear', fill: 'both' });
      materialAnimation = material.animate([
        { transform: getComputedStyle(material).transform },
        { offset: .22, transform: shape(velocity) },
        { transform: 'scale(1)' },
      ], { duration, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'both' });
      if (content) contentAnimation = content.animate(elasticSettleFrames(elasticPosition(content),0,0,duration), { duration, easing: 'linear', fill: 'both' });
      animation.onfinish = () => finish(index, token);
      // The user's intent is accepted now. Only the material keeps settling.
      if(commit)commitNow(index, allowReselect);
    };
    const cancel = (immediate = false) => {
      ++sequence;
      if (gesture?.dragging) suppressClick = true;
      releaseCapture(); gesture = null;
      freeze();
      if (immediate) {
        settlingIndex=undefined;
        surface.style.transform = `translate3d(${location(latest.current.index)}px,0,0)`;
        material.style.transform = ''; surface.style.willChange = ''; resetContent(); setPhase('idle');
      } else settle(latest.current.index, false);
    };
    const measure = () => {
      // Geometry belongs to resize/structure changes, never the pointer-move path.
      const width = root.clientWidth, height = root.clientHeight;
      const next = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-elastic-index]'))
        .map(button => ({ button, left: button.offsetLeft, width: button.offsetWidth }));
      if (width === measuredWidth && height === measuredHeight && next.length === slots.length
        && next.every((slot, i) => slot.left === slots[i].left && slot.width === slots[i].width)) return;
      measuredWidth = width; measuredHeight = height; slots = next;
      cancel(true);
      surface.style.width = `${slots[latest.current.index]?.width ?? 0}px`;
    };
    const select = (index: number) => {
      if (latest.current.enabled === false || items()[index]?.disabled || !items()[index] || document.hidden || document.querySelector('[aria-modal="true"],[data-group-dialog]')) return;
      releaseCapture(); gesture = null;
      prepareContent();
      // Explicit activation may return to a navigation root. A drag landing on
      // its original item never takes this reselect path.
      settle(index, true, undefined, true);
    };
    const blocked = (target: EventTarget | null) => {
      const node = target instanceof Element ? target : null;
      return !node || !!node.closest('input,textarea,select,[contenteditable="true"],[data-no-elastic-swipe]')
        || !!document.querySelector('[aria-modal="true"],[data-group-dialog]') || !!window.getSelection()?.toString();
    };
    const down = (event: PointerEvent) => {
      if (!event.isPrimary) { if (gesture) cancel(); return; }
      if (event.button !== 0 || latest.current.enabled === false || blocked(event.target)
        || event.target instanceof Element && event.target.closest('button:disabled')) return;
      // Leave both screen edges available to the browser/native back gesture.
      if (event.clientX <= SWIPE_EDGE || event.clientX >= window.innerWidth - SWIPE_EDGE) return;
      ++sequence; suppressClick = false;
      const pose = freeze();
      prepareContent();
      gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, origin: pose.x,
        lastX: pose.x, lastTime: performance.now(), velocity: pose.velocity, dragging: false };
      material.style.transform = shape(pose.velocity, true);
      setPhase('tracking');
    };
    const move = (event: PointerEvent) => {
      const g = gesture;
      if (!g || event.pointerId !== g.id) return;
      const dx = event.clientX - g.x;
      const dy = event.clientY - g.y;
      if (!g.dragging) {
        const direction = elasticDirection(dx, dy);
        if (direction === 'y') { cancel(); return; }
        if (direction !== 'x') return;
        g.dragging = true;
        if (event.cancelable) event.preventDefault();
        root.setPointerCapture(g.id);
        setPhase('dragging');
      }
      if (!event.cancelable) { cancel(); return; }
      event.preventDefault();
      const now = performance.now();
      const maximum = location(Math.max(0, latest.current.count - 1));
      const minimum = location(0);
      const raw = g.origin + dx;
      const x = raw < minimum ? minimum - 22 * (1 - Math.exp((raw - minimum) / 70))
        : raw > maximum ? maximum + 22 * (1 - Math.exp((maximum - raw) / 70)) : raw;
      g.velocity = (x - g.lastX) / Math.max(8, now - g.lastTime);
      g.lastX = x; g.lastTime = now;
      paint(x, g.velocity);
    };
    const up = (event: PointerEvent) => {
      const g = gesture;
      if (!g || event.pointerId !== g.id) return;
      releaseCapture(); gesture = null;
      if (!g.dragging) { settle(latest.current.index, false); return; }
      suppressClick = true;
      const velocity = performance.now() - g.lastTime < 100 ? g.velocity : 0;
      const projected = elasticPosition(surface) + velocity * 95;
      const nearest = slots.filter(slot => !slot.button.disabled).reduce<typeof slots[number] | undefined>(
        (best, slot) => !best || Math.abs(slot.left - projected) < Math.abs(best.left - projected) ? slot : best, undefined);
      settle(nearest ? Number(nearest.button.dataset.elasticIndex) : latest.current.index, true, velocity);
    };
    const pointerCancel = (event: PointerEvent) => { if (gesture?.id === event.pointerId) { suppressClick = true; cancel(); } };
    // Touch starts with implicit capture on the child button. Transferring it
    // to this root emits a bubbled loss from that child, not a cancelled drag.
    const lostCapture = (event: PointerEvent) => { if (gesture?.id === event.pointerId && !root.hasPointerCapture(event.pointerId)) cancel(); };
    const leave = () => { if (gesture && !gesture.dragging) cancel(); };
    const click = (event: MouseEvent) => {
      if (suppressClick && event.detail !== 0) { suppressClick = false; event.preventDefault(); event.stopPropagation(); }
    };
    const interrupted = () => cancel(true);
    const hidden = () => { if (document.hidden) interrupted(); };
    const focus = () => { if (phase !== 'idle' && document.querySelector('[aria-modal="true"],[data-group-dialog]')) interrupted(); };
    controller.current = { select, sync: () => {
      committedIndex=latest.current.index;
      if((phase==='settling'&&settlingIndex===latest.current.index)||phase==='dragging'||phase==='tracking')return;
      settle(latest.current.index, false);
    }, cancel: interrupted };
    measure();
    const observer = new ResizeObserver(measure); observer.observe(root);
    slots.forEach(slot => observer.observe(slot.button));
    root.addEventListener('pointerdown', down);
    root.addEventListener('pointermove', move, { passive: false });
    root.addEventListener('pointerup', up);
    root.addEventListener('pointercancel', pointerCancel);
    root.addEventListener('lostpointercapture', lostCapture);
    root.addEventListener('pointerleave', leave);
    root.addEventListener('click', click, true);
    window.addEventListener('resize', interrupted);
    window.addEventListener('blur', interrupted);
    window.addEventListener('popstate', interrupted);
    window.addEventListener('vg:back-request', interrupted);
    document.addEventListener('visibilitychange', hidden);
    document.addEventListener('focusin', focus);
    const unsubscribe = subscribeReducedMotion(interrupted);
    return () => {
      alive = false; interrupted(); controller.current = null; observer.disconnect(); unsubscribe();
      root.removeEventListener('pointerdown', down);
      root.removeEventListener('pointermove', move);
      root.removeEventListener('pointerup', up);
      root.removeEventListener('pointercancel', pointerCancel);
      root.removeEventListener('lostpointercapture', lostCapture);
      root.removeEventListener('pointerleave', leave);
      root.removeEventListener('click', click, true);
      window.removeEventListener('resize', interrupted); window.removeEventListener('blur', interrupted);
      window.removeEventListener('popstate', interrupted); window.removeEventListener('vg:back-request', interrupted);
      document.removeEventListener('visibilitychange', hidden); document.removeEventListener('focusin', focus);
    };
  }, [options.count, options.enabled, options.gestureKey]);

  // External route changes move the existing capsule; they never submit a route.
  useLayoutEffect(() => { controller.current?.sync(); }, [options.index]);
  return { rootRef, surfaceRef, select: (index: number) => controller.current?.select(index), cancel: () => controller.current?.cancel() };
}
