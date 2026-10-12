import { MimoCallClient, CallApiError, type CallMessage, type CallVoice, type CallApiUsage } from './mimo';
import { NativeCallAudio, decodeCapture, type NativeAudioEvent, type AudioCapabilities, type PlaybackReceipt } from './native-audio';
import { CallLifecycle, type CallPhase, type CallTurn, type SpokenSegment } from './lifecycle';
import { SpokenSentenceBuffer, UtteranceGate, pcmWav } from './utterance';
import { reviewCallSpeech } from './speech-quality';

export interface CallAudioPort {
  start(callback: (event: NativeAudioEvent) => void): Promise<AudioCapabilities>;
  beginPlayback(turn: string, signal: AbortSignal): Promise<void>;
  append(turn: string, pcm: Uint8Array, signal: AbortSignal): Promise<PlaybackReceipt>;
  drain(turn: string, signal: AbortSignal): Promise<PlaybackReceipt>;
  interrupt(): Promise<PlaybackReceipt>; mute(value: boolean): Promise<void>;
  pause?(): Promise<void>;
  resume(): Promise<{ routes: AudioCapabilities['routes']; echoCancellation?: boolean; noiseSuppression?: boolean }>; close(): Promise<void>;
  routes?(): Promise<{ routes: AudioCapabilities['routes'] }>;
  route?(deviceId: number): Promise<{ routes: AudioCapabilities['routes'] }>;
  requestBluetooth?(): Promise<void>;
}
export interface CallTurnMetrics {
  speechEndedAt?: number; vadWaitMs?: number; firstPlaybackFromSpeechMs?: number;
  llmFirstTokenMs?: number; ttsFirstChunkMs?: number;
  latencyBasis?: 'js-capture-receipt-with-frame-offset';
  turnId: string; stoppedAt: number; asrMs?: number; firstTextMs?: number; firstPcmMs?: number; firstPlaybackMs?: number;
  interruptedAt?: number; stopAcknowledgementMs?: number;
}
export interface CallExchange {
  recordedAt?: number;
  turnId: string; userText: string; generatedText: string; heardText: string; interrupted: boolean;
  segments: SpokenSegment[]; metrics: CallTurnMetrics;
}
export interface CallView {
  /** Current sanitized sentence being played, distinct from completed heardText. */
  speakingText?: string;
  phase: CallPhase; userText: string; generatedText: string; heardText: string; level: number;
  muted: boolean; routing?: boolean; error?: string; capabilities?: AudioCapabilities;
}
type Dependencies = {
  audio?: CallAudioPort; api?: Pick<MimoCallClient, 'recognize' | 'dialogue' | 'synthesize'>;
  context: (text: string, exchanges: readonly CallExchange[], signal: AbortSignal) => Promise<CallMessage[] | PreparedCallContext>;
  voice: CallVoice; style: string; onView: (view: CallView) => void;
  onUsage?: (stage: 'asr' | 'dialogue' | 'tts', usage: CallApiUsage) => void;
  onRequest?: (stage: 'asr' | 'dialogue' | 'tts', audioSeconds?: number) => void;
  onExchange?: (exchange: CallExchange) => void;
  now?: () => number;
};
export interface PreparedCallContext {
  messages: CallMessage[];
  /** Read-only source validation; must not advance sentence filter state. */
  assertCurrent?: () => Promise<void>;
  reviewSpeech?: (text: string) => string | Promise<string>;
}

