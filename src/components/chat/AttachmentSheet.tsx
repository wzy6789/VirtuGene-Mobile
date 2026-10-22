import { useLayoutEffect, useRef } from 'react';
import { Modal } from '../ui/Modal';
import { elasticSettleFrames, type ElasticPhase } from '../ui/useElasticSurface';
import { prefersReducedMotion, subscribeReducedMotion } from '../../lib/mobile-motion';
import '../../styles/attachment-sheet.css';

interface AttachmentSheetProps {
  open: boolean;
  onClose: () => void;
  /** Called inside the original click, preserving the browser's file-picker activation. */
  onImage: () => void;
}

export function AttachmentSheet({ open, ...props }: AttachmentSheetProps) {
  return open ? <OpenAttachmentSheet {...props} /> : null;
}

/** Reuse Modal's focus/back/overlay owner; only this panel owns its vertical motion. */
function OpenAttachmentSheet({ onClose, onImage }: Omit<AttachmentSheetProps, 'open'>) {
  const contentRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<HTMLDivElement>(null);
  const materialRef = useRef<HTMLSpanElement>(null);
  const latest = useRef({ onClose, onImage }); latest.current = { onClose, onImage };
  const controller = useRef<{ close: () => void; image: () => void } | null>(null);

  useLayoutEffect(() => {
    const content = contentRef.current;
    const handle = dragRef.current;
    const material = materialRef.current;
    const panel = content?.closest<HTMLElement>('.vg-modal-panel');
    if (!content || !handle || !material || !panel) return;
    // The shared mobile page transition translates too, but its horizontal pose
    // does not describe this local bottom sheet. Stop only this panel's entry.
    panel.getAnimations().forEach(animation => animation.cancel());
    type Gesture = { id: number; x: number; y: number; origin: number; lastY: number; lastTime: number; velocity: number; dragging: boolean };
    let gesture: Gesture | null = null;
    let animation: Animation | null = null;
    let materialAnimation: Animation | null = null;
    let sequence = 0;
    let alive = true;
    let delivered = false;
    let actionLocked = false;
    const readY = () => { const transform = getComputedStyle(panel).transform; return transform === 'none' ? 0 : new DOMMatrixReadOnly(transform).m42; };
    const phase = (next: ElasticPhase) => { panel.dataset.attachmentPhase = next; panel.dataset.attachmentSequence = String(sequence); };
    const releaseCapture = () => {
      const previous = gesture; gesture = null;
      if (previous && handle.hasPointerCapture(previous.id)) handle.releasePointerCapture(previous.id);
    };
    const freeze = () => {
      const y = readY();
      const time = animation?.currentTime;
      let velocity = 0;
      if (animation && typeof time === 'number' && time > 0) {
        const before = Math.max(0, time - 8);
        animation.currentTime = before;
        velocity = (y - readY()) / Math.max(1, time - before);
        animation.currentTime = time;
      }
      const shape = getComputedStyle(material).transform;
      animation?.cancel(); animation = null;
      materialAnimation?.cancel(); materialAnimation = null;
      panel.style.transform = `translate3d(0,${y}px,0)`;
      material.style.transform = shape;
      return { y, velocity };
    };
    const complete = (token: number, target: number, close: boolean) => {
      if (!alive || token !== sequence || delivered) return;
      ++sequence;
      animation?.cancel(); animation = null;
      materialAnimation?.cancel(); materialAnimation = null;
      panel.style.transform = `translate3d(0,${target}px,0)`;
      panel.style.willChange = ''; material.style.transform = '';
      phase('idle');
      if (close) { delivered = true; latest.current.onClose(); }
    };
    const settle = (target: number, close = false, incomingVelocity?: number) => {
      const token = ++sequence;
      releaseCapture();
      const pose = freeze();
      const velocity = incomingVelocity ?? pose.velocity;
      phase('settling');
      if (prefersReducedMotion() || document.hidden || Math.abs(target - pose.y) < .3 && Math.abs(velocity) < .01) { complete(token, target, close); return; }
      const duration = Math.min(420, Math.max(240, 260 + Math.abs(target - pose.y) * .24 - Math.abs(velocity) * 24));
      const frames = elasticSettleFrames(pose.y, target, velocity, duration).map(frame => {
        const y = new DOMMatrixReadOnly(String(frame.transform)).m41;
        return { ...frame, transform: `translate3d(0,${y}px,0)` };
      });
      panel.style.willChange = 'transform';
      animation = panel.animate(frames, { duration, easing: 'linear', fill: 'both' });
      materialAnimation = material.animate([{ transform: getComputedStyle(material).transform }, { transform: 'scale(1)' }], { duration, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'both' });
      animation.onfinish = () => complete(token, target, close);
    };
    const close = () => {
      if (actionLocked || delivered) return;
      settle(panel.getBoundingClientRect().height + 40, true);
    };
    const interrupt = () => {
      ++sequence; releaseCapture(); freeze();
      panel.style.transform = 'translate3d(0,0,0)'; panel.style.willChange = ''; material.style.transform = '';
      phase('idle');
    };
    const image = () => {
      if (!alive || delivered || actionLocked) return;
      actionLocked = true; ++sequence; releaseCapture(); freeze();
      // Never defer this callback to an animation completion: input.click()
      // requires this native user-activation turn, and must happen only once.
      delivered = true;
      try { latest.current.onImage(); } finally { latest.current.onClose(); }
    };
    const down = (event: PointerEvent) => {
      if (!event.isPrimary) { if (gesture) settle(0); return; }
      if (event.button !== 0 || actionLocked || delivered) return;
      ++sequence;
      const pose = freeze();
      gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, origin: pose.y,
        lastY: pose.y, lastTime: performance.now(), velocity: pose.velocity, dragging: false };
      phase('tracking');
    };
    const move = (event: PointerEvent) => {
      const g = gesture;
      if (!g || event.pointerId !== g.id) return;
      const dx = event.clientX - g.x, dy = event.clientY - g.y;
      if (!g.dragging) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 10) return;
        if (Math.abs(dy) <= Math.abs(dx) * 1.25) { settle(0); return; }
        if (!event.cancelable) { settle(0); return; }
        g.dragging = true; handle.setPointerCapture(g.id); phase('dragging');
      }
      if (!event.cancelable) { settle(0); return; }
      event.preventDefault();
      const raw = g.origin + dy;
      const edge = panel.getBoundingClientRect().height * .9;
      const y = raw < 0 ? -12 * (1 - Math.exp(raw / 60)) : raw > edge ? edge + 30 * (1 - Math.exp((edge - raw) / 100)) : raw;
      const now = performance.now();
      g.velocity = (y - g.lastY) / Math.max(8, now - g.lastTime);
      g.lastY = y; g.lastTime = now;
      panel.style.transform = `translate3d(0,${y}px,0)`;
      const stretch = Math.min(1, Math.max(0, y) / Math.max(1, panel.offsetHeight));
      material.style.transform = `scale(${1 - stretch * .02},${1 + stretch * .03})`;
    };
    const up = (event: PointerEvent) => {
      const g = gesture;
      if (!g || event.pointerId !== g.id) return;
      const y = readY();
      const velocity = performance.now() - g.lastTime < 100 ? g.velocity : 0;
      const dismiss = g.dragging && velocity >= -.2 && (y >= Math.min(104, Math.max(64, panel.offsetHeight * .32)) || y >= 28 && velocity >= .6);
      settle(dismiss ? panel.offsetHeight + 40 : 0, dismiss, velocity);
    };
    const cancelled = (event: PointerEvent) => { if (gesture?.id === event.pointerId) settle(0); };
    const lostCapture = (event:PointerEvent) => { if(!handle.hasPointerCapture(event.pointerId))cancelled(event); };
    const leave = () => { if (gesture && !gesture.dragging) settle(0); };
    const hidden = () => { if (document.hidden) interrupt(); };
    const covered = () => {
      const dialogs = document.querySelectorAll<HTMLElement>('[aria-modal="true"]');
      if (dialogs.length && dialogs[dialogs.length - 1] !== panel) interrupt();
    };
    controller.current = { close, image };
    panel.style.transform = 'translate3d(0,28px,0)'; settle(0);
    handle.addEventListener('pointerdown', down);
    handle.addEventListener('pointermove', move, { passive: false });
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', cancelled);
    handle.addEventListener('lostpointercapture', lostCapture);
    handle.addEventListener('pointerleave', leave);
    window.addEventListener('resize', interrupt); window.visualViewport?.addEventListener('resize', interrupt);
    window.addEventListener('blur', interrupt);
    document.addEventListener('visibilitychange', hidden); document.addEventListener('focusin', covered);
    const unsubscribe = subscribeReducedMotion(interrupt);
    return () => {
      alive = false; interrupt(); controller.current = null; unsubscribe();
      handle.removeEventListener('pointerdown', down); handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up); handle.removeEventListener('pointercancel', cancelled);
      handle.removeEventListener('lostpointercapture', lostCapture); handle.removeEventListener('pointerleave', leave);
      window.removeEventListener('resize', interrupt); window.visualViewport?.removeEventListener('resize', interrupt);
      window.removeEventListener('blur', interrupt);
      document.removeEventListener('visibilitychange', hidden); document.removeEventListener('focusin', covered);
    };
  }, []);

  return <Modal open title="添加附件" presentation="page" panelClassName="vg-attachment-sheet" width="max-w-md"
    onClose={() => controller.current?.close()} canSnapshotOnExit={() => false}>
    <div ref={contentRef} className="vg-attachment-content">
      <span ref={materialRef} className="vg-attachment-material" aria-hidden="true" />
      <div ref={dragRef} className="vg-attachment-drag-region" data-no-page-swipe data-no-back-swipe>
        <span className="vg-attachment-grip" aria-hidden="true" /><h3>添加附件</h3><p>向下拖动关闭</p>
      </div>
      <div className="vg-attachment-actions">
        <button type="button" className="vg-attachment-image" onClick={() => controller.current?.image()}>
          <span className="vg-attachment-action-material" aria-hidden="true" />
          <svg aria-hidden="true" width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="4" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L6 21" /></svg>
          <span><strong>选择图片</strong><small>从设备中选择</small></span>
        </button>
        <button type="button" className="vg-attachment-cancel" onClick={() => controller.current?.close()}><span className="vg-attachment-action-material" aria-hidden="true" /><span>取消</span></button>
      </div>
    </div>
  </Modal>;
}
