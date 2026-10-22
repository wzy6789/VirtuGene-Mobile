import { prefersReducedMotion, subscribeReducedMotion } from '../mobile-motion';
import { deriveSceneMotion } from './scene-policy';
import type { SceneMotionPolicy, ScenePreferences, SceneQuality, SceneRuntimeSignals } from './scene-types';

let runtimes = 0, subscriptions = 0;
export const inspectSceneRuntimeResources = () => ({ runtimes, subscriptions });
export interface SceneRuntimeSnapshot { signals: SceneRuntimeSignals; policy: SceneMotionPolicy }
/** One host policy drives every executor. No scene animation independently decides to resume. */
export function createSceneRuntime(host: HTMLElement, preferences: ScenePreferences, quality: SceneQuality, changed: (state: SceneRuntimeSnapshot) => void) {
  const room = host.closest<HTMLElement>('.chat-room,.vg-background-preview') ?? host.parentElement!;
  const root = document.documentElement;
  let alive = true, visible = true, nativeActive = true, scrolling = false, keyboardTransitioning=false, timer: ReturnType<typeof setTimeout> | undefined, keyboardTimer:ReturnType<typeof setTimeout>|undefined;
  let last = '', snapshot: SceneRuntimeSnapshot;
  runtimes++;
  const sync = () => {
    if (!alive) return;
    const active = document.activeElement;
    const inputFocused = !!active && room.contains(active) && active.matches('input,textarea,[contenteditable="true"]');
    const viewport = window.visualViewport;
    const keyboardOpen = !!viewport && window.innerHeight - viewport.height - viewport.offsetTop > 120;
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
      selectingText:!!document.getSelection()?.toString()&&!!document.getSelection()?.anchorNode&&room.contains(document.getSelection()!.anchorNode),keyboardTransitioning,
      surfaceMode:front?.getAttribute('data-vg-surface-mode')==='long-form'?'long-form':undefined,
    };
    const policy = deriveSceneMotion(signals, preferences, quality);
    room.dataset.chatAmbient=policy.ambient??'off';room.dataset.chatAvatar=policy.avatar??'off';room.dataset.chatParticles=policy.particles??'off';
    snapshot = { signals, policy };
    const key = JSON.stringify(snapshot);
    if (key !== last) { last = key; changed(snapshot); }
  };
  const scroll = (event: Event) => {
    if (!(event.target instanceof Element) || !event.target.closest('.chat-thread')) return;
    scrolling = true; clearTimeout(timer); sync(); timer = setTimeout(() => { scrolling = false; sync(); }, 180);
  };
  const blur = () => queueMicrotask(sync);
  const keyboardChanged=()=>{keyboardTransitioning=true;clearTimeout(keyboardTimer);sync();keyboardTimer=setTimeout(()=>{keyboardTransitioning=false;sync();},220);};
  const pause = () => { nativeActive = false; sync(); }, resume = () => { nativeActive = true; sync(); };
  const intersection = new IntersectionObserver(entries => { visible = entries[0]?.isIntersecting ?? false; sync(); }); intersection.observe(host);
  const ancestors = new MutationObserver(sync);
  for (let node: HTMLElement | null = room; node; node = node.parentElement) ancestors.observe(node, { attributes: true, attributeFilter: ['hidden','inert','data-chat-resting','data-chat-phase','data-vg-background','data-vg-reduced-motion','data-vg-call-minimized'] });
  // Modals are direct body portals. Token/text mutations never trigger modal scans.
  const portals = new MutationObserver(sync); portals.observe(document.body, { childList: true });
  const removeMotion = subscribeReducedMotion(sync); subscriptions++;
  room.addEventListener('scroll', scroll, { capture: true, passive: true }); room.addEventListener('focusin', sync); room.addEventListener('focusout', blur);
  document.addEventListener('visibilitychange', sync); document.addEventListener('pause', pause); document.addEventListener('resume', resume);
  document.addEventListener('selectionchange',sync);
  window.visualViewport?.addEventListener('resize', keyboardChanged); window.visualViewport?.addEventListener('scroll', keyboardChanged);
  sync();
  return { sync, inspect: () => snapshot, dispose() {
    if (!alive) return; alive = false; clearTimeout(timer);clearTimeout(keyboardTimer); intersection.disconnect(); ancestors.disconnect(); portals.disconnect(); removeMotion();
    subscriptions--; runtimes--; room.removeEventListener('scroll', scroll, true); room.removeEventListener('focusin', sync); room.removeEventListener('focusout', blur);
    document.removeEventListener('visibilitychange', sync); document.removeEventListener('pause', pause); document.removeEventListener('resume', resume);
    document.removeEventListener('selectionchange',sync);
    window.visualViewport?.removeEventListener('resize', keyboardChanged); window.visualViewport?.removeEventListener('scroll', keyboardChanged);
  } };
}
