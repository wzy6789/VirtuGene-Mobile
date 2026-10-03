import { useLayoutEffect, useRef } from 'react';
import { prefersReducedMotion, subscribeReducedMotion } from '../../lib/mobile-motion';

/** Only the value moves. Its label, suffix and surrounding controls stay still. */
export function AnimatedValue({ value, className = '' }: { value: string | number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const previous = useRef(value);
  useLayoutEffect(() => {
    const node = ref.current;
    const before = previous.current; previous.current = value;
    if (!node || before === value || prefersReducedMotion()) return;
    const direction = typeof before === 'number' && typeof value === 'number' && value < before ? -1 : 1;
    const animation = node.animate([
      { transform: `translate3d(0,${direction * 5}px,0)`, opacity: .45 },
      { transform: 'translate3d(0,0,0)', opacity: 1 },
    ], { duration: 180, easing: 'cubic-bezier(.16,1,.3,1)' });
    const clear = () => { animation.cancel(); unsubscribe(); };
    const unsubscribe = subscribeReducedMotion(clear);
    animation.onfinish = clear;
    return clear;
  }, [value]);
  return <span ref={ref} className={`vg-animated-value ${className}`}>{value}</span>;
}
