import { useAuthStore } from '../store/auth-store';
import { prefersReducedMotion, settleProgress, subscribeReducedMotion } from './mobile-motion';

export type SoulRole = 'list' | 'chat' | 'profile' | 'media' | 'cabin';
const elements = new Map<string, Set<HTMLElement>>();
type Handoff = { key: string; role: SoulRole; source: HTMLElement; target?: HTMLElement; owner: string | null; ghost: HTMLElement; stop: () => void; fly: (node: HTMLElement) => void };
let active: Handoff | undefined;
const identity = (key: string, role: SoulRole) => `${role}:${key}`;
const usable = (node: HTMLElement) => node.isConnected && !node.closest('.vg-motion-snapshot,.vg-modal-exit,.vg-page-exit,[inert]') && getComputedStyle(node).visibility !== 'hidden';
export function soulElement(key: string, role: SoulRole): HTMLElement | undefined {
  return [...(elements.get(identity(key, role)) ?? [])].find(usable);
}
export const soulHandoffTo = (role: SoulRole) => active?.role === role;
export function cancelSoulHandoff() { active?.stop(); }

/** Ref registration precedes the parent page's entrance animation; rects are final layout coordinates. */
export function registerSoulElement(node: HTMLElement, key: string, role: SoulRole): () => void {
  const id = identity(key, role), group = elements.get(id) ?? new Set<HTMLElement>();
  group.add(node); elements.set(id, group);
  if (active?.key === key && active.role === role && node !== active.source) {
    const handoff = active;
    queueMicrotask(() => { if (active === handoff && node.isConnected) handoff.fly(node); });
  }
  return () => {
    group.delete(node); if (!group.size) elements.delete(id);
    if (active?.target === node) active.stop();
  };
}

function visibleRect(node: HTMLElement): DOMRect | undefined {
  if (!usable(node)) return;
  const rect = node.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1 || rect.bottom <= 0 || rect.top >= innerHeight || rect.right <= 0 || rect.left >= innerWidth) return;
  if (node instanceof HTMLImageElement && (!node.complete || !node.naturalWidth)) return;
  return rect;
}

