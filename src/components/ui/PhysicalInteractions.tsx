import { useEffect, useId, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { breathe } from '../../lib/haptics';
import { AnimatedValue } from './AnimatedValue';
import { prefersReducedMotion, subscribeReducedMotion } from '../../lib/mobile-motion';

const reduced = prefersReducedMotion;

/** Layout changes animate positions, never the entire scrolling page. */
function useFlowMotion(key: string) {
  const ref = useRef<HTMLDivElement>(null);
  const previous = useRef(new Map<string, { x: number; y: number }>());
  const height = useRef(0);
  useLayoutEffect(() => {
    const host = ref.current;
    if (!host) return;
    const next = new Map<string, { x: number; y: number }>();
    const animations: Animation[] = [];
    host.querySelectorAll<HTMLElement>('[data-flow-key]').forEach(el => {
      const pos = { x: el.offsetLeft, y: el.offsetTop };
      const old = previous.current.get(el.dataset.flowKey!);
      if (old && !reduced() && (pos.x !== old.x || pos.y !== old.y)) {
        animations.push(el.animate([{ transform: `translate(${old.x - pos.x}px, ${old.y - pos.y}px)` }, { transform: 'translate(0,0)' }], { duration: 260, easing: 'cubic-bezier(.2,.8,.2,1)' }));
      }
      next.set(el.dataset.flowKey!, pos);
    });
    const nextHeight = host.offsetHeight;
    if (height.current && nextHeight !== height.current && !reduced()) {
      animations.push(host.animate([{ height: `${height.current}px` }, { height: `${nextHeight}px` }], { duration: 260, easing: 'cubic-bezier(.2,.8,.2,1)' }));
    }
    previous.current = next; height.current = nextHeight;
    const clear = () => animations.forEach(animation => animation.cancel());
    const unsubscribe = subscribeReducedMotion(clear);
    return () => { unsubscribe(); clear(); };
  }, [key]);
  return ref;
}

export function MultiFilterChips({ options, value, onChange }: { options: string[]; value: string[]; onChange: (value: string[]) => void }) {
  return <section className="vg-filter-control" data-no-page-swipe data-no-back-swipe aria-label="角色标签筛选">
    <div className="vg-filter-heading"><span>性格筛选</span><button type="button" disabled={!value.length} onClick={() => onChange([])} aria-label={`已选 ${value.length} 项，清除筛选`}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4" /></svg>
      <span>筛选</span><b className="vg-filter-count"><AnimatedValue value={value.length} /></b>
    </button></div>
    <div className="vg-filter-strip">{options.map(option => {
      const selected = value.includes(option);
      return <button type="button" className={`vg-filter-chip ${selected ? 'is-selected' : ''}`} key={option} aria-pressed={selected}
        onClick={() => onChange(selected ? value.filter(v => v !== option) : [...value, option])}>
        <span className="vg-chip-check" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m5 12 4 4 10-10" /></svg></span><span>{option}</span>
      </button>;
    })}</div>
  </section>;
}

export const PERSONALITY_TAGS = ['温柔', '冷静', '幽默', '活泼', '傲娇', '细心', '可靠', '坦率', '安静', '理性', '好奇', '浪漫'];
export const DIARY_TAGS = ['生活', '心情', '开心', '平静', '成长', '学习', '工作', '旅行', '朋友', '家人', '灵感', '期待'];

export function TagInput({ value, onChange, suggestions, label, placeholder = '输入标签' }: {
  value: string[]; onChange: (value: string[]) => void; suggestions: string[]; label: string; placeholder?: string;
}) {
  const [draft, setDraft] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [removing, setRemoving] = useState<string[]>([]);
  const [anchor, setAnchor] = useState({ left: 0, top: 0, width: 200, maxHeight: 276 });
  const input = useRef<HTMLInputElement>(null);
  const latest = useRef({ value, onChange }); latest.current = { value, onChange };
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const id = useId();
  const clean = draft.trim().replace(/^#/, '');
  const matches = suggestions.filter(t => !value.includes(t) && t.toLocaleLowerCase().includes(clean.toLocaleLowerCase())).slice(0, 6);
  const shown = open && !!clean && matches.length > 0;
  const flow = useFlowMotion(JSON.stringify([value, removing]));
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const locate = () => {
    const el = input.current; if (!el) return;
    const rect = el.getBoundingClientRect();
    const context = document.createElement('canvas').getContext('2d');
    if (context) context.font = getComputedStyle(el).font;
    const caret = context?.measureText(el.value.slice(0, el.selectionStart ?? el.value.length)).width ?? 0;
    const width = Math.min(224, window.innerWidth - 24);
    const viewport = window.visualViewport;
    const bottom = (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight);
    const popupHeight = matches.length * 42 + 12;
    const above = Math.max(0, rect.top - (viewport?.offsetTop ?? 0) - 8);
    const below = Math.max(0, bottom - rect.bottom - 8);
    const placeBelow = below >= Math.min(168, popupHeight) || below > above;
    const maxHeight = Math.max(42, Math.min(popupHeight, placeBelow ? below : above));
    setAnchor({ left: Math.max(12, Math.min(rect.left + caret - el.scrollLeft, window.innerWidth - width - 12)),
      top: placeBelow ? rect.bottom + 8 : Math.max(viewport?.offsetTop ?? 0, rect.top - maxHeight - 8), width, maxHeight });
  };
  useLayoutEffect(() => { if (shown) locate(); }, [draft, shown, matches.length]);
  useEffect(() => {
    if (!shown) return;
    const close = (e: Event) => { if (e.target instanceof Element && !e.target.closest(`[data-tag-owner="${id}"]`)) setOpen(false); };
    window.addEventListener('resize', locate); window.addEventListener('scroll', locate, true);
    window.visualViewport?.addEventListener('resize', locate);
    document.addEventListener('pointerdown', close);
    return () => { window.removeEventListener('resize', locate); window.removeEventListener('scroll', locate, true); window.visualViewport?.removeEventListener('resize', locate); document.removeEventListener('pointerdown', close); };
  }, [shown, id, matches.length]);
  const insert = (tag = clean) => {
    const t = tag.trim().replace(/^#/, ''); if (!t) return;
    // A re-added tag cancels its pending removal; no old closure can discard new tags.
    const timer = timers.current.get(t); if (timer) clearTimeout(timer);
    timers.current.delete(t); setRemoving(v => v.filter(x => x !== t));
    if (!latest.current.value.includes(t)) latest.current.onChange([...latest.current.value, t]);
    setDraft(''); setOpen(false); setActive(0); input.current?.focus();
  };
  const remove = (tag: string) => {
    if (timers.current.has(tag)) return;
    setRemoving(v => [...v, tag]);
    timers.current.set(tag, setTimeout(() => {
      timers.current.delete(tag);
      latest.current.onChange(latest.current.value.filter(t => t !== tag));
      setRemoving(v => v.filter(t => t !== tag));
    }, reduced() ? 0 : 210));
  };
  return <>
    <div ref={flow} className="vg-tag-field" data-tag-owner={id} data-no-page-swipe data-no-back-swipe>
      {value.map(tag => <span data-flow-key={tag} key={tag} className={`vg-edit-tag ${removing.includes(tag) ? 'is-removing' : ''}`}>
        <span>{tag}</span><button type="button" aria-label={`删除标签 ${tag}`} disabled={removing.includes(tag)} onClick={() => remove(tag)}>×</button>
      </span>)}
      <input data-flow-key="__input" ref={input} value={draft} placeholder={placeholder} aria-label={label} role="combobox" aria-autocomplete="list" aria-expanded={shown}
        aria-controls={shown ? `${id}-list` : undefined} aria-activedescendant={shown ? `${id}-${Math.min(active, matches.length - 1)}` : undefined}
        onChange={e => { setDraft(e.target.value); setOpen(true); setActive(0); }} onFocus={() => setOpen(true)} onSelect={locate} onBlur={() => setOpen(false)}
        onKeyDown={e => {
          if (e.nativeEvent.isComposing || e.keyCode === 229) return;
          if (e.key === 'Escape') { setOpen(false); return; }
          if (shown && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); setActive(v => (v + (e.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length); }
          if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); insert(shown && e.key === 'Enter' ? matches[Math.min(active, matches.length - 1)] : clean); }
          if (e.key === 'Backspace' && !draft && value.length) { e.preventDefault(); remove(value[value.length - 1]); }
        }} />
      {clean && <button type="button" className="vg-tag-add" aria-label={`添加标签 ${clean}`} onPointerDown={e => e.preventDefault()} onClick={() => insert()}>＋</button>}
    </div>
    {shown && createPortal(<div id={`${id}-list`} data-tag-owner={id} className="vg-tag-suggestions" role="listbox" aria-label="标签联想" style={anchor} data-no-page-swipe data-no-back-swipe>
      {matches.map((tag, index) => <button type="button" id={`${id}-${index}`} role="option" aria-selected={active === index} key={tag}
        onPointerDown={e => e.preventDefault()} onClick={() => insert(tag)}>{tag}<span aria-hidden="true">↵</span></button>)}
    </div>, document.body)}
  </>;
}

const FONT_SIZES = Array.from({ length: 11 }, (_, i) => 12 + i);
export function FontRuler({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const scroll = useRef<HTMLDivElement>(null);
  const ticks = useRef<HTMLDivElement>(null);
  const rebound = useRef<Animation | null>(null);
  const [landing, setLanding] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const changing = useRef(false);
  const drag = useRef<{ id: number; x: number; left: number; initial: number } | null>(null);
  const latest = useRef(onChange); latest.current = onChange;
  const normalized = Math.min(22, Math.max(12, Math.round(value || 14)));
  const selected = useRef(normalized); selected.current = normalized;
  useLayoutEffect(() => {
    const el = scroll.current; if (el && !changing.current) el.scrollLeft = (normalized - 12) * 32;
  }, [normalized]);
  useEffect(() => {
    const clear = () => {
      if (timer.current) clearTimeout(timer.current);
      rebound.current?.cancel(); rebound.current = null;
      if (ticks.current) ticks.current.style.transform = '';
      if (!drag.current && scroll.current) {
        changing.current = false;
        scroll.current.scrollTo({ left: (selected.current - 12) * 32, behavior: 'instant' });
      }
    };
    const unsubscribe = subscribeReducedMotion(clear);
    return () => { unsubscribe(); clear(); };
  }, []);
  const release = (cancelled = false) => {
    const gesture = drag.current;
    drag.current = null;
    setLanding(null);
    const el = scroll.current; if (!el) return;
    const node = ticks.current;
    if (node) {
      const transform = getComputedStyle(node).transform; rebound.current?.cancel(); node.style.transform = '';
      if (!reduced() && transform !== 'none') {
        const animation = node.animate([{ transform }, { transform: 'translate3d(0,0,0)' }], { duration: 240, easing: 'cubic-bezier(.16,1,.3,1)' });
        rebound.current = animation; animation.onfinish = () => { if (rebound.current === animation) { animation.cancel(); rebound.current = null; } };
      }
    }
    el.style.scrollSnapType = '';
    const n = Math.max(12, Math.min(22, 12 + Math.round(el.scrollLeft / 32)));
    if (!cancelled && gesture && n !== gesture.initial) breathe();
    latest.current(n); el.scrollTo({ left: (n - 12) * 32, behavior: reduced() ? 'instant' : 'smooth' });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { changing.current = false; }, 180);
  };
  return <div className="vg-font-ruler" data-no-page-swipe data-no-back-swipe>
    <span className="vg-font-caption">字号</span><div className="vg-font-scale" ref={scroll} role="slider" aria-label="聊天字号" aria-valuemin={12} aria-valuemax={22} aria-valuenow={normalized} aria-valuetext={`${normalized} 像素`} tabIndex={0}
      onPointerDown={e => {
        if (e.button !== 0) return; e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId);
        const transform = ticks.current && getComputedStyle(ticks.current).transform;
        const elastic = !transform || transform === 'none' ? 0 : new DOMMatrixReadOnly(transform).m41;
        rebound.current?.cancel(); rebound.current = null;
        if (ticks.current) ticks.current.style.transform = `translate3d(${elastic}px,0,0)`;
        e.currentTarget.scrollTo({ left: e.currentTarget.scrollLeft, behavior: 'instant' });
        changing.current = true; if (timer.current) clearTimeout(timer.current);
        const virtualOffset = elastic ? Math.sign(elastic) * -90 * Math.log(Math.max(.001, 1 - Math.abs(elastic) / 28)) : 0;
        drag.current = { id: e.pointerId, x: e.clientX, left: e.currentTarget.scrollLeft - virtualOffset, initial: selected.current };
        setLanding(normalized); e.currentTarget.style.scrollSnapType = 'none';
      }}
      onPointerMove={e => {
        const d = drag.current; if (!d || e.pointerId !== d.id) return;
        const raw = d.left + d.x - e.clientX, max = 320;
        e.currentTarget.scrollLeft = Math.max(0, Math.min(max, raw));
        const excess = raw < 0 ? raw : raw > max ? raw - max : 0;
        const elastic = -Math.sign(excess) * 28 * (1 - Math.exp(-Math.abs(excess) / 90));
        if (ticks.current) ticks.current.style.transform = `translate3d(${elastic}px,0,0)`;
        const n = Math.max(12, Math.min(22, 12 + Math.round(e.currentTarget.scrollLeft / 32)));
        setLanding(n); if (n !== normalized) latest.current(n);
      }}
      onPointerUp={() => release()} onPointerCancel={() => release(true)}
      onKeyDown={e => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
        e.preventDefault(); const n = e.key === 'Home' ? 12 : e.key === 'End' ? 22 : Math.max(12, Math.min(22, normalized + (e.key === 'ArrowRight' ? 1 : -1)));
        if (timer.current) clearTimeout(timer.current); changing.current = false; rebound.current?.cancel();
        if (ticks.current) ticks.current.style.transform = '';
        e.currentTarget.scrollTo({ left: (n - 12) * 32, behavior: 'instant' }); if (n !== normalized) breathe(); latest.current(n);
      } }}
      onScroll={e => {
        const el = e.currentTarget; const n = Math.max(12, Math.min(22, 12 + Math.round(el.scrollLeft / 32)));
        changing.current = true; if (n !== normalized) latest.current(n);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => { if (drag.current) return; el.scrollTo({ left: (n - 12) * 32, behavior: reduced() ? 'instant' : 'smooth' }); changing.current = false; }, 140);
      }}>
      <div ref={ticks} className="vg-font-ticks">{FONT_SIZES.map(size => <span key={size} className={`${size === normalized ? 'is-active' : ''} ${size === landing ? 'is-landing' : ''}`}><i /><b>{size}</b></span>)}</div>
    </div><span className="vg-font-value" aria-hidden="true">Aa</span>
    {landing !== null && <span className="vg-font-landing" aria-hidden="true">松手选 {landing} px</span>}
  </div>;
}

