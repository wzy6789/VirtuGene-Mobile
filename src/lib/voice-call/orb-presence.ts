import type { CallPhase } from './lifecycle';
import type { SoulOrbEmotion } from '../../components/ui/SoulOrb';

/** The orb represents the audio lifecycle, never an invented character mood. */
export function callOrbPresence(view?: { phase: CallPhase; inputMode?: 'voice' | 'text'; inputModePending?: boolean; muted?: boolean }) {
  const phase = view?.phase;
  const labels: Record<CallPhase, string> = {
    initializing: '正在准备声音', connecting: '正在连接', listening: '正在听你说',
    recognizing: '正在听清', generating: '正在想回应', playing: '正在回应',
    interrupting: '正在停下', paused: '通话已暂停', error: '连接需要恢复', ended: '通话已结束',
  };
  const emotion: SoulOrbEmotion = view?.inputModePending ? 'working' : phase === 'error' ? 'error'
    : phase === 'generating' || phase === 'recognizing' ? 'thinking'
      : phase === 'playing' || phase === 'connecting' || phase === 'initializing' ? 'working'
        : phase === 'listening' && view?.inputMode !== 'text' && !view?.muted ? 'listening' : 'idle';
  const label = view?.inputModePending ? '正在切换输入方式' : phase === 'listening' && view?.inputMode === 'text' ? '等你发送文字'
    : phase === 'listening' && view?.muted ? '麦克风已静音' : phase ? labels[phase] : '准备通话';
  return { emotion, label, animated: emotion !== 'idle' && emotion !== 'error' };
}
