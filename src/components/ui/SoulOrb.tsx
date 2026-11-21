import { useLayoutEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { useSettingsStore } from '../../store/settings-store';
import { useAuthStore } from '../../store/auth-store';
import { normalizeOrbSignal, orbInteractionEnergy, ORB_INTERACTION_MS, type OrbMotionContext, type OrbSignal } from '../../lib/orb-vitality';
import { ORB_COLORS, type OrbColor } from '../../lib/orb-colors';
import type { OrbMotionIntensity } from '../../lib/orb-vitality';
import { prefersReducedMotion, subscribeReducedMotion } from '../../lib/mobile-motion';
import { createOrbAccent, registerOrbTiming, sampleOrbBlink, settleOrbValue, startOrbAccent, stepOrbAccent, subscribeSoulOrbFrame, orbFrameBudgetMode, subscribeOrbFrameBudget } from '../../lib/soul-orb-motion';
import { ORB_CHANNEL_GROUPS, constrainOrbGaze, orbPoseCoefficients, resolveOrbTransition, type OrbAttention, type OrbChannel, type OrbTransitionProfile } from '../../lib/orb-motion-profiles';
import { resolveOrbAttention } from '../../lib/orb-attention';
import { createOrbPainter } from '../../lib/orb-render';
import { registerSoulElement, type SoulRole } from '../../lib/soul-handoff';
import voiceGlassShell from '../../assets/orb/voice-glass-shell.png';

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
const voicePoses = Object.fromEntries(SOUL_ORB_EMOTIONS.map(emotion => [emotion, {...poses[emotion], eyeWidth:9,eyeOpen:1.3,rightOpen:1,eyeCurve:0,eyeGap:24,mouthWidth:0,mouthOpen:0,mouthCurve:0,brow:0,listening:0,thought:0,busy:0,orbit:0,scaleX:1,scaleY:1,tilt:-10,lift:0,faceX:0,faceY:0,cross:0}])) as Record<SoulOrbEmotion,OrbPose>;
const zeroVelocity = (): OrbPose => Object.fromEntries(channels.map(key=>[key,0])) as unknown as OrbPose;

interface Props {
  colorOverride?: OrbColor;
  motionOverride?: OrbMotionIntensity;
  motionContext?: OrbMotionContext;
  /** Read actual audio receipts without subscribing React to capture frames. */
  activity?: () => OrbSignal | undefined;
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
export function SoulOrb({ emotion='idle', size=160, animated=true, interactive=false, className='', reaction=0, attention, cueId, soulKey, soulRole, fallbackLabel=true, motionContext='interaction', activity, colorOverride, motionOverride }: Props) {
  const glass = motionContext === 'voice';
  const bodyShape = glass ? 'M128 43A87 87 0 1 1 128 217A87 87 0 1 1 128 43Z' : 'M128 47C174 43 208 76 213 121C219 169 184 209 138 215C88 221 46 192 42 145C38 98 65 57 109 49C115 48 121 47 128 47Z';
  const userId=useAuthStore(s=>s.userId);
  const globalIntensity=useSettingsStore(s=>userId?s.orbMotionByUser?.[userId]??'gentle':'gentle');
  const intensity=motionOverride??globalIntensity;
  const motion=useRef({animated,intensity,context:motionContext,activity});motion.current={animated,intensity,context:motionContext,activity};
  const syncMotion=useRef<()=>void>(()=>{}), clock=useRef(0), pressFocus=useRef([0,0]);
  const colorId=useSettingsStore(s=>s.orbColor);
  const color=ORB_COLORS.find(color=>color.id===(colorOverride??colorId));
  const colorStyle:CSSProperties=color&&color.id!=='auto'?{'--orb-body':color.body,'--orb-highlight':color.highlight,'--orb-depth':color.depth,'--orb-cyan':color.rim} as CSSProperties:colorOverride==='auto'?{'--orb-body':'var(--chat-accent,#8069dd)','--orb-highlight':'var(--chat-light-panel,#d3c5ff)','--orb-cyan':'var(--chat-cyan,#7fe0db)'} as CSSProperties:{};
  const uid = useId().replace(/:/g,'');
  const root = useRef<HTMLSpanElement>(null), rig = useRef<SVGGElement>(null), face = useRef<SVGGElement>(null);
  const left = useRef<SVGPathElement>(null), right = useRef<SVGPathElement>(null), mouth = useRef<SVGPathElement>(null);
  const blush = useRef<SVGGElement>(null), orbit = useRef<SVGGElement>(null), shadow = useRef<SVGEllipseElement>(null);
  const darkMouth = useRef<SVGPathElement>(null), brows = useRef<SVGGElement>(null), orbitDot = useRef<SVGCircleElement>(null);
  const waves = useRef<SVGGElement>(null), thoughts = useRef<SVGGElement>(null), sleep = useRef<SVGGElement>(null);
  const tear = useRef<SVGPathElement>(null), cross = useRef<SVGGElement>(null), sparkles = useRef<SVGGElement>(null);
  const sheen = useRef<SVGPathElement>(null);
  const coreA=useRef<SVGEllipseElement>(null),coreB=useRef<SVGEllipseElement>(null),coreC=useRef<SVGEllipseElement>(null),focusLight=useRef<SVGEllipseElement>(null),ripple=useRef<SVGCircleElement>(null);
  const phase = useRef(Math.random()*Math.PI*2);
  const state = useRef(emotion); state.current = emotion;
  const current = useRef({... (glass ? voicePoses[emotion] : poses[emotion])}), velocity = useRef(zeroVelocity());
  const gaze = useRef([0,0]), gazeVelocity = useRef([0,0]), gazeTarget = useRef([0,0]);
  const bodyGaze = useRef([0,0]), bodyVelocity = useRef([0,0]);
  const accent=useRef(createOrbAccent());
  const interactionUntil=useRef(0);
  const attentionRef=useRef(attention);attentionRef.current=attention;
  const reactToTouch=useRef<()=>void>(()=>{});
  const releaseCompression=useRef(.03);
  const pressOrigin = useRef<{x:number;y:number}|null>(null);
  const held = useRef(false), cheerUntil = useRef(0), reset = useRef<()=>void>(()=>{});
  useLayoutEffect(()=>{if(root.current)return registerOrbTiming(root.current,clock,phase);},[]);
  useLayoutEffect(() => {
    if(root.current && soulKey && soulRole)return registerSoulElement(root.current,soulKey,soulRole);
  },[soulKey,soulRole]);

  useLayoutEffect(() => {
    const el = root.current; if (!el) return;
    let visible = true, focused = document.hasFocus(), disposed = false, stopFrame: (()=>void) | undefined;
    let blinkAt = performance.now()+2800+Math.random()*1200, blinkStart = 0, gazeAt = 0, doubleBlink = false, lastBlink=-Infinity;
    let motionStrength = 0, bodyFollowAt = 0;
    let lastEmotion=state.current, attentionKey=attentionRef.current?.key, attentionUntil=0, pointerUntil=0;
    let lastVisual=state.current,transition:OrbTransitionProfile|undefined,transitionRemaining=0;
    let pointerGaze:[number,number]=[0,0], roaming:[number,number]=[0,0];
    const render=createOrbPainter({rig,face,left,right,mouth,blush,orbit,shadow,darkMouth,brows,orbitDot,waves,thoughts,sleep,tear,cross,sparkles,sheen,coreA,coreB,coreC,focus:focusLight,ripple},size,phase.current);
    let quality = orbFrameBudgetMode();
    const paint=(p:OrbPose,time:number,blink=0,move=true)=>{
      const signal=move?motion.current.activity?.():undefined;
      const normalized=normalizeOrbSignal(signal);
      const audio=normalized.capture>0?'capture':normalized.playback?'playback':'none';
      if(el.dataset.orbAudio!==audio)el.dataset.orbAudio=audio;
      const energy=move?orbInteractionEnergy(interactionUntil.current-performance.now()):0;
      const intensity=quality==='gentle'?'gentle':motion.current.intensity;
      const context=motion.current.context==='reading'&&energy>0?'interaction':motion.current.context;
      // Scale the existing accent at small sizes, never the accessible button.
      const gain=motion.current.context==='reading'&&size<80?1+energy*(intensity==='lively'?3:1.8):1;
      const response=gain===1?accent.current:{...accent.current,
        lift:Math.max(-40,Math.min(40,accent.current.lift*gain*(accent.current.kind==='arrival'?2.4:1))),
        tilt:Math.max(-12,Math.min(12,accent.current.tilt*gain)),scale:accent.current.scale*Math.min(1.6,gain)};
      if(el.dataset.orbEnergy!==context)el.dataset.orbEnergy=context;
      render(p,time,blink,move,motionStrength,gaze.current,bodyGaze.current,response,state.current,held.current,el.dataset.orbAttention==='pointer'||el.dataset.orbAttention==='host',
        {intensity,context,signal,focus:pressFocus.current});
    };
    const snapshot = () => {
      current.current = {...(motion.current.context === 'voice' ? voicePoses[state.current] : poses[state.current] ?? poses.idle)}; velocity.current=zeroVelocity();
      gaze.current=[0,0]; gazeVelocity.current=[0,0];gazeTarget.current=[0,0];
      bodyGaze.current=[0,0]; bodyVelocity.current=[0,0];accent.current=createOrbAccent();interactionUntil.current=0;bodyFollowAt=0;
      paint(current.current,clock.current,0,false);
    };
    const tick = (dt: number, time: number) => {
      clock.current += dt*1000;
      motionStrength = Math.min(1, motionStrength+dt/0.45);
      if(lastEmotion!==state.current){
        lastEmotion=state.current;
        roaming=[0,0];
        if(lastEmotion==='sad'||lastEmotion==='sleepy')for(const key of channels)if(ORB_CHANNEL_GROUPS[key]==='body')velocity.current[key]=0;
        if(lastEmotion==='success'||lastEmotion==='error'||lastEmotion==='surprised'||lastEmotion==='happy'){
          startOrbAccent(accent.current,lastEmotion);
          if(lastEmotion==='error')interactionUntil.current=0;
          if(lastEmotion==='success')interactionUntil.current=time+ORB_INTERACTION_MS;
        }
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
      const target=motion.current.context === 'voice' ? voicePoses[visual] : poses[visual]??poses.idle;
      const coefficients=orbPoseCoefficients(dt,visual,transitionRemaining,transition);
      transitionRemaining=Math.max(0,transitionRemaining-dt);
      const compression=motion.current.intensity==='lively'?.045:.03;
      for (const key of channels) {
        const aim = key==='scaleY'&&held.current ? target[key]*(1-compression) : key==='scaleX'&&held.current ? target[key]*(1+compression*.7) : target[key];
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
      if(Math.hypot(nextGaze[0]-gazeTarget.current[0],nextGaze[1]-gazeTarget.current[1])>.3)bodyFollowAt=time+140;
      gazeTarget.current=nextGaze;
      for (let i=0;i<2;i++) [gaze.current[i],gazeVelocity.current[i]]=settleOrbValue(gaze.current[i],gazeVelocity.current[i],gazeTarget.current[i],dt,time<pointerUntil?32:45);
      if(time>=bodyFollowAt)for (let i=0;i<2;i++) [bodyGaze.current[i],bodyVelocity.current[i]]=settleOrbValue(bodyGaze.current[i],bodyVelocity.current[i],gaze.current[i],dt,10);
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
      paint(current.current,clock.current,blink*(1-current.current.sleep),true);
    };
    const sync = () => {
      if (disposed) return;
      const paused=!motion.current.animated||motion.current.intensity==='reduced'||!visible||!focused||document.hidden||document.documentElement.hasAttribute('data-vg-background')||prefersReducedMotion();
      if(!paused&&stopFrame&&el.dataset.orbBudget===quality)return;
      const resting = paused || quality === 'static';
      el.dataset.orbBudget=quality;
      el.dataset.orbMotion=resting?'paused':'active';
      if (resting) { el.dataset.orbAttention='none';held.current=false;pressOrigin.current=null;pressFocus.current=[0,0];cheerUntil.current=0;pointerUntil=0;attentionUntil=0;attentionKey=attentionRef.current?.key;roaming=[0,0];motionStrength=0;lastEmotion=state.current;lastVisual=state.current;transition=undefined;transitionRemaining=0;snapshot(); }
      if (paused) { stopFrame?.(); stopFrame=undefined; }
      else {
        blinkStart=0;doubleBlink=false;blinkAt=performance.now()+2800+Math.random()*1000;
        // During the one permitted recovery probe the shared clock observes raw
        // frames, while this SVG performs no continuous writes in static mode.
        if(!stopFrame)stopFrame=subscribeSoulOrbFrame((dt,time)=>{if(quality!=='static')tick(dt,time);});
      }
    };
    syncMotion.current=sync;
    reset.current=()=>{ if(el.dataset.orbMotion==='paused'){lastEmotion=state.current;lastVisual=state.current;transition=undefined;transitionRemaining=0;snapshot();} };
    const intersection = new IntersectionObserver(entries=>{visible=entries[0]?.isIntersecting??false;sync();});
    intersection.observe(el);
    const background = new MutationObserver(sync);background.observe(document.documentElement,{attributes:true,attributeFilter:['data-vg-background']});
    const unsubscribe=subscribeReducedMotion(sync);
    const unsubscribeBudget=subscribeOrbFrameBudget(()=>{quality=orbFrameBudgetMode();sync();});
    const cancel=()=>{held.current=false;pressOrigin.current=null;pressFocus.current=[0,0];releaseCompression.current=.03;cheerUntil.current=0;interactionUntil.current=0;bodyFollowAt=0;pointerUntil=0;pointerGaze=[0,0];gazeTarget.current=[0,0];};
    // Input events read current geometry, so scrolling or viewport movement
    // cannot leave a stale gaze origin. Frames never measure layout.
    const look=(event: PointerEvent)=>{
      if(!interactive||!event.isPrimary||el.dataset.orbMotion!=='active')return;
      const press=pressOrigin.current;
      if(press&&Math.hypot(event.clientX-press.x,event.clientY-press.y)>10){held.current=false;pressOrigin.current=null;}
      const box=el.getBoundingClientRect(), dx=event.clientX-box.x-box.width/2, dy=event.clientY-box.y-box.height/2;
      const near=Math.max(box.width,box.height)*.7, reach=Math.max(120,near*2);
      const gain=Math.max(0,1-Math.max(0,Math.hypot(dx,dy)-near)/reach)**2;
      pointerGaze=constrainOrbGaze(Math.max(-1,Math.min(1,dx/Math.max(1,box.width*.65)))*gain,Math.max(-1,Math.min(1,dy/Math.max(1,box.height*.65)))*gain);
      pointerUntil=gain>.01?performance.now()+1400:0;
      if(!pointerUntil){roaming=[0,0];gazeAt=performance.now()+1800;}
      else gazeAt=performance.now()+1400;
    };
    const leave=(event: PointerEvent)=>{if(!event.relatedTarget){pointerUntil=0;pointerGaze=[0,0];roaming=[0,0];gazeTarget.current=[0,0];}};
    const releasePress=(event:PointerEvent)=>{
      if(held.current)releaseCompression.current=Math.max(.015,poses[state.current].scaleY-current.current.scaleY);
      held.current=false;pressOrigin.current=null;
      if(event.pointerType==='touch'){pointerUntil=0;roaming=[0,0];pressFocus.current=[0,0];}
    };
    reactToTouch.current=()=>{
      if(el.dataset.orbMotion!=='active')return;
      startOrbAccent(accent.current,'touch',releaseCompression.current);
      interactionUntil.current=performance.now()+ORB_INTERACTION_MS;
      cheerUntil.current=performance.now()+750;releaseCompression.current=.03;
      if(state.current==='idle'||state.current==='curious'||state.current==='shy'){blinkAt=performance.now()+90;doubleBlink=false;}
    };
    const blur=()=>{focused=false;cancel();sync();};
    const focus=()=>{focused=true;sync();};
    document.addEventListener('visibilitychange',sync);window.addEventListener('blur',blur);window.addEventListener('focus',focus);window.addEventListener('resize',cancel);
    if(interactive){window.addEventListener('pointermove',look,{capture:true,passive:true});window.addEventListener('pointerout',leave);window.addEventListener('pointerup',releasePress,true);window.addEventListener('pointercancel',cancel,true);}
    snapshot();sync();
    return ()=>{disposed=true;stopFrame?.();intersection.disconnect();background.disconnect();unsubscribe();unsubscribeBudget();document.removeEventListener('visibilitychange',sync);window.removeEventListener('blur',blur);window.removeEventListener('focus',focus);window.removeEventListener('resize',cancel);window.removeEventListener('pointermove',look,true);window.removeEventListener('pointerout',leave);window.removeEventListener('pointerup',releasePress,true);window.removeEventListener('pointercancel',cancel,true);reset.current=()=>{};syncMotion.current=()=>{};reactToTouch.current=()=>{};};
  },[interactive,size]);
  useLayoutEffect(()=>{syncMotion.current();},[animated,intensity]);
  useLayoutEffect(()=>{cheerUntil.current=0;held.current=false;reset.current();},[emotion]);
  const previousReaction = useRef(reaction);
  useLayoutEffect(()=>{if(previousReaction.current!==reaction){previousReaction.current=reaction;reactToTouch.current();}},[reaction]);
  const previousCue=useRef(cueId);
  useLayoutEffect(()=>{if(previousCue.current!==cueId){previousCue.current=cueId;if(cueId!=null&&root.current?.dataset.orbMotion==='active'){
    if(emotion==='success'||emotion==='error')startOrbAccent(accent.current,emotion);
    else if(motionContext==='reading')startOrbAccent(accent.current,'arrival');
    if(emotion!=='error'&&motionContext==='reading')interactionUntil.current=performance.now()+ORB_INTERACTION_MS;
  }}},[cueId,emotion,motionContext]);
  return <span ref={root} data-soul-orb-host="" className={`vg-soul-orb ${className}`} style={{width:size,height:size,...colorStyle}} data-orb-emotion={emotion} data-orb-intensity={intensity} data-orb-context={motionContext} data-orb-interactive={interactive?'true':undefined} aria-hidden="true"
    onPointerDown={interactive ? event=>{if(event.isPrimary&&event.button===0&&root.current?.dataset.orbMotion==='active'){held.current=true;releaseCompression.current=.03;accent.current.launched=true;accent.current.elapsed=Math.max(240,accent.current.elapsed);pressOrigin.current={x:event.clientX,y:event.clientY};const box=event.currentTarget.getBoundingClientRect();pressFocus.current=constrainOrbGaze((event.clientX-box.x-box.width/2)/Math.max(1,box.width/2),(event.clientY-box.y-box.height/2)/Math.max(1,box.height/2));}}:undefined}
    onPointerUp={interactive ? ()=>{held.current=false;pressOrigin.current=null;}:undefined}
    onPointerCancel={interactive ? ()=>{held.current=false;pressOrigin.current=null;cheerUntil.current=0;gazeTarget.current=[0,0];}:undefined}
    onPointerLeave={interactive ? ()=>{held.current=false;pressOrigin.current=null;}:undefined}>
    <svg viewBox="0 0 256 256" focusable="false">
      <defs>
        <radialGradient id={`${uid}-body`} cx="26%" cy="18%" r="90%"><stop stopColor="var(--orb-material-highlight)" stopOpacity={glass ? .92 : 1}/><stop offset=".28" stopColor="var(--orb-material-body)" stopOpacity={glass ? .96 : 1}/><stop offset="1" stopColor="var(--orb-material-depth)" stopOpacity={glass ? .9 : 1}/></radialGradient>
        {glass && <><radialGradient id={`${uid}-glass`} cx="48%" cy="46%" r="53%"><stop offset=".64" stopColor="var(--orb-highlight)" stopOpacity="0"/><stop offset=".88" stopColor="var(--orb-highlight)" stopOpacity=".16"/><stop offset=".96" stopColor="var(--orb-highlight)" stopOpacity=".86"/><stop offset="1" stopColor="var(--orb-highlight)" stopOpacity=".2"/></radialGradient><linearGradient id={`${uid}-glass-arc`} x1="0" y1="0" x2="1" y2="1"><stop stopColor="var(--orb-highlight)" stopOpacity="0"/><stop offset=".3" stopColor="var(--orb-highlight)" stopOpacity=".95"/><stop offset=".75" stopColor="var(--orb-cyan)" stopOpacity=".8"/><stop offset="1" stopColor="var(--orb-highlight)" stopOpacity="0"/></linearGradient></>}
        <linearGradient id={`${uid}-rim`} x1="0" x2="1" y1="0" y2="1"><stop stopColor="var(--orb-material-highlight)" stopOpacity=".3"/><stop offset=".52" stopColor="var(--orb-material-body)" stopOpacity=".07"/><stop offset="1" stopColor="var(--orb-material-rim)" stopOpacity=".18"/></linearGradient>
        <radialGradient id={`${uid}-light`} cx="90%" cy="80%" r="80%"><stop stopColor="var(--orb-material-rim)" stopOpacity={glass ? .18 : .09}/><stop offset=".8" stopColor="var(--orb-material-rim)" stopOpacity="0"/></radialGradient>
        <linearGradient id={`${uid}-arc`}><stop stopColor="var(--orb-cyan)" stopOpacity="0"/><stop offset=".55" stopColor="var(--orb-cyan)"/><stop offset="1" stopColor="var(--orb-highlight)" stopOpacity=".1"/></linearGradient>
        <radialGradient id={`${uid}-core`}><stop stopColor="var(--orb-material-highlight)"/><stop offset="1" stopColor="var(--orb-material-highlight)" stopOpacity="0"/></radialGradient>
        <clipPath id={`${uid}-inside`}><path d={bodyShape}/></clipPath>
        {glass && <mask id={`${uid}-outside`}><rect width="256" height="256" fill="white"/><path d={bodyShape} fill="black"/></mask>}
      </defs>
      {glass && <g fill="var(--orb-cyan)" opacity=".55"><circle cx="24" cy="84" r="2.4"/><circle cx="17" cy="157" r="1.6"/><circle cx="36" cy="212" r="2"/><circle cx="220" cy="220" r="2.1"/><circle cx="240" cy="48" r="1.6"/><circle cx="237" cy="183" r="1.3"/></g>}
      <ellipse ref={shadow} cx="128" cy="236" rx="53" ry="5" fill={glass ? 'none' : 'var(--orb-shadow)'}/>
      <g ref={rig}>
        {glass && <g fill="none" stroke={`url(#${uid}-glass-arc)`}><path d="M19 148A109 30 0 0 1 237 148" transform="rotate(-15 128 148)" mask={`url(#${uid}-outside)`} strokeWidth="1.8"/></g>}
        <path d={bodyShape} fill={`url(#${uid}-body)`} stroke={`url(#${uid}-rim)`} strokeWidth="1.4"/>
        <path d={bodyShape} fill={`url(#${uid}-light)`}/>
        {glass && <image className="vg-orb-glass-shell" href={voiceGlassShell} x="22" y="24" width="212" height="212" opacity=".1" clipPath={`url(#${uid}-inside)`} preserveAspectRatio="xMidYMid meet"/>}
        <g clipPath={`url(#${uid}-inside)`} className="vg-orb-core">
          <ellipse ref={coreA} cx="119" cy="115" rx="70" ry="78" fill={`url(#${uid}-core)`}/>
          <ellipse ref={coreB} cx="161" cy="168" rx="66" ry="58" fill={`url(#${uid}-light)`}/>
          <ellipse ref={coreC} cx="88" cy="161" rx="59" ry="66" fill={`url(#${uid}-core)`}/>
          <ellipse ref={focusLight} cx="128" cy="125" rx="58" ry="54" opacity="0" fill={`url(#${uid}-core)`}/>
          <circle ref={ripple} cx="128" cy="132" r="78" fill="none" stroke="var(--orb-cyan)" strokeWidth="2" opacity="0"/>
        </g>
        {glass && <g className="vg-orb-glass" fill="none"><path d={bodyShape} fill={`url(#${uid}-glass)`} opacity=".28"/><path d="M237 148A109 30 0 0 1 19 148" transform="rotate(-15 128 148)" stroke={`url(#${uid}-glass-arc)`} strokeWidth="1.8"/><circle cx="233.3" cy="119.8" r="5" fill={`url(#${uid}-body)`} stroke="var(--orb-highlight)" strokeWidth="1.5"/></g>}
        <path ref={sheen} data-orb-sheen="" d={glass ? 'M69 91C81 69 104 59 128 60' : 'M72 86C85 70 101 63 116 61'} stroke="var(--orb-material-highlight)" strokeOpacity={glass ? .12 : .26} strokeWidth="2" strokeLinecap="round" fill="none"/>
        <path d="M178 184C194 172 202 154 201 138" stroke="var(--orb-material-rim)" strokeOpacity={glass ? .22 : .12} strokeWidth="2" strokeLinecap="round" fill="none"/>
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
