import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { PlaybackBufferPolicy, playbackBufferRelease, PLAYBACK_BUFFER_HISTORY_LIMIT, PLAYBACK_BUFFER_HISTORY_MAX_AGE_MS,
  type PlaybackBufferBinding, type PlaybackBufferDevice, type PlaybackSupplySample } from '../../src/lib/voice-call/playback-buffer-policy';

let checks = 0;
const baseline = process.argv.includes('--baseline');
const check = (condition: unknown, message: string) => { assert.ok(condition, message); checks++; };
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const binding = (trackId: string, routeGeneration = 1, callId = 'synthetic-call'): PlaybackBufferBinding => ({ callId, routeGeneration, trackId });
const device = (rate = 24000, capacityMs = 100): PlaybackBufferDevice => ({ sampleRate: rate, bufferFrames: rate * capacityMs / 1000,
  startThresholdFrames: rate * 40 / 1000, canAdjustStartThreshold: true });
const feedback = (atMs: number, supplyGapMs = 0, underrunEnd: number | undefined = 0) => ({ completed: true,
  samples: [{ atMs, supplyGapMs, serviceMs: 0 }], underrunStart: 0, underrunEnd });

function contracts() {
  const policy = new PlaybackBufferPolicy();
  const first = policy.beginTrack(binding('first'), device(), 0);
  check(first.targetMs === 40 && first.sampleCount === 0, 'cold start has no hidden prewarming');
  const cleanSupply = new PlaybackBufferPolicy();
  cleanSupply.beginTrack(binding('clean-supply'), device(), 0);
  cleanSupply.finishTrack(binding('clean-supply'), { completed: true, samples: [{ atMs: 50, supplyGapMs: 2, serviceMs: 1 }], underrunStart: 0, underrunEnd: 0 }, 60);
  check(cleanSupply.beginTrack(binding('still-clean'), device(), 70).targetMs === (baseline ? 60 : 40),
    'small supply timing noise without actual underruns cannot raise stable startup latency');
  const unobserved = new PlaybackBufferPolicy(); unobserved.beginTrack(binding('no-counters'), device(), 0);
  unobserved.finishTrack(binding('no-counters'), { completed: true, samples: [{ atMs: 50, supplyGapMs: 80, serviceMs: 10 }] }, 60);
  check(unobserved.beginTrack(binding('not-evidence'), device(), 70).targetMs === (baseline ? 100 : 40),
    'unknown native underruns cannot justify increasing startup buffering from callback delays alone');
  check(Object.isFrozen(first) && Object.isFrozen(first.binding), 'a track decision cannot change after observation');
  check(policy.finishTrack(binding('first'), feedback(50, 45, 2), 60), 'active feedback accepted');
  check(!policy.finishTrack(binding('first'), feedback(50, 1000, 20), 60), 'duplicate feedback cannot train twice');
  const next = policy.beginTrack(binding('next'), device(), 70);
  check(next.targetMs === 100 && next.sampleCount === 1 && next.newestSampleAgeMs === 20, 'new track uses only older same-route samples and effective capacity');
  check(first.targetMs === 40 && first.sampleCount === 0, 'later samples do not rewrite an old decision');
  check(!policy.finishTrack(binding('first'), feedback(75, 200, 20), 80), 'old track completion cannot train a replacement');
  policy.finishTrack(binding('next'), { completed: true, samples: [
    { atMs: 1000, supplyGapMs: 10000, serviceMs: 0 }, // future
    { atMs: 65, supplyGapMs: 10000, serviceMs: 0 }, // before this track
    { atMs: 75, supplyGapMs: Number.NaN, serviceMs: 0 },
    { atMs: 75, supplyGapMs: -1, serviceMs: 0 },
    ...Array.from({ length: 30 }, (_, i) => ({ atMs: 71 + i / 2, supplyGapMs: 0, serviceMs: 0 })),
  ], underrunStart: 9, underrunEnd: 9 }, 90);
  const bounded = policy.beginTrack(binding('bounded'), device(), 100);
  check(bounded.sampleCount === PLAYBACK_BUFFER_HISTORY_LIMIT && bounded.supplyGapP90Ms === 0, 'history evicts to sixteen validated numeric samples');
  policy.finishTrack(binding('bounded'), { completed: false, samples: [{ atMs: 110, supplyGapMs: 10000, serviceMs: 0 }], underrunStart: 0, underrunEnd: 100 }, 120);
  check(policy.beginTrack(binding('cancelled-feedback'), device(), 130).supplyGapP90Ms === 0, 'cancelled work does not train route history');
  check(policy.beginTrack(binding('route-change', 2), device(), 140).sampleCount === 0, 'route change clears numeric history');
  policy.finishTrack(binding('route-change', 2), feedback(145, 30, 1), 150);
  check(policy.beginTrack(binding('call-change', 2, 'new-call'), device(), 160).sampleCount === 0, 'call change clears numeric history');
  policy.finishTrack(binding('call-change', 2, 'new-call'), feedback(170, 30, 1), 180);
  const expired = policy.beginTrack(binding('expired', 2, 'new-call'), device(), 180 + PLAYBACK_BUFFER_HISTORY_MAX_AGE_MS + 1);
  check(expired.sampleCount === 0 && expired.targetMs === 40 && expired.routeFloorMs === 40, 'expired history and raised floor return to cold start');
  const defaults = new PlaybackBufferPolicy();
  check(defaults.beginTrack(binding('missing'), { sampleRate: 8000 }, 0).mode === 'device-default', 'unknown capabilities preserve unknown device default');
  const unsupported = defaults.beginTrack(binding('unsupported'), { ...device(8000), startThresholdFrames: 800, canAdjustStartThreshold: false }, 1);
  check(unsupported.mode === 'device-default' && unsupported.retainedDefaultFrames === 800 && unsupported.requestedFrames === undefined, 'legacy device default is preserved exactly');
  check(defaults.beginTrack(binding('large-default'), { ...device(24000, 300), startThresholdFrames: 4800 }, 2).reason === 'device-outside-range', 'large device default is not lowered to manufacture latency gains');
  check(defaults.beginTrack(binding('tiny-capacity'), device(24000, 20), 3).mode === 'device-default', 'capacity below safe range is not silently enlarged');
  check(defaults.beginTrack(binding('zero-getter'), { ...device(), bufferFrames: 0 }, 4).mode === 'device-default', 'zero and missing getters are not valid adaptive capability');
  const hysteresis = new PlaybackBufferPolicy(); let time = 0;
  hysteresis.beginTrack(binding('raise'), device(24000, 200), time++);
  hysteresis.finishTrack(binding('raise'), feedback(time++, 0, 1), time++);
  for (let round = 0; round < 7; round++) {
    const id = binding(`stable-${round}`), d = hysteresis.beginTrack(id, device(24000, 200), time++);
    check(d.routeFloorMs === 60, 'floor does not decay before eight confirmed clean tracks');
    hysteresis.finishTrack(id, feedback(time++, 0, 0), time++);
  }
  const eighth = binding('stable-7'); hysteresis.beginTrack(eighth, device(24000, 200), time++);
  hysteresis.finishTrack(eighth, feedback(time++, 0, 0), time++);
  check(hysteresis.beginTrack(binding('after-eight'), device(24000, 200), time++).routeFloorMs === 40, 'eight clean tracks lower the floor by one twenty-ms step');
  const unknown = new PlaybackBufferPolicy(); unknown.beginTrack(binding('raise'), device(), 0); unknown.finishTrack(binding('raise'), feedback(1, 0, 1), 2);
  for (let i = 0; i < 10; i++) {
    const id = binding(`unknown-${i}`); unknown.beginTrack(id, device(), i * 3 + 3);
    unknown.finishTrack(id, { completed: true, samples: [{ atMs: i * 3 + 4, supplyGapMs: 0, serviceMs: 0 }], underrunStart: 0 }, i * 3 + 5);
  }
  check(unknown.beginTrack(binding('still-raised'), device(), 40).routeFloorMs === 60, 'unknown underrun getter cannot count as a clean track');
  check(playbackBufferRelease(0, 960, true) === 'wait' && playbackBufferRelease(240, 960, false) === 'wait'
    && playbackBufferRelease(240, 960, true) === 'eof-tail' && playbackBufferRelease(960, 960, false) === 'threshold', 'short EOF releases all real frames without zeroing the target');
  assert.throws(() => defaults.beginTrack(binding('clock-backwards'), device(), 3), /buffer_clock/); checks++;
  assert.throws(() => playbackBufferRelease(1.5, 1, false), /buffer_frames/); checks++;
}

