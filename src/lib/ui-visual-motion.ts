import { prefersReducedMotion, subscribeReducedMotion } from './mobile-motion';

/** Bounded, interruptible decoration. Callers never await visual feedback. */
export function animateVisual(node: HTMLElement | null | undefined, frames: Keyframe[], duration=200): () => void {
  if (!node || prefersReducedMotion() || document.hidden) return () => {};
  const animation=node.animate(frames,{duration:Math.min(320,duration),easing:'cubic-bezier(.2,.8,.2,1)'});
  let disposed=false;
  const stop=()=>{if(disposed)return;disposed=true;animation.cancel();unsubscribe();document.removeEventListener('visibilitychange',hidden);};
  const hidden=()=>{if(document.hidden)stop();};
  const unsubscribe=subscribeReducedMotion(()=>{if(prefersReducedMotion())stop();});
  document.addEventListener('visibilitychange',hidden);animation.onfinish=stop;
  return stop;
}
