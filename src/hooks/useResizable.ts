import { useRef, useState } from 'react';

interface UseResizableOptions {
  initial: number;
  min: number;
  max: number;
  /** 拖拽松开后对宽度做二次吸附（例如低于阈值就收起），可配合 CSS transition 平滑过渡 */
  snap?: (width: number) => number;
  /** 反向拖拽：往右拖 = 宽度变小。用于面板锚定在右侧、分隔条是面板左缘的情况 */
  reverse?: boolean;
}

export function useResizable({ initial, min, max, snap, reverse = false }: UseResizableOptions) {
  const [width, setWidth] = useState(initial);
  const [isDragging, setIsDragging] = useState(false);
  const liveRef = useRef(initial);

  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = liveRef.current;
    setIsDragging(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMove = (ev: MouseEvent) => {
      const delta = reverse ? -(ev.clientX - startX) : ev.clientX - startX;
      const next = Math.max(min, Math.min(max, startWidth + delta));
      liveRef.current = next;
      setWidth(next);
    };

    const onUp = () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      setIsDragging(false);
      // 松开后再吸附，让跳变能被 CSS transition 平滑过渡
      if (snap) {
        const target = snap(liveRef.current);
        liveRef.current = target;
        setWidth(target);
      }
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return { width, setWidth, isDragging, startDrag };
}
