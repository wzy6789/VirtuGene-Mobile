import { prefersReducedMotion, subscribeReducedMotion } from '../mobile-motion';
import { deriveSceneMotion } from './scene-policy';
import type { SceneMotionPolicy, ScenePreferences, SceneQuality, SceneRuntimeSignals } from './scene-types';

let runtimes = 0, subscriptions = 0;
export const inspectSceneRuntimeResources = () => ({ runtimes, subscriptions });
export interface SceneRuntimeSnapshot { signals: SceneRuntimeSignals; policy: SceneMotionPolicy }
/** Geometry only: refresh on viewport/lifecycle events, never policy mutations. */
export function createSceneViewportSnapshot() {
  const capture = () => {
    const viewport = window.visualViewport;
    const layoutHeight = window.innerHeight;
    const visibleHeight = viewport?.height ?? layoutHeight;
    const offsetTop = viewport?.offsetTop ?? 0;
    return { layoutHeight, visibleHeight, offsetTop, keyboardOpen: !!viewport && layoutHeight - visibleHeight - offsetTop > 120 };
  };
  let current = capture();
  return { get current() { return current; }, refresh() { current = capture(); } };
}
/** One host policy drives every executor. No scene animation independently decides to resume. */
export function createSceneRuntime(host: HTMLElement, preferences: ScenePreferences, quality: SceneQuality, changed: (state: SceneRuntimeSnapshot) => void) {
  const room = host.closest<HTMLElement>('.chat-room,.vg-background-preview') ?? host.parentElement!;
  const root = document.documentElement;
  let alive = true, visible = true, nativeActive = true, scrolling = false, keyboardTransitioning=false, timer: ReturnType<typeof setTimeout> | undefined, keyboardTimer:ReturnType<typeof setTimeout>|undefined;
  let last = '', snapshot: SceneRuntimeSnapshot;
  let pendingFrame = 0;
  const viewport = createSceneViewportSnapshot();
  runtimes++;
  const sync = () => {
    if (!alive) return;
    if (pendingFrame) { cancelAnimationFrame(pendingFrame); pendingFrame = 0; }
    const active = document.activeElement;
    const inputFocused = !!active && room.contains(active) && active.matches('input,textarea,[contenteditable="true"]');
    const keyboardOpen = viewport.current.keyboardOpen;
    const selection = document.getSelection();
    // Reading rendered selection text can flush pending styles. Portal/focus
    // changes usually have no selected text, so keep those checks layout-free;
    // a real room selection still uses the browser's visible-text semantics.
    const selectingText = !!selection && !selection.isCollapsed && !!selection.anchorNode
      && room.contains(selection.anchorNode) && !!selection.toString();
    let front: Element | undefined, z = -Infinity;
    for (const modal of document.querySelectorAll('.vg-modal-overlay,.vg-modal-exit')) {
      const style = getComputedStyle(modal);
      if (!modal.getClientRects().length || style.display === 'none' || style.visibility === 'hidden') continue;
      const layer = parseFloat(style.zIndex) || 0; if (layer >= z) { front = modal; z = layer; }
    }
    const signals: SceneRuntimeSignals = {
      visible: visible && !host.closest('[hidden],[inert],.vg-motion-snapshot'),
      appActive: nativeActive && !document.hidden && !root.hasAttribute('data-vg-background'),
      inputFocused, keyboardOpen, scrolling: scrolling || room.hasAttribute('data-chat-resting'),
      modalOpen: !!front && !front.contains(host),
      phase: room.dataset.chatPhase === 'waiting' ? 'waiting' : room.dataset.chatPhase === 'streaming' ? 'streaming' : 'idle',
      voiceActive: root.hasAttribute('data-vg-call-minimized') || !!document.querySelector('.vg-voice-call-modal,.vg-call-stage,.vg-voice-call-capsule'), reduceMotion: prefersReducedMotion(),
      selectingText,keyboardTransitioning,
      surfaceMode:front?.getAttribute('data-vg-surface-mode')==='long-form'?'long-form':undefined,
    };
    const policy = deriveSceneMotion(signals, preferences, quality);
    // Repeated focus/portal/viewport signals often resolve to the same policy.
    // Even assigning an identical dataset value invalidates CSS and publishes a
    // mutation, so only commit channels whose visual state actually changed.
    const ambient=policy.ambient??'off',avatar=policy.avatar??'off',particles=policy.particles??'off';
    if(room.dataset.chatAmbient!==ambient)room.dataset.chatAmbient=ambient;
    if(room.dataset.chatAvatar!==avatar)room.dataset.chatAvatar=avatar;
    if(room.dataset.chatParticles!==particles)room.dataset.chatParticles=particles;
    snapshot = { signals, policy };
    const key = JSON.stringify(snapshot);
    if (key !== last) { last = key; changed(snapshot); }
  };
  // Focus restoration and portal insertion/removal share one commit, but arrive
  // through several observers. Resolve their final visible state once before
  // paint instead of forcing a full style/layout pass in every microtask.
  const scheduleSync = () => {
    if (!alive || pendingFrame) return;
    pendingFrame = requestAnimationFrame(() => { pendingFrame = 0; sync(); });
  };
  const scroll = (event: Event) => {
    if (!(event.target instanceof Element) || !event.target.closest('.chat-thread')) return;
    // A scroll burst changes policy only at its edges. Re-scanning every modal
    // and reading its layout for each scroll event cannot change this signal.
    // Focus, portals, visibility and the other independent signals still sync.
    clearTimeout(timer);
    if (!scrolling) { scrolling = true; sync(); }
    timer = setTimeout(() => { scrolling = false; sync(); }, 180);
  };
  const refresh = () => {
    if (!alive) return;
    viewport.refresh();
    // Hidden documents may not get another animation frame. Stop executors now.
    if (document.hidden) sync(); else scheduleSync();
  };
  const blur = () => queueMicrotask(refresh);
  const keyboardChanged=()=>{if(!alive)return;viewport.refresh();keyboardTransitioning=true;clearTimeout(keyboardTimer);scheduleSync();keyboardTimer=setTimeout(()=>{if(!alive)return;keyboardTransitioning=false;refresh();},220);};
  const pause = () => { nativeActive = false; sync(); }, resume = () => { nativeActive = true; refresh(); };
  const intersection = new IntersectionObserver(entries => { visible = entries[0]?.isIntersecting ?? false; sync(); }); intersection.observe(host);
  const ancestors = new MutationObserver(scheduleSync);
  for (let node: HTMLElement | null = room; node; node = node.parentElement) ancestors.observe(node, { attributes: true, attributeFilter: ['hidden','inert','data-chat-resting','data-chat-phase','data-vg-background','data-vg-reduced-motion','data-vg-call-minimized'] });
  // Modals are direct body portals. Token/text mutations never trigger modal scans.
  const portals = new MutationObserver(scheduleSync); portals.observe(document.body, { childList: true });
  const removeMotion = subscribeReducedMotion(sync); subscriptions++;
  room.addEventListener('scroll', scroll, { capture: true, passive: true }); room.addEventListener('focusin', refresh); room.addEventListener('focusout', blur);
  document.addEventListener('visibilitychange', refresh); document.addEventListener('pause', pause); document.addEventListener('resume', resume);
  document.addEventListener('selectionchange',scheduleSync);
  window.visualViewport?.addEventListener('resize', keyboardChanged); window.visualViewport?.addEventListener('scroll', keyboardChanged);
  window.addEventListener('resize', keyboardChanged);
  sync();
  return { sync, inspect: () => snapshot, dispose() {
    if (!alive) return; alive = false; cancelAnimationFrame(pendingFrame); clearTimeout(timer);clearTimeout(keyboardTimer); intersection.disconnect(); ancestors.disconnect(); portals.disconnect(); removeMotion();
    subscriptions--; runtimes--; room.removeEventListener('scroll', scroll, true); room.removeEventListener('focusin', refresh); room.removeEventListener('focusout', blur);
    document.removeEventListener('visibilitychange', refresh); document.removeEventListener('pause', pause); document.removeEventListener('resume', resume);
    document.removeEventListener('selectionchange',scheduleSync);
    window.visualViewport?.removeEventListener('resize', keyboardChanged); window.visualViewport?.removeEventListener('scroll', keyboardChanged);
    window.removeEventListener('resize', keyboardChanged);
  } };
}
