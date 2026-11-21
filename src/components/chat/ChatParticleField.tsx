import { useEffect, useId, useRef, useState } from 'react';
import type { Container } from '@tsparticles/engine';
import type { ChatBackgroundConfig } from '../../lib/chat-background-config';
import {
  chatParticleCount, getChatParticleFrameMetrics, getChatParticleOptions,
  getChatParticleProfile, loadChatParticleEngine, seedChatParticles,
  destroyChatParticleContainer,
} from '../../lib/chat-particle-engine';
export { inspectChatParticleEngine } from '../../lib/chat-particle-engine';

interface ParticleFieldRecord {
  instanceId: string;
  status: 'loading' | 'running' | 'paused' | 'static' | 'fallback';
  pauseReason: string;
  theme: string;
  shape: string;
  motion: string;
  count: number;
  lastError?: string;
  container?: Container;
}
const fields = new WeakMap<HTMLElement, ParticleFieldRecord>();
let particleInstance = 0;

/** A diagnostics-only getter: no account, message, user text, mutation, or production window global. */
export function inspectChatParticleField(element: HTMLElement, { pixels = false }: { pixels?: boolean } = {}) {
  const host = element.matches('.vg-chat-particles') ? element : element.querySelector<HTMLElement>('.vg-chat-particles');
  const record = host && fields.get(host);
  if (!record) return undefined;
  const container = record.container;
  const metrics = container ? getChatParticleFrameMetrics(container) : { frames: 0, lastFrameTime: 0, fps: 0 };
  const particles = container?.particles.filter(() => true).map(particle => ({
    x: particle.position.x, y: particle.position.y, size: particle.getRadius(),
    opacity: particle.opacity?.value ?? 1, shape: particle.shape,
  })) ?? [];
  let pixelSample: { painted: number; central: number; width: number; height: number; hash: number; centralHash: number } | undefined;
  if (pixels && container && !container.destroyed) {
    try {
      pixelSample = container.canvas.render.draw(context => {
        const { width, height } = container.canvas.size;
        const data = context.getImageData(0, 0, width, height).data;
        let painted = 0, central = 0, hash = 2166136261, centralHash = 2166136261;
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const offset = (y * width + x) * 4;
            const middle = x >= width * .25 && x < width * .75 && y >= height * .12 && y < height * .88;
            if (data[offset + 3] > 12) { painted++; if (middle) central++; }
            for (let channel = 0; channel < 4; channel++) {
              hash = Math.imul(hash ^ data[offset + channel], 16777619) >>> 0;
              if (middle) centralHash = Math.imul(centralHash ^ data[offset + channel], 16777619) >>> 0;
            }
          }
        }
        return { painted, central, width, height, hash, centralHash };
      });
    } catch { /* Diagnostics must remain safe on restricted canvases or a concurrently destroyed view. */ }
  }
  return { ...record, container: undefined, count: container?.particles.count ?? record.count, ...metrics, fps: record.status === 'running' ? metrics.fps : 0, particles, pixelSample };
}

