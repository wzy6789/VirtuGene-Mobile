import assert from 'node:assert/strict';
import { VoiceCallController, type CallView } from '../../src/lib/voice-call/controller';
async function main() {
  let requests = 0, syntheses = 0, checks = 0, view: CallView | undefined;
  const controller = new VoiceCallController('transmission-guard', { inputMode: 'text', voice: '茉莉', style: '', onView: value => { view = value; },
    audio: { start: async () => ({ sampleRate: 16000, echoCancellation: true, noiseSuppression: true, routes: [] }),
      beginPlayback: async () => {}, append: async () => ({ playedFrames: 1, writtenFrames: 1 }),
      drain: async () => ({ playedFrames: 1, writtenFrames: 1, complete: true }),
      interrupt: async () => ({ playedFrames: 0, writtenFrames: 0 }), mute: async () => {}, close: async () => {}, resume: async () => ({ routes: [] }) },
    context: async () => ({ messages: [{ role: 'system', content: '已经撤回的测试记忆' }], assertCurrent: async () => { checks++; throw Error('voice:context_changed'); } }),
    api: { recognize: async () => '', dialogue: async (_messages, options) => { requests++; await options.onText('不该发送的资料。'); }, synthesize: async () => { syntheses++; } } });
  await controller.start(); await controller.sendText('之前呢？');
  for (let n = 0; n < 100 && view?.phase !== 'error'; n++) await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(view?.error, 'voice:context_changed'); assert.equal(syntheses, 0);
  const result = { dialogueRequests: requests, synthesisRequests: syntheses, sourceChecks: checks,
    preventsRevokedTransmission: requests === 0, realApiCalls: 0, scope: 'actual controller with revoked prepared-context contract and simulated model/audio' };
  if (!process.argv.includes('--before')) assert.equal(requests, 0, 'revoked prepared evidence must never enter the reply model');
  await controller.end(); console.log(JSON.stringify(result));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