export function PressLightCard({ children, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  const ref = useRef<HTMLButtonElement>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const moved = useRef(false);
  const frame = useRef(0);
  const reset = () => { cancelAnimationFrame(frame.current); origin.current = null; ref.current?.removeAttribute('data-pressed'); ref.current?.style.removeProperty('--press-x'); ref.current?.style.removeProperty('--press-y'); };
  useEffect(() => {
    const unsubscribe = subscribeReducedMotion(reset);
    return () => { unsubscribe(); reset(); };
  }, []);
  return <button {...props} type={props.type ?? 'button'} ref={ref} className={`vg-press-card ${className}`} style={{ ...props.style } as CSSProperties}
    onPointerDown={e => {
      props.onPointerDown?.(e); moved.current = false; if (e.defaultPrevented || e.button !== 0 || props.disabled || reduced()) return;
      origin.current = { x: e.clientX, y: e.clientY };
      const el = e.currentTarget; const r = el.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); const y = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
      el.style.setProperty('--press-x', `${(x - .5) * 7}deg`); el.style.setProperty('--press-y', `${(.5 - y) * 7}deg`);
      el.style.setProperty('--press-glow-x', `${x * 100}%`); el.style.setProperty('--press-glow-y', `${y * 100}%`); el.setAttribute('data-pressed', '');
    }}
    onPointerMove={e => { props.onPointerMove?.(e); if (origin.current && Math.hypot(e.clientX - origin.current.x, e.clientY - origin.current.y) > 10) { moved.current = true; reset(); } }}
    onClick={e => { if (moved.current && e.detail !== 0) { e.preventDefault(); moved.current = false; return; } props.onClick?.(e); }}
    onPointerUp={e => { props.onPointerUp?.(e); reset(); }} onPointerCancel={e => { props.onPointerCancel?.(e); moved.current = true; reset(); }} onPointerLeave={e => { props.onPointerLeave?.(e); reset(); }} onBlur={e => { props.onBlur?.(e); reset(); }}>
    {children}<span className="vg-press-glow" aria-hidden="true" />
  </button>;
}
