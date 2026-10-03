import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Modal } from './Modal';
import { AnimatedValue } from './AnimatedValue';
import { prefersReducedMotion, subscribeReducedMotion } from '../../lib/mobile-motion';

export function ImagePreview({ images, initialIndex = 0, onClose }: { images: string[]; initialIndex?: number; onClose: () => void }) {
  const [index, setIndex] = useState(Math.min(Math.max(0, initialIndex), images.length - 1));
  const current = useRef(index); current.current = index;
  const stage = useRef<HTMLDivElement>(null), track = useRef<HTMLDivElement>(null);
  const motion = useRef<Animation | null>(null);
  const gesture = useRef<{ id: number; x: number; y: number; base: number; baseY: number; dx: number; dy: number; lastX: number; lastTime: number; velocity: number; axis: 'x' | 'y' | null } | null>(null);
  const reduce = prefersReducedMotion;
  const paintedX = () => {
    const transform = track.current && getComputedStyle(track.current).transform;
    return !transform || transform === 'none' ? 0 : new DOMMatrixReadOnly(transform).m41;
  };
  const reset = () => {
    motion.current?.cancel(); motion.current = null; gesture.current = null;
    if (stage.current) { stage.current.style.transform = ''; stage.current.style.opacity = ''; delete stage.current.dataset.gestureDirection; }
    if (track.current) { track.current.style.willChange = ''; track.current.style.transform = `translate3d(${-current.current * (stage.current?.clientWidth ?? 0)}px,0,0)`; }
  };
  const go = (next: number) => {
    const node = track.current; if (!node || !stage.current) return;
    const target = Math.max(0, Math.min(images.length - 1, next));
    const from = paintedX(); motion.current?.cancel();
    const to = -target * stage.current.clientWidth;
    current.current = target; setIndex(target); node.style.transform = `translate3d(${to}px,0,0)`;
    stage.current.style.transform = ''; stage.current.style.opacity = '';
    delete stage.current.dataset.gestureDirection;
    if (reduce() || Math.abs(from - to) < .5) { node.style.willChange = ''; return; }
    node.style.willChange = 'transform';
    const animation = node.animate([{ transform: `translate3d(${from}px,0,0)` }, { transform: `translate3d(${to}px,0,0)` }], { duration: 280, easing: 'cubic-bezier(.16,1,.3,1)' });
    motion.current = animation;
    animation.onfinish = () => { if (motion.current === animation) { animation.cancel(); motion.current = null; node.style.willChange = ''; } };
  };
  useLayoutEffect(() => {
    reset();
    const observer = new ResizeObserver(reset); if (stage.current) observer.observe(stage.current);
    const unsubscribe = subscribeReducedMotion(reset);
    return () => { observer.disconnect(); unsubscribe(); reset(); };
  }, []);
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); go(current.current + (event.key === 'ArrowRight' ? 1 : -1)); } };
    document.addEventListener('keydown', key); return () => document.removeEventListener('keydown', key);
  }, [images.length]);
  return <Modal open onClose={onClose} title="图片预览" mobileFullHeight width="max-w-none" panelClassName="vg-media-viewer" canSnapshotOnExit={() => false}>
    <div className="vg-media-stage" ref={stage} data-no-page-swipe data-no-back-swipe data-preview-index={index}
      onPointerDown={event => {
        if (!event.isPrimary || event.button !== 0) { reset(); return; }
        event.currentTarget.setPointerCapture(event.pointerId);
        const base = paintedX(); const style = getComputedStyle(event.currentTarget);
        const baseY = style.transform === 'none' ? 0 : new DOMMatrixReadOnly(style.transform).m42;
        const paintedTransform = style.transform, paintedOpacity = style.opacity;
        motion.current?.cancel(); motion.current = null;
        event.currentTarget.style.transform = paintedTransform; event.currentTarget.style.opacity = paintedOpacity;
        if (track.current) track.current.style.transform = `translate3d(${base}px,0,0)`;
        gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, base, baseY, dx: 0, dy: 0, lastX: event.clientX, lastTime: performance.now(), velocity: 0, axis: Math.abs(baseY) > 1 ? 'y' : null };
      }}
      onPointerMove={event => {
        const g = gesture.current; if (!g || g.id !== event.pointerId || !track.current) return;
        g.dx = event.clientX - g.x; g.dy = event.clientY - g.y;
        if (!g.axis && Math.max(Math.abs(g.dx), Math.abs(g.dy)) >= 12) {
          if (Math.abs(g.dx) > Math.abs(g.dy) * 1.35) g.axis = 'x';
          else if (Math.abs(g.dy) > Math.abs(g.dx) * 1.35) g.axis = 'y';
          if (g.axis) event.currentTarget.dataset.gestureDirection = g.axis;
        }
        const now = performance.now(); g.velocity = (event.clientX - g.lastX) / Math.max(8, now - g.lastTime); g.lastX = event.clientX; g.lastTime = now;
        if (g.axis === 'x') {
          const raw = g.base + g.dx, limit = -(images.length - 1) * event.currentTarget.clientWidth;
          const x = raw > 0 ? 38 * (1 - Math.exp(-raw / 100)) : raw < limit ? limit - 38 * (1 - Math.exp((raw - limit) / 100)) : raw;
          track.current.style.willChange = 'transform'; track.current.style.transform = `translate3d(${x}px,0,0)`;
        } else if (g.axis === 'y') {
          const y = g.baseY + (g.dy < 0 ? -30 * (1 - Math.exp(g.dy / 100)) : g.dy * .8);
          event.currentTarget.style.transform = `translate3d(0,${y}px,0) scale(${1 - Math.min(.12, Math.max(0, y) / 1600)})`;
          event.currentTarget.style.opacity = String(1 - Math.min(.4, Math.abs(y) / 700));
        }
      }}
      onPointerUp={event => {
        const g = gesture.current; if (!g || g.id !== event.pointerId) return;
        gesture.current = null;
        if (g.axis === 'y') {
          const style = getComputedStyle(event.currentTarget); const from = { transform: style.transform, opacity: style.opacity };
          if (g.dy > 110) {
            if (reduce()) { onClose(); return; }
            const leave = event.currentTarget.animate([from, { transform: `translate3d(0,${g.baseY + g.dy * .8 + 160}px,0) scale(.86)`, opacity: '0' }], { duration: 200, easing: 'cubic-bezier(.3,0,.6,1)', fill: 'forwards' });
            motion.current = leave;
            leave.onfinish = () => { if (motion.current === leave) { motion.current = null; onClose(); } };
            return;
          }
          event.currentTarget.style.transform = ''; event.currentTarget.style.opacity = ''; delete event.currentTarget.dataset.gestureDirection;
          if (!reduce()) { const animation = event.currentTarget.animate([from, { transform: 'none', opacity: '1' }], { duration: 240, easing: 'cubic-bezier(.16,1,.3,1)' }); motion.current = animation; animation.onfinish = () => { if (motion.current === animation) { animation.cancel(); motion.current = null; } }; }
          return;
        }
        const velocity = performance.now() - g.lastTime < 100 ? g.velocity : 0;
        const commit = g.axis === 'x' && Math.sign(velocity || g.dx) === Math.sign(g.dx) && (Math.abs(g.dx) > event.currentTarget.clientWidth * .2 || Math.abs(g.dx) >= 35 && Math.abs(velocity) > .65);
        go(current.current + (commit ? g.dx < 0 ? 1 : -1 : 0));
      }} onPointerCancel={reset}>
      <div className="vg-media-track" ref={track}>{images.map((src, i) => <div className="vg-media-frame" key={i}><img src={src} alt={`动态图片 ${i + 1}`} draggable={false} /></div>)}</div>
    </div>
    <div className="vg-media-controls"><button type="button" aria-label="上一张图片" disabled={index === 0} onClick={() => go(current.current - 1)}>‹</button><span><AnimatedValue value={index + 1} /> / {images.length}<small>左右切换 · 下拉关闭</small></span><button type="button" aria-label="下一张图片" disabled={index === images.length - 1} onClick={() => go(current.current + 1)}>›</button></div>
  </Modal>;
}
