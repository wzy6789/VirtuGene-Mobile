import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { SpokenSentenceBuffer, UtteranceGate } from '../../src/lib/voice-call/utterance';
const baseline = process.argv.includes('--baseline');
let checks = 0;
function check(value: unknown, label: string) { assert.ok(value, label); checks++; }
function collect(text: string, step: number, flush = true) {
  const speech = new SpokenSentenceBuffer(); const parts: string[] = []; let firstAt: number | null = null;
  for (let i = 0; i < text.length; i += step) {
    const ready = speech.push(text.slice(i, i + step));
    if (ready.length && firstAt === null) firstAt = Math.min(i + step, text.length);
    parts.push(...ready);
  }
  if (flush) parts.push(...speech.push('', true));
  return { parts, firstAt };
}
const unpunctuated = '你问的这个问题可以从三个方面来看首先我们先看看具体原因然后再一起安排下一步';
const segmentation: unknown[] = [];
for (const step of [1, 2, 3, 7, 1000]) {
  const row = collect(unpunctuated, step, false);
  segmentation.push({ step, ...row });
  if (!baseline) {
    check(row.parts[0] === '你问的这个问题可以从三个方面来看', 'complete unpunctuated clause becomes speakable before stream completion');
    check(step === 1000 || row.firstAt! < 40, 'first unpunctuated phrase does not wait for 100 characters');
  }
}
for (const text of [
  '这个要求我确实可以帮你完成但不能保证每一个环节都会成功',
  '这个要求我确实可以帮你完成 接下来不能保证每一个环节都会成功',
  '这个要求我确实可以帮你完成接下来我们不能保证每一个环节都会成功',
  '这个要求我们一定能够完成接下来你可能不想继续也没关系',
  '这个要求我确实可以帮你完成 不过我不能替你承诺最终结果',
  '这个要求我确实可以帮你完成，接下来我们先不能保证每一个环节都会成功',
  'I can definitely help you not repeat this mistake',
  '我会先核对一下相关细节然后不能保证结果符合你的预期',
]) {
  const row = collect(text, 1, false);
  if (!baseline) check(row.parts.length === 0, `qualification and negation do not leave an affirmative prefix playing alone: ${text}`);
}
for (const text of [
  '实际读数是1234567890.1234567890不是一个整数',
  '请打开https://example.com/verylongpathname?redirect=https://other.example.com/a?q=12.34然后查看说明',
  '请在今天晚上20:30之前查看工单编号12,345的状态',
  '这是一个没有明确完整谓语边界的长句为了避免把后面的限定条件和前面的承诺分离我们宁可等到最终输出再一起播放',
]) {
  const row = collect(text, 1);
  if (!baseline) check(row.parts.join('') === text && row.parts.length === 1, 'numbers URLs and unresolved semantics remain intact');
}
const word = 'pneumonoultramicroscopicsilicovolcanoconiosis'.repeat(5);
const url = 'https://example.test/' + 'x'.repeat(180) + '?amount=123.45';
for (const text of [word, url, '😀'.repeat(70), '👩🏽‍💻'.repeat(30)]) {
  for (const step of [1, 2, 5]) {
    const row = collect(text, step);
    if (!baseline) {
      check(row.parts.length === 1 && row.parts[0] === text, 'a long token or emoji sequence never crosses an arbitrary 100-unit cut');
      check(row.parts.every(part => !/[\uD800-\uDBFF]$/.test(part) && !/^[\uDC00-\uDFFF]/.test(part)), 'split stream surrogate pairs remain complete');
    }
  }
}
const visible = '你好。今天的读数是12.34。你可以打开https://example.test/a?q=1.2查看。';
const tagged = '（轻声[隐藏]）<analysis><style>不读</style>不能读。</analysis>**微笑**' + visible;
for (const step of [1, 2, 7, 1000]) {
  const row = collect(tagged, step);
  check(row.parts.join('') === visible, 'all hidden instructions stay filtered across arbitrary transport fragments');
}
if (!baseline) {
  for (const text of ['这个问题最重要的原因现在已经说清楚了另外我们再看看有哪些实际做法', '这次的相关安排和资料都已经准备好了首先我们先核对一下时间是否合适', '当前这几个环节的具体情况大家都了解了然后我们一起检查遗漏的地方']) {
    check(collect(text, 1, false).parts.length > 0, 'generic complete predicate and explicit next-clause boundary does not require a canned acknowledgement');
  }
  check(collect('I understand your concern. We can review it together.', 1).parts[0] === 'I understand your concern.', 'English full stop provides a complete early sentence');
  check(collect('Please ask Dr. Smith about version 12.34 before continuing.', 1).parts[0] === 'Please ask Dr. Smith about version 12.34 before continuing.', 'abbreviation and decimal are not sentence ends');
  assert.throws(() => collect('x'.repeat(1025), 1), /voice:speech_boundary_limit/); checks++;
  assert.throws(() => collect('\uD83Dx', 1), /voice:invalid_speech_unicode/); checks++;
  const unmatched = new SpokenSentenceBuffer(); unmatched.push('\uD83D');
  assert.throws(() => unmatched.push('', true), /voice:invalid_speech_unicode/); checks++;
  check(collect('x'.repeat(1024), 1).parts[0].length === 1024, 'one bounded unsplittable token may be finalized intact');
  check(collect('我请你核对antidisestablishmentarianism以及https://example.test/a?q=3.14的详细说明', 1).parts.length === 1, 'mixed CJK English decimal URL tokens stay intact');
  const reset = new SpokenSentenceBuffer(); reset.push('旧的无标点'); reset.reset();
  check(reset.push('新的一句。').join('') === '新的一句。', 'reset discards all pending syntax and Unicode state');
}

