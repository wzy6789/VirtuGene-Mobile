import { useVoiceCallStore } from '../../store/voice-call-store';
import { useAuthStore } from '../../store/auth-store';
import type { OrbSignal } from '../orb-vitality';

/** Read-only presentation of capture and native acknowledged playback. */
export function callOrbSignal(userId: string, characterId: string, sessionId: string): OrbSignal | undefined {
  const call = useVoiceCallStore.getState(), view = call.view;
  if (useAuthStore.getState().userId !== userId || !call.busy || call.owner?.userId !== userId || call.owner.characterId !== characterId || call.owner.sessionId !== sessionId || !view) return;
  return {
    captureLevel: view.phase === 'listening' && view.inputMode !== 'text' && !view.muted && !view.inputModePending ? view.level : 0,
    // speakingText/playing is published only after confirmed native progress.
    playback: view.phase === 'playing' && !!view.speakingText && !view.inputModePending,
  };
}
