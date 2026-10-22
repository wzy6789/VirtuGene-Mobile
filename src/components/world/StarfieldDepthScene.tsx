import { useEffect, useRef } from 'react';
import { prefersReducedMotion, subscribeReducedMotion } from '../../lib/mobile-motion';
import { createStarfieldDepthRenderer, STARFIELD_DEPTH_FRAME_MS, type StarfieldDepthRenderer } from '../../lib/starfield-depth';
import '../../styles/starfield-depth.css';

export interface StarfieldDepthSceneProps {
  /** Local equirectangular mineral albedo; image failure keeps a procedural surface. */
  textureUrl?: string;
  onReady?: () => void;
  onFallback?: () => void;
}

/** Decorative real 3D; the host retains its original poster until onReady. */
export function StarfieldDepthScene({ textureUrl, onReady, onFallback }: StarfieldDepthSceneProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const callbacks = useRef({ onReady, onFallback });
  callbacks.current = { onReady, onFallback };
  useEffect(() => {
    const canvasNode = canvasRef.current;
    if (!canvasNode) return;
    const canvas: HTMLCanvasElement = canvasNode;
    const host = canvas.parentElement;
    let renderer: StarfieldDepthRenderer | undefined, frame = 0, lastDraw = 0, lastTick = 0, elapsed = 0, drawn = 0;
    let visible = true, focused = document.hasFocus(), disposed = false, lost = false, ready = false, staticDevice = false;
    let slowFrames = 0, measuredFrames = 0, windowStart = 0, lookX = 0, lookY = 0, targetX = 0, targetY = 0;
    let ancestorHidden = false, press: { id: number; x: number; y: number } | undefined;
    let lastCountWrite = 0;
    const flushCount = () => {
      const value = String(drawn);
      if (canvas.dataset.renderCount !== value) canvas.dataset.renderCount = value;
      lastCountWrite = performance.now();
    };
    const setState = (state: string, reason: string) => {
      let changed = false;
      if (canvas.dataset.state !== state) { canvas.dataset.state = state; changed = true; }
      if (canvas.dataset.reason !== reason) { canvas.dataset.reason = reason; changed = true; }
      if (changed) flushCount();
    };
    // Exact read-only diagnostics stay outside the DOM, avoiding global mutation
    // observers on every frame. The DOM counter is a 2Hz compatibility snapshot.
    Object.defineProperty(canvas, '__vgDepthStats', { configurable: true, get: () => Object.freeze({ renderCount: drawn, state: canvas.dataset.state, reason: canvas.dataset.reason }) });
    const lightTheme = () => !canvas.closest('.dark');
    const pauseReason = () => {
      if (document.hidden) return 'document-hidden';
      if (!focused) return 'window-blur';
      if (document.documentElement.hasAttribute('data-vg-background')) return 'app-background';
      if (!visible) return 'offscreen';
      if (ancestorHidden) return 'ancestor-hidden';
      return '';
    };
    const stop = () => { if (frame) cancelAnimationFrame(frame); frame = 0; lastTick = 0; lastDraw = 0; slowFrames = 0; measuredFrames = 0; windowStart = 0; };
    const draw = () => {
      if (!renderer?.draw(elapsed / 1000, lookX, lookY, lightTheme())) return;
      drawn++;
      if (drawn === 1 || canvas.dataset.state !== 'active' || performance.now() - lastCountWrite >= 500) flushCount();
      if (!ready) { ready = true; callbacks.current.onReady?.(); }
    };
    const fail = () => { stop(); setState('lost', 'webgl-unavailable'); callbacks.current.onFallback?.(); };
    const tick = (now: number) => {
      frame = 0;
      if (disposed || lost || !renderer) return;
      const reason = pauseReason();
      if (reason || prefersReducedMotion() || staticDevice) { sync(); return; }
      if (lastTick) {
        const dt = now - lastTick;
        elapsed += Math.min(80, dt);
        lookX += (targetX - lookX) * Math.min(1, dt / 160); lookY += (targetY - lookY) * Math.min(1, dt / 160);
        if (!windowStart) windowStart = now;
        measuredFrames++; if (dt > 45) slowFrames++;
        // rAF intervals include GPU pressure; this is a browser heuristic, not a GPU timer.
        if (now - windowStart >= 3000) {
          if (measuredFrames >= 12 && slowFrames / measuredFrames > .6) { staticDevice = true; draw(); sync(); return; }
          slowFrames = 0; measuredFrames = 0; windowStart = now;
        }
      }
      lastTick = now;
      if (!lastDraw || now - lastDraw >= STARFIELD_DEPTH_FRAME_MS - .5) { draw(); lastDraw = now; }
      frame = requestAnimationFrame(tick);
    };
    function sync() {
      if (disposed || lost || !renderer) return;
      // Layout/style queries happen on lifecycle changes, never on the frame path.
      // Decorative aria-hidden is accessibility-only and must not block readiness.
      ancestorHidden = !!canvas.closest('[hidden],[inert],.vg-motion-snapshot') || !canvas.getClientRects().length;
      if (host && !ancestorHidden) { const style = getComputedStyle(host); ancestorHidden = style.display === 'none' || style.visibility === 'hidden'; }
      const reason = pauseReason();
      if (reason) { stop(); press = undefined; targetX = targetY = 0; setState('paused', reason); return; }
      if (prefersReducedMotion() || staticDevice) {
        stop(); press = undefined; targetX = targetY = lookX = lookY = 0; setState(staticDevice ? 'static' : 'reduced', staticDevice ? 'sustained-slow-frames' : 'motion-preference'); draw(); return;
      }
      setState('active', 'visible');
      if (!frame) { draw(); frame = requestAnimationFrame(tick); }
    }
    const initialize = () => {
      try { renderer = createStarfieldDepthRenderer(canvas, { textureUrl, onTextureReady: sync }); sync(); }
      catch { fail(); }
    };
    const onVisibility = () => sync();
    const onFocus = () => { focused = true; sync(); };
    const onBlur = () => { focused = false; sync(); };
    const onLost = (event: Event) => { event.preventDefault(); lost = true; ready = false; stop(); setState('lost', 'context-lost'); callbacks.current.onFallback?.(); };
    const onRestored = () => { if (disposed) return; renderer?.dispose(); renderer = undefined; lost = false; initialize(); };
    const pointAt = (event: PointerEvent) => {
      if (prefersReducedMotion() || staticDevice || pauseReason() || !host) return;
      const rect = host.getBoundingClientRect();
      targetX = Math.max(-1, Math.min(1, (event.clientX - rect.left) / rect.width * 2 - 1));
      targetY = Math.max(-1, Math.min(1, 1 - (event.clientY - rect.top) / rect.height * 2));
    };
    const onRelease = () => { press = undefined; targetX = targetY = 0; };
    const onCenter = () => {
      onRelease(); lookX = lookY = 0;
      if (!disposed && !lost && !pauseReason()) draw();
    };
    const onPress = (event: PointerEvent) => {
      if (event.pointerType === 'mouse' || !event.isPrimary) return;
      press = { id: event.pointerId, x: event.clientX, y: event.clientY }; pointAt(event);
    };
    const onPointer = (event: PointerEvent) => {
      if (event.pointerType === 'mouse') { pointAt(event); return; }
      if (press?.id !== event.pointerId) return;
      // Scrolling takes over after 10px; the passive decoration never captures a gesture.
      if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > 10) { onRelease(); return; }
      pointAt(event);
    };
    const intersection = new IntersectionObserver(entries => { visible = entries[0]?.isIntersecting ?? false; sync(); }, { threshold: 0 });
    intersection.observe(canvas);
    const resize = new ResizeObserver(() => { renderer?.resize(); sync(); }); resize.observe(canvas);
    // Observe ancestors only: render-count updates must never recursively wake the renderer.
    const mutation = new MutationObserver(sync);
    for (let node: HTMLElement | null = host; node; node = node.parentElement) mutation.observe(node, { attributes: true, attributeFilter: ['class', 'style', 'hidden', 'inert', 'aria-hidden', 'data-vg-background', 'data-vg-reduced-motion'] });
    const unsubscribeMotion = subscribeReducedMotion(sync);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onFocus); window.addEventListener('blur', onBlur);
    canvas.addEventListener('webglcontextlost', onLost); canvas.addEventListener('webglcontextrestored', onRestored);
    host?.addEventListener('pointerdown', onPress, { passive: true }); host?.addEventListener('pointermove', onPointer, { passive: true }); host?.addEventListener('pointerleave', onRelease, { passive: true });
    host?.addEventListener('vg:starfield-center', onCenter);
    window.addEventListener('pointerup', onRelease, { passive: true }); window.addEventListener('pointercancel', onRelease, { passive: true });
    initialize();
    return () => {
      disposed = true; stop(); intersection.disconnect(); resize.disconnect(); mutation.disconnect(); unsubscribeMotion();
      document.removeEventListener('visibilitychange', onVisibility); window.removeEventListener('focus', onFocus); window.removeEventListener('blur', onBlur);
      canvas.removeEventListener('webglcontextlost', onLost); canvas.removeEventListener('webglcontextrestored', onRestored);
      host?.removeEventListener('pointerdown', onPress); host?.removeEventListener('pointermove', onPointer); host?.removeEventListener('pointerleave', onRelease);
      host?.removeEventListener('vg:starfield-center', onCenter);
      window.removeEventListener('pointerup', onRelease); window.removeEventListener('pointercancel', onRelease);
      renderer?.dispose(); setState('disposed', 'unmounted');
    };
  }, [textureUrl]);
  return <canvas ref={canvasRef} className="vg-starfield-depth" aria-hidden="true" data-starfield-depth="" data-state="initializing" data-render-count="0" />;
}

export default StarfieldDepthScene;
