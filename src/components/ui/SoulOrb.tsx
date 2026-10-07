import { useLayoutEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { useSettingsStore } from '../../store/settings-store';
import { ORB_COLORS } from '../../lib/orb-colors';
import { prefersReducedMotion, subscribeReducedMotion } from '../../lib/mobile-motion';
import { createOrbAccent, sampleOrbBlink, settleOrbValue, startOrbAccent, stepOrbAccent, subscribeSoulOrbFrame } from '../../lib/soul-orb-motion';
import { ORB_CHANNEL_GROUPS, constrainOrbGaze, orbPoseCoefficients, resolveOrbTransition, type OrbAttention, type OrbChannel, type OrbTransitionProfile } from '../../lib/orb-motion-profiles';
import { resolveOrbAttention } from '../../lib/orb-attention';
import { createOrbPainter } from '../../lib/orb-render';
import { registerSoulElement, type SoulRole } from '../../lib/soul-handoff';

export const SOUL_ORB_EMOTIONS = ['idle','curious','listening','thinking','working','happy','surprised','shy','sleepy','sad','error','success'] as const;
export type SoulOrbEmotion = typeof SOUL_ORB_EMOTIONS[number];
/** Product guidance promises these business states; the other expressions are optional reactions. */
export const SOUL_ORB_CORE_STATES = ['idle', 'thinking', 'working', 'success', 'error'] as const satisfies readonly SoulOrbEmotion[];
export const SOUL_ORB_LABELS: Record<SoulOrbEmotion,string> = {
  idle:'待机', curious:'好奇', listening:'倾听', thinking:'思考', working:'忙碌', happy:'开心',
  surprised:'惊讶', shy:'害羞', sleepy:'困倦', sad:'低落', error:'遇到困难', success:'完成',
};
// Original expression parameters, geometry and art. No external mascot assets.
interface OrbPose extends Record<OrbChannel,number> {
  eyeWidth:number; eyeOpen:number; rightOpen:number; eyeCurve:number; eyeGap:number;
  mouthWidth:number; mouthCurve:number; mouthOpen:number; mouthDark:number;
  tilt:number; faceX:number; faceY:number; scaleX:number; scaleY:number; lift:number; blush:number;
  brow:number; browLift:number; browTilt:number; orbit:number; orbitDot:number;
  listening:number; thought:number; busy:number; sleep:number; tear:number; cross:number; sparkles:number;
}
const neutral: OrbPose = {
  eyeWidth:7.5,eyeOpen:1,rightOpen:1,eyeCurve:0,eyeGap:22,
  mouthWidth:6,mouthCurve:4,mouthOpen:2,mouthDark:0,
  tilt:0,faceX:0,faceY:0,scaleX:1,scaleY:1,lift:0,blush:0,
  brow:0,browLift:0,browTilt:0,orbit:.23,orbitDot:2.4,
  listening:0,thought:0,busy:0,sleep:0,tear:0,cross:0,sparkles:0,
};
const pose = (overrides: Partial<OrbPose>): OrbPose => ({...neutral,...overrides});
const poses: Record<SoulOrbEmotion,OrbPose> = {
  idle: pose({}),
  curious: pose({eyeWidth:8,eyeOpen:1.25,rightOpen:.42,tilt:-12,faceX:4,faceY:-3,brow:1,browLift:7,browTilt:-6}),
  listening: pose({eyeWidth:8,eyeGap:20,tilt:-4,scaleY:1.035,listening:1,mouthWidth:4}),
  thinking: pose({eyeOpen:.52,rightOpen:.2,tilt:8,faceX:3,faceY:-3,mouthCurve:0,orbit:.9,orbitDot:10,thought:1,brow:.8,browLift:4}),
  working: pose({eyeWidth:10,eyeOpen:.1,eyeGap:21,mouthWidth:7,mouthCurve:0,mouthOpen:3,tilt:5,scaleX:.98,scaleY:1.025,orbit:.7,orbitDot:5,busy:1,brow:.8,browTilt:7}),
  happy: pose({eyeWidth:9,eyeOpen:.2,eyeCurve:-9,eyeGap:23,mouthWidth:10,mouthCurve:8,mouthOpen:4,tilt:-4,faceY:-2,scaleX:1.04,scaleY:.96,blush:.3}),
  surprised: pose({eyeWidth:9,eyeOpen:1.35,eyeGap:25,mouthWidth:7,mouthCurve:-16,mouthOpen:32,mouthDark:1,scaleX:.95,scaleY:1.06,lift:-3}),
  shy: pose({eyeOpen:.58,eyeGap:19,mouthWidth:4,tilt:9,faceX:-3,faceY:5,blush:.9,scaleX:1.03,scaleY:.97}),
  sleepy: pose({eyeWidth:10,eyeOpen:.08,mouthWidth:4,mouthCurve:-5,mouthOpen:11,mouthDark:.8,tilt:-13,faceY:5,scaleX:1.04,scaleY:.95,sleep:1}),
  sad: pose({eyeWidth:9,eyeOpen:.12,eyeCurve:6,mouthCurve:-8,tilt:-5,faceY:7,scaleX:1.035,scaleY:.94,lift:9,brow:1,browLift:6,browTilt:-5,tear:1}),
  error: pose({eyeWidth:8,eyeOpen:.55,mouthCurve:-5,mouthOpen:2,tilt:6,scaleX:1.03,scaleY:.97,cross:1}),
  success: pose({eyeWidth:9,eyeOpen:.19,eyeCurve:-9,eyeGap:23,mouthWidth:11,mouthCurve:8,mouthOpen:5,tilt:-6,faceY:-3,scaleX:1.04,scaleY:.97,blush:.25,sparkles:1}),
};
const channels = Object.keys(neutral) as (keyof OrbPose)[];
const zeroVelocity = (): OrbPose => Object.fromEntries(channels.map(key=>[key,0])) as unknown as OrbPose;

interface Props {
  emotion?: SoulOrbEmotion;
  size?: number;
  animated?: boolean;
  /** Visual gaze/press only; this aria-hidden span is decorative. Use
   * SoulOrbButton for activation, or an accessible button host that cancels
   * movement >10px and only increments reaction for valid clicks/keyboard input. */
  interactive?: boolean;
  className?: string;
  reaction?: number;
  attention?: OrbAttention;
  /** A new event identity can acknowledge repeated success without remounting. */
  cueId?: string | number;
  soulKey?: string;
  soulRole?: SoulRole;
  /** Inline streaming decoration must not append hidden labels to message text. */
  fallbackLabel?: boolean;
}

/** Controlled, decorative mascot. Business status always belongs to its host. */
export function SoulOrb({ emotion='idle', size=160, animated=true, interactive=false, className='', reaction=0, attention, cueId, soulKey, soulRole, fallbackLabel=true }: Props) {
  const colorId=useSettingsStore(s=>s.orbColor);
  const color=ORB_COLORS.find(color=>color.id===colorId);
  const colorStyle:CSSProperties=color&&color.id!=='auto'?{'--orb-body':color.body,'--orb-highlight':color.highlight,'--orb-depth':color.depth,'--orb-cyan':color.rim} as CSSProperties:{};
  const uid = useId().replace(/:/g,'');
  const root = useRef<HTMLSpanElement>(null), rig = useRef<SVGGElement>(null), face = useRef<SVGGElement>(null);
  const left = useRef<SVGPathElement>(null), right = useRef<SVGPathElement>(null), mouth = useRef<SVGPathElement>(null);
  const blush = useRef<SVGGElement>(null), orbit = useRef<SVGGElement>(null), shadow = useRef<SVGEllipseElement>(null);
  const darkMouth = useRef<SVGPathElement>(null), brows = useRef<SVGGElement>(null), orbitDot = useRef<SVGCircleElement>(null);
  const waves = useRef<SVGGElement>(null), thoughts = useRef<SVGGElement>(null), sleep = useRef<SVGGElement>(null);
  const tear = useRef<SVGPathElement>(null), cross = useRef<SVGGElement>(null), sparkles = useRef<SVGGElement>(null);
  const sheen = useRef<SVGPathElement>(null);
  const phase = useRef(Math.random()*Math.PI*2);
  const state = useRef(emotion); state.current = emotion;
  const current = useRef({...poses[emotion]}), velocity = useRef(zeroVelocity());
  const gaze = useRef([0,0]), gazeVelocity = useRef([0,0]), gazeTarget = useRef([0,0]);
  const bodyGaze = useRef([0,0]), bodyVelocity = useRef([0,0]);
  const accent=useRef(createOrbAccent());
  const attentionRef=useRef(attention);attentionRef.current=attention;
  const reactToTouch=useRef<()=>void>(()=>{});
  const releaseCompression=useRef(.03);
  const pressOrigin = useRef<{x:number;y:number}|null>(null);
  const held = useRef(false), cheerUntil = useRef(0), reset = useRef<()=>void>(()=>{});
  useLayoutEffect(() => {
    if(root.current && soulKey && soulRole)return registerSoulElement(root.current,soulKey,soulRole);
  },[soulKey,soulRole]);

  useLayoutEffect(() => {
    const el = root.current; if (!el) return;
    let visible = true, focused = document.hasFocus(), disposed = false, stopFrame: (()=>void) | undefined;
    let blinkAt = performance.now()+2800+Math.random()*1200, blinkStart = 0, gazeAt = 0, doubleBlink = false, lastBlink=-Infinity;
    let motionTime = 0, motionStrength = 0;
    let lastEmotion=state.current, attentionKey=attentionRef.current?.key, attentionUntil=0, pointerUntil=0;
    let lastVisual=state.current,transition:OrbTransitionProfile|undefined,transitionRemaining=0;
    let pointerGaze:[number,number]=[0,0], roaming:[number,number]=[0,0];
    const render=createOrbPainter({rig,face,left,right,mouth,blush,orbit,shadow,darkMouth,brows,orbitDot,waves,thoughts,sleep,tear,cross,sparkles,sheen},size,phase.current);
    const paint=(p:OrbPose,time:number,blink=0,move=true)=>render(p,time,blink,move,motionStrength,gaze.current,bodyGaze.current,accent.current,state.current,held.current,el.dataset.orbAttention==='pointer'||el.dataset.orbAttention==='host');
    const snapshot = () => {
      current.current = {...(poses[state.current] ?? poses.idle)}; velocity.current=zeroVelocity();
      gaze.current=[0,0]; gazeVelocity.current=[0,0];gazeTarget.current=[0,0];
      bodyGaze.current=[0,0]; bodyVelocity.current=[0,0];accent.current=createOrbAccent();
      paint(current.current,0,0,false);
    };
    const tick = (dt: number, time: number) => {
      motionTime += dt*1000;
      motionStrength = Math.min(1, motionStrength+dt/0.45);
      if(lastEmotion!==state.current){
        lastEmotion=state.current;
        roaming=[0,0];
        if(lastEmotion==='sad'||lastEmotion==='sleepy')for(const key of channels)if(ORB_CHANNEL_GROUPS[key]==='body')velocity.current[key]=0;
        if(lastEmotion==='success'||lastEmotion==='error'||lastEmotion==='surprised'||lastEmotion==='happy')startOrbAccent(accent.current,lastEmotion);
        else {accent.current.kind='touch';accent.current.launched=true;accent.current.elapsed=Math.max(240,accent.current.elapsed);}
      }
      stepOrbAccent(accent.current,dt);
      const playful = interactive && cheerUntil.current>time;
      // A touch may acknowledge the user, but must not mask a live task or failure.
      const protectedState = state.current==='thinking'||state.current==='working'||state.current==='error'||state.current==='success';
      const visual=playful&&!protectedState?'happy':state.current;
      if(lastVisual!==visual){
        transition=resolveOrbTransition(lastVisual,visual);transitionRemaining=transition?.duration??0;lastVisual=visual;
        if(transition?.blink&&!blinkStart&&time-lastBlink>700){blinkAt=time;doubleBlink=false;}
      }
      const target=poses[visual]??poses.idle;
      const coefficients=orbPoseCoefficients(dt,visual,transitionRemaining,transition);
      transitionRemaining=Math.max(0,transitionRemaining-dt);
      for (const key of channels) {
        const aim = key==='scaleY'&&held.current ? target[key]*.91 : key==='scaleX'&&held.current ? target[key]*1.07 : target[key];
        const c=coefficients[ORB_CHANNEL_GROUPS[key]], y=current.current[key]-aim, v=velocity.current[key];
        if(Math.abs(y)<.0001&&Math.abs(v)<.001){current.current[key]=aim;velocity.current[key]=0;}
        else {current.current[key]=aim+c[0]*y+c[1]*v;velocity.current[key]=c[2]*y+c[3]*v;}
      }
      const hostAttention=attentionRef.current;
      if(hostAttention?.key!==attentionKey){attentionKey=hostAttention?.key;attentionUntil=hostAttention?time+Math.min(2000,Math.max(0,hostAttention.expiresInMs??1200)):0;}
      if(time>gazeAt&&!held.current&&time>=pointerUntil&&time>=attentionUntil&&state.current==='idle'){
        roaming=[(Math.random()-.5)*.6,(Math.random()-.5)*.24];gazeAt=time+1800+Math.random()*2700;
      }
      const nextGaze=resolveOrbAttention(pointerGaze,pointerUntil,hostAttention,attentionUntil,roaming,time);
      const attentionSource=time<pointerUntil?'pointer':hostAttention&&time<attentionUntil?'host':'idle';
      if(el.dataset.orbAttention!==attentionSource)el.dataset.orbAttention=attentionSource;
      if(Math.hypot(nextGaze[0]-gazeTarget.current[0],nextGaze[1]-gazeTarget.current[1])>.6&&time-lastBlink>700&&!blinkStart){blinkAt=time;}
      gazeTarget.current=nextGaze;
      for (let i=0;i<2;i++) [gaze.current[i],gazeVelocity.current[i]]=settleOrbValue(gaze.current[i],gazeVelocity.current[i],gazeTarget.current[i],dt,time<pointerUntil?32:45);
      for (let i=0;i<2;i++) [bodyGaze.current[i],bodyVelocity.current[i]]=settleOrbValue(bodyGaze.current[i],bodyVelocity.current[i],gaze.current[i],dt,10);
      if (time>=blinkAt && !blinkStart){blinkStart=time;lastBlink=time;}
      let blink=0;
      if (blinkStart) {
        const elapsed=time-blinkStart;
        if (elapsed<210) blink=sampleOrbBlink(elapsed);
        else {
          blinkStart=0;
          if(doubleBlink){blinkAt=time+90;doubleBlink=false;}
          else {blinkAt=time+3200+Math.random()*2200;doubleBlink=Math.random()<.11;}
        }
      }
      paint(current.current,motionTime,blink*(1-current.current.sleep),true);
    };
    const sync = () => {
      stopFrame?.(); stopFrame=undefined;
      if (disposed) return;
      const paused=!animated||!visible||!focused||document.hidden||document.documentElement.hasAttribute('data-vg-background')||prefersReducedMotion();
      el.dataset.orbMotion=paused?'paused':'active';
      if (paused) { el.dataset.orbAttention='none';held.current=false;pressOrigin.current=null;cheerUntil.current=0;pointerUntil=0;attentionUntil=0;attentionKey=attentionRef.current?.key;roaming=[0,0];motionTime=0;motionStrength=0;lastEmotion=state.current;lastVisual=state.current;transition=undefined;transitionRemaining=0;snapshot(); }
      else { blinkStart=0;doubleBlink=false;blinkAt=performance.now()+2800+Math.random()*1000;stopFrame=subscribeSoulOrbFrame(tick); }
    };
    reset.current=()=>{ if(el.dataset.orbMotion==='paused'){lastEmotion=state.current;lastVisual=state.current;transition=undefined;transitionRemaining=0;snapshot();} };
    const intersection = new IntersectionObserver(entries=>{visible=entries[0]?.isIntersecting??false;sync();});
    intersection.observe(el);
    const background = new MutationObserver(sync);background.observe(document.documentElement,{attributes:true,attributeFilter:['data-vg-background']});
    const unsubscribe=subscribeReducedMotion(sync);
    const cancel=()=>{held.current=false;pressOrigin.current=null;releaseCompression.current=.03;cheerUntil.current=0;pointerUntil=0;pointerGaze=[0,0];gazeTarget.current=[0,0];};
    // Input events read current geometry, so scrolling or viewport movement
    // cannot leave a stale gaze origin. Frames never measure layout.
    const look=(event: PointerEvent)=>{
      if(!interactive||!event.isPrimary||el.dataset.orbMotion!=='active')return;
      const press=pressOrigin.current;
      if(press&&Math.hypot(event.clientX-press.x,event.clientY-press.y)>10){held.current=false;pressOrigin.current=null;}
      const box=el.getBoundingClientRect(), dx=event.clientX-box.x-box.width/2, dy=event.clientY-box.y-box.height/2;
      const near=Math.max(box.width,box.height)*.7, reach=Math.max(260,near*2);
      const gain=Math.max(0,1-Math.max(0,Math.hypot(dx,dy)-near)/reach)**2;
      pointerGaze=constrainOrbGaze(Math.max(-1,Math.min(1,dx/Math.max(1,box.width*.65)))*gain,Math.max(-1,Math.min(1,dy/Math.max(1,box.height*.65)))*gain);
      pointerUntil=gain>.01?performance.now()+4000:0;
      if(!pointerUntil){roaming=[0,0];gazeAt=performance.now()+1800;}
      else gazeAt=performance.now()+4000;
    };
    const leave=(event: PointerEvent)=>{if(!event.relatedTarget){pointerUntil=0;pointerGaze=[0,0];roaming=[0,0];gazeTarget.current=[0,0];}};
    const releasePress=(event:PointerEvent)=>{
      if(held.current)releaseCompression.current=Math.max(.015,poses[state.current].scaleY-current.current.scaleY);
      held.current=false;pressOrigin.current=null;
      if(event.pointerType==='touch'){pointerUntil=0;roaming=[0,0];}
    };
    reactToTouch.current=()=>{
      if(el.dataset.orbMotion!=='active')return;
      startOrbAccent(accent.current,'touch',releaseCompression.current);
      cheerUntil.current=performance.now()+750;releaseCompression.current=.03;
      if(state.current==='idle'||state.current==='curious'||state.current==='shy'){blinkAt=performance.now()+90;doubleBlink=false;}
    };
    const blur=()=>{focused=false;cancel();sync();};
    const focus=()=>{focused=true;sync();};
    document.addEventListener('visibilitychange',sync);window.addEventListener('blur',blur);window.addEventListener('focus',focus);window.addEventListener('resize',cancel);
    if(interactive){window.addEventListener('pointermove',look,{capture:true,passive:true});window.addEventListener('pointerout',leave);window.addEventListener('pointerup',releasePress,true);window.addEventListener('pointercancel',cancel,true);}
    snapshot();sync();
    return ()=>{disposed=true;stopFrame?.();intersection.disconnect();background.disconnect();unsubscribe();document.removeEventListener('visibilitychange',sync);window.removeEventListener('blur',blur);window.removeEventListener('focus',focus);window.removeEventListener('resize',cancel);window.removeEventListener('pointermove',look,true);window.removeEventListener('pointerout',leave);window.removeEventListener('pointerup',releasePress,true);window.removeEventListener('pointercancel',cancel,true);reset.current=()=>{};reactToTouch.current=()=>{};};
  },[animated,interactive,size]);
  useLayoutEffect(()=>{cheerUntil.current=0;held.current=false;reset.current();},[emotion]);
  const previousReaction = useRef(reaction);
  useLayoutEffect(()=>{if(previousReaction.current!==reaction){previousReaction.current=reaction;reactToTouch.current();}},[reaction]);
  const previousCue=useRef(cueId);
  useLayoutEffect(()=>{if(previousCue.current!==cueId){previousCue.current=cueId;if(cueId!=null&&root.current?.dataset.orbMotion==='active'&&(emotion==='success'||emotion==='error'))startOrbAccent(accent.current,emotion);}},[cueId,emotion]);
  return <span ref={root} data-soul-orb-host="" className={`vg-soul-orb ${className}`} style={{width:size,height:size,...colorStyle}} data-orb-emotion={emotion} data-orb-interactive={interactive?'true':undefined} aria-hidden="true"
    onPointerDown={interactive ? event=>{if(event.isPrimary&&event.button===0&&root.current?.dataset.orbMotion==='active'){held.current=true;releaseCompression.current=.03;accent.current.launched=true;accent.current.elapsed=Math.max(240,accent.current.elapsed);pressOrigin.current={x:event.clientX,y:event.clientY};}}:undefined}
    onPointerUp={interactive ? ()=>{held.current=false;pressOrigin.current=null;}:undefined}
    onPointerCancel={interactive ? ()=>{held.current=false;pressOrigin.current=null;cheerUntil.current=0;gazeTarget.current=[0,0];}:undefined}
    onPointerLeave={interactive ? ()=>{held.current=false;pressOrigin.current=null;}:undefined}>
    <svg viewBox="0 0 256 256" focusable="false">
      <defs>
        <radialGradient id={`${uid}-body`} cx="30%" cy="22%" r="95%"><stop stopColor="var(--orb-highlight)"/><stop offset=".44" stopColor="var(--orb-body)"/><stop offset="1" stopColor="var(--orb-depth)"/></radialGradient>
        <linearGradient id={`${uid}-rim`} x1="0" x2="1" y1="0" y2="1"><stop stopColor="var(--orb-highlight)" stopOpacity=".75"/><stop offset=".52" stopColor="var(--orb-body)" stopOpacity=".18"/><stop offset="1" stopColor="var(--orb-cyan)" stopOpacity=".85"/></linearGradient>
        <radialGradient id={`${uid}-light`} cx="90%" cy="80%" r="80%"><stop stopColor="var(--orb-cyan)" stopOpacity=".48"/><stop offset=".8" stopColor="var(--orb-cyan)" stopOpacity="0"/></radialGradient>
        <linearGradient id={`${uid}-arc`}><stop stopColor="var(--orb-cyan)" stopOpacity="0"/><stop offset=".55" stopColor="var(--orb-cyan)"/><stop offset="1" stopColor="var(--orb-highlight)" stopOpacity=".1"/></linearGradient>
      </defs>
      <ellipse ref={shadow} cx="128" cy="236" rx="53" ry="5" fill="var(--orb-shadow)"/>
      <g ref={rig}>
        <path d="M128 47C174 43 208 76 213 121C219 169 184 209 138 215C88 221 46 192 42 145C38 98 65 57 109 49C115 48 121 47 128 47Z" fill={`url(#${uid}-body)`} stroke={`url(#${uid}-rim)`} strokeWidth="1.4"/>
        <path d="M128 47C174 43 208 76 213 121C219 169 184 209 138 215C88 221 46 192 42 145C38 98 65 57 109 49C115 48 121 47 128 47Z" fill={`url(#${uid}-light)`}/>
        <path ref={sheen} d="M69 91C81 69 104 59 128 60" stroke="var(--orb-highlight)" strokeOpacity=".55" strokeWidth="3" strokeLinecap="round" fill="none"/>
        <path d="M178 184C194 172 202 154 201 138" stroke="var(--orb-cyan)" strokeOpacity=".45" strokeWidth="2" strokeLinecap="round" fill="none"/>
        <g ref={orbit} className="vg-orb-orbit" fill="none" stroke={`url(#${uid}-arc)`} strokeWidth="1.2"><path d="M35 144C26 174 80 195 140 185C193 176 233 148 222 121"/><circle ref={orbitDot} cx="221" cy="119" r="2.4" fill="var(--orb-cyan)" stroke="none"/></g>
        <g ref={waves} className="vg-orb-listening" fill="none" stroke="var(--orb-cyan)" strokeWidth="4" strokeLinecap="round"><path d="M37 105Q25 126 37 147M25 96Q8 126 25 156"/></g>
        <g ref={thoughts} className="vg-orb-thought" fill="var(--orb-cyan)"><circle cx="186" cy="68" r="4"/><circle cx="202" cy="53" r="6"/><circle cx="222" cy="35" r="10"/></g>
        <g ref={sleep} className="vg-orb-sleep" fill="none" stroke="var(--orb-face)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M201 74h12l-12 12h12M222 55h16l-16 16h16"/></g>
        <g ref={sparkles} className="vg-orb-sparkles" fill="var(--orb-cyan)"><path d="m210 47 3-10 3 10 10 3-10 3-3 10-3-10-10-3Z"/><path d="m57 67 2-6 2 6 6 2-6 2-2 6-2-6-6-2Z"/></g>
        <g ref={face} className="vg-orb-face" fill="var(--orb-face)">
          <path ref={left}/><path ref={right}/><path ref={mouth} className="vg-orb-mouth"/>
          <path ref={darkMouth} className="vg-orb-mouth-dark" fill="var(--orb-mouth)"/>
          <g ref={brows} className="vg-orb-brows" fill="none" stroke="var(--orb-face)" strokeWidth="3" strokeLinecap="round"><path/><path/></g>
          <g ref={cross} className="vg-orb-cross" fill="none" stroke="var(--orb-face)" strokeWidth="4" strokeLinecap="round"><path d="m99 115 14 14m0-14-14 14M143 115l14 14m0-14-14 14"/></g>
          <path ref={tear} className="vg-orb-tear" d="M95 137q-9 13 0 13t0-13Z" fill="var(--orb-cyan)"/>
          <g ref={blush} fill="var(--orb-blush)"><ellipse cx="91" cy="149" rx="9" ry="4"/><ellipse cx="165" cy="149" rx="9" ry="4"/></g>
        </g>
      </g>
    </svg>
    {fallbackLabel && <span className="vg-soul-orb-fallback">{SOUL_ORB_LABELS[emotion]}</span>}
  </span>;
}

type SoulOrbButtonProps = Omit<Props,'interactive'|'reaction'> & {
  label:string;
  disabled?:boolean;
  onActivate?:()=>void;
};

/** Accessible host: native keyboard activation, >=44px target, and movement
 * cancellation shared by the visual reaction and the host's business action. */
export function SoulOrbButton({label,disabled=false,onActivate,className='',...orb}: SoulOrbButtonProps) {
  const button=useRef<HTMLButtonElement>(null);
  const gesture=useRef<{id:number;x:number;y:number;blocked:boolean}|null>(null);
  const [reaction,setReaction]=useState(0);
  useLayoutEffect(()=>{
    const move=(event:PointerEvent)=>{
      const g=gesture.current;if(g?.id!==event.pointerId||g.blocked)return;
      if(Math.hypot(event.clientX-g.x,event.clientY-g.y)>10){g.blocked=true;return;}
      const r=button.current?.getBoundingClientRect();
      if(r&&(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom))g.blocked=true;
    };
    const up=(event:PointerEvent)=>move(event);
    const cancel=()=>{if(gesture.current)gesture.current.blocked=true;};
    const hidden=()=>{if(document.hidden)cancel();};
    window.addEventListener('pointermove',move,{capture:true,passive:true});window.addEventListener('pointerup',up,true);window.addEventListener('pointercancel',cancel,true);window.addEventListener('blur',cancel);document.addEventListener('visibilitychange',hidden);
    return ()=>{window.removeEventListener('pointermove',move,true);window.removeEventListener('pointerup',up,true);window.removeEventListener('pointercancel',cancel,true);window.removeEventListener('blur',cancel);document.removeEventListener('visibilitychange',hidden);gesture.current=null;};
  },[]);
  return <button ref={button} type="button" className={`vg-soul-orb-button ${className}`} aria-label={label} disabled={disabled} style={{width:orb.size??160,height:orb.size??160}}
    onPointerDown={event=>{if(event.isPrimary&&event.button===0&&!disabled)gesture.current={id:event.pointerId,x:event.clientX,y:event.clientY,blocked:false};}}
    onPointerLeave={event=>{if((event.buttons&1)&&gesture.current?.id===event.pointerId)gesture.current.blocked=true;}}
    onClickCapture={event=>{if(disabled||event.detail>0&&gesture.current?.blocked){gesture.current=null;event.preventDefault();event.stopPropagation();}}}
    onClick={()=>{gesture.current=null;setReaction(value=>value+1);onActivate?.();}}>
    <SoulOrb {...orb} interactive={!disabled} reaction={reaction}/>
  </button>;
}
