import { constrainOrbGaze, type OrbAttention } from './orb-motion-profiles';
export function resolveOrbAttention(pointer:readonly number[],pointerUntil:number,attention:OrbAttention|undefined,attentionUntil:number,roaming:readonly number[],now:number):[number,number] {
  if(now<pointerUntil)return constrainOrbGaze(pointer[0],pointer[1]);
  if(attention&&now<attentionUntil)return constrainOrbGaze(attention.point.x,attention.point.y);
  return constrainOrbGaze(roaming[0],roaming[1]);
}
