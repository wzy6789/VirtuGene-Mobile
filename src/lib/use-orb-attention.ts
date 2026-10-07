import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { constrainOrbGaze, type OrbAttention } from './orb-motion-profiles';

/** DOM measurements belong to host events, never the mascot's render loop. */
export function useOrbAttention(cue:string|undefined,scope:RefObject<HTMLElement|null>,target:()=>HTMLElement|null,captureSelector?:string) {
  const resolver=useRef(target);resolver.current=target;
  const captured=useRef<{node:HTMLElement;rect:DOMRect}|null>(null);
  const [attention,setAttention]=useState<OrbAttention>();
  useLayoutEffect(()=>{
    const host=scope.current;if(!host||!captureSelector)return;
    const capture=(event:Event)=>{if(event instanceof KeyboardEvent&&event.key!=='Enter'&&event.key!==' ')return;if(event.target instanceof Element){const node=event.target.closest<HTMLElement>(captureSelector);captured.current=node?{node,rect:node.getBoundingClientRect()}:null;}};
    host.addEventListener('pointerdown',capture,true);host.addEventListener('keydown',capture,true);
    return()=>{host.removeEventListener('pointerdown',capture,true);host.removeEventListener('keydown',capture,true);captured.current=null;};
  },[scope,captureSelector]);
  useLayoutEffect(()=>{
    setAttention(undefined);
    const host=scope.current;if(!cue||!host)return;
    const deadline=performance.now()+1200;
    const source=captured.current;captured.current=null;
    let initial=true;
    const update=()=>{
      const destination=captureSelector?source?.node:resolver.current();
      const orb=host.querySelector<HTMLElement>('.vg-character-orb [data-soul-orb-host]');
      // A committed completion may remove its row before this effect. Use its
      // captured visual position once; any later scroll/resize invalidates it.
      const to=destination?.isConnected?destination.getBoundingClientRect():initial?source?.rect:undefined;
      initial=false;
      if(!orb||!to||performance.now()>=deadline||orb.closest('[hidden],[inert],.vg-motion-snapshot')||destination?.isConnected&&destination.closest('[hidden],[inert],.vg-motion-snapshot')){setAttention(undefined);return;}
      const from=orb.getBoundingClientRect();
      if(to.bottom<=0||to.top>=innerHeight||to.right<=0||to.left>=innerWidth||from.width<=0){setAttention(undefined);return;}
      const [x,y]=constrainOrbGaze((to.left+to.width/2-from.left-from.width/2)/180,(to.top+to.height/2-from.top-from.height/2)/180);
      setAttention({key:cue,point:{x,y},expiresInMs:Math.max(0,deadline-performance.now())});
    };
    update();
    host.addEventListener('scroll',update,{capture:true,passive:true});window.addEventListener('resize',update);
    window.visualViewport?.addEventListener('resize',update);window.visualViewport?.addEventListener('scroll',update);
    const detach=()=>{host.removeEventListener('scroll',update,true);window.removeEventListener('resize',update);window.visualViewport?.removeEventListener('resize',update);window.visualViewport?.removeEventListener('scroll',update);};
    const expiry=window.setTimeout(()=>{detach();setAttention(undefined);},Math.max(0,deadline-performance.now()));
    return()=>{clearTimeout(expiry);detach();};
  },[cue,scope,captureSelector]);
  return attention;
}
