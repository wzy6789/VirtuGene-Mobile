import { useEffect, useRef } from 'react';

/** Fixed, decorative layers: only transforms and opacity move. */
export function SoulAtmosphere() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    // Sheets cover the atmosphere. Pause its compositor work until both live
    // sheets and their short exit frames have left, keeping their current pose.
    const sync = () => node.toggleAttribute('data-motion-paused', document.hidden
      || !!document.body.querySelector(':scope > .vg-modal-overlay,:scope > .vg-modal-exit'));
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true });
    document.addEventListener('visibilitychange', sync);
    sync();
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', sync);
    };
  }, []);
  return <div ref={ref} className="vg-soul-field" aria-hidden="true">
    <div className="vg-soul-aura is-purple" />
    <div className="vg-soul-aura is-cyan" />
    <svg className="vg-soul-orbits" viewBox="0 0 400 500" fill="none" preserveAspectRatio="xMidYMin slice">
      <ellipse cx="320" cy="100" rx="152" ry="152" />
      <ellipse cx="320" cy="100" rx="128" ry="128" strokeDasharray="2 12" />
      <path d="M320 0v235M164 100h236" />
      <circle cx="192" cy="100" r="3" className="vg-soul-node" />
      <circle cx="320" cy="252" r="2" className="vg-soul-node" />
    </svg>
    <div className="vg-soul-dust"><i /><i /><i /><i /><i /><i /></div>
  </div>;
}
