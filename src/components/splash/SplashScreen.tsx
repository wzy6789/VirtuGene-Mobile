import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { prefersReducedMotion, subscribeReducedMotion } from '../../lib/mobile-motion';

// A brief signature, rather than a long artificial loading sequence.
const REVEAL_MS = 640;
const EXIT_MS = 320;
const RUNGS = Array.from({ length: 17 }, (_, index) => {
  const y = 92 + index * 8.5;
  const half = 25.5 * Math.sin((y - 88) / 48 * Math.PI);
  return { y, left: 160 - half, right: 160 + half };
});
interface SplashScreenProps { ready?: boolean; onComplete?: () => void }

/** Static vector artwork; only small transform/opacity layers move. */
export function SplashScreen({ ready = false, onComplete }: SplashScreenProps) {
  const id = useId();
  const started = useRef(performance.now());
  const completed = useRef(false);
  const [leaving, setLeaving] = useState(false);
  const complete = useCallback(() => {
    if (completed.current) return;
    completed.current = true;
    onComplete?.();
  }, [onComplete]);
  useEffect(() => {
    if (!ready) return;
    let revealTimer: ReturnType<typeof setTimeout> | undefined;
    let exitTimer: ReturnType<typeof setTimeout> | undefined;
    const settle = () => { clearTimeout(revealTimer); clearTimeout(exitTimer); complete(); };
    const leave = () => {
      if (document.hidden || prefersReducedMotion()) { settle(); return; }
      setLeaving(true);
      // animationend is primary; also handle interrupted styles/hidden tabs.
      exitTimer = setTimeout(settle, EXIT_MS + 60);
    };
    if (prefersReducedMotion() || document.hidden) { complete(); return; }
    revealTimer = setTimeout(leave, Math.max(0, REVEAL_MS - (performance.now() - started.current)));
    const unsubscribe = subscribeReducedMotion(() => { if (prefersReducedMotion()) settle(); });
    return () => { clearTimeout(revealTimer); clearTimeout(exitTimer); unsubscribe(); };
  }, [ready, complete]);

  return <div className="vg-splash" data-phase={leaving ? 'leaving' : 'awakening'}
    onAnimationEnd={event => { if (event.target === event.currentTarget && event.animationName === 'vg-boot-exit') complete(); }}>
    <div className="vg-boot-space" aria-hidden="true"><div className="vg-boot-grid" /><div className="vg-boot-stars" /></div>
    <div className="vg-boot-frame" aria-hidden="true"><i /><i /><i /><i /></div>
    <p className="vg-boot-eyebrow" aria-hidden="true"><span />DIGITAL SOUL<span /></p>
    <div className="vg-boot-stage">
      <div className="vg-boot-core" aria-hidden="true">
        <svg className="vg-boot-foundation" viewBox="0 0 320 320" fill="none">
          <defs>
            <radialGradient id={`${id}-halo`}><stop stopColor="#8294ee" stopOpacity=".15" /><stop offset=".6" stopColor="#7775d6" stopOpacity=".055" /><stop offset="1" stopColor="#7775d6" stopOpacity="0" /></radialGradient>
            <radialGradient id={`${id}-heart`}><stop stopColor="#49d6d0" stopOpacity=".12" /><stop offset="1" stopColor="#49d6d0" stopOpacity="0" /></radialGradient>
            <linearGradient id={`${id}-orbit`} x1="34" y1="250" x2="290" y2="96" gradientUnits="userSpaceOnUse"><stop stopColor="#66e5de" stopOpacity="0" /><stop offset=".48" stopColor="#66e5de" stopOpacity=".55" /><stop offset="1" stopColor="#aba1fc" stopOpacity=".12" /></linearGradient>
          </defs>
          <circle cx="160" cy="160" r="158" fill={`url(#${id}-halo)`} />
          <circle cx="160" cy="160" r="86" fill={`url(#${id}-heart)`} />
          <circle cx="160" cy="160" r="126" stroke="#a3a2db" strokeOpacity=".12" strokeWidth=".7" />
          <circle cx="160" cy="160" r="90" stroke="#afaaee" strokeOpacity=".07" strokeWidth=".7" />
          <path d="M160 69 239 114v92l-79 45-79-45v-92Z" stroke="#8b95c9" strokeOpacity=".12" strokeWidth=".6" />
          <path d="M160 40v12m0 216v12M40 160h12m216 0h12" stroke="#b9b9e0" strokeOpacity=".33" strokeWidth="1" />
          <ellipse cx="160" cy="179" rx="143" ry="44" transform="rotate(-24 160 179)" stroke={`url(#${id}-orbit)`} strokeWidth=".9" />
          <path d="m51 86 11 6m196 136 11 6M88 271l6-11m132-202 6-11" stroke="#8998bc" strokeOpacity=".4" strokeWidth=".8" />
          <circle cx="48" cy="214" r="2" fill="#8be2dd" fillOpacity=".65" /><circle cx="264" cy="89" r="2.5" fill="#b8b1f4" fillOpacity=".7" /><circle cx="219" cy="273" r="1.5" fill="#8be2dd" fillOpacity=".4" />
        </svg>
        <div className="vg-boot-rotor is-outer"><svg viewBox="0 0 320 320" fill="none"><circle cx="160" cy="160" r="137" stroke="#9990e9" strokeOpacity=".34" strokeWidth="1" strokeDasharray="52 13 9 14 1 35 84 38 12 26" /><path d="M160 23a137 137 0 0 1 59 13" stroke="#c2b9ff" strokeOpacity=".85" strokeWidth="1.5" strokeLinecap="round" /><circle cx="219" cy="36" r="2" fill="#dad5ff" /></svg></div>
        <div className="vg-boot-rotor is-inner"><svg viewBox="0 0 320 320" fill="none"><circle cx="160" cy="160" r="108" stroke="#79d9d9" strokeOpacity=".23" strokeWidth="1" strokeDasharray="1 11" /><path d="M52 160a108 108 0 0 1 12-49" stroke="#79d9d9" strokeOpacity=".48" strokeWidth="1.2" strokeLinecap="round" /></svg></div>
        <div className="vg-boot-genome"><svg viewBox="0 0 320 320" fill="none">
          <defs>
            <linearGradient id={`${id}-gene-a`} x1="134" y1="88" x2="185" y2="232" gradientUnits="userSpaceOnUse"><stop stopColor="#c7baff" /><stop offset=".45" stopColor="#a897fc" /><stop offset="1" stopColor="#7069d3" /></linearGradient>
            <linearGradient id={`${id}-gene-b`} x1="185" y1="88" x2="134" y2="232" gradientUnits="userSpaceOnUse"><stop stopColor="#429cae" /><stop offset=".55" stopColor="#75e4df" /><stop offset="1" stopColor="#bcfff1" /></linearGradient>
          </defs>
          <g className="vg-boot-links">{RUNGS.map(({ y, left, right }, index) => <g key={index}><path d={`M${left} ${y}H${right}`} stroke={index % 2 ? '#b1a2ef' : '#77d6d3'} strokeOpacity=".4" strokeWidth="1.1" /><circle cx={left} cy={y} r="1.65" fill="#c5b6ff" /><circle cx={right} cy={y} r="1.65" fill="#9bece3" /></g>)}</g>
          <path d="M160 88C194 100 194 124 160 136C126 148 126 172 160 184C194 196 194 220 160 232" stroke={`url(#${id}-gene-a)`} strokeWidth="3" strokeLinecap="round" />
          <path d="M160 88C126 100 126 124 160 136C194 148 194 172 160 184C126 196 126 220 160 232" stroke={`url(#${id}-gene-b)`} strokeWidth="3" strokeLinecap="round" />
          <path d="M160 88v-9m0 153v9" stroke="#b9d7e9" strokeOpacity=".4" strokeWidth="1" /><circle cx="160" cy="79" r="2" fill="#d3c5ff" /><circle cx="160" cy="241" r="2" fill="#aaf7e7" />
        </svg></div>
        <span className="vg-boot-core-label">GENE · SOUL · TIME</span>
      </div>
      <div className="vg-boot-brand"><h1>VIRTUGENE</h1><p>让数字灵魂拥有时间</p></div>
    </div>
    <div className="vg-boot-status" role="status" aria-live="polite" aria-label="正在启动 VirtuGene"><span className="vg-boot-signal" aria-hidden="true"><i /></span><p>正在唤醒你的数字世界</p></div>
  </div>;
}
