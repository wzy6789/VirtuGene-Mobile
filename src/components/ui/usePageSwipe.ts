import { useEffect,useRef } from 'react';
import { SWIPE_EDGE,swipeBlocked,swipeCommits,swipeDirection } from '../../lib/swipe-policy';
/** One owner, one frame update, one commit. Cancellation never navigates. */
export function usePageSwipe(enabled:boolean,key:string,canMove:(dx:number)=>boolean,commit:(dx:number)=>void,back=false) {
  const ref=useRef<HTMLDivElement>(null);
  const latest=useRef({canMove,commit});latest.current={canMove,commit};
  useEffect(()=>{
    const el=ref.current;if(!el)return;
    let gesture:{x:number;y:number;dx:number;time:number;dir:'x'|'y'|null}|null=null;
    let frame=0,timer:ReturnType<typeof setTimeout>|undefined,settling=false;
    const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const paint=(x:number,animate=false)=>{el.style.transition=animate&&!reduced?'transform 170ms cubic-bezier(.22,1,.36,1)':'none';el.style.transform=x?`translate3d(${x}px,0,0)`:'';el.style.willChange=x?'transform':'';};
    const cancel=()=>{gesture=null;if(frame)cancelAnimationFrame(frame);frame=0;paint(0,true);};
    const start=(event:TouchEvent)=>{
      if(settling)return;cancel();const t=event.touches[0];
      if(!enabled||event.touches.length!==1||!t||t.clientX<=SWIPE_EDGE||t.clientX>=window.innerWidth-SWIPE_EDGE||swipeBlocked(event.target,el))return;
      gesture={x:t.clientX,y:t.clientY,dx:0,time:performance.now(),dir:null};
    };
    const move=(event:TouchEvent)=>{
      if(event.touches.length!==1){cancel();return;}const g=gesture,t=event.touches[0];if(!g||!t)return;
      const dx=t.clientX-g.x,dy=t.clientY-g.y;g.dir??=swipeDirection(dx,dy);if(g.dir!=='x')return;
      if(back&&dx<=0){cancel();return;}if(!event.cancelable){cancel();return;}event.preventDefault();g.dx=dx;
      if(!frame)frame=requestAnimationFrame(()=>{frame=0;if(!gesture)return;const raw=gesture.dx;paint(latest.current.canMove(raw)?Math.max(-140,Math.min(140,raw*.65)):Math.max(-24,Math.min(24,raw*.1)));});
    };
    const finish=()=>{
      const g=gesture;gesture=null;if(frame)cancelAnimationFrame(frame);frame=0;
      if(!g||g.dir!=='x'||!latest.current.canMove(g.dx)||!swipeCommits(g.dx,performance.now()-g.time,el.clientWidth)){paint(0,true);return;}
      settling=true;paint(Math.sign(g.dx)*Math.min(150,el.clientWidth*.35),true);
      timer=setTimeout(()=>{timer=undefined;paint(0);settling=false;latest.current.commit(g.dx);},reduced?0:170);
    };
    const interrupted=()=>{if(timer)clearTimeout(timer);timer=undefined;settling=false;cancel();};
    const hidden=()=>{if(document.hidden)interrupted();};
    el.addEventListener('touchstart',start,{passive:true});el.addEventListener('touchmove',move,{passive:false});el.addEventListener('touchend',finish);el.addEventListener('touchcancel',cancel);window.addEventListener('resize',interrupted);document.addEventListener('visibilitychange',hidden);
    return()=>{if(timer)clearTimeout(timer);if(frame)cancelAnimationFrame(frame);el.removeEventListener('touchstart',start);el.removeEventListener('touchmove',move);el.removeEventListener('touchend',finish);el.removeEventListener('touchcancel',cancel);window.removeEventListener('resize',interrupted);document.removeEventListener('visibilitychange',hidden);paint(0);};
  },[enabled,key,back]);
  return ref;
}