type Scenario = 'stable' | 'bounded-jitter' | 'bursty-jitter' | 'tiny-fragments' | 'large-callbacks' | 'local-service-stalls' | 'slower-than-realtime' | 'short-eof';
type Mode = 'fixed-40' | 'fixed-80' | 'adaptive';
// Historical stress model refills after each underrun. The separate AOSP normal-mixer
// variant keeps an already filled track ready and only waits at initial startup.
const refillAfterUnderrun = !process.argv.includes('--aosp-startup-only');
interface Packet { readyAtMs: number; serviceMs: number; pcm: Uint8Array; audioMs: number }
interface Trace { packets: Packet[]; pcm: Uint8Array; scheduleHash: string; seed: number; durationMs: number }
const scenarios: Scenario[] = ['stable', 'bounded-jitter', 'bursty-jitter', 'tiny-fragments', 'large-callbacks', 'local-service-stalls', 'slower-than-realtime', 'short-eof'];
const modes: Mode[] = ['fixed-40', 'fixed-80', 'adaptive'];
function random(seed: number) {
  let state = seed >>> 0;
  return () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 0x100000000; };
}
function trace(scenario: Scenario, rate: number, round: number): Trace {
  const seed = 112358 + scenarios.indexOf(scenario) * 10000 + rate + round * 97;
  const rng = random(seed), durationMs = scenario === 'short-eof' ? 25 : 1655;
  const pcm = new Uint8Array(durationMs * rate / 1000 * 2);
  for (let i = 0; i < pcm.length / 2; i++) {
    const sample = (Math.imul(i + 1, 997) + seed) % 65535 - 32767;
    pcm[i * 2] = sample & 255; pcm[i * 2 + 1] = sample >> 8 & 255;
  }
  const packets: Packet[] = []; let readyAtMs = 40, audioOffsetMs = 0;
  while (audioOffsetMs < durationMs) {
    const index = packets.length, packetMs = scenario === 'tiny-fragments' || scenario === 'short-eof' ? 5 : scenario === 'large-callbacks' ? 200 : 20;
    const audioMs = Math.min(packetMs, durationMs - audioOffsetMs);
    let interval = 17 + Math.floor(rng() * 4), serviceMs = 1;
    if (scenario === 'bounded-jitter') interval = [10, 10, 50, 10, 20][(index + round) % 5];
    if (scenario === 'bursty-jitter') interval = index % 10 === (round % 10) ? 100 + Math.floor(rng() * 11) : 10;
    if (scenario === 'tiny-fragments') interval = index % 17 === 0 ? 17 : 4;
    if (scenario === 'large-callbacks') interval = 150 + Math.floor(rng() * 50);
    if (scenario === 'local-service-stalls') { interval = 18; serviceMs = index % 8 === round % 8 ? 38 : 3; }
    if (scenario === 'slower-than-realtime') interval = 30 + Math.floor(rng() * 7);
    if (scenario === 'short-eof') interval = 5;
    if (index > 0) readyAtMs += interval;
    packets.push({ readyAtMs, serviceMs, audioMs, pcm: pcm.subarray(audioOffsetMs * rate / 1000 * 2, (audioOffsetMs + audioMs) * rate / 1000 * 2) });
    audioOffsetMs += audioMs;
  }
  return { packets, pcm, seed, durationMs, scheduleHash: hash(JSON.stringify(packets.map(packet => [packet.readyAtMs, packet.serviceMs, packet.pcm.length]))) };
}

