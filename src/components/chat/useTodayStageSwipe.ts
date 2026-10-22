import {useLayoutEffect,useRef} from 'react';
import {prefersReducedMotion,settleFrames,subscribeReducedMotion} from '../../lib/mobile-motion';
import {SWIPE_EDGE} from '../../lib/swipe-policy';

/** A local horizontal gesture; vertical movement remains owned by the list. */
export function useTodayStageSwipe(key:string,count:number,index:number,select:(index:number)=>void) {
 const viewportRef=useRef<HTMLDivElement>(null),railRef=useRef<HTMLDivElement>(null);
 const latest=useRef({index,select});latest.current={index,select};
 const go=useRef<(index:number)=>void>(()=>{});
 useLayoutEffect(()=>{
  const viewport=viewportRef.current,rail=railRef.current;if(!viewport||!rail)return;
  let width=viewport.clientWidth,position=-latest.current.index*width,animation:Animation|undefined,frame=0,suppressUntil=0;
  type Drag={id:number;x:number;y:number;origin:number;lastX:number;lastTime:number;velocity:number;axis:'x'|'y'|null;moved:boolean};
  let drag:Drag|undefined;
  let wheel: {origin:number;total:number;lastTime:number;velocity:number}|undefined,wheelTimer:ReturnType<typeof setTimeout>|undefined;
  const clearWheel=()=>{clearTimeout(wheelTimer);wheelTimer=undefined;wheel=undefined;};
  const clamp=(value:number)=>Math.max(0,Math.min(count-1,value));
  const current=()=>animation?new DOMMatrixReadOnly(getComputedStyle(rail).transform).m41:position;
  const stop=()=>{position=current();animation?.cancel();animation=undefined;cancelAnimationFrame(frame);frame=0;};
  const paint=()=>{frame=0;rail.style.transform=`translate3d(${position}px,0,0)`;};
  const settle=(target:number,animate=true,velocity=0)=>{
   clearWheel();
   stop();const from=position;position=-clamp(target)*width;paint();
   if(!animate||prefersReducedMotion()||Math.abs(position-from)<.5){rail.style.willChange='';return;}
   const speed=velocity*(position-from)>0?Math.min(9,Math.abs(velocity)*260/Math.max(1,Math.abs(position-from))):0;
   rail.style.willChange='transform';animation=rail.animate(settleFrames(from,position,1,1,'x',speed),{duration:260,easing:'linear'});
   animation.onfinish=()=>{animation=undefined;rail.style.willChange='';};
  };
  const choose=(target:number,velocity=0)=>{target=clamp(target);if(rail.contains(document.activeElement))viewport.focus({preventScroll:true});latest.current.select(target);settle(target,true,velocity);};go.current=choose;
  const releaseCapture=(id:number)=>{if(viewport.hasPointerCapture(id))viewport.releasePointerCapture(id);};
  const cancel=()=>{const active=drag;drag=undefined;if(active)releaseCapture(active.id);settle(latest.current.index,false);};
  const down=(event:PointerEvent)=>{
   if(!event.isPrimary){cancel();return;}if(event.button!==0||count<2||window.getSelection()?.toString()||document.querySelector('[aria-modal="true"]'))return;
   if(event.pointerType==='touch'&&(event.clientX<=SWIPE_EDGE||event.clientX>=innerWidth-SWIPE_EDGE))return;
   clearWheel();stop();paint();drag={id:event.pointerId,x:event.clientX,y:event.clientY,origin:position,lastX:event.clientX,lastTime:performance.now(),velocity:0,axis:null,moved:false};
  };
  const dragPosition=(raw:number)=>{
   const min=-(count-1)*width,rubber=(excess:number)=>width*.13*(1-Math.exp(-excess/(width*.45)));
   return raw>0?rubber(raw):raw<min?min-rubber(min-raw):raw;
  };
  const finish=(origin:number,velocity:number)=>{
   const base=clamp(Math.round(-origin/width)),travel=position-origin;
   const commits=Math.abs(travel)>width*.18||Math.abs(travel)>22&&Math.abs(velocity)>.45;
   choose(commits?base-Math.sign(Math.abs(velocity)>.45?velocity:travel):base,velocity);
  };
  const move=(event:PointerEvent)=>{
   const active=drag;if(!active||active.id!==event.pointerId)return;
   const dx=event.clientX-active.x,dy=event.clientY-active.y;
   if(!active.axis&&Math.max(Math.abs(dx),Math.abs(dy))>=10){
    if(Math.abs(dx)>Math.abs(dy)*1.2)active.axis='x';
    else if(Math.abs(dy)>Math.abs(dx)*1.2)active.axis='y';
   }
   if(active.axis!=='x')return;
   event.preventDefault();active.moved ||= Math.abs(dx)>10;
   if(!viewport.hasPointerCapture(event.pointerId))viewport.setPointerCapture(event.pointerId);
   const now=performance.now(),velocity=(event.clientX-active.lastX)/Math.max(8,now-active.lastTime);
   active.velocity=active.velocity*.3+velocity*.7;active.lastX=event.clientX;active.lastTime=now;
   position=dragPosition(active.origin+dx);rail.style.willChange='transform';
   if(!frame)frame=requestAnimationFrame(paint);
  };
  const up=(event:PointerEvent)=>{
   const active=drag;if(!active||active.id!==event.pointerId)return;drag=undefined;releaseCapture(active.id);
   if(active.axis!=='x'){settle(latest.current.index,false);return;}
   if(active.moved)suppressUntil=performance.now()+400;
   finish(active.origin,performance.now()-active.lastTime<100?active.velocity:0);
  };
  const scroll=(event:WheelEvent)=>{
   if(event.ctrlKey||drag||count<2||document.querySelector('[aria-modal="true"]')||window.getSelection()?.toString())return;
   const horizontal=event.shiftKey&&Math.abs(event.deltaX)<1?event.deltaY:event.deltaX;
   if(!horizontal||!event.shiftKey&&Math.abs(horizontal)<=Math.abs(event.deltaY)*1.2)return;
   event.preventDefault();
   const now=performance.now(),delta=horizontal*(event.deltaMode===1?16:event.deltaMode===2?width:1);
   if(!wheel){stop();paint();wheel={origin:position,total:0,lastTime:now-16,velocity:0};}
   wheel.velocity=wheel.velocity*.3-delta/Math.max(8,now-wheel.lastTime)*.7;
   wheel.lastTime=now;wheel.total=Math.max(-width,Math.min(width,wheel.total+delta));
   position=dragPosition(wheel.origin-wheel.total);rail.style.willChange='transform';
   if(!frame)frame=requestAnimationFrame(paint);
   clearTimeout(wheelTimer);wheelTimer=setTimeout(()=>{
    const active=wheel;if(!active)return;
    finish(active.origin,active.velocity);
   },100);
  };
  const click=(event:MouseEvent)=>{if(event.detail&&performance.now()<suppressUntil){event.preventDefault();event.stopPropagation();}};
  const keyboard=(event:KeyboardEvent)=>{if(event.key!=='ArrowLeft'&&event.key!=='ArrowRight')return;event.preventDefault();choose(latest.current.index+(event.key==='ArrowRight'?1:-1));};
  const resized=()=>{width=viewport.clientWidth;cancel();};
  const hidden=()=>{if(document.hidden||document.documentElement.dataset.vgBackground==='true')cancel();};
  const captureLost=(event:PointerEvent)=>{if(event.target===viewport&&drag)cancel();};
  const observer=new ResizeObserver(resized);observer.observe(viewport);
  const background=new MutationObserver(hidden);background.observe(document.documentElement,{attributes:true,attributeFilter:['data-vg-background']});
  const unsubscribe=subscribeReducedMotion(()=>{if(prefersReducedMotion())cancel();});
  viewport.addEventListener('pointerdown',down);viewport.addEventListener('pointermove',move,{passive:false});viewport.addEventListener('pointerup',up);viewport.addEventListener('pointercancel',cancel);viewport.addEventListener('lostpointercapture',captureLost);viewport.addEventListener('click',click,true);viewport.addEventListener('keydown',keyboard);viewport.addEventListener('wheel',scroll,{passive:false});
  window.addEventListener('pointerup',up);window.addEventListener('blur',cancel);document.addEventListener('visibilitychange',hidden);paint();
  return()=>{go.current=()=>{};clearWheel();const active=drag;drag=undefined;if(active)releaseCapture(active.id);stop();observer.disconnect();background.disconnect();unsubscribe();viewport.removeEventListener('pointerdown',down);viewport.removeEventListener('pointermove',move);viewport.removeEventListener('pointerup',up);viewport.removeEventListener('pointercancel',cancel);viewport.removeEventListener('lostpointercapture',captureLost);viewport.removeEventListener('click',click,true);viewport.removeEventListener('keydown',keyboard);viewport.removeEventListener('wheel',scroll);window.removeEventListener('pointerup',up);window.removeEventListener('blur',cancel);document.removeEventListener('visibilitychange',hidden);rail.style.willChange='';};
 },[key,count]);
 return {viewportRef,railRef,goTo:(target:number)=>go.current(target)};
}
