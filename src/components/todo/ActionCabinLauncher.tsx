import { SoulOrb, type SoulOrbEmotion } from '../ui/SoulOrb';
import { useAuthStore } from '../../store/auth-store';
import { useSecretaryIdentity } from '../secretary/useSecretaryIdentity';
import { openAssistantWorkspace } from '../../lib/secretary/navigation';
import { useRef } from 'react';

export function ActionCabinLauncher({ from = 'list', compact=false, emotion='idle' }: { from?: 'list' | 'chat'; compact?:boolean; emotion?:SoulOrbEmotion }) {
  const userId = useAuthStore(s => s.userId);
  const { character } = useSecretaryIdentity(userId);
  const name = character?.name ?? '聘用助理';
  const gesture=useRef<{x:number;y:number;blocked:boolean} | undefined>(undefined);
  if (!userId) return null;
  const key = `action-cabin:${userId}`;
  return <button type="button" className={`vg-cabin-launcher ${compact?'is-compact':''}`} aria-label={`查看${name}的今日安排`} title={name}
    onPointerDown={e=>{gesture.current={x:e.clientX,y:e.clientY,blocked:!e.isPrimary||e.button!==0};if(!gesture.current.blocked)e.currentTarget.setPointerCapture(e.pointerId);}}
    onPointerMove={e=>{if(gesture.current&&Math.hypot(e.clientX-gesture.current.x,e.clientY-gesture.current.y)>10)gesture.current.blocked=true;}}
    onPointerCancel={()=>{if(gesture.current)gesture.current.blocked=true;}}
    onClick={e => {
    if(e.detail!==0&&gesture.current?.blocked||useAuthStore.getState().userId!==userId)return;
    openAssistantWorkspace('today', from);
  }}><SoulOrb size={48} interactive emotion={emotion} soulKey={key} soulRole={from} />{!compact&&<><span><strong>{name}</strong><small>今日 · 对话 · 待处理</small></span><span aria-hidden="true">↗</span></>}</button>;
}
