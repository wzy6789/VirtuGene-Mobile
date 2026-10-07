import { orbSpringCoefficients } from './soul-orb-motion';
import type { OrbPersonality } from './orb-personality';

export type OrbChannel = 'eyeWidth'|'eyeOpen'|'rightOpen'|'eyeCurve'|'eyeGap'|
  'mouthWidth'|'mouthCurve'|'mouthOpen'|'mouthDark'|'tilt'|'faceX'|'faceY'|
  'scaleX'|'scaleY'|'lift'|'blush'|'brow'|'browLift'|'browTilt'|'orbit'|
  'orbitDot'|'listening'|'thought'|'busy'|'sleep'|'tear'|'cross'|'sparkles';
export type OrbChannelGroup = 'eyes'|'mouth'|'face'|'body'|'attachment';
export const ORB_CHANNEL_GROUPS = {
  eyeWidth:'eyes',eyeOpen:'eyes',rightOpen:'eyes',eyeCurve:'eyes',brow:'eyes',browLift:'eyes',browTilt:'eyes',
  mouthWidth:'mouth',mouthCurve:'mouth',mouthOpen:'mouth',mouthDark:'mouth',
  eyeGap:'face',faceX:'face',faceY:'face',tilt:'body',scaleX:'body',scaleY:'body',lift:'body',
  blush:'attachment',orbit:'attachment',orbitDot:'attachment',listening:'attachment',thought:'attachment',
  busy:'attachment',sleep:'attachment',tear:'attachment',cross:'attachment',sparkles:'attachment',
} as const satisfies Record<OrbChannel,OrbChannelGroup>;
export const ORB_GROUP_FREQUENCIES = {eyes:26,mouth:20,face:22,body:14,attachment:18} as const;
export interface OrbTransitionProfile {
  duration:number;
  blink:boolean;
  frequencies:Record<OrbChannelGroup,number>;
}
const brighten:OrbTransitionProfile={duration:.32,blink:true,frequencies:{eyes:20,mouth:18,face:18,body:16,attachment:18}};
const soften:OrbTransitionProfile={duration:.32,blink:true,frequencies:{eyes:18,mouth:16,face:16,body:8,attachment:18}};
const heavy=(mood:OrbPersonality)=>mood==='sad'||mood==='sleepy'||mood==='error';
const bright=(mood:OrbPersonality)=>mood==='happy'||mood==='success'||mood==='surprised';
/** Only large emotional contrasts need choreography; live task/failure feedback
 * retains its usual response. No business state is queued behind an animation. */
export function resolveOrbTransition(from:OrbPersonality,to:OrbPersonality):OrbTransitionProfile|undefined {
  if(heavy(from)&&bright(to))return brighten;
  if(bright(from)&&(to==='sad'||to==='sleepy'))return soften;
  return undefined;
}
const groups=Object.keys(ORB_GROUP_FREQUENCIES) as OrbChannelGroup[];
export function orbPoseCoefficients(dt:number,mood:OrbPersonality,remaining=0,profile?:OrbTransitionProfile) {
  const result={} as Record<OrbChannelGroup,ReturnType<typeof orbSpringCoefficients>>;
  const blendTime=profile?Math.min(Math.max(0,remaining),Math.max(0,dt)):0;
  for(const group of groups){
    const base=group==='body'&&(mood==='sad'||mood==='sleepy')?8:ORB_GROUP_FREQUENCIES[group];
    if(!profile||blendTime===0){result[group]=orbSpringCoefficients(dt,base);continue;}
    const first=orbSpringCoefficients(blendTime,profile.frequencies[group]);
    if(blendTime===dt){result[group]=first;continue;}
    const second=orbSpringCoefficients(dt-blendTime,base);
    // Compose the two exact integrations when a frame crosses the 320ms edge.
    result[group]=[second[0]*first[0]+second[1]*first[2],second[0]*first[1]+second[1]*first[3],second[2]*first[0]+second[3]*first[2],second[2]*first[1]+second[3]*first[3]];
  }
  return result;
}

/** A local visual direction, never message/task content or a DOM reference. */
export interface OrbAttention {
  key:string;
  point:{x:number;y:number};
  expiresInMs?:number;
}
export function constrainOrbGaze(x:number,y:number):[number,number] {
  if(!Number.isFinite(x)||!Number.isFinite(y))return [0,0];
  const length=Math.hypot(x,y);
  return length>1?[x/length,y/length]:[x,y];
}

