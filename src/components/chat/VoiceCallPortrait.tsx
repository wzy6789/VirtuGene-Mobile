import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { avatarImageSrc } from '../../lib/avatar';
import { prefersReducedMotion, subscribeReducedMotion } from '../../lib/mobile-motion';
import { registerSoulElement } from '../../lib/soul-handoff';
import { useVoiceCallStore } from '../../store/voice-call-store';
import { normalizeOrbSignal, type OrbSignal } from '../../lib/orb-vitality';
import '../../styles/voice-call-portrait.css';

// Stable layers keep their phase when the call status or captions change.
const particles = Array.from({ length: 18 }, (_, index) => ({
  left: `${8 + ((index * 37) % 87)}%`, top: `${5 + ((index * 29) % 90)}%`,
  '--particle-size': `${index % 5 === 0 ? 3 : 1.5}px`,
  '--particle-drift': `${index % 2 ? 11 : -9}px`,
  '--particle-time': `${8 + index % 7}s`, '--particle-delay': `${-index * 1.7}s`,
}) as CSSProperties);

/** The existing portrait stays sharp; light responds only to real call signals. */
export function VoiceCallPortrait({ avatar, name, visible, layout, soulKey, activity }: {
  avatar: string; name: string; visible: boolean; layout: string; soulKey: string;
  activity: () => OrbSignal | undefined;
}) {
  const root = useRef<HTMLDivElement>(null);
  const response = useRef<HTMLSpanElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const lastFrame = useRef<{ width: number; top: number } | undefined>(undefined);
  const [failedImage, setFailedImage] = useState('');
  const image = avatarImageSrc(avatar);
  const showImage = image && failedImage !== image;
  const register = useCallback((node: HTMLImageElement | HTMLSpanElement | null) => {
    if (node) return registerSoulElement(node, soulKey, 'call');
  }, [soulKey, showImage]);

  useLayoutEffect(() => {
    const node = frameRef.current;
    if (!node || !visible) { lastFrame.current = undefined; return; }
    const rect = node.getBoundingClientRect(), previous = lastFrame.current;
    lastFrame.current = { width: node.offsetWidth, top: rect.top };
    if (!previous || prefersReducedMotion() || document.hidden || previous.width === node.offsetWidth) return;
    // Layout changes once. The portrait then settles on the compositor, without
    // animating width/height or reflowing the caption text on every frame.
    const animation = node.animate([
      { transform: `translateX(-50%) translateY(${previous.top - rect.top}px) translateZ(28px) scale(${previous.width / node.offsetWidth})` },
      { transform: 'translateX(-50%) translateY(0) translateZ(28px) scale(1)' },
    ], { duration: 320, easing: 'cubic-bezier(.2,.8,.2,1)' });
    void animation.finished.then(() => {
      lastFrame.current = { width: node.offsetWidth, top: node.getBoundingClientRect().top };
    }).catch(() => { /* A replacement layout owns the next settle. */ });
    const stop = () => animation.cancel();
    const hidden = () => { if (document.hidden) stop(); };
    const unsubscribe = subscribeReducedMotion(stop);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      // React has committed the next layout, but this animation's scale still
      // describes the visible intermediate frame. Use its previous base width,
      // not the new DOM width, before cancelling and starting the next settle.
      if (animation.playState === 'running' && lastFrame.current) {
        const transform = new DOMMatrixReadOnly(getComputedStyle(node).transform);
        lastFrame.current = { width: lastFrame.current.width * transform.m11, top: lastFrame.current.top + transform.m42 };
      }
      stop(); unsubscribe(); document.removeEventListener('visibilitychange', hidden);
    };
  }, [layout, visible]);

  // Viewport/container sizing also changes the portrait without a React commit.
  // Keep the next settle's base dimensions current after the keyboard resizes.
  useEffect(() => {
    const node = frameRef.current;
    if (!node || !visible) return;
    const observer = new ResizeObserver(() => {
      if (node.getAnimations().some(animation => animation.playState === 'running')) return;
      lastFrame.current = { width: node.offsetWidth, top: node.getBoundingClientRect().top };
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [visible]);

  useEffect(() => {
    let frame = 0;
    const paint = () => {
      frame = 0;
      if (!response.current) return;
      const signal = normalizeOrbSignal(activity());
      const opacity = String(.24 + signal.capture * .46 + signal.playback * .26);
      if (response.current.style.opacity !== opacity) response.current.style.opacity = opacity;
    };
    const update = () => {
      const active = visible && !document.hidden && !prefersReducedMotion();
      if (root.current && root.current.dataset.motion !== String(active)) root.current.dataset.motion = String(active);
      if (!active) {
        cancelAnimationFrame(frame); frame = 0;
        if (response.current) response.current.style.opacity = '.24';
      } else if (!frame) frame = requestAnimationFrame(paint);
    };
    update();
    const unsubscribe = useVoiceCallStore.subscribe(update);
    const unsubscribeMotion = subscribeReducedMotion(update);
    document.addEventListener('visibilitychange', update);
    return () => {
      cancelAnimationFrame(frame); unsubscribe(); unsubscribeMotion();
      document.removeEventListener('visibilitychange', update);
    };
  }, [activity, visible]);

  return <div ref={root} className="vg-voice-portrait" data-motion="false" aria-hidden="true">
    <span className="vg-voice-portrait-aura"/>
    <span ref={response} className="vg-voice-portrait-response"/>
    <div className="vg-voice-portrait-depth">
      <span className="vg-voice-portrait-shadow"/>
      <div className="vg-voice-portrait-particles is-back">
        {particles.slice(0, 11).map((style, index) => <i key={index} style={style}/>)}
      </div>
      <div ref={frameRef} className="vg-voice-portrait-frame">
        {showImage ? <img ref={register} className="vg-voice-portrait-image" src={image} alt="" loading="eager" decoding="async"
          onError={() => setFailedImage(image)} data-soul-key={soulKey} data-soul-role="call"/>
          : <span ref={register} className="vg-voice-portrait-image vg-voice-portrait-fallback" data-soul-key={soulKey} data-soul-role="call">{image ? name.slice(0, 2) : avatar.trim() || name.slice(0, 2) || 'TA'}</span>}
        <span className="vg-voice-portrait-edge"/>
      </div>
      <div className="vg-voice-portrait-particles is-front">
        {particles.slice(11).map((style, index) => <i key={index} style={style}/>)}
      </div>
    </div>
  </div>;
}
