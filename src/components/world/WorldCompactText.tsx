import { useId, useLayoutEffect, useRef, useState, type Ref } from 'react';
import '../../styles/world-compact-text.css';

/** Collapse only the presentation; the original name remains available in full. */
export function WorldCompactText(props: {
  text: string;
  label: string;
  as?: 'h2' | 'span';
  className?: string;
  titleRef?: Ref<HTMLSpanElement>;
}) {
  return <CompactText key={props.text} {...props} />;
}

function CompactText({ text, label, as: Tag = 'span', className = '', titleRef }: Parameters<typeof WorldCompactText>[0]) {
  const id = useId();
  const value = useRef<HTMLElement>(null);
  const fullWidthValue = useRef<HTMLElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  useLayoutEffect(() => {
    // The toggle narrows the visible column. Measure its full-width counterpart
    // so that the toggle can disappear again when the name fits after a resize.
    const node = fullWidthValue.current ?? value.current;
    if (!node || expanded) return;
    const measure = () => {
      const needsToggle = node.scrollHeight > node.clientHeight + 1 || node.scrollWidth > node.clientWidth + 1;
      if (!needsToggle && document.activeElement === toggle.current) value.current?.focus({ preventScroll: true });
      setOverflows(needsToggle);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [expanded, overflows]);
  return <div className={`vg-world-compact-text ${className}`} data-expanded={expanded} data-overflows={overflows}>
    <Tag id={id} ref={value as Ref<HTMLHeadingElement & HTMLSpanElement>} tabIndex={-1} className="vg-world-compact-text__value"><span ref={titleRef}>{text}</span></Tag>
    {(overflows || expanded) && <button ref={toggle} type="button" aria-controls={id} aria-expanded={expanded} aria-label={`${expanded ? '收起' : '展开'}${label}`} onClick={() => setExpanded(value => !value)}>{expanded ? '收起' : '展开'}</button>}
    {overflows && !expanded && <Tag ref={fullWidthValue as Ref<HTMLHeadingElement & HTMLSpanElement>} className="vg-world-compact-text__measure" aria-hidden="true">{text}</Tag>}
  </div>;
}
