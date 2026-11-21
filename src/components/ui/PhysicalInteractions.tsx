import { useEffect, useId, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { breathe } from '../../lib/haptics';
import { AnimatedValue } from './AnimatedValue';
import { Icon } from './Icon';
import { prefersReducedMotion, subscribeReducedMotion } from '../../lib/mobile-motion';

const reduced = prefersReducedMotion;

/** Layout changes animate positions, never the entire scrolling page. */
function useFlowMotion(key: string) {
  const ref = useRef<HTMLDivElement>(null);
  const previous = useRef(new Map<string, { x: number; y: number }>());
  useLayoutEffect(() => {
    const host = ref.current;
    if (!host) return;
    const next = new Map<string, { x: number; y: number }>();
    const animations: Animation[] = [];
    // Read every layout position before starting any animation. The field keeps
    // its natural height; animating height would relayout the form every frame.
    const positions = [...host.querySelectorAll<HTMLElement>('[data-flow-key]')]
      .map(el => ({ el, pos: { x: el.offsetLeft, y: el.offsetTop } }));
    positions.forEach(({ el, pos }) => {
      const old = previous.current.get(el.dataset.flowKey!);
      if (old && !reduced() && (pos.x !== old.x || pos.y !== old.y)) {
        animations.push(el.animate([{ transform: `translate(${old.x - pos.x}px, ${old.y - pos.y}px)` }, { transform: 'translate(0,0)' }], { duration: 260, easing: 'cubic-bezier(.2,.8,.2,1)' }));
      }
      next.set(el.dataset.flowKey!, pos);
    });
    previous.current = next;
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
  const [anchor, setAnchor] = useState({ left: 0, top: 0, width: 200, maxHeight: 276 });
  const input = useRef<HTMLInputElement>(null);
  const latest = useRef({ value, onChange }); latest.current = { value, onChange };
  const id = useId();
  const clean = draft.trim().replace(/^#/, '');
  const matches = suggestions.filter(t => !value.includes(t) && t.toLocaleLowerCase().includes(clean.toLocaleLowerCase())).slice(0, 6);
  const shown = open && !!clean && matches.length > 0;
  const flow = useFlowMotion(JSON.stringify(value));
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
    if (!latest.current.value.includes(t)) {
      const next = [...latest.current.value, t];
      latest.current.value = next; latest.current.onChange(next);
    }
    setDraft(''); setOpen(false); setActive(0); input.current?.focus();
  };
  const remove = (tag: string) => {
    // Saving or removing another tag must observe this deletion immediately.
    const next = latest.current.value.filter(t => t !== tag);
    latest.current.value = next; latest.current.onChange(next);
  };
  return <>
    <div ref={flow} className="vg-tag-field" data-tag-owner={id} data-no-page-swipe data-no-back-swipe>
      {value.map(tag => <span data-flow-key={tag} key={tag} className="vg-edit-tag">
        <span>{tag}</span><button type="button" aria-label={`删除标签 ${tag}`} onClick={() => remove(tag)}><Icon name="close" size={14} /></button>
      </span>)}
      <input data-flow-key="__input" ref={input} value={draft} placeholder={placeholder} aria-label={label} role="combobox" aria-autocomplete="list" aria-expanded={shown}
        aria-controls={shown ? `${id}-list` : undefined} aria-activedescendant={shown ? `${id}-${Math.min(active, matches.length - 1)}` : undefined}
        onChange={e => { setDraft(e.target.value); setOpen(true); setActive(0); }} onFocus={() => setOpen(true)} onSelect={locate} onBlur={() => setOpen(false)}
        onKeyDown={e => {
          if (e.nativeEvent.isComposing || e.keyCode === 229) return;
          if (e.key === 'Escape') { if (shown) { e.preventDefault(); e.stopPropagation(); setOpen(false); } return; }
          if (shown && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); setActive(v => (v + (e.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length); }
          if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); insert(shown && e.key === 'Enter' ? matches[Math.min(active, matches.length - 1)] : clean); }
          if (e.key === 'Backspace' && !draft && latest.current.value.length) { e.preventDefault(); remove(latest.current.value[latest.current.value.length - 1]); }
        }} />
      {clean && <button type="button" className="vg-tag-add" aria-label={`添加标签 ${clean}`} onPointerDown={e => e.preventDefault()} onClick={() => insert()}><Icon name="plus" size={18} /></button>}
    </div>
    {shown && createPortal(<div id={`${id}-list`} data-tag-owner={id} className="vg-tag-suggestions" role="listbox" aria-label="标签联想" style={anchor} data-no-page-swipe data-no-back-swipe>
      {matches.map((tag, index) => <button type="button" id={`${id}-${index}`} role="option" aria-selected={active === index} key={tag}
        onPointerDown={e => e.preventDefault()} onClick={() => insert(tag)}>{tag}</button>)}
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
  const moveFrame = useRef(0);
  const pendingLeft = useRef<number | null>(null);
  const elasticOffset = useRef(0);
  const drag = useRef<{ id: number; x: number; y: number; left: number; initial: number; horizontal: boolean } | null>(null);
  const latest = useRef(onChange); latest.current = onChange;
  const normalized = Math.min(22, Math.max(12, Math.round(value || 14)));
  const selected = useRef(normalized); selected.current = normalized;
  const cancelMove = () => {
    if (moveFrame.current) cancelAnimationFrame(moveFrame.current);
    moveFrame.current = 0; pendingLeft.current = null;
  };
  const selectSize = (size: number) => {
    if (size === selected.current) return;
    selected.current = size;
    latest.current(size);
  };
  const paintDrag = () => {
    if (moveFrame.current) cancelAnimationFrame(moveFrame.current);
    moveFrame.current = 0;
    const raw = pendingLeft.current;
    pendingLeft.current = null;
    const el = scroll.current, node = ticks.current;
    if (raw === null || !drag.current?.horizontal || !el || !node) return;
    const left = Math.max(0, Math.min(320, raw));
    const excess = raw < 0 ? raw : raw > 320 ? raw - 320 : 0;
    const elastic = reduced() ? 0 : -Math.sign(excess) * 28 * (1 - Math.exp(-Math.abs(excess) / 90));
    const size = Math.max(12, Math.min(22, 12 + Math.round(left / 32)));
    // The requested position determines the notch; no scrollLeft read follows this write.
    el.scrollLeft = left;
    node.style.transform = elastic ? `translate3d(${elastic}px,0,0)` : '';
    elasticOffset.current = elastic;
    setLanding(size);
    selectSize(size);
  };
  useLayoutEffect(() => {
    const el = scroll.current; if (el && !changing.current) el.scrollLeft = (normalized - 12) * 32;
  }, [normalized]);
  useEffect(() => {
    const el = scroll.current, node = ticks.current;
    const clear = () => {
      cancelMove();
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      rebound.current?.cancel(); rebound.current = null;
      elasticOffset.current = 0;
      if (node) node.style.transform = '';
      if (!drag.current && el) {
        changing.current = false;
        el.style.scrollSnapType = '';
        el.scrollTo({ left: (selected.current - 12) * 32, behavior: 'instant' });
      }
    };
    const interrupt = () => {
      const gesture = drag.current;
      drag.current = null;
      clear();
      if (gesture && el?.hasPointerCapture(gesture.id)) el.releasePointerCapture(gesture.id);
      setLanding(null);
    };
    const hidden = () => { if (document.hidden) interrupt(); };
    const unsubscribe = subscribeReducedMotion(clear);
    window.addEventListener('blur', interrupt);
    window.addEventListener('resize', interrupt);
    window.addEventListener('vg:back-request', interrupt);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      unsubscribe();
      window.removeEventListener('blur', interrupt);
      window.removeEventListener('resize', interrupt);
      window.removeEventListener('vg:back-request', interrupt);
      document.removeEventListener('visibilitychange', hidden);
      const gesture = drag.current;
      drag.current = null;
      clear();
      if (gesture && el?.hasPointerCapture(gesture.id)) el.releasePointerCapture(gesture.id);
    };
  }, []);
  const release = (cancelled = false, finalClientX?: number) => {
    const gesture = drag.current;
    const el = scroll.current;
    if (!cancelled && gesture?.horizontal && finalClientX !== undefined) {
      // Pointerup may carry a final position that had no matching pointermove.
      pendingLeft.current = gesture.left + gesture.x - finalClientX;
    }
    // Read before flushing the last queued move. A cancellation keeps the last displayed notch.
    const left = !cancelled && pendingLeft.current !== null
      ? Math.max(0, Math.min(320, pendingLeft.current)) : el?.scrollLeft ?? 0;
    if (!cancelled) paintDrag();
    cancelMove();
    drag.current = null;
    setLanding(null);
    if (!el || !gesture?.horizontal) return;
    if (el.hasPointerCapture(gesture.id)) el.releasePointerCapture(gesture.id);
    const node = ticks.current;
    const elastic = elasticOffset.current;
    elasticOffset.current = 0;
    if (node) {
      const transform = `translate3d(${elastic}px,0,0)`;
      rebound.current?.cancel(); node.style.transform = '';
      if (!reduced() && elastic) {
        const animation = node.animate([{ transform }, { transform: 'translate3d(0,0,0)' }], { duration: 240, easing: 'cubic-bezier(.16,1,.3,1)' });
        rebound.current = animation; animation.onfinish = () => { if (rebound.current === animation) { animation.cancel(); rebound.current = null; } };
      }
    }
    el.style.scrollSnapType = '';
    const n = Math.max(12, Math.min(22, 12 + Math.round(left / 32)));
    if (!cancelled && gesture && n !== gesture.initial) breathe();
    selectSize(n); el.scrollTo({ left: (n - 12) * 32, behavior: reduced() ? 'instant' : 'smooth' });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { changing.current = false; }, 180);
  };
  return <div className="vg-font-ruler" data-no-page-swipe data-no-back-swipe>
    <span className="vg-font-caption">字号</span><div className="vg-font-scale" ref={scroll} role="slider" aria-label="聊天字号" aria-valuemin={12} aria-valuemax={22} aria-valuenow={normalized} aria-valuetext={`${normalized} 像素`} tabIndex={0}
      onPointerDown={e => {
        if (e.button !== 0 || !e.isPrimary || drag.current) return;
        // Leave taps and vertical movement to the browser until horizontal intent is clear.
        drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, left: e.currentTarget.scrollLeft, initial: selected.current, horizontal: false };
      }}
      onPointerMove={e => {
        const d = drag.current; if (!d || e.pointerId !== d.id) return;
        if (!d.horizontal) {
          const dx = Math.abs(e.clientX - d.x), dy = Math.abs(e.clientY - d.y);
          if (Math.max(dx, dy) < 8) return;
          if (dy >= dx) { drag.current = null; return; }
          d.horizontal = true;
          // Only an interrupted rebound needs a computed transform, and all reads precede writes.
          const left = e.currentTarget.scrollLeft;
          const transform = rebound.current && ticks.current ? getComputedStyle(ticks.current).transform : null;
          const elastic = !transform || transform === 'none' ? elasticOffset.current : new DOMMatrixReadOnly(transform).m41;
          e.currentTarget.setPointerCapture(e.pointerId);
          rebound.current?.cancel(); rebound.current = null;
          const virtualOffset = elastic ? Math.sign(elastic) * -90 * Math.log(Math.max(.001, 1 - Math.abs(elastic) / 28)) : 0;
          d.left = left - virtualOffset;
          elasticOffset.current = elastic;
          e.currentTarget.scrollTo({ left, behavior: 'instant' });
          changing.current = true; if (timer.current) clearTimeout(timer.current);
          e.currentTarget.style.scrollSnapType = 'none';
        }
        e.preventDefault();
        pendingLeft.current = d.left + d.x - e.clientX;
        if (!moveFrame.current) moveFrame.current = requestAnimationFrame(paintDrag);
      }}
      onPointerUp={e => { if (drag.current?.id === e.pointerId) release(false, e.clientX); }}
      onPointerCancel={e => { if (drag.current?.id === e.pointerId) release(true); }}
      onLostPointerCapture={e => { if (e.target === e.currentTarget && drag.current?.id === e.pointerId) release(true); }}
      onPointerLeave={e => { if (drag.current?.id === e.pointerId && !drag.current.horizontal) drag.current = null; }}
      onKeyDown={e => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
        e.preventDefault(); const n = e.key === 'Home' ? 12 : e.key === 'End' ? 22 : Math.max(12, Math.min(22, selected.current + (e.key === 'ArrowRight' ? 1 : -1)));
        cancelMove();
        const gesture = drag.current; drag.current = null;
        if (gesture && e.currentTarget.hasPointerCapture(gesture.id)) e.currentTarget.releasePointerCapture(gesture.id);
        if (timer.current) clearTimeout(timer.current); changing.current = false; rebound.current?.cancel(); rebound.current = null;
        elasticOffset.current = 0;
        e.currentTarget.style.scrollSnapType = '';
        setLanding(null);
        if (ticks.current) ticks.current.style.transform = '';
        e.currentTarget.scrollTo({ left: (n - 12) * 32, behavior: 'instant' }); if (n !== selected.current) breathe(); selectSize(n);
      } }}
      onScroll={e => {
        // Drag frames already own the position and selection; don't repeat their work here.
        if (drag.current?.horizontal || document.hidden) return;
        const el = e.currentTarget, left = el.scrollLeft;
        // Settling/cleanup can dispatch a scroll event for an already exact notch.
        if (!changing.current && Math.abs(left - (selected.current - 12) * 32) < .5) return;
        const n = Math.max(12, Math.min(22, 12 + Math.round(left / 32)));
        changing.current = true; selectSize(n);
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
  const glow = useRef<HTMLSpanElement>(null);
  const origin = useRef<{ id: number; x: number; y: number; currentX: number; currentY: number; box: DOMRect | null; lit: boolean } | null>(null);
  const lightFrame = useRef(0);
  const geometryCleanup = useRef<(() => void) | null>(null);
  const moved = useRef(false);
  const reset = () => {
    if (lightFrame.current) cancelAnimationFrame(lightFrame.current);
    lightFrame.current = 0;
    geometryCleanup.current?.(); geometryCleanup.current = null;
    const gesture = origin.current;
    origin.current = null;
    if (!gesture?.lit) return;
    ref.current?.removeAttribute('data-pressed');
    glow.current?.style.removeProperty('--press-x');
    glow.current?.style.removeProperty('--press-y');
    // Retain the last light coordinates during the existing opacity fade.
  };
  const paintLight = () => {
    if (lightFrame.current) cancelAnimationFrame(lightFrame.current);
    lightFrame.current = 0;
    const gesture = origin.current, el = ref.current, light = glow.current;
    if (!gesture?.box || !el || !light || el.disabled || reduced()) return;
    const box = gesture.box;
    const x = Math.max(0, Math.min(1, (gesture.currentX - box.left) / box.width));
    const y = Math.max(0, Math.min(1, (gesture.currentY - box.top) / box.height));
    // Keep the exact ellipse/64% falloff and 3deg/.985 deformation. Updating only
    // the decorative child avoids propagating these variables through the label.
    light.style.setProperty('--press-x', `${(x - .5) * 3}deg`);
    light.style.setProperty('--press-y', `${(.5 - y) * 3}deg`);
    light.style.setProperty('--press-glow-x', `${x * 100}%`);
    light.style.setProperty('--press-glow-y', `${y * 100}%`);
    if (!gesture.lit) { el.setAttribute('data-pressed', ''); gesture.lit = true; }
  };
  const watchGeometry = () => {
    const interrupt = () => { moved.current = true; reset(); };
    const scroll = (event: Event) => {
      const el = ref.current;
      if (el && event.target instanceof Node && event.target.contains(el)) interrupt();
    };
    // A cached rectangle is valid only while its ancestors and viewport stay put.
    // Listen only during a gesture; scrolling an idle card does no work here.
    window.addEventListener('resize', interrupt);
    document.addEventListener('scroll', scroll, { capture: true, passive: true });
    geometryCleanup.current = () => {
      window.removeEventListener('resize', interrupt);
      document.removeEventListener('scroll', scroll, true);
    };
  };
  useEffect(() => {
    const interrupt = () => { if (origin.current) moved.current = true; reset(); };
    const hidden = () => { if (document.hidden) interrupt(); };
    const unsubscribe = subscribeReducedMotion(interrupt);
    window.addEventListener('blur', interrupt);
    window.addEventListener('vg:back-request', interrupt);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      unsubscribe(); reset(); window.removeEventListener('blur', interrupt);
      window.removeEventListener('vg:back-request', interrupt); document.removeEventListener('visibilitychange', hidden);
    };
  }, []);
  useLayoutEffect(() => { if (props.disabled) { moved.current = true; reset(); } }, [props.disabled]);
  return <button {...props} type={props.type ?? 'button'} ref={ref} className={`vg-press-card ${className}`} style={{ ...props.style } as CSSProperties}
    onPointerDown={e => {
      props.onPointerDown?.(e);
      if (!e.isPrimary) { if (origin.current) { moved.current = true; reset(); } return; }
      if (e.defaultPrevented || e.button !== 0 || props.disabled) return;
      const box = reduced() ? null : e.currentTarget.getBoundingClientRect();
      reset();
      moved.current = false;
      // Track intent even in quiet mode, without capturing or cancelling native scrolling.
      origin.current = { id: e.pointerId, x: e.clientX, y: e.clientY, currentX: e.clientX, currentY: e.clientY, box: box && box.width > 0 && box.height > 0 ? box : null, lit: false };
      watchGeometry();
      // The first press responds in the input event; only subsequent motion is
      // coalesced. Its cached rectangle was already read before any style writes.
      if (origin.current.box) paintLight();
    }}
    onPointerMove={e => {
      props.onPointerMove?.(e);
      const gesture = origin.current;
      if (!gesture || gesture.id !== e.pointerId) return;
      if (Math.hypot(e.clientX - gesture.x, e.clientY - gesture.y) > 8) { moved.current = true; reset(); return; }
      if (e.clientX === gesture.currentX && e.clientY === gesture.currentY) return;
      gesture.currentX = e.clientX; gesture.currentY = e.clientY;
      if (gesture.box && !lightFrame.current) lightFrame.current = requestAnimationFrame(paintLight);
    }}
    onClick={e => { if (moved.current && e.detail !== 0) { e.preventDefault(); e.stopPropagation(); moved.current = false; return; } props.onClick?.(e); }}
    onPointerUp={e => {
      props.onPointerUp?.(e);
      const gesture = origin.current;
      if (!gesture || gesture.id !== e.pointerId) return;
      if (Math.hypot(e.clientX - gesture.x, e.clientY - gesture.y) > 8) { moved.current = true; reset(); return; }
      const finalMoved = e.clientX !== gesture.currentX || e.clientY !== gesture.currentY;
      gesture.currentX = e.clientX; gesture.currentY = e.clientY;
      if (lightFrame.current || finalMoved) paintLight();
      reset();
    }}
    onPointerCancel={e => { props.onPointerCancel?.(e); if (origin.current?.id === e.pointerId) { moved.current = true; reset(); } }}
    onLostPointerCapture={e => { props.onLostPointerCapture?.(e); if (origin.current?.id === e.pointerId) { moved.current = true; reset(); } }}
    onPointerLeave={e => { props.onPointerLeave?.(e); if (origin.current?.id === e.pointerId) { moved.current = true; reset(); } }}
    onBlur={e => { props.onBlur?.(e); reset(); }}>
    {children}<span ref={glow} className="vg-press-glow" aria-hidden="true" />
  </button>;
}