function simulate(input: Trace, rate: number, capacityMs: number, thresholdFrames: number, cancelAtMs?: number) {
  const capacityFrames = capacityMs * rate / 1000, stepFrames = rate / 1000;
  const queue: { pcm: Uint8Array; offset: number }[] = [];
  const rendered = new Uint8Array(input.pcm.length), accepted: Uint8Array[] = [];
  let queuedFrames = 0, peakQueuedFrames = 0, packetIndex = 0, held: { packet: Packet; offset: number } | undefined;
  let service: { packet: Packet; dueAtMs: number } | undefined;
  let writtenFrames = 0, renderedFrames = 0, playing = false, eof = false, firstProgressAtMs: number | undefined, firstPcmAtMs: number | undefined;
  let underruns = 0, underrunMs = 0, eofFlushes = 0, maximumHeldFrames = 0, finishedAtMs = 0, cancelled = false, starved = false;
  let flushedFrames = 0, lateAcceptedFrames = 0, lateProducerAttempts = 0, accepting = true, partialWriteOperations = 0;
  const samples: PlaybackSupplySample[] = [];
  const admit = (part: Uint8Array) => {
    if (!accepting || part.length / 2 + queuedFrames > capacityFrames) return false;
    queue.push({ pcm: part, offset: 0 }); accepted.push(part); writtenFrames += part.length / 2; queuedFrames += part.length / 2;
    peakQueuedFrames = Math.max(peakQueuedFrames, queuedFrames); return true;
  };
  for (let now = 0; now < 20_000; now++) {
    if (cancelAtMs !== undefined && now >= cancelAtMs) {
      cancelled = true; accepting = false; flushedFrames = queuedFrames; queuedFrames = 0; queue.length = 0; held = undefined; service = undefined; playing = false;
      // Simulate late producer attempts after cancellation; the sink stays revoked.
      for (const packet of input.packets.slice(packetIndex)) {
        lateProducerAttempts++;
        if (admit(packet.pcm)) lateAcceptedFrames += packet.pcm.length / 2;
      }
      finishedAtMs = now; break;
    }
    for (let cycle = 0; cycle < 4; cycle++) {
      if (service && service.dueAtMs <= now) {
        held = { packet: service.packet, offset: 0 }; service = undefined;
        if (firstPcmAtMs === undefined) firstPcmAtMs = now;
      }
      if (held) {
        maximumHeldFrames = Math.max(maximumHeldFrames, (held.packet.pcm.length - held.offset) / 2);
        const bytes = Math.min(held.packet.pcm.length - held.offset, (capacityFrames - queuedFrames) * 2);
        if (bytes > 0) {
          const part = held.packet.pcm.subarray(held.offset, held.offset + bytes);
          if (!admit(part)) throw Error('An active partial write exceeded available capacity');
          partialWriteOperations++; held.offset += bytes;
        }
        if (held.offset === held.packet.pcm.length) { held = undefined; packetIndex++; } else break;
      }
      if (!held && !service && packetIndex < input.packets.length && input.packets[packetIndex].readyAtMs <= now) {
        const packet = input.packets[packetIndex];
        if (packetIndex > 0) {
          const previous = input.packets[packetIndex - 1];
          samples.push({ atMs: packet.readyAtMs, supplyGapMs: Math.max(0, packet.readyAtMs - previous.readyAtMs - previous.audioMs), serviceMs: packet.serviceMs });
        }
        service = { packet, dueAtMs: now + packet.serviceMs };
      }
      if (!held && !service && packetIndex === input.packets.length) eof = true;
    }
    if (playing && queuedFrames === 0 && !eof) { if (!starved) underruns++; starved = true; if (refillAfterUnderrun) playing = false; }
    if (queuedFrames > 0) starved = false;
    if (!playing) {
      const release = playbackBufferRelease(queuedFrames, thresholdFrames, eof);
      if (release !== 'wait') { playing = true; if (release === 'eof-tail') eofFlushes++; }
    }
    if (playing && queuedFrames > 0) {
      if (firstProgressAtMs === undefined) firstProgressAtMs = now + 1;
      let remaining = Math.min(stepFrames, queuedFrames);
      while (remaining > 0) {
        const head = queue[0], frames = Math.min(remaining, (head.pcm.length - head.offset) / 2);
        rendered.set(head.pcm.subarray(head.offset, head.offset + frames * 2), renderedFrames * 2);
        head.offset += frames * 2; renderedFrames += frames; queuedFrames -= frames; remaining -= frames;
        if (head.offset === head.pcm.length) queue.shift();
      }
    } else if (firstProgressAtMs !== undefined && !eof) underrunMs++;
    if (eof && queuedFrames === 0) { finishedAtMs = now + 1; break; }
    if (now === 19_999) throw Error('Synthetic sink did not terminate');
  }
  const renderedPcm = rendered.subarray(0, renderedFrames * 2), acceptedPcm = Buffer.concat(accepted);
  check(peakQueuedFrames <= capacityFrames && maximumHeldFrames <= rate * .2, 'sink and one active callback memory stay finite, including 200ms callbacks');
  check(renderedFrames <= writtenFrames && writtenFrames <= input.pcm.length / 2, 'frame conservation holds');
  check(hash(renderedPcm) === hash(input.pcm.subarray(0, renderedPcm.length)), 'rendered PCM preserves exact content and order');
  check(hash(acceptedPcm) === hash(input.pcm.subarray(0, acceptedPcm.length)), 'accepted PCM preserves exact content and order');
  if (!cancelled) {
    check(renderedFrames === input.pcm.length / 2 && writtenFrames === renderedFrames && queuedFrames === 0, 'successful EOF retains every frame and tail');
    check(firstProgressAtMs !== undefined && firstPcmAtMs !== undefined, 'a successful stream records actual software frame progress');
  } else check(queuedFrames === 0 && lateAcceptedFrames === 0 && lateProducerAttempts > 0, 'cancel flushes the sink and the same admission path rejects later producer attempts');
  return { firstPcmAtMs, firstProgressAtMs, firstPcmToProgressMs: firstProgressAtMs === undefined || firstPcmAtMs === undefined ? undefined : firstProgressAtMs - firstPcmAtMs,
    finishedAtMs, underruns, underrunMs, peakQueuedFrames, peakQueuedMs: peakQueuedFrames * 1000 / rate, maximumHeldFrames,
    writtenFrames, renderedFrames, pcmHash: hash(input.pcm), renderedHash: hash(renderedPcm), tailHex: Buffer.from(renderedPcm.subarray(-16)).toString('hex'),
    eofFlushes, cancelled, flushedFrames, lateAcceptedFrames, lateProducerAttempts, partialWriteOperations, samples };
}