/** One inert, bounded visual; navigation and input never wait for the animation. */
export function beginSoulHandoff(key: string, source: HTMLElement | undefined | null, role: SoulRole): () => void {
  cancelSoulHandoff();
  if (!source || prefersReducedMotion() || document.hidden) return () => {};
  const from = visibleRect(source);
  const limit = role === 'media' ? 512 : 200;
  const orb = source.matches('span.vg-soul-orb[data-soul-orb-host]') && source.childElementCount<=2 && !!source.querySelector(':scope > svg') && source.querySelectorAll('*').length<=160;
  if (!from || from.width > limit || from.height > limit || !source.matches('img,span') || !orb&&(source.childElementCount>0 || source.textContent!.length > 64)) return () => {};
  const visual = source.cloneNode(orb) as HTMLElement;
  if (!orb && !(source instanceof HTMLImageElement)) visual.textContent = source.textContent;
  for (const attribute of [...visual.attributes]) {
    if (!['src', 'alt'].includes(attribute.name)) visual.removeAttribute(attribute.name);
  }
  const style = getComputedStyle(source);
  if(orb) {
    visual.className='vg-soul-orb'; visual.setAttribute('data-orb-emotion',source.dataset.orbEmotion??'idle');
    // Freeze a trusted mascot visual; never copy application content or handlers.
    const descendants=[...visual.querySelectorAll('*')], originals=[...source.querySelectorAll('*')];
    const ids=new Map<string,string>();
    descendants.forEach((node,index)=>{if(node.id)ids.set(node.id,`vg-flight-${crypto.randomUUID()}`);const computed=getComputedStyle(originals[index]);(node as SVGElement).style.fill=computed.fill;(node as SVGElement).style.stroke=computed.stroke;(node as SVGElement).style.opacity=computed.opacity;});
    for(const node of descendants)for(const attr of [...node.attributes]) {
      if(attr.name.startsWith('on'))node.removeAttribute(attr.name);
      else if(attr.name==='id')node.id=ids.get(attr.value)!;
      else {let value=attr.value;for(const [id,replacement] of ids)value=value.split(`#${id}`).join(`#${replacement}`);node.setAttribute(attr.name,value);}
    }
    visual.removeAttribute('data-orb-interactive');
  }
  Object.assign(visual.style, { width:'100%', height:'100%', display:'flex', alignItems:'center', justifyContent:'center', objectFit:style.objectFit, color:style.color, background:style.backgroundColor, font:style.font, lineHeight:style.lineHeight });
  const ghost = document.createElement('div');
  ghost.className = 'vg-soul-ghost'; ghost.inert = true; ghost.setAttribute('aria-hidden','true');
  Object.assign(ghost.style, { width:`${from.width}px`,height:`${from.height}px`,left:`${from.left}px`,top:`${from.top}px`,borderRadius:style.borderRadius });
  ghost.append(visual);
  const modal = source.closest('.vg-modal-overlay');
  const host = modal || role === 'media' ? document.body : document.querySelector<HTMLElement>('[data-soul-host]') ?? document.body;
  if (role === 'media') ghost.style.zIndex = 'var(--vg-z-viewer)';
  if (modal) ghost.style.zIndex = `calc(${getComputedStyle(modal).zIndex} + 1)`;
  host.append(ghost); source.setAttribute('data-soul-hidden','');
  const owner = useAuthStore.getState().userId;
  let imageReady: HTMLImageElement | undefined, ready: (() => void) | undefined;
  let contentAnimation: Animation | undefined;
  let animation: Animation | undefined, timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  const stop = () => {
    if (disposed) return; disposed = true;
    clearTimeout(timer); animation?.cancel(); contentAnimation?.cancel(); ghost.remove();
    if (imageReady && ready) { imageReady.removeEventListener('load',ready); imageReady.removeEventListener('error',stop); }
    source.removeAttribute('data-soul-hidden'); handoff.target?.removeAttribute('data-soul-hidden');
    unsubscribe(); unsubscribeAuth();
    window.removeEventListener('resize', stop); window.removeEventListener('blur', stop); window.removeEventListener('pointerdown', stop, true); window.removeEventListener('touchstart', stop, true);
    window.visualViewport?.removeEventListener('resize',stop); window.visualViewport?.removeEventListener('scroll',stop);
    document.removeEventListener('visibilitychange',hidden);
    if (active === handoff) active = undefined;
  };
  const hidden = () => { if (document.hidden) stop(); };
  const handoff: Handoff = { key, role, source, ghost, owner, stop, fly: node => {
    if (disposed || handoff.target || owner !== useAuthStore.getState().userId) return;
    if (node instanceof HTMLImageElement && !node.complete) {
      handoff.target = node; node.setAttribute('data-soul-hidden',''); imageReady = node;
      ready = () => { if (!disposed) { handoff.target = undefined; handoff.fly(node); } };
      node.addEventListener('load',ready,{once:true}); node.addEventListener('error',stop,{once:true}); return;
    }
    const to = visibleRect(node); if (!to) { stop(); return; }
    // Measure after layout effects restore list scroll, subtracting only the
    // temporary page entrance, never static title centering transforms.
    const page = node.closest<HTMLElement>('.vg-page-transition');
    if (page) {
      const transform = getComputedStyle(page).transform;
      if (transform !== 'none') { const matrix = new DOMMatrixReadOnly(transform); to.x -= matrix.m41; to.y -= matrix.m42; }
    }
    const panel = node.closest<HTMLElement>('.vg-modal-panel');
    if (panel) {
      const transform = getComputedStyle(panel).transform;
      if (transform !== 'none') { const matrix = new DOMMatrixReadOnly(transform); to.x -= matrix.m41; to.y -= matrix.m42; }
    }
    clearTimeout(timer); handoff.target = node; node.setAttribute('data-soul-hidden','');
    // Image frames grow their crop while compensating the inner picture's
    // scale, so a square thumbnail expands into a wide photo without distortion.
    if (role === 'media' && node instanceof HTMLImageElement) {
      const fit = Math.min(to.width/node.naturalWidth,to.height/node.naturalHeight);
      const width = node.naturalWidth*fit, height = node.naturalHeight*fit;
      to.x += (to.width-width)/2; to.y += (to.height-height)/2; to.width=width; to.height=height;
      Object.assign(ghost.style,{left:`${to.left}px`,top:`${to.top}px`,width:`${to.width}px`,height:`${to.height}px`});
      visual.style.objectFit = 'contain'; visual.style.transformOrigin = 'center';
      const sx=from.width/to.width,sy=from.height/to.height,dx=from.left-to.left,dy=from.top-to.top;
      const progress = settleProgress(3);
      animation = ghost.animate(progress.map(({offset,progress:p})=>({offset,transform:`translate3d(${dx*(1-p)}px,${dy*(1-p)}px,0) scale(${sx+(1-sx)*p},${sy+(1-sy)*p})`,borderRadius:`${parseFloat(style.borderTopLeftRadius)*(1-p)}px`})),{duration:300,easing:'linear'});
      contentAnimation = visual.animate(progress.map(({offset,progress:p})=>{const x=sx+(1-sx)*p,y=sy+(1-sy)*p,cover=Math.max(x,y);return {offset,transform:`scale(${cover/x},${cover/y})`};}),{duration:300,easing:'linear'});
      animation.onfinish=stop; return;
    }
    const scale = Math.min(to.width/from.width, to.height/from.height);
    if (!orb && source instanceof HTMLSpanElement && node instanceof HTMLSpanElement) {
      // Glyph avatars need their own font scale; avatar diameter alone would
      // leave an oversized glyph just before the live header takes over.
      ghost.style.backgroundColor = style.backgroundColor; visual.style.backgroundColor = 'transparent';
      const fontScale = parseFloat(getComputedStyle(node).fontSize) / (parseFloat(style.fontSize) * scale);
      visual.style.transformOrigin = 'center';
      contentAnimation = visual.animate(settleProgress(3).map(({offset,progress}) => ({offset,transform:`scale(${1+(fontScale-1)*progress})`})),{duration:300,easing:'linear'});
    }
    const dx = to.left + (to.width - from.width*scale)/2 - from.left;
    const dy = to.top + (to.height - from.height*scale)/2 - from.top;
    const radius = parseFloat(getComputedStyle(node).borderTopLeftRadius)/scale;
    const initialRadius = parseFloat(style.borderTopLeftRadius);
    const frames = settleProgress(3).map(({offset,progress})=>({offset,transform:`translate3d(${dx*progress}px,${dy*progress}px,0) scale(${1+(scale-1)*progress})`,borderRadius:`${initialRadius+(radius-initialRadius)*progress}px`,opacity:1}));
    animation = ghost.animate(frames,{duration:300,easing:'linear'});
    animation.onfinish = stop;
  }};
  const unsubscribe = subscribeReducedMotion(() => { if (prefersReducedMotion()) stop(); });
  const unsubscribeAuth = useAuthStore.subscribe(state => { if (state.userId !== owner) stop(); });
  window.addEventListener('resize',stop); window.addEventListener('blur',stop); window.addEventListener('pointerdown',stop,true); window.addEventListener('touchstart',stop,true);
  window.visualViewport?.addEventListener('resize',stop); window.visualViewport?.addEventListener('scroll',stop);
  document.addEventListener('visibilitychange',hidden);
  active = handoff;
  timer = setTimeout(stop,300);
  // Existing mounted targets are only valid when they are outside the source page.
  const target = soulElement(key,role); if (target && target !== source) handoff.fly(target);
  return stop;
}
