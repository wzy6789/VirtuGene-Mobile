let motionMedia: MediaQueryList | undefined;
const reducedMotionMedia = () => motionMedia ??= window.matchMedia('(prefers-reduced-motion: reduce)');

/** The app preference adds to the operating system's accessibility preference. */
export function prefersReducedMotion(): boolean {
  return document.documentElement.dataset.vgReducedMotion === 'true'
    || reducedMotionMedia().matches;
}

/** Active animations can settle immediately when either preference changes. */
export function subscribeReducedMotion(callback: () => void): () => void {
  const media = reducedMotionMedia();
  media.addEventListener('change', callback);
  window.addEventListener('vg:motion-preference', callback);
  return () => {
    media.removeEventListener('change', callback);
    window.removeEventListener('vg:motion-preference', callback);
  };
}

/** A critically damped response: accelerates gently, then settles without overshoot. */
export function settleFrames(from: number, to = 0, opacityFrom = 1, opacityTo = 1, axis: 'x' | 'y' = 'x', initialVelocity = 0): Keyframe[] {
  // A small initial velocity gives taps an immediate response while preserving a
  // monotonic, critically damped finish. Existing gesture callers start at rest.
  const velocity = Math.max(0, Math.min(9, initialVelocity));
  const response = (t: number) => 1 - (1 + (9 - velocity) * t) * Math.exp(-9 * t);
  const end = response(1);
  return Array.from({ length: 25 }, (_, i) => {
    const offset = i / 24, progress = response(offset) / end;
    const value = from + (to - from) * progress;
    return { offset, opacity: opacityFrom + (opacityTo - opacityFrom) * progress,
      transform: axis === 'x' ? `translate3d(${value}px,0,0)` : `translate3d(0,${value}px,0)` };
  });
}

interface SnapshotScroll { node: Element; top: number; left: number }
const snapshotScroll = new WeakMap<HTMLElement, SnapshotScroll[]>();

/** Frozen visuals never retain control semantics or restart decorative animations. */
export function visualSnapshot(element: HTMLElement): HTMLElement | null {
  // Bound the inspection as well as the clone. A large history must not allocate
  // a full NodeList merely to find that it exceeds the animation budget.
  const originals: Element[] = [];
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  let nodes = 0;
  let characters = 0;
  let current: Node | null = element;
  while (current) {
    // Many text nodes or a large transcript can be expensive even with few
    // elements. Reject before cloning; the incoming page still animates normally.
    if (++nodes > 1800) return null;
    if (current.nodeType === Node.TEXT_NODE) {
      characters += current.nodeValue?.length ?? 0;
      if (characters > 200_000) return null;
    } else {
      const original = current as Element;
      if (original.matches('canvas,video,audio,iframe,object,embed') || originals.length >= 900) return null;
      originals.push(original);
    }
    current = walker.nextNode();
  }
  const snapshot = element.cloneNode(true) as HTMLElement;
  const copies = document.createTreeWalker(snapshot, NodeFilter.SHOW_ELEMENT);
  const scroll: SnapshotScroll[] = [];
  current = snapshot;
  for (const original of originals) {
    const copy = current as Element;
    if (original.scrollTop || original.scrollLeft) {
      scroll.push({ node: copy, top: original.scrollTop, left: original.scrollLeft });
    }
    // SVG resource IDs are referenced by fills/masks inside the same drawing.
    // HTML IDs and form names must never compete with the newly mounted UI.
    if (copy instanceof HTMLElement) copy.removeAttribute('id');
    for (const attribute of ['role', 'aria-modal', 'tabindex', 'autofocus', 'name', 'form', 'contenteditable']) {
      if (copy.hasAttribute(attribute)) copy.removeAttribute(attribute);
    }
    if (original instanceof HTMLInputElement && copy instanceof HTMLInputElement && original.type === 'password') {
      // Preserve the masked appearance, never the credential, in the inert copy.
      copy.value = '•'.repeat(Math.min(original.value.length, 24));
      copy.removeAttribute('value');
    }
    if (original instanceof HTMLOptionElement && copy instanceof HTMLOptionElement) copy.selected = original.selected;
    current = copies.nextNode();
  }
  if (scroll.length) snapshotScroll.set(snapshot, scroll);
  snapshot.classList.add('vg-motion-snapshot');
  snapshot.inert = true;
  snapshot.setAttribute('aria-hidden', 'true');
  return snapshot;
}

/** Scroll offsets can only be restored after the snapshot has a layout box. */
export function restoreSnapshotScroll(snapshot: HTMLElement) {
  for (const { node, top, left } of snapshotScroll.get(snapshot) ?? []) {
    node.scrollTop = top;
    node.scrollLeft = left;
  }
  snapshotScroll.delete(snapshot);
}
