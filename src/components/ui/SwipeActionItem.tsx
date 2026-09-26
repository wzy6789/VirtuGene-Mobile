import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { SWIPE_EDGE, swipeBlocked, swipeDirection } from '../../lib/swipe-policy';

interface Action {
  label: string;
  color: string;
  onClick: () => void;
}

interface Props {
  children: ReactNode;
  /** 左滑露出的操作按钮（从右到左排列） */
  actions: Action[];
  /** 点击主体（非滑动时） */
  onClick?: () => void;
  /** 左滑距离（px），默认 160 */
  swipeDistance?: number;
  /** 内容层额外样式（如置顶高亮背景） */
  contentClassName?: string;
  /** 用于关闭其它已展开的行，保证同屏只保留一个操作层 */
  itemId?: string;
}

/**
 * 微信式左滑操作项：向左滑动露出右侧操作按钮。
 * - 左滑超过阈值展开，再次左滑/点其他关闭；点击主体执行 onClick
 * - 不拦截纵向滚动：纵向位移大于横向时不进入滑动
 */
export function SwipeActionItem({ children, actions, onClick, swipeDistance = 160, contentClassName = '', itemId }: Props) {
  const [offset, setOffset] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [dragging, setDragging] = useState(false);
  const suppressClickUntil = useRef(0);
  const frame = useRef(0);
  const rowRef = useRef<HTMLDivElement>(null);
  const localId = useId();
  const id = itemId ?? localId;
  const startRef = useRef<{ x: number; y: number; moved: boolean; dir: 'x' | 'y' | null } | null>(null);
  const offsetRef = useRef(0);
  const revealDistance = Math.min(swipeDistance, Math.max(64, actions.length * 64));

  const setOffsetBoth = (v: number) => {
    if (frame.current) cancelAnimationFrame(frame.current);
    frame.current = 0;
    offsetRef.current = v;
    setOffset(v);
  };
  useEffect(() => () => { if (frame.current) cancelAnimationFrame(frame.current); }, []);
  useEffect(() => {
    if (!expanded) return;
    const outside = (event: Event) => {
      if (event.target instanceof Node && !rowRef.current?.contains(event.target)) {
        startRef.current = null; setDragging(false); setOffsetBoth(0); setExpanded(false);
      }
    };
    window.addEventListener('pointerdown', outside, true);
    window.addEventListener('touchstart', outside, { passive: true, capture: true });
    return () => { window.removeEventListener('pointerdown', outside, true); window.removeEventListener('touchstart', outside, true); };
  }, [expanded]);

  useEffect(() => {
    const onOtherOpen = (event: Event) => {
      const otherId = (event as CustomEvent<{ id?: string }>).detail?.id;
      if (otherId && otherId !== id) {
        startRef.current = null;
        setDragging(false);
        setOffsetBoth(0);
        setExpanded(false);
      }
    };
    window.addEventListener('vg:swipe-action-open', onOtherOpen);
    return () => window.removeEventListener('vg:swipe-action-open', onOtherOpen);
  }, [id]);

  const onTouchStart = (e: React.TouchEvent) => {
    startRef.current = null;
    const t = e.touches[0];
    if (!t || e.touches.length !== 1 || t.clientX <= SWIPE_EDGE || t.clientX >= window.innerWidth - SWIPE_EDGE || swipeBlocked(e.target, e.currentTarget, true)) return;
    startRef.current = { x: t.clientX, y: t.clientY, moved: false, dir: null };
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length !== 1) { onTouchCancel(); return; }
    const s = startRef.current;
    if (!s) return;
    const t = e.touches[0];
    const dx = t.clientX - s.x;
    const dy = t.clientY - s.y;
    if (!s.dir) {
      s.dir = swipeDirection(dx, dy);
    }
    if (s.dir !== 'x') return; // 纵向交给滚动
    s.moved = true;
    setDragging(true);
    // 左滑为负方向；已展开时允许向右关闭
    const base = expanded ? -revealDistance : 0;
    const next = Math.max(-revealDistance, Math.min(0, base + dx));
    offsetRef.current = next;
    if (!frame.current) frame.current = requestAnimationFrame(() => { frame.current = 0; setOffset(offsetRef.current); });
  };

  const onTouchCancel = () => {
    if (startRef.current?.moved) suppressClickUntil.current = performance.now() + 250;
    startRef.current = null;
    setDragging(false);
    setOffsetBoth(expanded ? -revealDistance : 0);
  };

  const onTouchEnd = () => {
    const s = startRef.current;
    startRef.current = null;
    setDragging(false);
    if (!s?.moved) return;
    suppressClickUntil.current = performance.now() + 250;
    // 超过一半展开，否则收起
    if (offsetRef.current < -revealDistance / 2) {
      setOffsetBoth(-revealDistance);
      setExpanded(true);
      window.dispatchEvent(new CustomEvent('vg:swipe-action-open', { detail: { id } }));
    } else {
      setOffsetBoth(0);
      setExpanded(false);
    }
  };

  const handleClick = () => {
    if (expanded) {
      // 展开时点击主体 → 收起
      setOffsetBoth(0);
      setExpanded(false);
      return;
    }
    onClick?.();
  };

  return (
    <div ref={rowRef} data-swipe-action-item="true" className="relative overflow-hidden rounded-2xl" style={{ touchAction: 'pan-y' }} onClickCapture={event => { if (performance.now() < suppressClickUntil.current) { event.preventDefault(); event.stopPropagation(); } }}>
      {/* 底部操作按钮层（默认被不透明内容层完全遮住，左滑才露出） */}
      <div className="absolute inset-y-0 right-0 flex" aria-hidden={offset === 0} style={{ visibility: offset === 0 ? 'hidden' : 'visible' }}>
        {actions.map((a) => (
          <button
            key={a.label}
            onClick={() => {
              setOffsetBoth(0);
              setExpanded(false);
              a.onClick();
            }}
            className={`w-16 text-xs font-medium text-white flex items-center justify-center transition-colors ${a.color}`}
          >
            {a.label}
          </button>
        ))}
      </div>
      {/* 内容层（左滑移动；必须用不透明背景盖住底层按钮） */}
      <div
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchCancel}
        onClick={handleClick}
        className={`relative bg-panel border border-line rounded-2xl transition-transform duration-200 ease-out ${contentClassName}`}
        style={{ transform: `translateX(${offset}px)`, transition: dragging ? 'none' : undefined }}
      >
        {children}
      </div>
    </div>
  );
}
