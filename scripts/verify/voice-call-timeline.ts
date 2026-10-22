import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { VoiceCallController, type CallExchange, type CallView } from '../../src/lib/voice-call/controller';
import { recordCallTrace, type CallTrace } from '../../src/lib/voice-call/trace';

const before = process.argv.includes('--before');
let checks = 0;
const check = (value: unknown, label: string) => { assert.ok(value, label); checks++; };
const flush = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };
const rows: unknown[] = [];
async function main() {
for (let round = 0; round < 30; round++) {
  let now = 10, frames = 0, validations = 0, reviewValidations = 0;
  let view: CallView | undefined;
  const transmitted: unknown[] = [], calls = { dialogue: 0, tts: 0, asr: 0 };
  const controller = new VoiceCallController(`synthetic-${round}`, {
    inputMode: 'text', voice: '茉莉', style: '虚构测试', now: () => now,
    onView: value => { view = value; },
    context: async text => {
      now += 15;
      return { messages: [{ role: 'user' as const, content: text }],
        assertCurrent: async () => { validations++; now += 2; },
        reviewSpeech: async (text, observer) => { reviewValidations++; now += 2; observer?.(2); return text; } };
    },
    api: {
      recognize: async () => { calls.asr++; throw new Error('No audio recognition in typed fixture'); },
      dialogue: async (messages, options) => {
        calls.dialogue++; transmitted.push(messages); options.onRequest?.(); now += 80;
        await options.onText('我听见了。'); now += 30; await options.onText('我们慢慢聊。');
      },
      synthesize: async (text, _voice, _style, options) => {
        calls.tts++; transmitted.push(text); options.onRequest?.(); now += 60;
        for (let chunk = 0; chunk < 3; chunk++) { now += 10; await options.onPcm(new Uint8Array(480)); }
      },
    },
    audio: {
      start: async () => ({ sampleRate: 16000, routes: [], echoCancellation: false, noiseSuppression: false }),
      beginPlayback: async () => {},
      append: async (_turn, pcm) => { frames += pcm.length / 2; now += 5; return { playedFrames: frames, writtenFrames: frames }; },
      drain: async () => ({ playedFrames: frames, writtenFrames: frames, complete: true }),
      interrupt: async () => ({ playedFrames: frames, writtenFrames: frames }),
      mute: async () => {}, resume: async () => ({ routes: [] }), close: async () => {},
    },
  });
  await controller.start(); check(await controller.sendText('虚构问题'), 'typed input accepted');
  await flush();
  const row = controller.getRecords()[0] as CallExchange;
  check(view?.phase === 'listening' && row?.heardText === '我听见了。我们慢慢聊。', 'complete heard history');
  check(calls.asr === 0 && calls.dialogue === 1 && calls.tts === 2, 'no speculative requests');
  check(row.metrics.sourceCheckCount === validations + (before ? 0 : reviewValidations), 'all actual source-check entries counted including review');
  if (!before) {
    const trace = row.metrics.timeline!;
    check(trace.clock === 'js-monotonic' && trace.dropped === 0, 'clock domain and complete bounded trace');
    const stages = trace.events.map(event => event.stage);
    for (const stage of ['endpoint', 'context-start', 'context-end', 'source-check', 'llm-send', 'llm-first', 'review-start', 'review-end', 'speakable', 'tts-send', 'tts-first-pcm', 'append-start', 'append-end', 'render-progress', 'segment-drained']) {
      check(stages.includes(stage as typeof stages[number]), `${stage} recorded`);
    }
    check(stages.indexOf('append-end') < stages.indexOf('render-progress'), 'enqueuing is separate from software render receipt');
    check(stages.indexOf('source-check') < stages.indexOf('llm-send'), 'authorization remains before transmission');
    check(!JSON.stringify(trace).includes('虚构问题') && !JSON.stringify(trace).includes('我听见了'), 'no private words in trace');
    controller.getRecords()[0].metrics.timeline!.events[0].at = -999;
    check(controller.getRecords()[0].metrics.timeline!.events[0].at !== -999, 'returned evidence cannot mutate stored trace');
  }
  rows.push({ round, inputHash: createHash('sha256').update(JSON.stringify(transmitted)).digest('hex'),
    calls, validations, reviewValidations, softwareFirstPlaybackMs: row.metrics.firstPlaybackMs,
    sourceCheckCount: row.metrics.sourceCheckCount, timeline: row.metrics.timeline });
  await controller.end();
}
const bounded: CallTrace = { clock: 'js-monotonic', events: [], dropped: 0 };
for (let i = 0; i < 300; i++) recordCallTrace(bounded, { stage: 'source-check', at: i, ...({ secret: 'DO NOT LOG' } as object) });
check(bounded.events.length === 128 && bounded.dropped === 172, 'trace is bounded under many PCM packets');
check(!JSON.stringify(bounded).includes('DO NOT LOG'), 'explicit field projection');
recordCallTrace(bounded, { stage: 'stop-ack', at: 301 });
check(bounded.events[0].at === 0 && bounded.events.at(-1)?.stage === 'stop-ack', 'retain first stage and latest stop under pressure');
console.log(JSON.stringify({ mode: before ? 'before' : 'after', checks, rounds: 30, providerCalls: 0,
  microphone: false, physicalAudio: false, timing: 'synthetic-software-only', rows }));
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
