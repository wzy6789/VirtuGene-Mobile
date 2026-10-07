import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { dismissFeedback, useFeedbackStore, type Feedback } from '../../lib/feedback';
import { prefersReducedMotion, settleFrames, subscribeReducedMotion } from '../../lib/mobile-motion';
import { useAuthStore } from '../../store/auth-store';
import { FeedbackNotice } from './FeedbackNotice';
import { Icon } from './Icon';

export function FeedbackHost() {
  const current = useFeedbackStore(s => s.current);
  const owner = useAuthStore(s => s.userId);
  useEffect(() => { if (current && current.owner !== owner) dismissFeedback(current.id); }, [current, owner]);
  return current && current.owner === owner ? createPortal(<FeedbackReceipt feedback={current} />, document.body) : null;
}

function FeedbackReceipt({ feedback }: { feedback: Feedback }) {
  const frame = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const animation = useRef<Animation | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const finishTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const seen = useRef(false);
  const leaving = useRef(false);
  const remaining = useRef(feedback.duration);
  const deadline = useRef(0);
  const paused = useRef(false);
  const close = useCallback(() => {
    if (leaving.current) return;
    leaving.current = true;
    clearTimeout(timer.current);
    const node = card.current;
    if (!node || prefersReducedMotion() || document.hidden) { dismissFeedback(feedback.id); return; }
    const style = getComputedStyle(node);
    const y = style.transform === 'none' ? 0 : new DOMMatrixReadOnly(style.transform).m42;
    animation.current?.cancel();
    animation.current = node.animate(settleFrames(y, 8, Number(style.opacity), 0, 'y'), { duration: 170, fill: 'forwards' });
    finishTimer.current = setTimeout(() => dismissFeedback(feedback.id), 180);
  }, [feedback.id]);
  const schedule = useCallback(() => {
    clearTimeout(timer.current);
    if (paused.current || leaving.current) return;
    deadline.current = Date.now() + remaining.current;
    timer.current = setTimeout(close, remaining.current);
  }, [close]);
  useLayoutEffect(() => {
    const node = card.current;
    clearTimeout(finishTimer.current);
    leaving.current = false;
    if (node) {
      const style = getComputedStyle(node);
      const y = !seen.current ? 10 : style.transform === 'none' ? 0 : new DOMMatrixReadOnly(style.transform).m42;
      const opacity = !seen.current ? 0 : Number(style.opacity);
      animation.current?.cancel();
      if (!prefersReducedMotion() && (y !== 0 || opacity < 1))
        animation.current = node.animate(settleFrames(y, 0, opacity, 1, 'y', 3), { duration: 280 });
      seen.current = true;
    }
    remaining.current = feedback.duration;
    schedule();
    return () => { clearTimeout(timer.current); clearTimeout(finishTimer.current); };
  }, [feedback.id, feedback.duration, schedule]);
  useEffect(() => {
    const sync = () => {
      // Follow the visible viewport when a keyboard covers the WebView.
      const viewport = window.visualViewport;
      const covered = viewport ? Math.max(0, innerHeight - viewport.height - viewport.offsetTop) : 0;
      frame.current?.style.setProperty('--feedback-bottom', covered > 100 ? `${covered + 12}px` : 'calc(84px + env(safe-area-inset-bottom,0px))');
    };
    const hidden = () => { if (document.hidden) dismissFeedback(feedback.id); };
    const unsubscribe = subscribeReducedMotion(() => {
      if (prefersReducedMotion()) { animation.current?.cancel(); if (leaving.current) dismissFeedback(feedback.id); }
    });
    sync();
    window.visualViewport?.addEventListener('resize', sync);
    window.visualViewport?.addEventListener('scroll', sync);
    window.addEventListener('resize', sync);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      unsubscribe(); window.visualViewport?.removeEventListener('resize', sync);
      window.visualViewport?.removeEventListener('scroll', sync); window.removeEventListener('resize', sync);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, [feedback.id]);
  useEffect(() => () => { animation.current?.cancel(); seen.current = false; }, []);
  const pause = () => { if (paused.current) return; paused.current = true; remaining.current = Math.max(0, deadline.current - Date.now()); clearTimeout(timer.current); };
  const resume = () => { paused.current = false; schedule(); };
  return <div ref={frame} className="vg-feedback-viewport" data-no-page-swipe data-no-back-swipe>
    <div ref={card} onPointerEnter={pause} onPointerLeave={() => { if (!card.current?.contains(document.activeElement)) resume(); }}
      onFocusCapture={pause} onBlurCapture={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) resume(); }}>
      <FeedbackNotice message={feedback.message} tone={feedback.tone}><button type="button" onClick={close} aria-label="关闭操作提示" className="vg-feedback-dismiss"><Icon name="close" size={16} /></button></FeedbackNotice>
    </div>
  </div>;
}
