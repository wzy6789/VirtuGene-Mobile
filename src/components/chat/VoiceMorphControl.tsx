import { useEffect, useRef, useState } from 'react';
import { IS_CAPACITOR } from '../../lib/platform';
import { AudioRecorder } from '../../lib/recorder';
import { ensureRecordPermission, startSpeechRecognition, stopSpeechRecognition, cancelSpeechRecognition } from '../../lib/speech-recognition';
import { loadSecret } from '../../lib/api-key-storage';
import { transcribeWithSiliconFlow, CLOUD_ASR_KEY_NAME } from '../../lib/cloud-asr';
import type { VoicePayload } from './ChatInput';

type Phase = 'idle' | 'starting' | 'recording' | 'converting' | 'cancelling';
let nativeOwner: symbol | null = null;

/** One recorder, one pending operation. Late permission/ASR results cannot send. */
export function VoiceMorphControl({ disabled, onSend, onImage, onActiveChange, onNotice }: {
  disabled?: boolean; onSend?: (voice: VoicePayload) => void; onImage?: () => void;
  onActiveChange: (active: boolean) => void; onNotice: (message: string) => void;
}) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [level, setLevel] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [cancelHint, setCancelHint] = useState(false);
  const state = useRef<Phase>('idle');
  const generation = useRef(0);
  const recorder = useRef<AudioRecorder | null>(null);
  const mounted = useRef(true);
  const owner = useRef(Symbol('voice-composer'));
  const releaseOwner = () => { if (nativeOwner === owner.current) nativeOwner = null; };
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);
  const limit = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointer = useRef<{ id: number; y: number; held: boolean; cancel: boolean } | null>(null);
  const suppressClick = useRef(false);
  const callbacks = useRef({ onSend, onActiveChange, onNotice }); callbacks.current = { onSend, onActiveChange, onNotice };
  const change = (next: Phase) => {
    state.current = next; if (!mounted.current) return;
    setPhase(next); callbacks.current.onActiveChange(next === 'recording');
  };
  const clearTimers = () => { if (tick.current) clearInterval(tick.current); if (limit.current) clearTimeout(limit.current); if (hold.current) clearTimeout(hold.current); tick.current = limit.current = hold.current = null; };
  const cancel = () => {
    const was = state.current;
    generation.current++; clearTimers(); pointer.current = null;
    recorder.current?.cancel(); void cancelSpeechRecognition();
    // Do not start a new native recorder until the pending start/stop completes.
    change(was === 'starting' || was === 'converting' ? 'cancelling' : 'idle');
    if (was !== 'starting' && was !== 'converting') releaseOwner();
    if (mounted.current) { setLevel(0); setCancelHint(false); }
  };
  const finish = async () => {
    if (state.current === 'starting') { cancel(); return; }
    if (state.current !== 'recording') return;
    const r = recorder.current; const token = generation.current;
    clearTimers(); change('converting'); setLevel(0); setCancelHint(false);
    if (!r || r.elapsedMs < 700) { r?.cancel(); void cancelSpeechRecognition(); change('idle'); releaseOwner(); callbacks.current.onNotice('说话时间太短，再试一次'); return; }
    try {
      const [audio, speech] = await Promise.all([r.stop(), stopSpeechRecognition()]);
      if (token !== generation.current || !mounted.current) return;
      if (!audio) throw new Error('录音没有保存成功，请重试');
      let text = speech.trim();
      if (!text) {
        const key = await loadSecret(CLOUD_ASR_KEY_NAME);
        if (token !== generation.current || !mounted.current) return;
        if (key) text = (await transcribeWithSiliconFlow(audio.dataUrl, key)).trim();
      }
      if (token !== generation.current || !mounted.current) return;
      if (!text) { callbacks.current.onNotice('没听清。可在语音设置中配置识别服务后重试'); return; }
      callbacks.current.onSend?.({ dataUrl: audio.dataUrl, duration: audio.durationSec, text });
    } catch {
      if (mounted.current && token === generation.current) callbacks.current.onNotice('语音暂时未发送，请重试');
    } finally {
      releaseOwner();
      if (mounted.current) change('idle');
    }
  };
  const start = async () => {
    if (disabled || !onSend || state.current !== 'idle') return;
    if (!IS_CAPACITOR) { callbacks.current.onNotice('请在安装后的 App 中使用录音'); return; }
    if (nativeOwner && nativeOwner !== owner.current) { callbacks.current.onNotice('上一段录音正在收尾，请稍后再试'); return; }
    nativeOwner = owner.current;
    const token = ++generation.current;
    change('starting'); setLevel(0); setElapsed(0);
    try {
      const granted = await ensureRecordPermission();
      if (token !== generation.current || !mounted.current) return;
      if (!granted) { callbacks.current.onNotice('需要麦克风权限才能录音'); return; }
      const r = new AudioRecorder(); recorder.current = r;
      await r.start(lv => { if (mounted.current && token === generation.current) setLevel(lv); });
      if (token !== generation.current || !mounted.current) { r.cancel(); return; }
      change('recording');
      try { navigator.vibrate?.(12); } catch { /* Haptics are optional. */ }
      void startSpeechRecognition();
      tick.current = setInterval(() => { if (mounted.current) setElapsed(r.elapsedMs); }, 100);
      limit.current = setTimeout(() => void finish(), 60_000);
    } catch {
      recorder.current?.cancel(); void cancelSpeechRecognition();
      if (mounted.current && token === generation.current) callbacks.current.onNotice('麦克风暂时无法使用，请检查权限或是否正在通话');
    } finally {
      if (!['recording', 'converting'].includes(state.current)) releaseOwner();
      if (mounted.current && ['starting', 'cancelling'].includes(state.current)) change('idle');
    }
  };
  useEffect(() => {
    mounted.current = true;
    const hide = () => { if (document.hidden && state.current !== 'idle') cancel(); };
    document.addEventListener('visibilitychange', hide);
    return () => {
      const pending = state.current === 'starting' || state.current === 'converting';
      mounted.current = false; generation.current++; clearTimers(); recorder.current?.cancel(); void cancelSpeechRecognition(); state.current = 'idle';
      if (!pending) releaseOwner();
      document.removeEventListener('visibilitychange', hide);
    };
  }, []);
  useEffect(() => { if (disabled && state.current !== 'idle') cancel(); }, [disabled]);
  const recording = phase === 'recording';
  return <div className={`vg-voice-tools ${!onSend ? 'is-image-only' : ''} ${recording ? 'is-recording' : ''} ${cancelHint ? 'is-cancelling' : ''}`} data-no-page-swipe data-no-back-swipe>
    <button type="button" aria-label={recording || phase === 'starting' ? '取消录音' : '发送图片'} disabled={disabled || (!recording && phase !== 'starting' && (!onImage || phase !== 'idle'))}
      onClick={() => recording || phase === 'starting' ? cancel() : onImage?.()}>
      <svg className="vg-voice-plus" style={phase === 'starting' ? { transform: 'rotate(45deg)' } : undefined} aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
    </button>
    {recording && <div className="vg-voice-live" role="status" aria-live="off">
      <span className="vg-voice-wave" aria-label="录音音量">{[.45,.7,1,.8,.5,.85,.55].map((v,i) => <i key={i} style={{ height: `${3 + Math.min(1, Math.max(0, level)) * v * 21}px` }} />)}</span>
      <time>{`${String(Math.floor(elapsed / 60000)).padStart(2,'0')}:${String(Math.floor(elapsed / 1000) % 60).padStart(2,'0')}`}</time>
      <span>{cancelHint ? '松手取消' : pointer.current?.held ? '松手发送' : '点话筒发送'}</span>
    </div>}
    {onSend && <button type="button" aria-label={recording ? '停止并发送录音' : phase === 'idle' ? '长按录音，也可点击开始' : phase === 'converting' ? '语音识别中' : '准备录音'}
      disabled={disabled || phase === 'converting' || phase === 'cancelling'} style={{ touchAction: 'none' }}
      onContextMenu={e => e.preventDefault()}
      onPointerDown={e => {
        if (e.button !== 0 || state.current !== 'idle') return;
        suppressClick.current = false; pointer.current = { id: e.pointerId, y: e.clientY, held: false, cancel: false };
        e.currentTarget.setPointerCapture(e.pointerId);
        hold.current = setTimeout(() => { if (!pointer.current) return; pointer.current.held = true; suppressClick.current = true; void start(); }, 300);
      }}
      onPointerMove={e => { const p = pointer.current; if (!p || e.pointerId !== p.id) return; p.cancel = p.y - e.clientY > 64; setCancelHint(p.cancel); if (!p.held && Math.abs(p.y - e.clientY) > 12) { if (hold.current) clearTimeout(hold.current); suppressClick.current = true; } }}
      onPointerUp={e => {
        if (hold.current) clearTimeout(hold.current);
        const p = pointer.current; if (p && p.id === e.pointerId && p.held) { suppressClick.current = true; if (p.cancel) cancel(); else void finish(); }
        pointer.current = null; setCancelHint(false);
      }}
      onPointerCancel={() => { suppressClick.current = true; cancel(); }}
      onClick={() => { if (suppressClick.current) { suppressClick.current = false; return; } if (state.current === 'recording') void finish(); else void start(); }}>
      {phase === 'starting' || phase === 'converting' || phase === 'cancelling' ? <span className="w-4 h-4 rounded-full border-2 border-current border-t-transparent animate-spin" aria-hidden="true" /> : recording ?
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2" /></svg> :
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10v1a7 7 0 0 0 14 0v-1M12 18v4" /></svg>}
    </button>}
  </div>;
}
