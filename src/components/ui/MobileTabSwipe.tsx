import { useEffect, useRef, type ReactNode } from 'react';
import type { MobileTab } from '../../store/ui-store';

const TAB_ORDER: MobileTab[] = ['chat', 'world', 'characters', 'me'];

interface Props {
  activeTab: MobileTab;
  enabled?: boolean;
  onTabSwipe: (tab: MobileTab) => void;
  children: ReactNode;
}

type Gesture = {
  startX: number;
  startY: number;
  direction: 'horizontal' | 'vertical' | null;
  blocked: boolean;
  deltaX: number;
};

/**
 * Mobile 一级导航的横滑层。
 *
 * 这里故意只做“页面切换预览”，不做 Android 边缘返回：
 * - 竖向滚动在方向锁定前完全交给原生滚动；
 * - 触摸来自按钮、消息行、输入框或横向滚动条时直接退出；
 * - 屏幕左右 28px 是 Android 系统手势安全区，不由 WebView 抢占；
 * - 未达到阈值只回弹，达到阈值才切换 tab。
 */
export function MobileTabSwipe({ activeTab, enabled = true, onTabSwipe, children }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const activeTabRef = useRef(activeTab);
  const onTabSwipeRef = useRef(onTabSwipe);
  activeTabRef.current = activeTab;
  onTabSwipeRef.current = onTabSwipe;

  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;

    const setTransform = (x: number, animate = false) => {
      el.style.transition = animate
        ? 'transform 220ms cubic-bezier(.22,1,.36,1), opacity 180ms ease'
        : 'none';
      el.style.transform = `translate3d(${x}px, 0, 0)`;
      el.style.opacity = x === 0 ? '1' : '0.94';
    };

    const isBlockedTarget = (target: EventTarget | null): boolean => {
      const node = target instanceof Element ? target : null;
      if (!node) return true;
      return Boolean(node.closest(
        '[data-no-page-swipe], [data-swipe-action-item], button, a, input, textarea, select, [contenteditable="true"]',
      ));
    };

    const onStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch || window.innerWidth < 320) return;
      // 保留 Android edge-back / edge-navigation 的触摸区。
      if (touch.clientX <= 28 || touch.clientX >= window.innerWidth - 28) return;
      gestureRef.current = {
        startX: touch.clientX,
        startY: touch.clientY,
        direction: null,
        blocked: isBlockedTarget(event.target),
        deltaX: 0,
      };
    };

    const onMove = (event: TouchEvent) => {
      const gesture = gestureRef.current;
      const touch = event.touches[0];
      if (!gesture || !touch || gesture.blocked) return;
      const dx = touch.clientX - gesture.startX;
      const dy = touch.clientY - gesture.startY;
      if (!gesture.direction) {
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
        gesture.direction = Math.abs(dx) > Math.abs(dy) * 1.35 ? 'horizontal' : 'vertical';
      }
      if (gesture.direction !== 'horizontal') return;

      const currentIndex = TAB_ORDER.indexOf(activeTabRef.current);
      const atFirst = dx > 0 && currentIndex <= 0;
      const atLast = dx < 0 && currentIndex >= TAB_ORDER.length - 1;
      if (atFirst || atLast) {
        // 边界处只给一点橡皮筋反馈，不改变页面也不阻止系统滚动。
        gesture.deltaX = dx * 0.12;
        setTransform(gesture.deltaX);
        return;
      }
      event.preventDefault();
      gesture.deltaX = Math.max(-150, Math.min(150, dx * 0.48));
      setTransform(gesture.deltaX);
    };

    const finish = () => {
      const gesture = gestureRef.current;
      gestureRef.current = null;
      if (!gesture || gesture.direction !== 'horizontal') return;
      const width = el.clientWidth || window.innerWidth;
      const shouldChange = Math.abs(gesture.deltaX) > Math.min(76, width * 0.18);
      const currentIndex = TAB_ORDER.indexOf(activeTabRef.current);
      const nextIndex = gesture.deltaX < 0 ? currentIndex + 1 : currentIndex - 1;
      const next = TAB_ORDER[nextIndex];
      if (!shouldChange || !next) {
        setTransform(0, true);
        return;
      }
      const exitX = gesture.deltaX < 0 ? -width : width;
      setTransform(exitX, true);
      window.setTimeout(() => {
        setTransform(0);
        onTabSwipeRef.current(next);
      }, 150);
    };

    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', finish, { passive: true });
    el.addEventListener('touchcancel', finish, { passive: true });
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', finish);
      el.removeEventListener('touchcancel', finish);
    };
  }, [enabled]);

  return (
    <div
      ref={ref}
      data-page-swipe="true"
      className="h-full min-w-0 mobile-tab-swipe"
      style={{ touchAction: 'pan-y', overscrollBehaviorX: 'none' }}
    >
      {children}
    </div>
  );
}
