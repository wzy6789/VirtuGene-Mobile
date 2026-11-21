import { useId, type ReactNode, type RefObject } from 'react';
import { useElasticSurface } from './useElasticSurface';
import '../../styles/elastic-navigation.css';

export interface ElasticTabItem<Value extends string> {
  value: Value;
  label: ReactNode;
  ariaLabel?: string;
  disabled?: boolean;
  controls?: string;
}

export interface ElasticTabsProps<Value extends string> {
  items: readonly ElasticTabItem<Value>[];
  value: Value;
  onChange: (value: Value) => void;
  onReselect?: (value: Value) => void;
  ariaLabel: string;
  className?: string;
  itemClassName?: string;
  role?: 'tablist' | 'navigation';
  gestureKey?: string;
  enabled?: boolean;
  contentRef?: RefObject<HTMLElement | null>;
  onItemIntent?: (value: Value) => void;
}

/** One movable material capsule, with rigid labels, icons, and touch rectangles. */
export function ElasticTabs<Value extends string>({ items, value, onChange, onReselect, ariaLabel, className = '', itemClassName = '', role = 'tablist', gestureKey, enabled = true, contentRef, onItemIntent }: ElasticTabsProps<Value>) {
  const id = useId();
  const index = Math.max(0, items.findIndex(item => item.value === value));
  const identity = items.map(item => `${item.value}:${!!item.disabled}`).join('|');
  const { rootRef, surfaceRef, select } = useElasticSurface({ index, count: items.length, enabled, gestureKey: `${gestureKey ?? ''}|${identity}`, contentRef,
    onCommit: next => { const item = items[next]; if (item && !item.disabled) onChange(item.value); },
    onReselect: next => { const item = items[next]; if (item && !item.disabled) onReselect?.(item.value); } });
  if (!items.length) return null;
  return <div ref={rootRef} role={role} aria-label={ariaLabel} aria-orientation={role === 'tablist' ? 'horizontal' : undefined}
    className={`vg-elastic-tabs ${className}`} data-elastic-tabs data-no-page-swipe data-no-back-swipe>
    <span ref={surfaceRef} className="vg-elastic-position" aria-hidden="true"><span className="vg-elastic-material" /></span>
    {items.map((item, itemIndex) => <button type="button" key={item.value} id={`${id}-${item.value}`} data-elastic-index={itemIndex}
      role={role === 'tablist' ? 'tab' : undefined} aria-selected={role === 'tablist' ? item.value === value : undefined}
      aria-current={role === 'navigation' && item.value === value ? 'page' : undefined} aria-controls={item.controls} aria-label={item.ariaLabel}
      tabIndex={role === 'tablist' ? item.value === value ? 0 : -1 : undefined} disabled={!enabled || item.disabled}
      className={`vg-elastic-tab ${itemClassName}`} onClick={() => select(itemIndex)}
      onPointerEnter={() => onItemIntent?.(item.value)} onPointerDown={() => onItemIntent?.(item.value)} onFocus={() => onItemIntent?.(item.value)}
      onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        const available = items.map((entry, entryIndex) => !entry.disabled ? entryIndex : -1).filter(entryIndex => entryIndex >= 0);
        if (!available.length) return;
        const from = available.indexOf(itemIndex);
        const next = event.key === 'Home' ? available[0] : event.key === 'End' ? available[available.length - 1]
          : available[(from + (event.key === 'ArrowRight' ? 1 : -1) + available.length) % available.length];
        event.preventDefault();
        rootRef.current?.querySelector<HTMLButtonElement>(`[data-elastic-index="${next}"]`)?.focus();
        select(next);
      }}>
      {item.label}
    </button>)}
  </div>;
}
