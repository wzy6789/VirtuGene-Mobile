import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useVoiceCallUIStore } from '../../store/voice-call-ui-store';
import { useVoiceCallStore } from '../../store/voice-call-store';
import { VoiceCallDialog } from './VoiceCallDialog';
import { SoulOrb } from '../ui/SoulOrb';
import { Icon } from '../ui/Icon';
import { useCallElapsed } from '../../lib/voice-call/use-call-elapsed';

export function VoiceCallHost() {
  const { target, minimized, restore, minimize, close } = useVoiceCallUIStore();
  const globalBusy = useVoiceCallStore(s => s.busy);
  const globalPhase = useVoiceCallStore(s => s.view?.phase);
  const owner = useVoiceCallStore(s => s.owner);
  const globalRecord = useVoiceCallStore(s => s.record);
  const owned = !!target && owner?.userId === target.userId && owner.characterId === target.character.id && owner.sessionId === target.sessionId;
  const busy = owned && globalBusy;
  const phase = owned ? globalPhase : undefined;
  const record = owned && globalRecord?.userId === target?.userId && globalRecord.characterId === target.character.id && globalRecord.sessionId === target.sessionId ? globalRecord : undefined;
  const ended = record?.status === 'ended';
  const elapsed = useCallElapsed(record?.startedAt, ended || phase === 'ended' ? record?.endedAt : undefined, busy, minimized);
  useEffect(() => {
    document.documentElement.toggleAttribute('data-vg-call-minimized', !!target && minimized);
    return () => document.documentElement.removeAttribute('data-vg-call-minimized');
  }, [target, minimized]);
  if (!target) return null;
  const paused = phase === 'paused' || phase === 'error';
  return <>
    <VoiceCallDialog {...target} visible={!minimized} onMinimize={minimize} onClose={close} />
    {minimized && createPortal(<button type="button" className="vg-voice-call-capsule" onClick={restore}
      aria-label={`返回与${target.character.name}的语音通话${paused ? '，已暂停' : ''}，通话时长 ${Math.floor(elapsed / 60)} 分 ${elapsed % 60} 秒`}>
      <SoulOrb size={36} emotion={paused ? 'idle' : phase === 'playing' ? 'happy' : 'listening'} animated={busy && !paused} />
      <span><span className="vg-voice-call-capsule-label"><Icon name="phone" size={14} />{paused ? '已暂停' : busy ? '语音通话' : ended || phase === 'ended' ? '通话记录' : '准备通话'}</span>
      <time aria-hidden="true">{String(Math.floor(elapsed / 60)).padStart(2, '0')}:{String(elapsed % 60).padStart(2, '0')}</time></span>
    </button>, document.body)}
  </>;
}
