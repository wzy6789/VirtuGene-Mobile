import { useRef, useState, type ReactNode } from 'react';

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
}

/**
 * 微信式左滑操作项：向左滑动露出右侧操作按钮。
 * - 左滑超过阈值展开，再次左滑/点其他关闭；点击主体执行 onClick
 * - 不拦截纵向滚动：纵向位移大于横向时不进入滑动
 */
export function SwipeActionItem({ children, actions, onClick, swipeDistance = 160 }: Props) {
  const [offset, setOffset] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const startRef = useRef<{ x: number; y: number; moved: boolean; dir: 'x' | 'y' | null } | null>(null);
  const offsetRef = useRef(0);

  const setOffsetBoth = (v: number) => {
    offsetRef.current = v;
    setOffset(v);
  };

  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    startRef.current = { x: t.clientX, y: t.clientY, moved: false, dir: null };
  };

  const onTouchMove = (e: React.TouchEvent) => {
    const s = startRef.current;
    if (!s) return;
    const t = e.touches[0];
    const dx = t.clientX - s.x;
    const dy = t.clientY - s.y;
    if (!s.dir) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      s.dir = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    }
    if (s.dir !== 'x') return; // 纵向交给滚动
    s.moved = true;
    // 左滑为负方向；已展开时允许向右关闭
    const base = expanded ? -swipeDistance : 0;
    const next = Math.max(-swipeDistance, Math.min(0, base + dx));
    setOffsetBoth(next);
  };

  const onTouchEnd = () => {
    const s = startRef.current;
    startRef.current = null;
    if (!s?.moved) return;
    // 超过一半展开，否则收起
    if (offsetRef.current < -swipeDistance / 2) {
      setOffsetBoth(-swipeDistance);
      setExpanded(true);
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
    <div className="relative overflow-hidden rounded-2xl">
      {/* 底部操作按钮层（默认被不透明内容层完全遮住，左滑才露出） */}
      <div className="absolute inset-y-0 right-0 flex">
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
        onClick={handleClick}
        className="relative bg-panel border border-line rounded-2xl transition-transform duration-200 ease-out"
        style={{ transform: `translateX(${offset}px)` }}
      >
        {children}
      </div>
    </div>
  );
}