/** Visible, theme-specific fallback for old WebViews without transferable OffscreenCanvas. */
function StaticParticleField({ config, dark }: { config: ChatBackgroundConfig; dark: boolean }) {
  const profile = getChatParticleProfile(config.themeId), colors = profile.colors[dark ? 'dark' : 'light'];
  const count = chatParticleCount(config);
  const shape = profile.shape;
  return <svg className="vg-chat-particles-fallback" viewBox="0 0 390 844" preserveAspectRatio="xMidYMid slice" width="100%" height="100%" aria-hidden="true" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
    {Array.from({ length: count }, (_, index) => {
      const x = 12 + ((index * 137 + 29) % 367), y = 12 + ((index * 233 + 73) % 817);
      const large = index % 4 === 0;
      const transform = `translate(${x} ${y}) rotate(${index * 37 % 360}) scale(${large ? 1 : .55})`;
      const common = { transform, fill: colors[index % colors.length], opacity: large ? .6 : .42 };
      return <g key={index} {...common}>
        {shape === 'vg-snow' ? <path d="M0-5 1-1 4-3 2 0 4 3 1 1 0 5-1 1-4 3-2 0-4-3-1-1Z" />
          : shape === 'vg-petal' ? <path d="M0-7C9-4 7 6-1 7-8 3-7-2 0-7Z" />
          : shape === 'vg-rain' ? <path d="m-1-12 1-2 1 19q-1 3-2 0Z" />
          : shape === 'vg-star' ? <path d="M0-6 1-1 6 0 1 1 0 6-1 1-6 0-1-1Z" />
          : <><circle r={shape === 'vg-amber' && index % 11 === 0 ? 12 : 5} opacity=".16" /><circle r={shape === 'vg-amber' && index % 11 === 0 ? 6 : 2.2} /></>}
      </g>;
    })}
  </svg>;
}

