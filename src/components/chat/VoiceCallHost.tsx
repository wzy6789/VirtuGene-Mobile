import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useVoiceCallUIStore, type VoiceCallTarget } from '../../store/voice-call-ui-store';
import { useVoiceCallStore } from '../../store/voice-call-store';
import { VoiceCallDialog } from './VoiceCallDialog';
import { VoiceCallControlIcon } from './VoiceCallControlIcon';
import { SoulOrb } from '../ui/SoulOrb';
import { Icon } from '../ui/Icon';
import { useCallElapsed } from '../../lib/voice-call/use-call-elapsed';
import { callOrbPresence } from '../../lib/voice-call/orb-presence';
import { callOrbSignal } from '../../lib/voice-call/orb-signal';
import { beginSoulHandoff, soulElement } from '../../lib/soul-handoff';
import { useAuthStore } from '../../store/auth-store';
import { useChatStore } from '../../store/chat-store';
import { useChatAtmosphere } from './useChatAtmosphere';
import type { OrbSignal } from '../../lib/orb-vitality';
import { holdOrbMotionRecovery } from '../../lib/soul-orb-motion';

export function VoiceCallHost() {
  const { target, minimized, restore, minimize, close } = useVoiceCallUIStore();
  const voiceKey=target?`${target.userId}:${target.character.id}:${target.sessionId}`:'';
  const returning = useRef<(() => void) | undefined>(undefined);
  useEffect(() => () => returning.current?.(), []);
  const handleClose = useCallback(() => {
    // A stale return event must never close a newer call or fly into another chat.
    if (!target || useVoiceCallUIStore.getState().target !== target) return;
    returning.current?.();
    const matchesChat = () => {
      const chat = useChatStore.getState();
      return useAuthStore.getState().userId === target.userId && chat.selectedCharacterId === target.character.id && chat.currentSessionId === target.sessionId;
    };
    const key = `role-orb:${target.character.id}`;
    const landing = matchesChat() && soulElement(key, 'chat');
    const source = soulElement(voiceKey, 'call');
    if (source && landing && landing.getClientRects().length && ![...document.querySelectorAll('.vg-modal-overlay')].some(overlay => !overlay.contains(source))) {
      const stop = beginSoulHandoff(key, source, 'chat');
      const finish = () => { stop(); unsubscribe(); clearTimeout(timer); if (returning.current === finish) returning.current = undefined; };
      const unsubscribe = useChatStore.subscribe(() => { if (!matchesChat()) finish(); });
      const timer = setTimeout(finish, 320);
      returning.current = finish;
    }
    // Navigation is immediate; the existing inert handoff is only decoration.
    close();
  }, [target, voiceKey, close]);
  const handleMinimize=useCallback(()=>{beginSoulHandoff(voiceKey,soulElement(voiceKey,'call'),'call-capsule');minimize();},[voiceKey,minimize]);
  const handleRestore=useCallback(()=>{beginSoulHandoff(voiceKey,soulElement(voiceKey,'call-capsule'),'call');restore();},[voiceKey,restore]);
  const signal=useCallback(()=>target?callOrbSignal(target.userId,target.character.id,target.sessionId):undefined,[target]);
  const globalBusy = useVoiceCallStore(s => s.busy);
  const globalPhase = useVoiceCallStore(s => s.view?.phase);
  const inputMode = useVoiceCallStore(s => s.view?.inputMode);
  const inputModePending = useVoiceCallStore(s => s.view?.inputModePending);
  const muted = useVoiceCallStore(s => s.view?.muted);
  const routeWait = useVoiceCallStore(s => s.view?.routeWait);
  const owner = useVoiceCallStore(s => s.owner);
  const globalRecord = useVoiceCallStore(s => s.record);
  const owned = !!target && owner?.userId === target.userId && owner.characterId === target.character.id && owner.sessionId === target.sessionId;
  const busy = owned && globalBusy;
  useLayoutEffect(() => busy ? holdOrbMotionRecovery() : undefined, [busy]);
  const phase = owned ? globalPhase : undefined;
  const record = owned && globalRecord?.userId === target?.userId && globalRecord.characterId === target.character.id && globalRecord.sessionId === target.sessionId ? globalRecord : undefined;
  const ended = record?.status === 'ended';
  const elapsed = useCallElapsed(record?.startedAt, ended || phase === 'ended' ? record?.endedAt : undefined, busy, minimized);
  useEffect(() => {
    document.documentElement.toggleAttribute('data-vg-call-minimized', !!target && minimized);
    return () => document.documentElement.removeAttribute('data-vg-call-minimized');
  }, [target, minimized]);
  if (!target) return null;
  const presence = callOrbPresence(phase ? { phase, inputMode, inputModePending, muted } : undefined);
  if (owned && routeWait) presence.label = routeWait.stage === 'cancelling' ? '正在取消设备切换' : '正在切换声音设备';
  return <>
    <VoiceCallDialog key={`${target.userId}:${target.character.id}:${target.sessionId}`} {...target} visible={!minimized} onMinimize={handleMinimize} onClose={handleClose} />
    {minimized && createPortal(<CallCapsule target={target} phase={phase} busy={busy} ended={ended} elapsed={elapsed} presence={presence} signal={signal} onRestore={handleRestore}/>, document.body)}
  </>;
}


