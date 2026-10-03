import { useCallback, useEffect, useRef } from 'react';
import { IS_MOBILE } from '../../lib/platform';
import { prefersReducedMotion, restoreSnapshotScroll, settleFrames, subscribeReducedMotion, visualSnapshot } from '../../lib/mobile-motion';

interface Handoff { top: number; opacity: number; panelOpacity: number }
interface ClosingFrame {
  depth: number;
  remove: () => void;
  attachTo: (overlay: HTMLElement) => Handoff | undefined;
}
const closingFrames = new Map<HTMLElement, ClosingFrame>();
// DOM insertion and ref detachment do not necessarily follow sibling order. In
// particular, a replacement portal can already exist while its old ref detaches.
// Track committed refs so that a replacement is not mistaken for a nested sheet.
const liveOverlays = new Set<HTMLElement>();
const translateY = (style: CSSStyleDeclaration) => style.transform === 'none' ? 0 : new DOMMatrixReadOnly(style.transform).m42;

/** A closing frame can finish even when the caller immediately unmounts the Modal. */
export function useModalMotion(canSnapshotOnExit?: () => boolean) {
  const snapshotAllowed = useRef(canSnapshotOnExit);
  snapshotAllowed.current = canSnapshotOnExit;
  const active = useRef<{ node: HTMLDivElement; depth: number; clear: () => void } | null>(null);
  const ref = useCallback((node: HTMLDivElement | null) => {
    if (!node) {
      const live = active.current;
      if (!live) return;
      liveOverlays.delete(live.node);
      const allowed = () => {
        try { return snapshotAllowed.current?.() ?? true; } catch { return false; }
      };
      // A rapid replacement must freeze only the current dialog, not its outgoing sibling.
      closingFrames.forEach(frame => frame.remove());
      const panel = live.node.querySelector<HTMLElement>(':scope > .vg-modal-panel');
      if (!IS_MOBILE || prefersReducedMotion() || document.hidden || !panel || !allowed()) {
        live.clear(); active.current = null;
        return;
      }
      // Read the interrupted pose before cancelling animations. Read all geometry
      // together, before the snapshot is inserted, to avoid a second layout flush.
      const rootStyle = getComputedStyle(live.node);
      const panelStyle = getComputedStyle(panel);
      const rootOpacity = Number(rootStyle.opacity);
      const panelOpacity = Number(panelStyle.opacity);
      const panelY = translateY(panelStyle);
      const panelTop = panel.getBoundingClientRect().top;
      const backgroundColor = rootStyle.backgroundColor;
      const depth = live.depth;
      const snapshot = visualSnapshot(live.node);
      live.clear(); active.current = null;
      if (!snapshot) return;
      snapshot.classList.remove('vg-modal-overlay'); snapshot.classList.add('vg-modal-exit');
      snapshot.style.backgroundColor = backgroundColor;
      snapshot.style.opacity = String(rootOpacity);
      const frozenPanel = snapshot.querySelector<HTMLElement>(':scope > .vg-modal-panel')!;
      frozenPanel.style.transform = `translate3d(0,${panelY}px,0)`;
      frozenPanel.style.opacity = String(panelOpacity);
      frozenPanel.style.willChange = 'transform,opacity';
      document.body.append(snapshot);
      restoreSnapshotScroll(snapshot);
      let released = false;
      let leave: Animation | undefined;
      let shade: Animation | undefined;
      let startFrame = 0;
      let accessFrame = 0;
      let deadline = 0;
      const remove = () => {
        if (released) return;
        released = true;
        cancelAnimationFrame(startFrame); cancelAnimationFrame(accessFrame); window.clearTimeout(deadline);
        snapshot.remove(); closingFrames.delete(snapshot); leave?.cancel(); shade?.cancel();
        unsubscribe(); document.removeEventListener('visibilitychange', hidden);
        window.removeEventListener('resize', remove); window.visualViewport?.removeEventListener('resize', remove);
      };
      const hidden = () => { if (document.hidden) remove(); };
      // Access can change after unmount (for example, switching accounts during an
      // exit). A guarded frame is dropped before the next paint if access is lost.
      const checkAccess = () => {
        if (!allowed()) { remove(); return; }
        accessFrame = requestAnimationFrame(checkAccess);
      };
      if (snapshotAllowed.current) accessFrame = requestAnimationFrame(checkAccess);
      // A same-commit handoff needs neither an outgoing scrim animation nor its
      // allocation/cancellation. Hold the captured pose until that decision is known.
      startFrame = requestAnimationFrame(() => {
        if (!allowed()) { remove(); return; }
        leave = frozenPanel.animate(settleFrames(panelY, panelY + 20, panelOpacity, .74, 'y', 3), { duration: 180, easing: 'linear' });
        shade = snapshot.animate([{ opacity: rootOpacity }, { opacity: 0 }], { duration: 180, easing: 'cubic-bezier(.4,0,1,1)' });
        shade.onfinish = remove;
      });
      deadline = window.setTimeout(remove, 240);
      closingFrames.set(snapshot, { depth, remove, attachTo: overlay => {
        if (released || !allowed()) { remove(); return; }
        const opacity = Number(getComputedStyle(snapshot).opacity);
        const style = getComputedStyle(frozenPanel);
        const y = translateY(style);
        const ownOpacity = Number(style.opacity);
        const top = panelTop + y - panelY;
        cancelAnimationFrame(startFrame); leave?.cancel(); shade?.cancel();
        // The incoming overlay owns one continuous scrim. Its predecessor is an
        // inert visual under the new panel, including when replacing a nested sheet.
        snapshot.style.backgroundColor = 'transparent'; snapshot.style.opacity = '1'; snapshot.style.zIndex = '0';
        overlay.prepend(snapshot);
        leave = frozenPanel.animate(settleFrames(y, y - 8, ownOpacity, 0, 'y', 3), { duration: 140, easing: 'linear' });
        leave.onfinish = remove;
        return { top, opacity, panelOpacity: ownOpacity };
      } });
      const unsubscribe = subscribeReducedMotion(remove);
      document.addEventListener('visibilitychange', hidden);
      window.addEventListener('resize', remove); window.visualViewport?.addEventListener('resize', remove);
      return;
    }
    const animations: Animation[] = [];
    const panel = node.querySelector<HTMLElement>(':scope > .vg-modal-panel');
    const depth = liveOverlays.size + 1;
    liveOverlays.add(node);
    const candidate = IS_MOBILE && !prefersReducedMotion() && !document.hidden
      ? [...closingFrames.values()].find(frame => frame.depth === depth) : undefined;
    closingFrames.forEach(frame => { if (frame !== candidate) frame.remove(); });
    const targetTop = candidate && panel ? panel.getBoundingClientRect().top : 0;
    const source = candidate?.attachTo(node);
    if (IS_MOBILE && panel && !prefersReducedMotion() && !document.hidden) {
      const fullHeight = panel.classList.contains('vg-mobile-sheet-full');
      const distance = source ? Math.max(-30, Math.min(30, source.top - targetTop)) : fullHeight ? 14 : 24;
      if (!source || source.opacity < .999) {
        node.style.willChange = 'opacity';
        const shade = node.animate([{ opacity: source?.opacity ?? 0 }, { opacity: 1 }], { duration: 140, easing: 'cubic-bezier(.16,1,.3,1)' });
        shade.onfinish = () => { node.style.willChange = ''; };
        animations.push(shade);
      }
      panel.style.willChange = 'transform,opacity';
      const enter = panel.animate(settleFrames(distance, 0, source ? Math.min(.94, source.panelOpacity) : .92, 1, 'y', 3), { duration: source ? 260 : 300, easing: 'linear' });
      enter.onfinish = () => { panel.style.willChange = ''; };
      animations.push(enter);
    }
    const clear = () => {
      animations.forEach(animation => animation.cancel());
      node.style.willChange = '';
      if (panel) panel.style.willChange = '';
      unsubscribe(); window.removeEventListener('resize', clear);
      window.visualViewport?.removeEventListener('resize', clear); document.removeEventListener('visibilitychange', hidden);
    };
    const hidden = () => { if (document.hidden) clear(); };
    const unsubscribe = subscribeReducedMotion(clear);
    window.addEventListener('resize', clear);
    window.visualViewport?.addEventListener('resize', clear); document.addEventListener('visibilitychange', hidden);
    active.current = { node, depth, clear };
  }, []);
  useEffect(() => () => {
    if (active.current) liveOverlays.delete(active.current.node);
    active.current?.clear(); active.current = null;
  }, []);
  return ref;
}
