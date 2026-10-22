import assert from 'node:assert/strict';
import { VoiceCallController, type CallView } from '../../src/lib/voice-call/controller';
import { CallApiError } from '../../src/lib/voice-call/mimo';
import type { NativeAudioEvent } from '../../src/lib/voice-call/native-audio';

const checks: { name: string; ok: boolean; error?: string }[] = [];
const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));
async function waitFor(test: () => boolean) { for (let i = 0; i < 100; i++) { if (test()) return; await tick(); } throw Error('Timed out'); }
const capabilities = { sampleRate: 16000 as const, echoCancellation: true, noiseSuppression: true,
  routes: [{ id: 2, type: 3, label: 'isolated headset', selected: true }], routeGeneration: 1 };
function fixture(id: string) {
  let event: (value: NativeAudioEvent) => void = () => {}, view: CallView | undefined;
  let resumes = 0, pauses = 0, interrupts = 0, starts = 0, requests = 0, syntheses = 0, muteValue = false;
  let releaseResume: (() => void) | undefined;
  const control: { holdResume?: boolean; error?: Error; source?: boolean; failResume?: boolean; parts?:string[] } = {};
  const controller = new VoiceCallController(id, { inputMode: 'text', voice: '茉莉', style: '保留角色语气',
    audio: {
      start: async callback => { starts++; event = callback; return capabilities; },
      beginPlayback: async () => {}, append: async () => ({ playedFrames: 2, writtenFrames: 2 }),
      drain: async () => ({ playedFrames: 2, writtenFrames: 2, complete: true }),
      interrupt: async () => { interrupts++; return { playedFrames: 0, writtenFrames: 0 }; },
      mute: async value => { muteValue = value; }, pause: async () => { pauses++; }, close: async () => {},
      resume: async () => { resumes++; if (control.holdResume) await new Promise<void>(resolve => { releaseResume = resolve; });
        if (control.failResume) throw Error('voice:audio_focus'); return capabilities; },
    }, context: async text => ({ messages: [{ role: 'user', content: text }],
      assertCurrent: async () => { if (control.source) throw Error('voice:source_withdrawn'); } }),
    api: { recognize: async () => { throw Error('No microphone test'); },
      dialogue: async (_messages, options) => { requests++; if (control.error) throw control.error; for(const part of control.parts??['我听着，你继续。'])await options.onText(part); },
      synthesize: async (_text, _voice, _style, options) => { syntheses++; await options.onPcm(new Uint8Array([0, 0, 0, 0])); },
    }, onView: value => { view = value; },
  });
  return { controller, control, get view() { return view; }, get resumes() { return resumes; }, get pauses() { return pauses; },
    get interrupts() { return interrupts; }, get starts() { return starts; }, get requests() { return requests; }, get syntheses() { return syntheses; },
    get muteValue() { return muteValue; }, release() { releaseResume?.(); },
    emit(type: NativeAudioEvent['type'], reason?: string) { event({ callId: id, type, reason, at: 1, routeGeneration: 1 }); },
  };
}
async function scenario(name: string, run: (f: ReturnType<typeof fixture>) => Promise<void>) {
  const f = fixture(name);
  try { await f.controller.start(); await run(f); checks.push({ name, ok: true }); }
  catch (error) { checks.push({ name, ok: false, error: String(error) }); }
  finally { f.release(); await f.controller.end(); }
}
async function main() {
  await scenario('raw split stage direction never reaches TTS or draft display',async f=>{
    f.control.parts=['（拍','桌）','不行。'];await f.controller.sendText('聊聊今天的事。');
    await waitFor(()=>f.view?.phase==='error'||f.syntheses>0);
    assert.equal(f.syntheses,0);assert.equal(f.view?.phase,'error');assert.equal(f.view?.generatedText,'');
  });
  await scenario('focus-gain resumes once without API calls', async f => {
    f.emit('paused', 'audio-focus'); f.emit('focusAvailable'); f.emit('focusAvailable');
    await waitFor(() => f.view?.phase === 'listening');
    assert.equal(f.resumes, 1); assert.equal(f.requests, 0); assert.equal(f.starts, 1);
  });
  await scenario('manual and system recovery share the same in-flight restore', async f => {
    f.control.holdResume = true; f.emit('paused', 'audio-focus'); f.emit('focusAvailable');
    await waitFor(() => f.resumes === 1);
    let completed = false; const manual = f.controller.resume().then(() => { completed = true; }); await tick();
    assert.equal(completed, false); f.release(); await manual; assert.equal(f.resumes, 1); assert.equal(f.view?.phase, 'listening');
  });
  await scenario('mute remains active after system focus recovery', async f => {
    await f.controller.mute(true); f.emit('paused', 'audio-focus'); f.emit('focusAvailable');
    await waitFor(() => f.view?.phase === 'listening'); assert.equal(f.muteValue, true); assert.equal(f.view?.muted, true);
  });
  await scenario('lost headset blocks later focus events until explicit recovery', async f => {
    f.emit('routeLost', 'headset-disconnected'); f.emit('paused', 'audio-focus'); f.emit('focusAvailable'); await tick(); await tick();
    assert.equal(f.resumes, 0); assert.equal(f.view?.phase, 'paused');
    await f.controller.resume(); assert.equal(f.resumes, 1);
  });
  await scenario('background pause cannot be reopened by focus gain alone', async f => {
    f.emit('paused', 'background-or-lock'); f.emit('paused', 'audio-focus'); f.emit('focusAvailable'); await tick(); await tick();
    assert.equal(f.resumes, 0); assert.equal(f.view?.phase, 'paused');
  });
  await scenario('user pause wins over a late focus recovery acknowledgement', async f => {
    f.control.holdResume = true; f.emit('paused', 'audio-focus'); f.emit('focusAvailable'); await waitFor(() => f.resumes === 1);
    await (f.controller as VoiceCallController & { pause(): Promise<void> }).pause(); f.release(); await tick(); await tick();
    assert.equal(f.view?.phase, 'paused'); assert.equal((f.view as any)?.pauseCause, 'user');
    f.emit('focusAvailable'); await tick(); assert.equal(f.resumes, 1); assert.ok(f.pauses >= 1);
  });
  await scenario('new route loss invalidates an in-flight automatic restore', async f => {
    f.control.holdResume = true; f.emit('paused', 'audio-focus'); f.emit('focusAvailable'); await waitFor(() => f.resumes === 1);
    f.emit('routeLost', 'headset-disconnected'); f.release(); await tick(); await tick();
    assert.equal(f.view?.phase, 'paused'); assert.equal((f.view as any)?.pauseCause, 'route'); assert.equal(f.requests, 0);
  });
  await scenario('failed automatic restore is not retried by repeated focus events', async f => {
    f.control.failResume = true; f.emit('paused', 'audio-focus'); f.emit('focusAvailable'); await waitFor(() => f.resumes === 1);
    await tick(); await tick(); f.emit('focusAvailable'); await tick(); assert.equal(f.resumes, 1);
    assert.equal(f.view?.phase, 'error');
  });
  await scenario('network failure retains healthy native audio and explicit resume never resends', async f => {
    f.control.error = new CallApiError('network', 'dialogue'); await f.controller.sendText('这次帮我想一下');
    await waitFor(() => f.view?.phase === 'error'); assert.equal(f.pauses, 0); assert.equal(f.requests, 1);
    assert.equal((f.view as any)?.pauseCause, 'network'); f.emit('focusAvailable'); await tick(); assert.equal(f.requests, 1);
    await f.controller.resume(); assert.equal(f.resumes, 0); assert.equal(f.view?.phase, 'listening'); assert.equal(f.requests, 1);
    f.control.error = undefined; await f.controller.sendText('这是新的一轮'); await waitFor(() => f.controller.getRecords().length === 2);
    assert.equal(f.requests, 2); assert.equal(f.controller.getRecords()[0].heardText, '');
  });
  await scenario('source revocation is terminal even after focus and manual resume', async f => {
    f.control.source = true; await f.controller.sendText('来源被撤回'); await waitFor(() => f.view?.phase === 'error');
    f.emit('paused', 'audio-focus'); f.emit('focusAvailable'); await f.controller.resume();
    assert.equal(f.resumes, 0); assert.equal(f.syntheses, 0); assert.equal(f.view?.error, 'voice:source_withdrawn'); assert.ok(f.pauses >= 1);
  });
  await scenario('unknown pauses never gain automatic microphone permission', async f => {
    f.emit('paused', 'legacy-unknown'); f.emit('focusAvailable'); await tick(); assert.equal(f.resumes, 0);
  });
  await scenario('hangup invalidates a pending restore', async f => {
    f.control.holdResume = true; f.emit('paused', 'audio-focus'); f.emit('focusAvailable'); await waitFor(() => f.resumes === 1);
    await f.controller.end(); f.release(); await tick(); f.emit('focusAvailable'); await tick();
    assert.equal(f.view?.phase, 'ended'); assert.equal(f.resumes, 1); assert.equal(f.requests, 0);
  });
  console.log(JSON.stringify({ complete: checks.every(check => check.ok), checks, apiCalls: 0, microphoneUsed: false, audioPlayed: false, deviceTested: false }));
  if (checks.some(check => !check.ok)) process.exitCode = 1;
}
void main();
