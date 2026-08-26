import { useEffect, useRef, type ReactNode } from 'react';

interface Props {
  onBack: () => void;
  enabled?: boolean;
  children: ReactNode;
  className?: string;
}

/**
 * 滑动返回容器（学习微信/QQ 的右滑返回）：
 * 内容整体右滑跟手移动，松手时位移超过阈值 → 动画滑出并触发 onBack；否则回弹。
 * - 纵向滑动不拦截（滚动交给原生）；仅当横向意图明确且向右时才接管
 * - 起点在 INPUT / TEXTAREA 上不触发（避免干扰文本输入/选择）
 * - 用原生 touch 监听 + ref 直接改 transform，不触发 React 重渲染（兼容虚拟滚动列表）
 */
export function SwipeBackView({ onBack, enabled = true, children, className = '' }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ startX: number; startY: number; dir: 'x' | 'y' | null } | null>(null);
  const dxRef = useRef(0);
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;

  const THRESHOLD = 90;

  const setX = (x: number, transition = false) => {
    const el = ref.current;
    if (!el) return;
    el.style.transition = transition
      ? 'transform 0.22s cubic-bezier(0.22, 1, 0.36, 1)'
      : 'none';
    el.style.transform = `translateX(${x}px)`;
  };

  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;

    const onStart = (e: TouchEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      const touch = e.touches[0];
      if (!touch) return;
      gesture.current = { startX: touch.clientX, startY: touch.clientY, dir: null };
      dxRef.current = 0;
    };

    const onMove = (e: TouchEvent) => {
      const g = gesture.current;
      if (!g) return;
      const touch = e.touches[0];
      if (!touch) return;
      const dx = touch.clientX - g.startX;
      const dy = touch.clientY - g.startY;
      if (!g.dir) {
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
        // 只有"横向为主"才进入返回手势；纵向交给页面滚动
        g.dir = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      }
      if (g.dir !== 'x' || dx <= 0) return;
      e.preventDefault();
      // 跟手 + 阻尼：越往后越慢，封顶 ~180px
      const next = Math.min(dx * 0.55, 180);
      dxRef.current = next;
      setX(next);
    };

    const finish = () => {
      const g = gesture.current;
      gesture.current = null;
      if (g?.dir !== 'x') return;
      if (dxRef.current > THRESHOLD) {
        // 滑出后切页（先让组件保持滑出态，onBack 切换 tab 会卸载）
        setX(window.innerWidth * 0.55, true);
        const t = setTimeout(() => onBackRef.current(), 200);
        return () => clearTimeout(t);
      }
      dxRef.current = 0;
      setX(0, true);
    };

    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', finish);
    el.addEventListener('touchcancel', finish);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', finish);
      el.removeEventListener('touchcancel', finish);
    };
  }, [enabled]);

  return (
    <div ref={ref} className={`h-full will-change-transform ${className}`}>
      {children}
    </div>
  );
}
