import { useCallback, useEffect, useRef } from 'react';
import { beginSoulHandoff, registerSoulElement, soulElement, type SoulRole } from '../../lib/soul-handoff';
import { useAuthStore } from '../../store/auth-store';

interface GeneOrigin {
  owner: string;
  key: string;
  card: HTMLButtonElement;
  portrait: HTMLElement | null;
  library: HTMLElement | null;
  scroller: HTMLElement | null;
  scrollTop: number;
  valid: boolean;
}

/** Only the portrait enters the shared visual channel; text is never cloned. */
export function useGeneProfileHandoff(userId: string) {
  const origin = useRef<GeneOrigin | null>(null);
  const owner = useRef(userId);
  owner.current = userId;
  const stopFlight = useRef<(() => void) | null>(null);
  const detachWatch = useRef<(() => void) | null>(null);
  const returnFrame = useRef(0);

  const cancel = useCallback(() => {
    detachWatch.current?.();
    detachWatch.current = null;
    stopFlight.current?.();
    stopFlight.current = null;
    cancelAnimationFrame(returnFrame.current);
    returnFrame.current = 0;
  }, []);

  const invalidate = useCallback(() => {
    if (origin.current) origin.current.valid = false;
    cancel();
  }, [cancel]);

  const fly = useCallback((from: HTMLElement | undefined | null, role: SoulRole, target?: HTMLElement | null) => {
    const saved = origin.current;
    if (!saved || !saved.valid || saved.owner !== useAuthStore.getState().userId) { cancel(); return; }
    // Keep the old flight until the shared channel reads its current geometry.
    detachWatch.current?.();
    const stop = beginSoulHandoff(saved.key, from, role);
    const releaseTarget = target ? registerSoulElement(target, saved.key, role) : undefined;
    const ghost = document.querySelector<HTMLElement>('.vg-soul-ghost');
    const liftAbovePanels = () => {
      if (!ghost?.isConnected) return;
      const overlays = [from?.closest('.vg-modal-overlay'), soulElement(saved.key, role)?.closest('.vg-modal-overlay')];
      const depth = Math.max(0, ...overlays.map((overlay) => overlay ? Number.parseInt(getComputedStyle(overlay).zIndex, 10) || 0 : 0));
      ghost.style.zIndex = String(depth + 1);
    };
    liftAbovePanels();
    let timer = 0;
    const observer = new MutationObserver(() => {
      if (!saved.card.isConnected) invalidate();
      else if (!saved.portrait?.isConnected) {
        cancel();
        saved.portrait = saved.card.querySelector<HTMLElement>('.vg-gene-portrait [data-soul-key]');
      }
      liftAbovePanels();
    });
    if (saved.library) observer.observe(saved.library, { childList: true, subtree: true });
    // The nested profile portal is inserted after the tap. Keep this one visual
    // above both panels until it settles; no global animation scheduler is added.
    observer.observe(document.body, { childList: true });
    const interrupted = () => cancel();
    window.addEventListener('pointercancel', interrupted, true);
    const detach = () => {
      clearTimeout(timer);
      observer.disconnect();
      window.removeEventListener('pointercancel', interrupted, true);
      releaseTarget?.();
    };
    stopFlight.current = stop;
    detachWatch.current = detach;
    // One bounded visual uses existing WAAPI; this hook owns no RAF loop.
    timer = window.setTimeout(() => {
      detach();
      stop();
      if (detachWatch.current === detach) detachWatch.current = null;
      if (stopFlight.current === stop) stopFlight.current = null;
    }, 350);
  }, [cancel, invalidate]);

  const open = useCallback((characterId: string, card: HTMLButtonElement, scroller: HTMLElement | null | undefined) => {
    cancel();
    origin.current = {
      owner: owner.current,
      key: `avatar:${characterId}`,
      card,
      portrait: card.querySelector<HTMLElement>('.vg-gene-portrait [data-soul-key]'),
      library: card.closest<HTMLElement>('[data-gene-library]'),
      scroller: scroller ?? null,
      scrollTop: scroller?.scrollTop ?? 0,
      valid: true,
    };
    fly(origin.current.portrait, 'profile');
  }, [cancel, fly]);

  const returnToCard = useCallback(() => {
    const saved = origin.current;
    if (!saved || saved.owner !== useAuthStore.getState().userId || saved.owner !== owner.current) { cancel(); return; }
    if (saved.scroller?.isConnected) saved.scroller.scrollTop = saved.scrollTop;
    if (saved.valid && saved.card.isConnected && saved.portrait?.isConnected) {
      // The underlying gallery can register the same ID as "list". A temporary
      // interaction target selects this exact card; the avatar key stays the
      // same so an interrupted flight can resume from its visible position.
      fly(soulElement(saved.key, 'profile'), 'interaction', saved.portrait);
    } else cancel();
    returnFrame.current = requestAnimationFrame(() => {
      returnFrame.current = 0;
      if (saved.owner !== useAuthStore.getState().userId || origin.current !== saved) return;
      if (saved.scroller?.isConnected) saved.scroller.scrollTop = saved.scrollTop;
      if (saved.valid && saved.card.isConnected) saved.card.focus({ preventScroll: true });
      else if (saved.library?.isConnected) saved.library.focus({ preventScroll: true });
    });
  }, [cancel, fly]);

  useEffect(() => {
    const unsubscribe = useAuthStore.subscribe((next, previous) => {
      if (next.userId === previous.userId) return;
      cancel();
      origin.current = null;
    });
    return () => { unsubscribe(); cancel(); origin.current = null; };
  }, [userId, cancel]);

  return { open, returnToCard, invalidate, cancel };
}
