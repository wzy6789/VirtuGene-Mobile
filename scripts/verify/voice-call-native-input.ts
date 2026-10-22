import assert from 'node:assert/strict';
import { NativeCallAudio, type NativeCallPlugin, type NativeAudioEvent, type AudioCapabilities } from '../../src/lib/voice-call/native-audio';
let checks = 0;
const check = (condition: unknown, description: string) => { assert.ok(condition, description); checks++; };
const capabilities: AudioCapabilities = { routes: [{ id: 1, label: '扬声器', selected: true }], sampleRate: 16000, echoCancellation: false, noiseSuppression: false };
function fixture(id: string) {
  const starts: Array<{ callId: string; captureEnabled?: boolean }> = [], switches: boolean[] = [], events: NativeAudioEvent[] = [];
  let listener!: (event: NativeAudioEvent) => void, stops = 0, removals = 0, appends = 0, resumes = 0, routes = 0;
  const plugin: NativeCallPlugin = {
    addListener: async (_type, callback) => { listener = callback; return { remove: async () => { removals++; } }; },
    start: async options => { starts.push(options); return capabilities; },
    setInputMode: async options => { switches.push(options.captureEnabled); },
    heartbeat: async () => {}, mute: async () => {}, pause: async () => {},
    resume: async () => { resumes++; return { routes: capabilities.routes }; },
    beginPlayback: async () => {}, appendPcm: async () => { appends++; return { playedFrames: 1, writtenFrames: 1 }; },
    drain: async () => ({ playedFrames: 1, writtenFrames: 1, complete: true }),
    stopPlayback: async () => ({ playedFrames: 0, writtenFrames: 0 }),
    stop: async () => { stops++; }, getRoutes: async () => ({ routes: capabilities.routes }),
    setRoute: async () => { routes++; return { routes: capabilities.routes }; }, requestBluetooth: async () => {},
  };
  const audio = new NativeCallAudio(id, plugin, 100);
  const emit = (type: NativeAudioEvent['type'], patch: Partial<NativeAudioEvent> = {}) => listener({ callId: id, type, at: 0, ...patch });
  // Clock diagnostics have their own bridge suite; these assertions count
  // microphone, playback and lifecycle events, including replay rejection.
  return { audio, plugin, starts, switches, events, emit, listen: (event: NativeAudioEvent) => { if (event.type !== 'clock') events.push(event); },
    stats: () => ({ stops, removals, appends, resumes, routes }) };
}
async function output(f: ReturnType<typeof fixture>, turn = 'typed-output') {
  const signal = new AbortController().signal;
  await f.audio.beginPlayback(turn, signal); await f.audio.append(turn, new Uint8Array([0, 0]), signal);
  f.emit('playback', { turnId: turn, playedFrames: 1, writtenFrames: 1 });
  return f.audio.drain(turn, signal);
}
async function main() {
  const ordinary = fixture('ordinary-default');
  try {
    await ordinary.audio.start(ordinary.listen);
    check(ordinary.starts[0].captureEnabled === true, 'unchanged startup defaults to voice capture');
    ordinary.emit('capture', { sequence: 1 }); ordinary.emit('interrupted');
    check(ordinary.events.length === 2 && ordinary.audio.clockSnapshot().status === 'unsupported', 'voice keeps microphone capture and native interruption events; old-native clock remains unsupported');
  } finally { await ordinary.audio.close(); }

  const typed = fixture('typed-start');
  try {
    await typed.audio.start(typed.listen, { inputMode: 'text' });
    check(typed.starts[0].captureEnabled === false, 'text explicitly requests output-only native start');
    typed.emit('capture', { sequence: 1 }); typed.emit('interrupted');
    check(typed.events.length === 0, 'text filters every microphone capture and speech interruption');
    check((await output(typed)).complete && typed.stats().appends === 1, 'text retains audible PCM append/drain output');
    check(typed.events[0].type === 'playback', 'text retains real playback receipts');
    typed.emit('routes', { routes: capabilities.routes });
    check(typed.events[1].type === 'routes', 'text retains native device route updates');
    await typed.audio.route(1);
    check(typed.stats().routes === 1 && typed.starts.length === 1, 'text route change does not restart the session');
    await typed.audio.pause(); await typed.audio.resume();
    check(typed.stats().resumes === 1 && typed.starts.length === 1, 'text pause/resume retains its existing output session');
    typed.emit('capture', { sequence: 2 }); typed.emit('interrupted');
    check(typed.events.every(event => !['capture', 'interrupted'].includes(event.type)), 'text stays text after route and resume');
  } finally { await typed.audio.close(); }
  check(typed.stats().stops === 1 && typed.stats().removals === 1, 'text hangup removes listener and closes native owner once');

  for (const mode of ['voice', 'text'] as const) {
    const recovery = fixture(`recover-${mode}`);
    try {
      await recovery.audio.start(recovery.listen, { inputMode: mode });
      recovery.plugin.resume = async () => { throw { message: 'voice:inactive' }; };
      await recovery.audio.pause(); await recovery.audio.resume();
      check(recovery.starts.length === 2 && recovery.starts[1].captureEnabled === (mode === 'voice'), `${mode} explicit dead-session recovery preserves input mode`);
      recovery.emit('capture', { sequence: 1 });
      check(recovery.events.some(event => event.type === 'capture') === (mode === 'voice'), `${mode} replacement listener keeps the correct capture authority`);
    } finally { await recovery.audio.close(); }
  }

  const switched = fixture('switch-both-ways');
  try {
    await switched.audio.start(switched.listen, { inputMode: 'text' });
    await switched.audio.setInputMode('voice'); switched.emit('capture', { sequence: 10 });
    check(switched.switches[0] === true && switched.events.length === 1, 'acknowledged voice switch admits new microphone samples');
    await switched.audio.setInputMode('text'); switched.emit('capture', { sequence: 11 }); switched.emit('interrupted');
    check(switched.switches[1] === false && switched.events.length === 1, 'acknowledged text switch rejects delayed microphone events');
    await switched.audio.setInputMode('text');
    check(switched.switches.length === 2 && switched.starts.length === 1, 'same-mode requests are no-ops and switches retain session ownership');
    check((await output(switched)).complete, 'voice to text keeps the output path available');
  } finally { await switched.audio.close(); }

  for (const failure of ['voice:microphone_denied', 'voice:input_unavailable', 'voice:microphone_busy', 'voice:capture_failed']) {
    const denied = fixture(`denied-${failure}`);
    try {
      await denied.audio.start(denied.listen, { inputMode: 'text' });
      denied.plugin.setInputMode = async () => { throw { message: failure }; };
      await assert.rejects(denied.audio.setInputMode('voice'), (error: any) => error.message === failure); checks++;
      denied.emit('capture', { sequence: 1 }); denied.emit('interrupted');
      check(denied.events.length === 0 && denied.starts.length === 1, `${failure}: failed voice request retains original text mode without restart`);
      check((await output(denied)).complete, `${failure}: old text output remains available`);
    } finally { await denied.audio.close(); }
  }

  for (const action of ['close', 'background'] as const) {
    const pending = fixture(`permission-pending-${action}`); let release!: () => void, rejectNative!: (error: Error) => void;
    try {
      await pending.audio.start(pending.listen, { inputMode: 'text' });
      pending.plugin.setInputMode = async () => new Promise<void>((resolve, reject) => { release = resolve; rejectNative = reject; });
      const switchRequest = pending.audio.setInputMode('voice');
      const switchRejected = assert.rejects(switchRequest, (error: any) => error.name === 'AbortError');
      pending.emit('capture', { sequence: 1 }); pending.emit('interrupted');
      check(pending.events.length === 0, `${action}: pending permission cannot admit unconfirmed capture`);
      await assert.rejects(pending.audio.setInputMode('voice'), /voice:input_busy/); checks++;
      if (action === 'close') {
        await pending.audio.close();
        await pending.audio.start(pending.listen, { inputMode: 'text' });
      } else {
        pending.emit('paused', { reason: 'background-or-lock' });
        rejectNative(new DOMException('Cancelled before native commit', 'AbortError'));
      }
      if (action === 'close') release(); await switchRejected; checks++;
      if (action === 'background') {
        await assert.rejects(pending.audio.setInputMode('voice'), /voice:input_unavailable/); checks++;
        await pending.audio.resume();
      }
      pending.emit('capture', { sequence: 2 }); pending.emit('interrupted');
      check(!pending.events.some(event => event.type === 'capture' || event.type === 'interrupted'), `${action}: late permission success never changes text capture authority`);
      check((await output(pending)).complete, `${action}: explicit current-session output remains available`);
    } finally { release?.(); await pending.audio.close(); }
  }

  const acknowledgedPause = fixture('ack-committed-before-pause'); let acknowledge!: () => void;
  try {
    await acknowledgedPause.audio.start(acknowledgedPause.listen, { inputMode: 'text' });
    acknowledgedPause.plugin.setInputMode = async () => new Promise<void>(resolve => { acknowledge = resolve; });
    const mode = acknowledgedPause.audio.setInputMode('voice');
    acknowledgedPause.emit('paused', { reason: 'background-after-mode-commit' }); acknowledge(); await mode;
    await assert.rejects(acknowledgedPause.audio.beginPlayback('no-auto-resume', new AbortController().signal), (error: any) => error.name === 'AbortError'); checks++;
    check(acknowledgedPause.stats().resumes === 0, 'native committed mode acknowledgement does not implicitly resume a paused session');
    await acknowledgedPause.audio.resume(); acknowledgedPause.emit('capture', { sequence: 1 });
    check(acknowledgedPause.events.some(event => event.type === 'capture'), 'pause-before-JS-ack preserves the committed voice mode for explicit recovery');
    acknowledgedPause.plugin.resume = async () => { throw new Error('voice:inactive'); };
    await acknowledgedPause.audio.pause(); await acknowledgedPause.audio.resume();
    check(acknowledgedPause.starts.at(-1)?.captureEnabled === true, 'later native restart also preserves the acknowledged voice mode after the pause race');
  } finally { acknowledge?.(); await acknowledgedPause.audio.close(); }

  const missing = fixture('missing-switch');
  try {
    await missing.audio.start(missing.listen, { inputMode: 'text' }); missing.plugin.setInputMode = undefined;
    await assert.rejects(missing.audio.setInputMode('voice'), /voice:input_unavailable/); checks++;
    check((await output(missing)).complete, 'old native plugin without setter keeps old mode and functioning output');
    await assert.rejects(missing.audio.setInputMode('invalid' as any), /voice:invalid_input_mode/); checks++;
  } finally { await missing.audio.close(); }
  console.log(JSON.stringify({ checks, mode: 'native-js-bridge-input-fixtures', realApiCalls: 0, modelTokens: 0, deviceTested: false, androidRuntimeExecuted: false }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