export function ChatParticleField({ config }: { config: ChatBackgroundConfig }) {
  const ref = useRef<HTMLDivElement>(null), mountRef = useRef<HTMLDivElement>(null);
  const identity = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const [appDark, setAppDark] = useState(() => document.documentElement.classList.contains('dark'));
  const [ready, setReady] = useState(false);
  const enabled = config.mode === 'atmosphere' && config.strength !== 'off';
  const dark = config.lightDarkPolicy === 'dark' || config.lightDarkPolicy === 'app' && appDark;

  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => setAppDark(root.classList.contains('dark')));
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const host = ref.current, mount = mountRef.current;
    if (!enabled || !host || !mount) return;
    // Each asynchronous load owns a distinct mount. A late old load cannot remove a newer canvas.
    const slot = document.createElement('div');
    Object.assign(slot.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
    mount.appendChild(slot);
    let alive = true, container: Container | undefined, intersects = true, scrollUntil = 0;
    let scrollTimer: ReturnType<typeof setTimeout> | undefined;
    const profile = getChatParticleProfile(config.themeId);
    const record: ParticleFieldRecord = {
      instanceId: `vg-particles-${identity}-${++particleInstance}-${config.themeId}-${config.strength}-${config.effect}-${dark ? 'dark' : 'light'}`,
      status: 'loading', pauseReason: '', theme: config.themeId, shape: profile.shape,
      motion: profile.motion, count: chatParticleCount(config),
    };
    fields.set(host, record);
    host.dataset.particleCount = String(record.count);
    host.dataset.particleTheme = record.theme;
    host.dataset.particleShape = record.shape;
    host.dataset.particleMotion = record.motion;
    host.dataset.particleState = 'loading';
    setReady(false);
    const root = document.documentElement;
    const room = host.closest<HTMLElement>('.chat-room, .vg-background-preview') ?? host.parentElement!;
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const ancestors: HTMLElement[] = [];
    for (let node: HTMLElement | null = host.parentElement; node; node = node.parentElement) ancestors.push(node);
    const pauseReason = () => {
      if (document.hidden || root.hasAttribute('data-vg-background')) return 'background';
      if (!intersects || host.closest('[hidden], [inert]')) return 'hidden';
      if (root.dataset.vgReducedMotion === 'true' || media.matches) return 'reduced-motion';
      // Only the frontmost sheet covers a preview. Lower settings sheets remain mounted beneath an editor.
      let front: Element | undefined, frontLayer = -Infinity;
      for (const modal of document.querySelectorAll('.vg-modal-overlay, .vg-modal-exit')) {
        const style = getComputedStyle(modal);
        if (!modal.getClientRects().length || style.display === 'none' || style.visibility === 'hidden') continue;
        const layer = Number.parseFloat(style.zIndex) || 0;
        if (layer >= frontLayer) { front = modal; frontLayer = layer; }
      }
      if (front && !front.contains(host)) return 'covered';
      if (performance.now() < scrollUntil || room.hasAttribute('data-chat-resting')) return 'scroll-or-input';
      const active = document.activeElement;
      if (active instanceof HTMLElement && room.contains(active) && active.matches('textarea, input, [contenteditable="true"]')) return 'input';
      if (room.dataset.chatPhase === 'waiting' || room.dataset.chatPhase === 'streaming') return room.dataset.chatPhase;
      return '';
    };
    const sync = () => {
      if (!alive || !container || container.destroyed) return;
      const reason = pauseReason(), status = reason === 'reduced-motion' ? 'static' : reason ? 'paused' : 'running';
      if (record.status !== status || record.pauseReason !== reason) {
        record.status = status; record.pauseReason = reason;
        host.dataset.particleState = status;
        host.dataset.particlePause = reason;
        if (reason) container.pause(); else container.play();
      }
    };
    const mutation = new MutationObserver(sync);
    // One observe call per node: observing the same ancestor twice replaces its earlier filters.
    for (const node of ancestors) mutation.observe(node, {
      attributes: true,
      attributeFilter: ['hidden', 'inert', 'data-chat-resting', 'data-chat-phase', 'data-vg-background', 'data-vg-reduced-motion'],
      childList: node === document.body,
    });
    const intersection = typeof IntersectionObserver === 'undefined' ? undefined : new IntersectionObserver(entries => {
      intersects = entries[0]?.isIntersecting ?? true; sync();
    });
    intersection?.observe(host);
    const scroll = () => {
      scrollUntil = performance.now() + 180; sync();
      clearTimeout(scrollTimer); scrollTimer = setTimeout(sync, 190);
    };
    room.addEventListener('scroll', scroll, { passive: true, capture: true });
    document.addEventListener('visibilitychange', sync);
    document.addEventListener('focusin', sync);
    document.addEventListener('focusout', sync);
    media.addEventListener('change', sync);
    const fallback = (error?: unknown) => {
      if (!alive) return;
      record.lastError = error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 400) : 'Transferable OffscreenCanvas unavailable';
      record.status = 'fallback'; record.pauseReason = 'engine-unavailable'; host.dataset.particleState = 'fallback';
    };
    if (typeof OffscreenCanvas === 'undefined' || typeof HTMLCanvasElement.prototype.transferControlToOffscreen !== 'function') fallback();
    else void loadChatParticleEngine().then(async engine => {
      if (!alive) return;
      let loaded: Container | undefined;
      try {
        loaded = await engine.load({ id: record.instanceId, element: slot, options: getChatParticleOptions(config, dark) });
      } catch (error) {
        // Engine.load registers before canvas initialization; a failed transfer must not leave an orphan.
        for (const failed of engine.items.filter(item => item.id.description === record.instanceId)) destroyChatParticleContainer(failed);
        throw error;
      }
      if (!loaded) { fallback(); return; }
      if (!alive) { destroyChatParticleContainer(loaded); return; }
      container = loaded; record.container = loaded;
      seedChatParticles(loaded, config);
      setReady(true); sync();
    }).catch(fallback);
    return () => {
      alive = false; mutation.disconnect(); intersection?.disconnect(); clearTimeout(scrollTimer);
      room.removeEventListener('scroll', scroll, true);
      document.removeEventListener('visibilitychange', sync);
      document.removeEventListener('focusin', sync);
      document.removeEventListener('focusout', sync);
      media.removeEventListener('change', sync);
      if (container) destroyChatParticleContainer(container);
      slot.remove();
      if (fields.get(host) === record) fields.delete(host);
    };
  }, [enabled, config.themeId, config.strength, config.effect, dark, identity]);

  if (!enabled) return null;
  return <div ref={ref} className="vg-chat-particles" aria-hidden="true" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
    {!ready && <StaticParticleField config={config} dark={dark} />}
    <div ref={mountRef} className="vg-chat-particles-canvas" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} />
  </div>;
}