// Frame-only endpoint comparison: no transcript/semantic access is given to any strategy.
// These candidates are experiments; they do not replace the production 700ms gate.
type Frame = { rms: number; ms: number; at: number; room: boolean; speech: boolean };
const frameRun = (rms: number, duration: number, at: number, room = true): Frame[] => Array.from({ length: duration / 20 }, (_, n) => ({ rms, ms: 20, at: at + (n + 1) * 20, room, speech: rms > 0.018 }));
type Stratum = { name: string; frames: Frame[]; lastSpeech: number; expectedTurns: number; expectedMinEnd: number; expectedLegacyFalseEnds?: number; semanticFalseTurns?: number; gapProbe?: { at: number; lastActualFrame: number } };
function fixture(name: string, round: number): Stratum {
  const jitter = (round % 5) * 20; const strong = 0.06 + (round % 3) * 0.002;
  if (name === 'silence-and-noise') return { name, frames: frameRun(0.004 + (round % 3) * 0.002, 3000, 0), lastSpeech: 0, expectedTurns: 0, expectedMinEnd: 0 };
  if (name === 'below-energy-threshold') return { name, frames: [...frameRun(0.015, 600, 0), ...frameRun(0.004, 1000, 600)], lastSpeech: 600, expectedTurns: 0, expectedMinEnd: 0 };
  if (name === 'short-noise-burst') return { name, frames: [...frameRun(strong, 80, 0), ...frameRun(0.004, 1000, 80)], lastSpeech: 80, expectedTurns: 0, expectedMinEnd: 0 };
  if (name === 'background-tv-energy') return { name, frames: [...frameRun(strong, 600, 0), ...frameRun(0.004, 1000, 600)], lastSpeech: 600, expectedTurns: 1, expectedMinEnd: 600, semanticFalseTurns: 1 };
  if (name === 'quiet-answer' || name === 'short-answer' || name === 'steady-noise') {
    const rms = name === 'quiet-answer' ? 0.020 + (round % 3) * 0.001 : strong;
    const prefix = name === 'steady-noise' ? frameRun(0.012, 2000, 0) : [];
    const start = prefix.length * 20; const spoken = 300 + jitter;
    return { name, frames: [...prefix, ...frameRun(rms, spoken, start), ...frameRun(0.006, 1000, start + spoken)], lastSpeech: start + spoken, expectedTurns: 1, expectedMinEnd: start + spoken };
  }
  if (name === 'thirty-second-speech') return { name, frames: [...frameRun(strong, 30600, 0), ...frameRun(0.004, 1000, 30600)], lastSpeech: 30600, expectedTurns: 1, expectedMinEnd: 30600 };
  if (name === 'missing-callbacks') {
    const gap = 2000 + jitter;
    return { name, frames: [...frameRun(strong, 400, 0), ...frameRun(strong, 200, 400 + gap), ...frameRun(0.004, 1000, 600 + gap)], lastSpeech: 600 + gap, expectedTurns: 1, expectedMinEnd: 600 + gap, gapProbe: { at: 400 + gap, lastActualFrame: 400 } };
  }
  const pause = name === 'long-hesitation-beyond-700' ? 760 + jitter : name === 'brief-hesitation' ? 520 + jitter : 600 + jitter;
  const room = name !== 'slow-asr-no-room'; const first = 400;
  return { name, frames: [...frameRun(strong, first, 0), ...frameRun(0.004, pause, first, room), ...frameRun(strong, 300, first + pause, room), ...frameRun(0.004, 1000, first + pause + 300, room)], lastSpeech: first + pause + 300, expectedTurns: name === 'long-hesitation-beyond-700' ? 2 : 1, expectedMinEnd: first + pause + 300, expectedLegacyFalseEnds: name === 'long-hesitation-beyond-700' ? 1 : 0 };
}
const strata = ['short-answer', 'quiet-answer', 'steady-noise', 'silence-and-noise', 'below-energy-threshold', 'short-noise-burst', 'background-tv-energy', 'brief-hesitation', 'digits-address-pause', 'proper-name-pause', 'bluetooth-gated-pause', 'slow-asr-no-room', 'long-hesitation-beyond-700', 'thirty-second-speech', 'missing-callbacks'];
const rows: any[] = [];
for (const name of strata) for (let round = 0; round < 30; round++) {
  const sample = fixture(name, round);
  for (const policy of ['fixed-700', 'fixed-400', 'adaptive-energy'] as const) {
    const fixed = new UtteranceGate(policy === 'fixed-400' ? 400 : 700);
    let totalVoiced = 0;
    const events: { event: string; at: number }[] = [];
    for (const frame of sample.frames) {
      // Test-only threshold injection isolates one factor in the actual gate. The
      // production API/default is deliberately unchanged by this experiment.
      if (policy === 'adaptive-energy') Object.assign(fixed, { silenceMs: totalVoiced >= 300 && frame.rms < 0.01 ? 400 : 700 });
      const event = fixed.push(frame.rms, frame.ms, frame.room);
      if (event !== 'none') events.push({ event, at: frame.at });
      if (fixed.isSpeech(frame.rms)) totalVoiced += frame.ms;
      if (event === 'end' || event === 'discard') totalVoiced = 0;
    }
    const ends = events.filter(e => e.event === 'end');
    const falseEnds = ends.filter(e => e.at < sample.expectedMinEnd).length;
    const row = { stratum: name, round, policy, ends: ends.length, falseEnds, endpointDelayMs: ends.length ? ends.at(-1)!.at - sample.lastSpeech : null,
      recognize: events.filter(e => e.event === 'recognize').length, forcedSegments: events.filter(e => e.event === 'segment').length, semanticFalseTurns: sample.semanticFalseTurns ?? 0 };
    rows.push(row);
    if (policy === 'fixed-700') {
      check(falseEnds === (sample.expectedLegacyFalseEnds ?? 0) && ends.length === sample.expectedTurns, `production gate has recorded ${name} turn count and known limitations`);
      check(row.recognize <= 2, 'early ASR opportunities stay bounded');
      if (name === 'slow-asr-no-room') check(row.recognize === 0, 'full ASR queue admits no extra early work');
      if (name === 'thirty-second-speech') check(row.forcedSegments === 1, '30s forced PCM boundary preserves same logical turn');
      if (name === 'missing-callbacks') check(events.every(e => !(e.at > sample.gapProbe!.lastActualFrame && e.at <= sample.gapProbe!.at)), 'absent callbacks never advance acoustic silence');
    }
  }
}
const endpoint = strata.flatMap(stratum => ['fixed-700', 'fixed-400', 'adaptive-energy'].map(policy => {
  const group = rows.filter(row => row.stratum === stratum && row.policy === policy);
  const delays = group.map(row => row.endpointDelayMs).filter((v): v is number => v !== null).sort((a, b) => a - b);
  return { stratum, policy, rounds: group.length, falseEnds: group.reduce((n, row) => n + row.falseEnds, 0), endpointP50Ms: delays.length ? delays[Math.floor(delays.length * .5)] : null,
    endpointP95Ms: delays.length ? delays[Math.floor(delays.length * .95)] : null, earlyAsrMax: Math.max(...group.map(row => row.recognize)), semanticFalseTurns: group.reduce((n, row) => n + row.semanticFalseTurns, 0) };
}));
check(endpoint.some(row => row.policy === 'adaptive-energy' && row.falseEnds > 0), 'candidate must expose hesitation false cuts rather than report only latency');
console.log(JSON.stringify({ mode: baseline ? 'before' : 'after', checks, textFixture: unpunctuated, textFixtureHash: createHash('sha256').update(unpunctuated).digest('hex'), segmentation, endpoint, rows, decision: 'Keep production 700ms. Energy-only shorter/adaptive candidates cut hesitation, names and address continuations. Existing limitations remain: low-volume below-threshold undetected; TV-like energy indistinguishable from user speech; pauses longer than 700ms still cut. No semantic/audio model was added.',
  scope: 'Actual splitter and fixed gate; synthetic 20ms RMS frames, candidate strategy local experiment. Address/name/Bluetooth labels describe continuation-pause patterns, not speech-recognition/acoustic quality. No actual ASR queue or acoustic accuracy measurement; existing controller suites cover queue/continuation separately.', realApiCalls: 0, modelTokens: 0, model: 'GPT-6', reasoning: '未确认' }));
