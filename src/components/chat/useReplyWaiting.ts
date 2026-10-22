import { useEffect, useState } from 'react';

/** The delay applies only to feedback, never to received reply text. */
export function useReplyWaiting(active: boolean, scope: string) {
  const [visibleScope, setVisibleScope] = useState<string | null>(null);
  useEffect(() => {
    setVisibleScope(null);
    if (!active) return;
    const timer = window.setTimeout(() => setVisibleScope(scope), 500);
    return () => window.clearTimeout(timer);
  }, [active, scope]);
  return active && visibleScope === scope;
}