/** A single bounded microphone-to-PCM conversation. Context and persistence reuse the host's repositories. */
export class VoiceCallController {
  readonly lifecycle: CallLifecycle;
  private audio: CallAudioPort;
  private api: NonNullable<Dependencies['api']>;
  private now: () => number;
  private gate = new UtteranceGate();
  private preRoll: Uint8Array[] = [];
  private capture: Uint8Array[] | null = null;
  private captureBytes = 0;
  private turn?: CallTurn;
  private pausing: Promise<void> = Promise.resolve();
  private exchange?: CallExchange;
  private exchanges: CallExchange[] = [];
  private view: CallView = { phase: 'initializing', userText: '', generatedText: '', heardText: '', level: 0, muted: false };
  private ended = false;
  // Revoked in-memory exchanges cannot be repaired by resuming this call.
  private sourceWithdrawn = false;
  private startedAt = 0;
  private playbackStarted = false;
  private activeSegment?: { turnId: string; id: string; text: string; startFrame: number };
  private stopping?: Promise<void>;
  private closing?: Promise<void>;
  private lastSpeechAt?: number;
  private routePending = false;
  private routeEvents = 0;
  private routeQuery = 0;
  constructor(readonly callId: string, private readonly deps: Dependencies) {
    this.now = deps.now ?? performance.now.bind(performance);
    this.lifecycle = new CallLifecycle(callId);
    this.audio = deps.audio ?? new NativeCallAudio(callId);
    this.api = deps.api ?? new MimoCallClient();
  }
  private publish(patch: Partial<CallView> = {}) { this.view = { ...this.view, ...patch, ...(this.sourceWithdrawn ? { error: 'voice:source_withdrawn' } : {}), phase: this.lifecycle.phase }; this.deps.onView({ ...this.view }); }
  async start() {
    if (this.ended || this.sourceWithdrawn) return;
    this.lifecycle.transition('connecting'); this.publish({ error: undefined });
    try {
      const capabilities = await this.audio.start(event => this.event(event));
      if (this.ended) { await this.audio.close(); return; }
      this.startedAt = this.now();
      if (this.lifecycle.phase === 'connecting') this.lifecycle.transition('listening');
      this.publish({ capabilities });
    } catch (error) { if (!this.ended) this.fail(error); }
  }
  private canInterrupt(): boolean {
    const capabilities = this.view.capabilities;
    return !!capabilities?.echoCancellation || !!capabilities?.routes.some(route => route.selected && route.type !== undefined && route.type !== 2);
  }
  private event(event: NativeAudioEvent) {
    if (this.ended || event.callId !== this.callId) return;
    if (event.type === 'capture') {
      const pcm = decodeCapture(event); if (!pcm || this.routePending || this.view.muted || ['paused', 'error', 'connecting', 'initializing'].includes(this.lifecycle.phase)) return;
      if (this.now() - this.startedAt > 60 * 60_000 || this.exchanges.length >= 200) { void this.end().catch(() => {}); return; }
      if (this.lifecycle.phase === 'playing' && !this.canInterrupt()) return;
      const receivedAt = this.now();
      for (let offset = 0; offset < pcm.length; offset += 640) this.frame(pcm.slice(offset, offset + 640), receivedAt - (pcm.length - offset - 640) / 32);
      this.publish();
    } else if (event.type === 'interrupted') {
      this.playbackProgress(event);
      void this.interrupt().catch(error => { if (!this.ended) this.fail(error); });
    } else if (event.type === 'paused' || event.type === 'routeLost') {
      this.routeEvents++;
      this.lifecycle.pause(); this.clearCapture(); this.saveExchange(true); void this.audio.interrupt().catch(() => {});
      this.publish({ error: event.reason ?? '音频设备发生变化，请确认后继续。' });
    } else if (event.type === 'ended') {
      void this.end().catch(() => {});
    } else if (event.type === 'routes' && event.routes && this.view.capabilities) {
      this.routeEvents++;
      this.publish({ capabilities: { ...this.view.capabilities, routes: event.routes,
        echoCancellation: event.echoCancellation ?? this.view.capabilities.echoCancellation,
        noiseSuppression: event.noiseSuppression ?? this.view.capabilities.noiseSuppression } });
    } else if (event.type === 'playback' && this.turn && this.turn.id === event.turnId && this.lifecycle.isCurrent(this.turn)) {
      this.playbackProgress(event);
    }
  }
  private playbackProgress(event: NativeAudioEvent) {
    if (this.turn && event.turnId === this.turn.id) this.acknowledgePlayback(this.turn, event);
  }
  private acknowledgePlayback(turn: CallTurn, receipt: Pick<NativeAudioEvent, 'turnId' | 'playedFrames' | 'writtenFrames' | 'sampleRate'>, complete = false): boolean {
    const segment = this.activeSegment, played = receipt.playedFrames, written = receipt.writtenFrames;
    if (!this.lifecycle.isCurrent(turn) || segment?.turnId !== turn.id || (receipt.turnId !== undefined && receipt.turnId !== turn.id)
      || !Number.isSafeInteger(played) || !Number.isSafeInteger(written)
      || played! < segment.startFrame || written! < segment.startFrame || played! > written!) return false;
    const frames = played! - segment.startFrame;
    if (!this.lifecycle.acknowledgePlayback(turn, segment.id, frames, complete && played === written, receipt.sampleRate)) return false;
    if (frames > 0) {
      // Creating a track or receiving PCM is not evidence of audible output.
      // The earliest valid native progress/append/drain receipt owns latency.
      const metrics = this.exchange?.metrics;
      if (metrics && metrics.firstPlaybackMs === undefined) {
        const at = this.now(); metrics.firstPlaybackMs = at - metrics.stoppedAt;
        if (metrics.speechEndedAt !== undefined) metrics.firstPlaybackFromSpeechMs = at - metrics.speechEndedAt;
      }
      if (this.lifecycle.phase !== 'playing' || this.view.speakingText !== segment.text) {
        this.lifecycle.transition('playing'); this.publish({ speakingText: segment.text });
      }
    }
    return true;
  }
  private frame(pcm: Uint8Array, frameAt: number) {
    const values = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
    let energy = 0; for (let offset = 0; offset < pcm.length; offset += 2) { const value = values.getInt16(offset, true) / 32768; energy += value * value; }
    const rms = Math.sqrt(energy / (pcm.length / 2));
    if (this.gate.isSpeech(rms)) this.lastSpeechAt = frameAt;
    this.preRoll.push(pcm); if (this.preRoll.length > 10) this.preRoll.shift();
    const status = this.gate.push(rms);
    if (status === 'start') {
      if (this.turn && this.lifecycle.isCurrent(this.turn)) void this.interrupt().catch(error => { if (!this.ended) this.fail(error); });
      this.capture = [...this.preRoll]; this.captureBytes = this.capture.reduce((n, frame) => n + frame.length, 0);
    } else if (this.capture) { this.capture.push(pcm); this.captureBytes += pcm.length; }
    if (status === 'discard') { this.capture = null; this.captureBytes = 0; }
    if (status === 'end' || this.captureBytes >= 960000) {
      const chunks = this.capture; this.capture = null; this.captureBytes = 0;
      if (chunks?.length) {
        // Keep 200ms of trailing silence, not the full stop-phrase wait, reducing billed ASR duration.
        const trimmed = chunks.slice(0, Math.max(1, chunks.length - (status === 'end' ? 25 : 0)));
        const utterance = new Uint8Array(trimmed.reduce((n, item) => n + item.length, 0));
        let offset = 0; for (const part of trimmed) { utterance.set(part, offset); offset += part.length; }
        void this.respond(utterance.subarray(0, 960000), this.lastSpeechAt).catch(error => { if (!this.ended) this.fail(error); });
      }
      this.preRoll = []; this.gate.reset();
    }
    // Capture arrives at 10Hz, but frame analysis remains at 20ms.
    this.view.level = Math.min(1, rms * 8);
  }
  private clearCapture() { this.capture = null; this.captureBytes = 0; this.preRoll = []; this.lastSpeechAt = undefined; this.gate.reset(); }
  private saveExchange(interrupted: boolean) {
    if (!this.exchange) return;
    const segments = this.lifecycle.receipt().filter(segment => segment.turnId === this.exchange!.turnId);
    this.exchange.segments = segments; this.exchange.heardText = segments.filter(s => s.playedAt !== undefined).map(s => s.text).join('');
    this.exchange.interrupted = interrupted;
    this.exchange.recordedAt = Date.now();
    const saved = this.exchange;
    this.exchanges.push(saved); this.exchange = undefined;
    this.deps.onExchange?.({ ...saved, segments: saved.segments.map(segment => ({ ...segment })), metrics: { ...saved.metrics } });
  }
  private async respond(pcm: Uint8Array, speechEndedAt?: number) {
    if (this.ended || ['error', 'paused', 'connecting', 'initializing'].includes(this.lifecycle.phase)) return;
    if (this.stopping) await this.stopping;
    if (this.turn && this.lifecycle.isCurrent(this.turn)) await this.interrupt();
    if (this.ended || this.lifecycle.phase !== 'listening') return;
    const turn = this.lifecycle.beginTurn(); this.turn = turn; this.playbackStarted = false;
    const metrics: CallTurnMetrics = { turnId: turn.id, stoppedAt: this.now(), speechEndedAt,
      vadWaitMs: speechEndedAt === undefined ? undefined : Math.max(0, this.now() - speechEndedAt), latencyBasis: 'js-capture-receipt-with-frame-offset' };
    this.exchange = { turnId: turn.id, userText: '', generatedText: '', heardText: '', interrupted: false, segments: [], metrics };
    this.publish({ userText: '', generatedText: '', heardText: '', speakingText: '', error: undefined });
    const current = () => { if (!this.lifecycle.isCurrent(turn)) throw new DOMException('Aborted', 'AbortError'); };
    let worker: Promise<void> | undefined;
    let workerError: unknown, workerFailedCurrent = false;
    let firstTtsStartedAt: number | undefined;
    try {
      const userText = await this.api.recognize(pcmWav(pcm), { signal: turn.signal, onRequest: () => this.deps.onRequest?.('asr', pcm.length / 32000), onUsage: usage => this.deps.onUsage?.('asr', usage), onText: text => { if (this.lifecycle.isCurrent(turn)) this.publish({ userText: text }); } });
      current(); metrics.asrMs = this.now() - metrics.stoppedAt;
      if (!userText) { this.exchange = undefined; this.lifecycle.transition('listening'); this.publish(); return; }
      this.exchange!.userText = userText;
      const prepared = await this.deps.context(userText, this.exchanges, turn.signal); current();
      const messages = Array.isArray(prepared) ? prepared : prepared.messages;
      const contextualReview = Array.isArray(prepared) ? undefined : prepared.reviewSpeech;
      const validateSources = Array.isArray(prepared) ? undefined : prepared.assertCurrent;
      this.lifecycle.transition('generating'); this.publish({ userText });
      const queue: SpokenSegment[] = []; let finished = false;
      let filtered = false, accepted = 0;
      let wake: (() => void) | undefined, room: (() => void) | undefined;
      const notifyRoom = () => { room?.(); room = undefined; };
      const splitter = new SpokenSentenceBuffer();
      worker = (async () => {
        let segmentStart = 0;
        const prepareSynthesis = (segment: SpokenSegment) => {
          let activate!: (start: number) => void;
          let resolveActivationCleanup: () => void = () => {};
          const activation = new Promise<number>((resolve, reject) => {
            activate = resolve;
            const abort = () => reject(new DOMException('Aborted', 'AbortError'));
            turn.signal.addEventListener('abort', abort, { once: true });
            resolveActivationCleanup = () => turn.signal.removeEventListener('abort', abort);
          });
          // A prefetched stream stops at its first PCM callback. It cannot
          // append or read subsequent SSE frames until this sentence is active.
          const done = (async () => {
            await validateSources?.(); current();
            if (firstTtsStartedAt === undefined) firstTtsStartedAt = this.now();
            let receipt: PlaybackReceipt = { playedFrames: 0, writtenFrames: 0 };
            await this.api.synthesize(segment.text, this.deps.voice, this.deps.style, { signal: turn.signal,
              onRequest: () => this.deps.onRequest?.('tts'), onUsage: usage => this.deps.onUsage?.('tts', usage), onPcm: async pcm => {
                current();
                if (metrics.firstPcmMs === undefined) { metrics.firstPcmMs = this.now() - metrics.stoppedAt; metrics.ttsFirstChunkMs = this.now() - firstTtsStartedAt!; }
                await activation; current();
                await validateSources?.(); current();
                receipt = await this.audio.append(turn.id, pcm, turn.signal); current();
                this.acknowledgePlayback(turn, receipt);
              } });
            current(); return receipt;
          })().catch(error => {
            if (!workerFailedCurrent) workerError = error;
            if (this.lifecycle.isCurrent(turn) && !this.ended) { workerFailedCurrent = true; this.lifecycle.invalidate(); }
            wake?.(); room?.(); throw error;
          }).finally(() => resolveActivationCleanup());
          // Errors may arrive while the preceding sentence is draining.
          // Keep both pending promises observed, including cancellation.
          void done.catch(() => {}); void activation.catch(() => {});
          return { segment, done, activate };
        };
        let prefetched: ReturnType<typeof prepareSynthesis> | undefined;
        while (!finished || queue.length || prefetched) {
          current();
          const segment = prefetched?.segment ?? queue.shift();
          if (!segment) { await new Promise<void>(resolve => { wake = resolve; }); current(); continue; }
          notifyRoom();
          await validateSources?.(); current();
          this.lifecycle.transition('generating'); this.publish({ speakingText: '' });
          this.activeSegment = { turnId: turn.id, id: segment.id, text: segment.text, startFrame: segmentStart };
          if (!this.playbackStarted) { await this.audio.beginPlayback(turn.id, turn.signal); current(); this.playbackStarted = true; }
          const synthesis = prefetched ?? prepareSynthesis(segment); prefetched = undefined;
          synthesis.activate(segmentStart);
          await synthesis.done; current();
          // Only one future sentence can incur a request. No future PCM is
          // written until the preceding full playback receipt has been saved.
          const next = queue.shift();
          if (next) { prefetched = prepareSynthesis(next); notifyRoom(); }
          const receipt = await this.audio.drain(turn.id, turn.signal); current();
          if (receipt.complete !== true || receipt.playedFrames !== receipt.writtenFrames || receipt.writtenFrames <= segmentStart
            || !this.acknowledgePlayback(turn, receipt, true)) throw new Error('voice:audio_playback_receipt');
          segmentStart = receipt.writtenFrames;
          this.activeSegment = undefined;
          this.lifecycle.transition('generating');
          this.publish({ speakingText: '', heardText: this.lifecycle.receipt().filter(s => s.turnId === turn.id && s.playedAt !== undefined).map(s => s.text).join('') });
        }
      })().catch(error => {
        if (!workerFailedCurrent) workerError = error;
        if (this.lifecycle.isCurrent(turn) && !this.ended) {
          workerFailedCurrent = true;
          // Cancel the still-streaming dialogue too; waiting for its next delta
          // or network timeout would waste requests after speech is revoked.
          this.lifecycle.invalidate();
        }
        wake?.(); room?.();
      });
      const abortWake = () => { wake?.(); room?.(); };
      turn.signal.addEventListener('abort', abortWake, { once: true });
      const enqueue = async (text: string) => {
        current();
        const safe = reviewCallSpeech(contextualReview ? await contextualReview(text) : text);
        current();
        if (safe !== text.trim()) filtered = true;
        if (!safe) return;
        while (queue.length >= 3) { if (workerError) throw workerError; await new Promise<void>(resolve => { room = resolve; }); current(); }
        if (workerError) throw workerError;
        const segment = this.lifecycle.recordGenerated(turn, safe); if (segment) { queue.push(segment); accepted++; } wake?.(); wake = undefined;
      };
      try {
        const llmStartedAt = this.now();
        await this.api.dialogue(messages, { signal: turn.signal, onRequest: () => this.deps.onRequest?.('dialogue'), onUsage: usage => this.deps.onUsage?.('dialogue', usage), onText: async delta => {
          current(); if (delta && metrics.firstTextMs === undefined) { metrics.firstTextMs = this.now() - metrics.stoppedAt; metrics.llmFirstTokenMs = this.now() - llmStartedAt; }
          this.exchange!.generatedText += delta; this.publish({ generatedText: this.exchange!.generatedText });
          for (const sentence of splitter.push(delta)) await enqueue(sentence);
        } });
        current(); for (const sentence of splitter.push('', true)) await enqueue(sentence);
        if (accepted === 0) throw new Error(filtered ? 'voice:reply_filtered' : 'voice:reply_empty');
        finished = true; wake?.(); await worker; current(); if (workerError) throw workerError;
      } finally { finished = true; wake?.(); room?.(); turn.signal.removeEventListener('abort', abortWake); }
      // A fully drained turn no longer needs an AudioTrack or its native progress ticker.
      await this.audio.interrupt(); current();
      this.saveExchange(false); this.lifecycle.transition('listening'); this.publish();
    } catch (error) {
      if ((!this.lifecycle.isCurrent(turn) && !workerFailedCurrent) || this.ended || this.turn?.id !== turn.id) return;
      this.lifecycle.invalidate(); await this.audio.interrupt().catch(() => {}); await worker;
      this.saveExchange(true); this.fail(workerFailedCurrent ? workerError : error);
    }
  }
  interrupt(): Promise<void> {
    if (this.stopping) return this.stopping;
    if (this.ended || ['paused', 'error', 'connecting', 'initializing'].includes(this.lifecycle.phase)) return Promise.resolve();
    const exchange = this.exchange; const start = this.now();
    const turn = this.turn, segment = this.activeSegment;
    this.lifecycle.interrupt();
    this.publish({ speakingText: '' });
    const stopping = (async () => {
      try {
        const receipt = await this.audio.interrupt();
        if (turn && segment?.turnId === turn.id && receipt.turnId === turn.id
          && Number.isSafeInteger(receipt.playedFrames) && receipt.playedFrames >= segment.startFrame
          && receipt.playedFrames <= receipt.writtenFrames) {
          this.lifecycle.recordStoppedPlayback(turn, segment.id, receipt.playedFrames - segment.startFrame, receipt.sampleRate);
        }
      } catch (error) {
        if (!this.ended) this.fail(error);
        throw error;
      } finally {
        if (exchange) { exchange.metrics.interruptedAt = start; exchange.metrics.stopAcknowledgementMs = this.now() - start; }
        if (this.exchange === exchange) this.saveExchange(true);
        if (!this.ended && this.lifecycle.phase === 'interrupting') { this.lifecycle.transition('listening'); this.publish(); }
      }
    })();
    this.stopping = stopping;
    // Clear before callers awaiting the promise may start another turn.
    const clear = () => { if (this.stopping === stopping) this.stopping = undefined; };
    void stopping.then(clear, clear);
    return stopping;
  }
  private fail(error: unknown) {
    if (error instanceof Error && error.message === 'voice:source_withdrawn') this.sourceWithdrawn = true;
    this.lifecycle.invalidate(); if (this.lifecycle.phase !== 'ended') this.lifecycle.transition('error');
    this.clearCapture(); this.publish({ speakingText: '', error: error instanceof CallApiError ? error.code : error instanceof Error ? error.message : 'voice:unknown' });
    if (this.view.capabilities && this.audio.pause) {
      this.pausing = this.audio.pause().catch(() => this.audio.close()).catch(() => {});
    }
  }
  private mutePending = false;
  async mute(value: boolean) {
    if (this.ended || this.mutePending) return;
    this.mutePending = true; this.clearCapture();
    try { await this.audio.mute(value); if (!this.ended) this.publish({ muted: value, level: 0 }); }
    catch (error) { if (!this.ended) this.fail(error); throw error; }
    finally { this.mutePending = false; }
  }
  async resume() {
    if (this.ended || this.sourceWithdrawn || this.routePending || !['paused', 'error'].includes(this.lifecycle.phase)) return;
    await this.pausing;
    if (this.ended || this.sourceWithdrawn || this.routePending || !['paused', 'error'].includes(this.lifecycle.phase)) return;
    // A rejected permission/start has no live native session to resume.
    if (!this.view.capabilities) { await this.start(); return; }
    this.lifecycle.transition('connecting'); this.publish({ error: undefined });
    try {
      const result = await this.audio.resume();
      if (this.ended) return;
      // Reconcile the last acknowledged mute setting after a failed control
      // request. Capture remains excluded while the call is connecting.
      await this.audio.mute(this.view.muted);
      if (!this.ended) {
        this.clearCapture();
        if (this.lifecycle.phase === 'connecting') this.lifecycle.transition('listening');
        this.publish({ capabilities: { ...this.view.capabilities, routes: result.routes,
          echoCancellation: result.echoCancellation ?? this.view.capabilities.echoCancellation,
          noiseSuppression: result.noiseSuppression ?? this.view.capabilities.noiseSuppression } });
      }
    } catch (error) { if (!this.ended) this.fail(error); }
  }
  async refreshRoutes(requestBluetooth = false) {
    if (this.ended || this.routePending || !this.audio.routes) return;
    const query = ++this.routeQuery, events = this.routeEvents;
    if (requestBluetooth) await this.audio.requestBluetooth?.();
    if (this.ended || query !== this.routeQuery) return;
    const result = await this.audio.routes();
    if (!this.ended && query === this.routeQuery && events === this.routeEvents && this.view.capabilities) this.publish({ capabilities: { ...this.view.capabilities, routes: result.routes } });
  }
  async selectRoute(deviceId: number) {
    if (this.ended || this.routePending || !this.audio.route || !this.view.capabilities) return;
    if (!this.view.capabilities.routes.some(route => route.id === deviceId)) throw new Error('voice:route_unavailable');
    this.routePending = true; this.routeQuery++;
    const events = this.routeEvents;
    this.clearCapture(); this.publish({ routing: true, level: 0 });
    try {
      // Stop old output and inference before changing acoustic conditions.
      // Hold capture throughout both stop acknowledgement and route selection.
      await this.interrupt();
      if (this.ended) return;
      const result = await this.audio.route(deviceId);
      if (!this.ended && events === this.routeEvents) this.publish({ capabilities: { ...this.view.capabilities, routes: result.routes } });
    } catch (error) { if (!this.ended && this.lifecycle.phase !== 'error') this.fail(error); throw error; }
    finally { this.clearCapture(); this.routePending = false; this.publish({ routing: false }); }
  }
  async end(): Promise<CallExchange[]> {
    if (!this.ended) {
      const pendingStop = this.stopping;
      this.ended = true; this.lifecycle.end(); this.clearCapture();
      // Release native resources immediately, but do not snapshot an exchange
      // until an already-started stop has had a chance to attach its receipt.
      const release = this.audio.close();
      this.closing = (async () => {
        const [, released] = await Promise.allSettled([pendingStop ?? Promise.resolve(), release]);
        this.saveExchange(true); this.publish({ level: 0 });
        if (released.status === 'rejected') throw released.reason;
      })();
    }
    await this.closing;
    return this.getRecords();
  }
  getRecords(): CallExchange[] {
    return this.exchanges.map(exchange => ({ ...exchange, segments: exchange.segments.map(segment => ({ ...segment })), metrics: { ...exchange.metrics } }));
  }
}