function main() {
  contracts();
  const rows: any[] = [], cancellations: any[] = [];
  for (const scenario of scenarios) for (const rate of [8000, 24000]) for (const capacityMs of [100, 200]) {
    const policies = Object.fromEntries(modes.map(mode => [mode, new PlaybackBufferPolicy()])) as Record<Mode, PlaybackBufferPolicy>;
    const clocks: Record<Mode, number> = { 'fixed-40': 0, 'fixed-80': 0, adaptive: 0 };
    for (let round = 0; round < 30; round++) {
      const input = trace(scenario, rate, round), paired: any[] = [];
      for (const mode of modes) {
        const policy = policies[mode], id = binding(`track-${round}`), startAtMs = clocks[mode];
        const decision = policy.beginTrack(id, device(rate, capacityMs), startAtMs);
        const thresholdFrames = mode === 'adaptive' ? decision.requestedFrames! : rate * (mode === 'fixed-40' ? 40 : 80) / 1000;
        const result = simulate(input, rate, capacityMs, thresholdFrames);
        const endAtMs = startAtMs + result.finishedAtMs;
        policy.finishTrack(id, { completed: true, samples: result.samples.map(sample => ({ ...sample, atMs: startAtMs + sample.atMs })), underrunStart: 0, underrunEnd: result.underruns }, endAtMs);
        clocks[mode] = endAtMs + 50;
        const row = { scenario, rate, capacityMs, round, mode, seed: input.seed, scheduleHash: input.scheduleHash,
          targetMs: thresholdFrames * 1000 / rate, historySamples: mode === 'adaptive' ? decision.sampleCount : 0,
          newestHistoryAgeMs: mode === 'adaptive' ? decision.newestSampleAgeMs : undefined, oldestHistoryAgeMs: mode === 'adaptive' ? decision.oldestSampleAgeMs : undefined,
          decision: mode === 'adaptive' ? decision : undefined, ...result, samples: undefined };
        rows.push(row); paired.push(row);
        if (mode === 'adaptive') {
          check(row.targetMs >= 40 && row.targetMs <= Math.min(160, capacityMs), 'adaptive target is nonzero and respects actual finite capacity');
          check(round > 0 || (row.targetMs === 40 && row.historySamples === 0), 'every main stratum includes its actual cold-start round');
          check(row.oldestHistoryAgeMs === undefined || row.oldestHistoryAgeMs <= PLAYBACK_BUFFER_HISTORY_MAX_AGE_MS, 'stale route history is excluded');
          if (scenario === 'slower-than-realtime') check(result.underruns > 0 && result.underrunMs > 0, 'bounded buffering does not pretend to fix persistent undersupply');
          if (scenario === 'short-eof') check(result.eofFlushes === 1 && result.renderedFrames === rate * .025, 'short EOF bypasses only the readiness wait and retains every frame');
        }
      }
      check(paired.every(row => row.scheduleHash === paired[0].scheduleHash && row.seed === paired[0].seed && row.pcmHash === paired[0].pcmHash
        && row.renderedHash === paired[0].renderedHash && row.tailHex === paired[0].tailHex), 'three policies use the same readiness schedule, seed, complete PCM and final samples');
    }
  }
  for (const rate of [8000, 24000]) for (const mode of modes) for (const cancelAtMs of [10, 42, 120, 600, 1200]) {
    const policy = new PlaybackBufferPolicy(), id = binding('cancel'), input = trace('bursty-jitter', rate, 0);
    const decision = policy.beginTrack(id, device(rate, 100), 0);
    const frames = mode === 'adaptive' ? decision.requestedFrames! : rate * (mode === 'fixed-40' ? 40 : 80) / 1000;
    const result = simulate(input, rate, 100, frames, cancelAtMs);
    policy.finishTrack(id, { completed: false, samples: result.samples, underrunStart: 0, underrunEnd: result.underruns }, result.finishedAtMs);
    const next = policy.beginTrack(binding('after-cancel'), device(rate, 100), result.finishedAtMs + 1);
    check(next.sampleCount === 0 && next.targetMs === 40, 'cancelled stream cannot prewarm a subsequent decision');
    cancellations.push({ rate, mode, cancelAtMs, ...result, samples: undefined });
  }
  const percentile = (values: number[], p: number) => values.sort((a, b) => a - b)[Math.ceil(values.length * p) - 1];
  const summary: any[] = [];
  for (const scenario of scenarios) for (const rate of [8000, 24000]) for (const capacityMs of [100, 200]) for (const mode of modes) {
    const group = rows.filter(row => row.scenario === scenario && row.rate === rate && row.capacityMs === capacityMs && row.mode === mode);
    summary.push({ scenario, rate, capacityMs, mode, rounds: group.length,
      firstPcmToProgressP50Ms: percentile(group.map(row => row.firstPcmToProgressMs), .5), firstPcmToProgressP95Ms: percentile(group.map(row => row.firstPcmToProgressMs), .95),
      firstProgressP50Ms: percentile(group.map(row => row.firstProgressAtMs), .5), firstProgressP95Ms: percentile(group.map(row => row.firstProgressAtMs), .95),
      underrunTotal: group.reduce((sum, row) => sum + row.underruns, 0), underrunMsTotal: group.reduce((sum, row) => sum + row.underrunMs, 0),
      peakQueuedMs: Math.max(...group.map(row => row.peakQueuedMs)), targetsMs: [...new Set(group.map(row => row.targetMs))],
      coldStart: { targetMs: group[0].targetMs, historySamples: group[0].historySamples, firstProgressAtMs: group[0].firstProgressAtMs },
      fullPcmAndTail: group.every(row => row.pcmHash === row.renderedHash),
    });
  }
  console.log(JSON.stringify({ checks, scope: 'Production buffer policy exercised in a bounded synthetic PCM software sink; this verifier does not instantiate the production bridge/controller or Android.',
    refillModel: refillAfterUnderrun ? 'threshold-after-every-underrun-stress-model' : 'AOSP-normal-mixer-startup-only-reference-model',
    productionIntegration: false, androidRuntimeExecuted: false, physicalAudio: false, realNetworkMeasured: false, microphone: false, modelApiCalls: 0, modelTokens: 0,
    rowDefinition: 'Each stratum starts cold, then 30 successive tracks on one call+route reuse only <=16 past numeric observations no older than 30 seconds; no warmup is excluded.',
    supplyDefinition: 'Synthetic independent producer-readiness gaps and separately modelled local service; current production onPcm timings are not isolated network jitter.',
      eofDefinition: 'Software EOF tail release keeps every PCM frame. Native short-start release has separate JVM coverage; real Android EOF playback is not proven here.',
    cancellationDefinition: 'Synthetic sink revokes admission, flushes queued frames and ignores late producer attempts; actual controller authority and physical stop remain outside this new experiment.',
    preservedBoundary: 'This policy does not start synthesis, grant permission, append PCM or certify heardText. Existing one-future synthesis, 200ms prefix and 9600-byte authorization checks remain production responsibilities.',
    partialWriteOperations: [...rows, ...cancellations].reduce((sum, row) => sum + row.partialWriteOperations, 0), rows, summary, cancellations }));
}
main();
