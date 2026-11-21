import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** One viewport-clamped menu, outside the feed's glass/scroll stacking context. */
export function MomentsActionMenu({ anchor, children, onClose, label, className }: {
  anchor: HTMLElement | null; children: ReactNode; onClose: () => void; label: string; className: string;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    if (!anchor?.isConnected || !menu.current) { close.current(); return; }
    const box = anchor.getBoundingClientRect(), panel = menu.current.getBoundingClientRect();
    const viewport = window.visualViewport;
    const leftEdge = viewport?.offsetLeft ?? 0, topEdge = viewport?.offsetTop ?? 0;
    const width = viewport?.width ?? window.innerWidth, height = viewport?.height ?? window.innerHeight;
    const left = Math.max(leftEdge + 12, Math.min(box.right - panel.width, leftEdge + width - panel.width - 12));
    const preferred = box.bottom + 6;
    const top = Math.max(topEdge + 12, Math.min(preferred + panel.height > topEdge + height - 12 ? box.top - panel.height - 6 : preferred, topEdge + height - panel.height - 12));
    setPosition({ left, top });
    const dismiss = () => close.current();
    const scroll = (event: Event) => { if (!(event.target instanceof Node) || !menu.current?.contains(event.target)) dismiss(); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); dismiss(); anchor.focus({ preventScroll: true }); } };
    const back = (event: Event) => { if (!event.defaultPrevented) { event.preventDefault(); dismiss(); } };
    window.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', dismiss);
    viewport?.addEventListener('resize', dismiss);
    window.addEventListener('keydown', key);
    window.addEventListener('vg:back-request', back, true);
    return () => {
      window.removeEventListener('scroll', scroll, true); window.removeEventListener('resize', dismiss);
      viewport?.removeEventListener('resize', dismiss); window.removeEventListener('keydown', key); window.removeEventListener('vg:back-request', back, true);
    };
  }, [anchor]);
  return createPortal(<div className="vg-moments-action-layer" data-no-page-swipe>
    <button type="button" className="vg-moments-action-dismiss" aria-label="关闭菜单" onClick={onClose} />
    <div ref={menu} role="menu" aria-label={label} className={`vg-moments-action-menu ${className}`} style={{ left: position?.left ?? 12, top: position?.top ?? 12, visibility: position ? 'visible' : 'hidden' }}>{children}</div>
  </div>, document.body);
}