/** Only a minimized call subscribes to this role's appearance, as the full view does. */
function CallCapsule({ target, phase, busy, ended, elapsed, presence, signal, onRestore }: {
  target: VoiceCallTarget; phase?: string; busy: boolean; ended: boolean; elapsed: number;
  presence: ReturnType<typeof callOrbPresence>; signal: () => OrbSignal | undefined; onRestore: () => void;
}) {
  const appearance = useChatAtmosphere(target.character, target.userId);
  const voiceKey = `${target.userId}:${target.character.id}:${target.sessionId}`;
  const end = () => {
    const current = useVoiceCallStore.getState();
    if (useAuthStore.getState().userId !== target.userId || useVoiceCallUIStore.getState().target !== target
      || !current.busy || current.owner?.userId !== target.userId || current.owner.characterId !== target.character.id || current.owner.sessionId !== target.sessionId) return;
    void current.end().catch(() => {
      if (useAuthStore.getState().userId === target.userId && useVoiceCallUIStore.getState().target === target) onRestore();
    });
  };
  return <div className="vg-voice-call-capsule vg-chat-atmosphere vg-light-paper" style={appearance.style} role="group" aria-label="应用内语音通话小窗">
    <button type="button" className="vg-voice-call-capsule-restore" onClick={onRestore}
      aria-label={`返回与${target.character.name}的语音通话，${presence.label}，通话时长 ${Math.floor(elapsed / 60)} 分 ${elapsed % 60} 秒`}>
      <SoulOrb size={36} colorOverride={appearance.config.roleVisual?.orbColor} motionOverride={appearance.config.roleVisual?.orbMotion} emotion={presence.emotion} animated={presence.animated} motionContext="voice" activity={signal} soulKey={voiceKey} soulRole="call-capsule"/>
      <span className="vg-voice-call-capsule-copy"><strong aria-hidden="true">{target.character.name}</strong><span className="vg-voice-call-capsule-row"><span className="vg-voice-call-capsule-label"><Icon name="phone" size={14} />{busy ? presence.label : ended || phase === 'ended' ? '通话记录' : '准备通话'}</span>
      <time aria-hidden="true">{String(Math.floor(elapsed / 60)).padStart(2, '0')}:{String(elapsed % 60).padStart(2, '0')}</time></span></span>
      <Icon name="chevron" size={16}/>
    </button>
    {busy && <button type="button" className="vg-voice-call-capsule-end" aria-label="结束小窗通话" onClick={end}><VoiceCallControlIcon kind="phone"/></button>}
  </div>;
}
