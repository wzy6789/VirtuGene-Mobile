import { useCallback, useLayoutEffect, useReducer, useRef, type ReactNode, type RefObject } from 'react';
import { flushSync } from 'react-dom';
import { elementScroll, measureElement, useVirtualizer } from '@tanstack/react-virtual';
import type { Message } from '../../db';

export interface ChatMessageRow {
  key: string;
  divider: string | null;
  message: Message;
  avatar: string;
  showIdentity: boolean;
}

/** Measurement updates belong to the history, not the composer, scenery or orb. */
export function ChatMessageList({ rows, scrollRef, onScrollAdjustment, renderMessage }: {
  rows: ChatMessageRow[];
  scrollRef: RefObject<HTMLDivElement | null>;
  onScrollAdjustment: (element: Element | null) => void;
  renderMessage: (row: ChatMessageRow, index: number) => ReactNode;
}) {
  const openingIds = useRef(new Set(rows.map(row => row.key)));
  const mounted = useRef(true);
  const batching = useRef(false);
  const pending = useRef(new Map<string | number | bigint, { node: HTMLDivElement; index: number; size: number }>());
  const scheduled = useRef(false);
  const deferredScroll = useRef<(() => void) | null>(null);
  const [, render] = useReducer(value => value + 1, 0);
  const getRowKey = useCallback((index: number) => rows[index].key, [rows]);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; pending.current.clear(); deferredScroll.current = null; };
  }, []);
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    getItemKey: getRowKey,
    estimateSize: () => 84,
    initialOffset: () => Math.max(0, rows.length * 84 - (scrollRef.current?.clientHeight ?? 0)),
    overscan: 8,
    anchorTo: 'end',
    followOnAppend: false,
    // The adapter otherwise flushes React once for every corrected row. Keep
    // synchronous anchoring outside a measurement batch; flush the batch once.
    useFlushSync: false,
    onChange: (_instance, sync) => { if (sync && !batching.current) flushSync(() => render()); },
    measureElement: (node, entry, instance) => {
      const index = instance.indexFromElement(node);
      const key = instance.options.getItemKey(index);
      const cached = instance.itemSizeCache.get(key);
      if (!entry) return openingIds.current.has(String(key)) ? cached ?? 84 : measureElement(node, entry, instance);
      pending.current.set(key, { node, index, size: measureElement(node, entry, instance) });
      if (!scheduled.current) {
        scheduled.current = true;
        // ResizeObserver finishes delivering the batch before this microtask;
        // geometry and its anchor still commit together before the next paint.
        queueMicrotask(() => {
          scheduled.current = false;
          if (!mounted.current) return;
          const sizes = [...pending.current]; pending.current.clear();
          batching.current = true;
          try {
            flushSync(() => {
              for (const [id, item] of sizes) {
                if (item.node.isConnected && instance.elementsCache.get(id) === item.node
                  && item.index < instance.options.count && instance.options.getItemKey(item.index) === id) {
                  instance.resizeItem(item.index, item.size);
                }
              }
            });
          } finally { batching.current = false; }
          // Core accumulates each intended adjustment in its own scrollOffset.
          // Write only the final target after React grows the size container,
          // then acknowledge the actual (possibly clamped) position once.
          const scroll = deferredScroll.current; deferredScroll.current = null;
          scroll?.();
        });
      }
      return cached ?? 84;
    },
    scrollToFn: (offset, options, instance) => {
      const apply = () => { elementScroll(offset, options, instance); onScrollAdjustment(instance.scrollElement); };
      if (batching.current) deferredScroll.current = apply;
      else apply();
    },
  });
  return <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
    {virtualizer.getVirtualItems().map(vi => {
      const row = rows[vi.index];
      return <div key={row.key} data-index={vi.index} ref={virtualizer.measureElement}
        style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${vi.start}px)` }}>
        {row.divider && <div className="flex justify-center my-3"><span className="text-xs text-gray-500 bg-panel px-3 py-0.5 rounded-full">{row.divider}</span></div>}
        {renderMessage(row, vi.index)}
      </div>;
    })}
  </div>;
}
