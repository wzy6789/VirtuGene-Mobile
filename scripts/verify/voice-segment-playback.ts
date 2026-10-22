import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { VoiceCallController, type CallView } from '../../src/lib/voice-call/controller';
import type { NativeAudioEvent, PlaybackReceipt } from '../../src/lib/voice-call/native-audio';
const baseline = process.argv.includes('--baseline');
let checks = 0;
const check = (ok: unknown, message: string) => { assert.ok(ok, message); checks++; };
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
type Options = { rate: number; packetBytes: number; sourceMs: number; supported: boolean; capacityMs?: number; singlePacket?: boolean; sentences?: 3; action?: 'interrupt' | 'interrupt-after-boundary' | 'revoke' | 'revoke-leading' | 'revoke-mid-packet' | 'bad-receipt' };
async function scenario(options: Options) {
  let now = 0, written = 0, tailAt = 0, alive = true, revoked = false;
  let view: CallView | undefined, callback!: (event: NativeAudioEvent) => void, turnId = '';
  const timers: { at: number; run(): void }[] = [], packets: { start: number; end: number; frameStart: number; frameEnd: number; label: number; bytes: Uint8Array }[] = [];
  const requests: string[] = [], modelInputs: unknown[] = [], targets: (number | undefined)[] = [];
  let appends = 0, maximumLeadingMs = 0, firedAction = false;
  const delay = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
    const abort = () => reject(new DOMException('Aborted', 'AbortError'));
    signal?.addEventListener('abort', abort, { once: true });
    timers.push({ at: now + ms, run: () => { signal?.removeEventListener('abort', abort); resolve(); } });
    if (signal?.aborted) abort();
  });
  const head = () => packets.reduce((n, packet) => n + Math.min(packet.frameEnd - packet.frameStart,
    Math.max(0, Math.floor((now - packet.start) * options.rate / 1000))), 0);
  const receipt = (throughFrame?: number): PlaybackReceipt => ({ turnId, writtenFrames: written,
    playedFrames: Math.min(written, head()), sampleRate: options.rate, ...(throughFrame === undefined ? {} : { throughFrame }) } as PlaybackReceipt);
  const controller = new VoiceCallController('segment-fixture', { inputMode: 'text', voice: '茉莉', style: '',
    now: () => now, onView: value => { view = value; }, context: async text => ({ messages: [{ role: 'user', content: text }],
      assertCurrent: async () => { await delay(options.sourceMs);
        if (options.action === 'revoke-leading' && packets.length === 2 && packets.every(packet => packet.label === 1)) revoked = true;
        if (revoked) throw Error('voice:context_changed'); } }),
    api: {
      recognize: async () => { throw Error('ASR forbidden'); },
      dialogue: async (messages, stream) => { requests.push('llm'); modelInputs.push(messages); await stream.onText('第一句话。'); await stream.onText('第二句话。'); if(options.sentences===3)await stream.onText('第三句话。'); },
      synthesize: async (text, _v, _s, stream) => {
        requests.push('tts'); modelInputs.push(text); const label = text.startsWith('第一') ? 1 : text.startsWith('第二')?2:3;
        if(label===3)check(view?.heardText.includes('第一句话。'),'a third synthesis cannot become a second future request before prior completion');
        await delay(20, stream.signal);
        const pcm = new Uint8Array(label === 1 ? options.action === 'revoke-mid-packet' ? 19200 : 9600 : options.packetBytes).fill(label);
        await stream.onPcm(pcm); if(!options.singlePacket){await delay(100, stream.signal); await stream.onPcm(new Uint8Array(9600).fill(label));}
      },
    }, audio: {
      start: async cb => { callback = cb; return { sampleRate: 16000, routes: [], echoCancellation: true, noiseSuppression: true, segmentDrain: options.supported } as any; },
      beginPlayback: async id => { turnId = id; },
      append: async (_id, pcm, signal) => {
        appends++;
        const frames = pcm.length / 2 * options.rate / 24000, start = Math.max(now, tailAt);
        packets.push({ start, end: start + frames / options.rate * 1000, frameStart: written, frameEnd: written + frames, label: pcm[0], bytes: pcm.slice() });
        if (pcm[0] === 2 && now < packets.filter(p => p.label === 1).at(-1)!.end) maximumLeadingMs += pcm.length / 48;
        written += frames; tailAt = start + frames / options.rate * 1000;
        if(options.action==='revoke-mid-packet') revoked=true;
        if(options.capacityMs!==undefined && tailAt-options.capacityMs>now) await delay(tailAt-options.capacityMs-now,signal);
        return receipt();
      },
      drain: async (_id, signal, throughFrame?: number) => {
        targets.push(throughFrame); const target = throughFrame ?? written;
        const packet = packets.find(packet => packet.frameEnd >= target)!;
        const at = packet.start + (target - packet.frameStart) / options.rate * 1000;
        if (at > now) await delay(at - now, signal);
        if (options.action === 'interrupt-after-boundary') await delay(100, signal);
        return { ...receipt(throughFrame), complete: true,
          ...(options.action === 'bad-receipt' ? { throughFrame: -1 } : {}) };
      },
      interrupt: async () => { alive = false; return receipt(); },
      mute: async () => {}, resume: async () => ({ routes: [] }), close: async () => { alive = false; },
    },
  });
  await controller.start(); alive = true; await controller.sendText('请说两句话');
  for (now = 10; now < 6000; now += 10) {
    for (let cycle = 0; cycle < 5; cycle++) {
      for (const timer of timers.filter(timer => timer.at <= now)) { timers.splice(timers.indexOf(timer), 1); timer.run(); }
      await flush();
    }
    if (alive && turnId) callback({ callId: 'segment-fixture', type: 'playback', at: now, ...receipt() });
    if (options.action === 'revoke' && packets.length === 1 && !firedAction) { firedAction = true; revoked = true; }
    if (options.action === 'interrupt' && packets.some(p => p.label === 2) && !firedAction) { firedAction = true; await controller.interrupt(); }
    if (options.action === 'interrupt-after-boundary' && packets.some(p=>p.label===2)
      && now >= packets.filter(p=>p.label===1).at(-1)!.end + 50 && !firedAction) { firedAction=true; await controller.interrupt(); }
    await flush();
    if (controller.getRecords().length && ['listening', 'error'].includes(view?.phase ?? '')) break;
  }
  const row = controller.getRecords()[0]; check(!!row, 'actual controller records or conservatively cancels the turn');
  if (!options.action) {
    check(row.heardText === (options.sentences===3?'第一句话。第二句话。第三句话。':'第一句话。第二句话。'), 'full playback history is preserved');
    check(requests.join(',') === (options.sentences===3?'llm,tts,tts,tts':'llm,tts,tts'), 'one dialogue and only one future synthesis');
    const firstFrames=options.rate*(options.singlePacket ? 0.2 : 0.4);
    check(row.segments[0].playedFrames === firstFrames, 'first sentence frames exclude the next sentence');
    check(row.segments[1].playedFrames === (options.packetBytes / 48 + (options.singlePacket?0:200)) * options.rate / 1000, 'second sentence gets its own full frame span');
    if(!baseline) check(row.segments[0].playbackStartFrame===0 && row.segments[0].playbackEndFrame===firstFrames
      && row.segments[1].playbackStartFrame===firstFrames, 'persistent segment boundaries use native playback frames');
    if (!baseline && options.supported && options.packetBytes >= 9600) check(maximumLeadingMs > 0 && maximumLeadingMs <= 200, 'queue at most 200ms of safe next audio before prior drain');
  } else if (options.action === 'bad-receipt') {
    if (!baseline && options.supported) check(view?.phase === 'error' && !row.heardText, 'mismatched drain target cannot certify listening');
  } else {
    check(!row.heardText.includes('第二'), 'queued/prefetched next audio is not automatically heard history');
    check(!options.action.startsWith('revoke') || packets.every(packet => packet.label !== 2), 'revocation blocks future audio before writing');
    if(!baseline && options.action==='revoke-mid-packet') check(packets.reduce((n,p)=>n+p.bytes.length,0)<=9600,'a large provider callback cannot bypass fresh checks between native bridge blocks');
    check(row.segments[0].playedFrames <= options.rate * .4, 'stop receipt cannot assign next-sentence frames to prior segment');
  }
  const firstEnd = packets.filter(p => p.label === 1).at(-1)?.end, nextStart = packets.find(p => p.label === 2)?.start;
  const gapMs = firstEnd === undefined || nextStart === undefined ? undefined : Math.max(0, nextStart - firstEnd);
  const nextPackets=packets.filter(p=>p.label===2);
  const internalGapMs=nextPackets.reduce((sum,p,i)=>sum+(i?Math.max(0,p.start-nextPackets[i-1].end):0),0);
  if(!baseline&&!options.action&&options.capacityMs===100&&options.packetBytes===9600)check(internalGapMs<=30,'bounded native buffer must not move the saved gap into the next sentence');
  if (!baseline && !options.action && options.supported && options.packetBytes >= 9600) check(gapMs === 0, 'ready next sentence has no forced drain-to-append gap');
  if(!baseline&&options.sentences===3)check(packets.find(p=>p.label===3)!.start===packets.filter(p=>p.label===2).at(-1)!.end,'repeated short sentences also join without a late-ready gap');
  const result = { options, gapMs, internalGapMs, maximumLeadingMs, targets, requests,
    inputHash: createHash('sha256').update(JSON.stringify(modelInputs)).digest('hex'),
    pcmHash: createHash('sha256').update(Buffer.concat(packets.map(p => p.bytes))).digest('hex'),
    heard: row.heardText, metrics: row.metrics, appends, phase: view?.phase };
  await controller.end(); return result;
}
async function main() {
  const rows = [];
  for (const rate of [24000, 8000]) for (const packetBytes of [9600, 19200, 480]) for (let round = 0; round < 30; round++) {
    rows.push(await scenario({ rate, packetBytes, sourceMs: 20 + round % 3 * 10, supported: true }));
  }
  const legacy = await scenario({ rate: 24000, packetBytes: 9600, sourceMs: 30, supported: false });
  const bounded=await scenario({rate:24000,packetBytes:9600,sourceMs:30,supported:true,capacityMs:100});
  const lateReady=await scenario({rate:24000,packetBytes:9600,sourceMs:30,supported:true,singlePacket:true});
  const triple=await scenario({rate:24000,packetBytes:9600,sourceMs:30,supported:true,singlePacket:true,sentences:3,capacityMs:100});
  const boundedRows=[];
  for(const rate of [24000,8000])for(const packetBytes of [9600,19200])for(let round=0;round<30;round++) {
    boundedRows.push(await scenario({rate,packetBytes,sourceMs:30,supported:true,capacityMs:100}));
  }
  const faults = [];
  for (const action of ['interrupt', 'interrupt-after-boundary', 'revoke', 'revoke-leading', 'revoke-mid-packet', 'bad-receipt'] as const) faults.push(await scenario({ rate: 24000, packetBytes: 9600, sourceMs: 30, supported: true, action }));
  console.log(JSON.stringify({ baseline, checks, rows, boundedRows, legacy, bounded, lateReady, triple, faults, apiCalls: 0, microphone: false, physicalAudio: false,
    scope: 'actual controller with deterministic PCM/frame-progress sink and synthetic network; not real sound' }));
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
