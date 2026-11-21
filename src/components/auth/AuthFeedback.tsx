import { useLayoutEffect, useRef } from 'react';
import { FeedbackNotice } from '../ui/FeedbackNotice';

/** Keep submission failures visible even when a long form was submitted at its bottom. */
export function AuthFeedback({ message, attempt }: { message: string; attempt: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    node.focus({ preventScroll: true });
    node.scrollIntoView({ block: 'nearest', behavior: 'instant' });
  }, [message, attempt]);
  return <div ref={ref} tabIndex={-1}><FeedbackNotice message={message} tone="error" /></div>;
}
