import { MimoCallClient, CallApiError, type CallMessage, type CallVoice, type CallApiUsage } from './mimo';
import {inspectDialogueSegment} from '../chat/output-contract';
import { NativeCallAudio, decodeCapture, type NativeAudioEvent, type AudioCapabilities, type PlaybackReceipt, type RouteObservation, type RouteSnapshot } from './native-audio';
import { CallLifecycle, type CallPhase, type CallTurn, type SpokenSegment } from './lifecycle';
import { UtteranceGate, pcmWav } from './utterance';
import { SpeechDeadlineQueue, type SpeechDeadlineScheduler } from './speech-deadline';
import { reviewCallSpeech } from './speech-quality';
import { MAX_CALL_TEXT_LENGTH, type CallInputMode } from './input';
import { copyCallTrace, recordCallTrace, type CallTrace, type CallTraceEvent } from './trace';
import { mapNativeTime, type NativeClockSnapshot, type NativeTimeInterval } from './clock';

export interface CallAudioPort {
  start(callback: (event: NativeAudioEvent) => void, options?: { inputMode: CallInputMode }): Promise<AudioCapabilities>;
  setInputMode?(mode: CallInputMode): Promise<void>;
  beginPlayback(turn: string, signal: AbortSignal): Promise<void>;
  append(turn: string, pcm: Uint8Array, signal: AbortSignal): Promise<PlaybackReceipt>;
  drain(turn: string, signal: AbortSignal, throughFrame?: number): Promise<PlaybackReceipt>;
  interrupt(completedTurnId?: string): Promise<PlaybackReceipt>; mute(value: boolean): Promise<void>;
  pause?(): Promise<void>;
  resume(): Promise<RouteSnapshot & { echoCancellation?: boolean; noiseSuppression?: boolean }>; close(): Promise<void>;
  routes?(): Promise<RouteSnapshot>;
  route?(deviceId: number, signal?: AbortSignal): Promise<RouteSnapshot>;
  cancelRouteWait?(): Promise<RouteSnapshot | void>;
  requestBluetooth?(): Promise<void>;
  clockSnapshot?(): NativeClockSnapshot;
}
export interface CallTurnMetrics {
  timeline?: CallTrace;
  /** Correlated receipt only, not a synchronized JS/native clock or acoustic endpoint. */
  captureBatchClock?: { nativeEmittedAtMs: number; jsReceivedAtMs: number;
    nativeReadCompletedAtMs?: number; generation?: number; sequence?: number;
    timestampFrame?: number; timestampAtMs?: number; timestampSampleRate?: number };
  /** Optional sampled-frame estimate plus bridge interval, separate from receipt-based latency. */
  speechSampleClock?: NativeTimeInterval;
  /** Actual software frame queue and optional native getters; not physical sound. */
  playback?: NonNullable<CallTraceEvent['playback']> & { peakQueuedFrames: number; peakQueuedMs: number };
  synthesizedPcmBytes?: number; enqueuedPcmBytes?: number; prefetchedPcmBytes?: number; ttsInputCharacters?: number;
  /** Wall time from preparation start to completion, including any endpoint gate wait. */
  contextPreparationMs?: number;
  contextEndpointGateWaitMs?: number;
  contextResidualWaitMs?: number; contextPreparationOverlapMs?: number;
  contextPreparationAttempts?: number; contextPreparationDiscarded?: number;
  speechEndedAt?: number; vadWaitMs?: number; firstPlaybackFromSpeechMs?: number;
  llmFirstTokenMs?: number; ttsFirstChunkMs?: number;
  /** Actual ASR request time, including work overlapped with endpoint detection. */
  asrRequestMs?: number;
  /** First safe clause ready for synthesis; distinct from first model token. */
  firstSpokenSegmentMs?: number;
  /** Cumulative local work; overlapping stages must not be added as wall time. */
  speechReviewMs?: number; speechReviewCount?: number;
  sourceCheckMs?: number; sourceCheckCount?: number;
  latencyBasis?: 'js-capture-receipt-with-frame-offset';
  turnId: string; stoppedAt: number; asrMs?: number; firstTextMs?: number; firstPcmMs?: number; firstPlaybackMs?: number;
  interruptedAt?: number; stopAcknowledgementMs?: number;
}
export interface CallExchange {
  /** A role-initiated presence check is never a user utterance. */
  origin?: 'presence-check';
  recordedAt?: number;
  turnId: string; userText: string; generatedText: string; heardText: string; interrupted: boolean;
  segments: SpokenSegment[]; metrics: CallTurnMetrics;
}
export interface CallView {
  /** Why capture is blocked. Only an observed focus loss permits automatic focus recovery. */
  pauseCause?: 'user' | 'focus' | 'background' | 'route' | 'network' | 'source' | 'permission' | 'device' | 'unknown';
  /** Wall-clock time is only for recovery UI, never a latency clock. */
  routeWait?: { requestId: number; deviceId?: number; requestedType?: number; startedAt: number; stage: 'waiting' | 'cancelling' };
  inputMode?: CallInputMode; inputModePending?: boolean;
  errorStage?: 'asr' | 'dialogue' | 'tts'; errorHttpStatus?: number;
  /** Current sanitized sentence being played, distinct from completed heardText. */
  speakingText?: string;
  phase: CallPhase; userText: string; generatedText: string; heardText: string; level: number;
  muted: boolean; routing?: boolean; error?: string; capabilities?: AudioCapabilities;
}
type Dependencies = {
  inputMode?: CallInputMode;
  audio?: CallAudioPort; api?: Pick<MimoCallClient, 'recognize' | 'dialogue' | 'synthesize'>;
  context: (text: string, exchanges: readonly CallExchange[], signal: AbortSignal, inputMode?: CallInputMode, trigger?: 'presence-check', preparation?: LocalContextPreparation) => Promise<CallMessage[] | PreparedCallContext>;
  /** Opt in only for the local composer. Never starts a speculative model request. */
  prepareContextDuringEndpoint?: boolean;
  voice: CallVoice; style: string; onView: (view: CallView) => void;
  onUsage?: (stage: 'asr' | 'dialogue' | 'tts', usage: CallApiUsage, requestId?: string) => void;
  onRequest?: (stage: 'asr' | 'dialogue' | 'tts', audioSeconds?: number, requestId?: string) => void;
  onExchange?: (exchange: CallExchange) => void;
  now?: () => number;
  presenceDelayMs?: number;
  /** Isolated local clock/timer injection; production uses the monotonic platform clock. */
  speechDeadlineScheduler?: SpeechDeadlineScheduler;
};
export interface PreparedCallContext {
  messages: CallMessage[];
  /** Read-only source validation; must not advance sentence filter state. */
  assertCurrent?: () => Promise<void>;
  reviewSpeech?: (text: string, onSourceCheck?: (durationMs: number) => void) => string | Promise<string>;
}

type ContextValue = CallMessage[] | PreparedCallContext;
export interface LocalContextPreparation {
  mode: 'early-local';
  /** Persistent retrieval bookkeeping waits for final, unchanged user input. */
  waitForEndpoint: () => Promise<void>;
}
interface LocalPreparation {
  text: string;
  revision: number;
  abort: AbortController;
  startedAt: number;
  endedAt?: number;
  endpointGateWaitMs?: number;
  commit: () => void;
  result: Promise<{ ok: true; value: ContextValue } | { ok: false; error: unknown }>;
}
interface PendingSpeech {
  preparation?: LocalPreparation;
  preparationAttempted?: boolean;
  queue: Uint8Array[];
  inFlight: boolean;
  final: boolean;
  cancelled: boolean;
  /** A new voice fragment joined an endpoint whose ASR is still pending. */
  continued?: boolean;
  stoppedAt?: number;
  speechEndedAt?: number;
  speechSampleClock?: NativeTimeInterval;
  turnId?: string;
  wake?: () => void;
}
const MAX_PENDING_ASR_SEGMENTS = 2; // Includes the one active request.

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
  private trailingSilenceFrames = 0;
  private segmentHasSpeech = false;
  private pendingSpeech?: PendingSpeech;
  private turn?: CallTurn;
  private pausing: Promise<void> = Promise.resolve();
  private resuming?: Promise<void>;
  private recoveryRevision = 0;
  private automaticRecoveryRevision = -1;
  private audioSuspended = false;
  private deviceStopping?: Promise<void>;
  private exchange?: CallExchange;
  private exchanges: CallExchange[] = [];
  private view: CallView = { phase: 'initializing', userText: '', generatedText: '', heardText: '', level: 0, muted: false };
  private ended = false;
  // Revoked in-memory exchanges cannot be repaired by resuming this call.
  private sourceWithdrawn = false;
  private startedAt = 0;
  private playbackStarted = false;
  /** Includes queued prefixes and bridge writes, independently of the UI phase. */
  private outputPending = false;
  private activeSegment?: { turnId: string; id: string; text: string; startFrame: number; endFrame?: number };
  private segmentSpans = new Map<string, { start: number; end?: number }>();
  private stopping?: Promise<void>;
  private closing?: Promise<void>;
  private lastSpeechAt?: number;
  private routePending = false;
  private routeControl = 0;
  private routeOperation?: { id: number; abort: AbortController; legacyConnecting?: boolean };
  private routeCancelling?: Promise<void>;
  private routeEvents = 0;
  private routeQuery = 0;
  private inputModePending = false;
  private textPending = false;
  private idleSince = 0;
  private lastCaptureReceiptAt?: number;
  private captureBatchClock?: CallTurnMetrics['captureBatchClock'];
  private lastSpeechSampleClock?: NativeTimeInterval;
  private nativeClock?: NativeClockSnapshot;
  private readonly diagnostics: CallTrace = { clock: 'js-monotonic', events: [], dropped: 0 };
  private observationKey?: string;
  private captureProgressKey?: string;
  private playbackProgressKey?: string;
  private presenceAsked = false;
  private speechRevision = 0;
  constructor(readonly callId: string, private readonly deps: Dependencies) {
    this.now = deps.now ?? performance.now.bind(performance);
    this.lifecycle = new CallLifecycle(callId);
    this.audio = deps.audio ?? new NativeCallAudio(callId);
    this.api = deps.api ?? new MimoCallClient();
    this.view.inputMode = deps.inputMode ?? 'voice';
  }
  private publish(patch: Partial<CallView> = {}) { this.view = { ...this.view, ...patch, ...(this.sourceWithdrawn ? { error: 'voice:source_withdrawn' } : {}), phase: this.lifecycle.phase }; this.deps.onView({ ...this.view }); }
  private trace(stage: CallTraceEvent['stage'], detail: Omit<CallTraceEvent, 'stage' | 'at'> = {}) {
    const metrics = this.exchange?.metrics;
    if (!metrics) return;
    metrics.timeline ??= { clock: 'js-monotonic', callId: this.callId, turnId: metrics.turnId, events: [], dropped: 0 };
    recordCallTrace(metrics.timeline, { stage, at: this.now(), ...detail });
  }
  private diagnostic(stage: CallTraceEvent['stage'], detail: Omit<CallTraceEvent, 'stage' | 'at'> = {}) {
    this.diagnostics.callId = this.callId;
    recordCallTrace(this.diagnostics, { stage, at: this.now(), ...detail });
    this.trace(stage, detail);
  }
  private observeRoute(route: RouteObservation | undefined, nativeTiming?: NativeTimeInterval) {
    if (!route) return;
    const key = JSON.stringify([route.routeGeneration, route.inputObserved, route.outputObserved, route.communicationObserved,
      route.inputType, route.outputType, route.communicationType]);
    if (key === this.observationKey) return;
    this.observationKey = key;
    this.diagnostic('route-observed', { routeGeneration: route.routeGeneration, routeObservation: route, nativeTiming });
  }
  async start() {
    if (this.ended || this.sourceWithdrawn) return;
    this.lifecycle.transition('connecting'); this.publish({ error: undefined });
    try {
      const capabilities = await this.audio.start(event => this.event(event), { inputMode: this.view.inputMode ?? 'voice' });
      if (this.ended) { await this.audio.close(); return; }
      this.diagnostic('route-confirmed', { routeGeneration: capabilities.routeGeneration });
      this.observeRoute(capabilities.routeObservation);
      this.startedAt = this.now();
      this.idleSince = this.startedAt;
      if (this.lifecycle.phase === 'connecting') this.lifecycle.transition('listening');
      if (this.lifecycle.phase === 'listening') this.audioSuspended = false;
      this.publish({ capabilities, ...(this.lifecycle.phase === 'listening' ? { pauseCause: undefined } : {}) });
    } catch (error) { if (!this.ended) this.fail(error); }
  }
  private canInterrupt(): boolean {
    const capabilities = this.view.capabilities;
    return !!capabilities?.echoCancellation || !!capabilities?.routes.some(route => route.selected && route.type !== undefined && route.type !== 2);
  }
  private event(event: NativeAudioEvent) {
    if (this.ended || event.callId !== this.callId) return;
    if (event.type === 'clock') {
      if (event.clock) { this.nativeClock = { ...event.clock }; this.diagnostic('clock-correlation', { clock: event.clock, routeGeneration: event.clock.routeGeneration }); }
      return;
    }
    this.observeRoute(event.routeObservation, event.timing);
    if (event.type === 'capture') {
      if (this.view.inputMode === 'text' || this.inputModePending || this.textPending) return;
      const pcm = decodeCapture(event); if (!pcm || this.routePending || this.mutePending || this.view.muted || ['paused', 'error', 'connecting', 'initializing'].includes(this.lifecycle.phase)) return;
      if (this.now() - this.startedAt > 60 * 60_000 || this.exchanges.length >= 200) { void this.end().catch(() => {}); return; }
      if ((this.outputPending || this.lifecycle.phase === 'playing') && !this.canInterrupt()) return;
      const receivedAt = this.now();
      // Missing audio callbacks cannot certify that the microphone heard silence.
      if (this.lastCaptureReceiptAt === undefined || receivedAt - this.lastCaptureReceiptAt > 1000) this.idleSince = receivedAt;
      this.lastCaptureReceiptAt = receivedAt;
      this.captureBatchClock = { nativeEmittedAtMs: event.at, jsReceivedAtMs: receivedAt,
        nativeReadCompletedAtMs: event.captureReadCompletedAtMs, generation: event.captureGeneration,
        sequence: event.sequence, timestampFrame: event.captureTimestampFrame,
        timestampAtMs: event.captureTimestampAtMs, timestampSampleRate: event.captureTimestampSampleRate };
      const clock = this.audio.clockSnapshot?.() ?? this.nativeClock;
      const sampleClock = clock && clock.routeGeneration === event.routeGeneration && event.captureSampleTimeBasis === 'audio-record-timestamp-estimate'
        && event.captureSampleEndAtMs !== undefined ? mapNativeTime(clock, event.captureSampleEndAtMs, receivedAt) : undefined;
      const captureKey = `${event.routeGeneration}:${event.captureGeneration}`;
      if (captureKey !== this.captureProgressKey) {
        this.captureProgressKey = captureKey;
        this.diagnostic('capture-progress', { routeGeneration: event.routeGeneration, frames: event.captureFrameEnd, nativeTiming: sampleClock ?? event.timing });
      }
      for (let offset = 0; offset < pcm.length; offset += 640) {
        const tailMs = (pcm.length - offset - 640) / 32;
        this.frame(pcm.slice(offset, offset + 640), receivedAt - tailMs, sampleClock && { ...sampleClock,
          nativeAtMs: sampleClock.nativeAtMs - tailMs, jsEarliestMs: sampleClock.jsEarliestMs - tailMs, jsLatestMs: sampleClock.jsLatestMs - tailMs });
      }
      this.maybeConfirmPresence();
      this.publish();
    } else if (event.type === 'interrupted') {
      if (this.view.inputMode === 'text' || this.inputModePending) return;
      this.playbackProgress(event);
      this.cancelPendingSpeech();
      void this.stopTurn().catch(error => { if (!this.ended) this.fail(error); });
    } else if (event.type === 'focusAvailable') {
      // This is evidence of available focus, not permission to override a user,
      // background, route, or source pause. The native resume still checks the
      // foreground, permissions and confirmed private audio route.
      void this.requestResume('focus').catch(() => {});
    } else if (event.type === 'paused' || event.type === 'routeLost') {
      this.diagnostic('route-lost', { routeGeneration: event.routeGeneration, nativeTiming: event.timing });
      this.routeEvents++;
      this.recoveryRevision++;
      this.audioSuspended = true;
      const reason = event.reason ?? '';
      const cause: CallView['pauseCause'] = event.type === 'routeLost' || /route|headset|bluetooth/.test(reason) ? 'route'
        : /background|lock/.test(reason) ? 'background'
          : /permission|microphone_denied|microphone_disabled/.test(reason) ? 'permission'
            : /audio[-_]focus/.test(reason) ? 'focus' : 'unknown';
      // Focus loss commonly follows another pause. It cannot demote that
      // stronger reason into an automatically recoverable one.
      if (this.sourceWithdrawn) this.view.pauseCause = 'source';
      else if (this.view.pauseCause !== 'user' && (cause !== 'focus' || !this.view.pauseCause || this.view.pauseCause === 'focus')) this.view.pauseCause = cause;
      const waiting = this.routeOperation;
      if (waiting && event.type === 'paused' && /bluetooth[-_]connecting/.test(event.reason ?? '')) waiting.legacyConnecting = true;
      else if (waiting) {
        this.routeOperation = undefined; waiting.abort.abort(); this.routePending = false;
        this.publish({ routing: false, routeWait: undefined });
      }
      this.lifecycle.pause(); this.clearCapture(); this.saveExchange(true);
      if (!this.deviceStopping) {
        const stop = this.audio.interrupt().then(() => {});
        this.deviceStopping = stop;
        const clear = () => { if (this.deviceStopping === stop) this.deviceStopping = undefined; };
        void stop.then(clear, error => { clear(); if (!this.ended) this.fail(error); });
      }
      this.publish({ error: event.reason ?? '音频设备发生变化，请确认后继续。' });
    } else if (event.type === 'ended') {
      void this.end().catch(() => {});
    } else if (event.type === 'routes' && event.routes && this.view.capabilities) {
      this.routeEvents++;
      if (this.routeOperation?.legacyConnecting && event.routes.some(route => route.id === this.view.routeWait?.deviceId && route.selected)) {
        this.routeOperation = undefined; this.routePending = false;
        this.publish({ routing: false, routeWait: undefined });
      }
      this.publish({ capabilities: { ...this.view.capabilities, routes: event.routes,
        routeGeneration: event.routeGeneration ?? this.view.capabilities.routeGeneration,
        routeObservation: event.routeObservation,
        echoCancellation: event.echoCancellation ?? this.view.capabilities.echoCancellation,
        noiseSuppression: event.noiseSuppression ?? this.view.capabilities.noiseSuppression } });
    } else if (event.type === 'playback' && this.turn && this.turn.id === event.turnId && this.lifecycle.isCurrent(this.turn)) {
      const key = `${event.turnId}:${event.routeGeneration}`;
      if (event.playedFrames !== undefined && event.playedFrames > 0 && key !== this.playbackProgressKey) {
        this.playbackProgressKey = key;
        this.diagnostic('native-playback-progress', { routeGeneration: event.routeGeneration, frames: event.playedFrames, nativeTiming: event.timing,
          playback: this.observePlayback(event) });
      }
      this.playbackProgress(event);
    }
  }
  private playbackProgress(event: NativeAudioEvent) {
    if (this.turn && event.turnId === this.turn.id) { this.observePlayback(event); this.acknowledgePlayback(this.turn, event); }
  }
  private observePlayback(receipt: Pick<NativeAudioEvent, 'playedFrames' | 'writtenFrames' | 'sampleRate'> &
    { bufferFrames?: number; startThresholdFrames?: number; underrunCount?: number; startupPaddingFrames?: number; nativeQueuedFrames?: number }): CallTraceEvent['playback'] {
    if (![8000, 24000].includes(receipt.sampleRate ?? 0) || !Number.isSafeInteger(receipt.playedFrames) || !Number.isSafeInteger(receipt.writtenFrames)
      || receipt.playedFrames! < 0 || receipt.writtenFrames! < receipt.playedFrames!) return undefined;
    const validCounter = (value: number | undefined) => Number.isSafeInteger(value) && value! >= 0 ? value : undefined;
    const voiceQueuedFrames = receipt.writtenFrames! - receipt.playedFrames!;
    const playback = { sampleRate: receipt.sampleRate!, queuedFrames: validCounter(receipt.nativeQueuedFrames) ?? voiceQueuedFrames,
      bufferFrames: validCounter(receipt.bufferFrames), startThresholdFrames: validCounter(receipt.startThresholdFrames), underrunCount: validCounter(receipt.underrunCount) };
    const padded = validCounter(receipt.startupPaddingFrames);
    const observation = { ...playback, ...(padded ? { startupPaddingFrames: padded, voiceQueuedFrames } : {}) };
    if (this.exchange) {
      const old = this.exchange.metrics.playback;
      this.exchange.metrics.playback = { ...observation, bufferFrames: playback.bufferFrames ?? old?.bufferFrames,
        startThresholdFrames: playback.startThresholdFrames ?? old?.startThresholdFrames,
        underrunCount: playback.underrunCount === undefined ? old?.underrunCount : Math.max(playback.underrunCount, old?.underrunCount ?? 0),
        peakQueuedFrames: Math.max(playback.queuedFrames, old?.peakQueuedFrames ?? 0),
        peakQueuedMs: Math.max(playback.queuedFrames * 1000 / playback.sampleRate, old?.peakQueuedMs ?? 0) };
    }
    return observation;
  }
  private acknowledgePlayback(turn: CallTurn, receipt: Pick<NativeAudioEvent, 'turnId' | 'playedFrames' | 'writtenFrames' | 'sampleRate'>, complete = false): boolean {
    const segment = this.activeSegment, played = receipt.playedFrames, written = receipt.writtenFrames;
    if (!this.lifecycle.isCurrent(turn) || segment?.turnId !== turn.id || (receipt.turnId !== undefined && receipt.turnId !== turn.id)
      || !Number.isSafeInteger(played) || !Number.isSafeInteger(written)
      || played! < segment.startFrame || written! < segment.startFrame || played! > written!) return false;
    const frames = Math.min(played!, segment.endFrame ?? played!) - segment.startFrame;
    if (!this.lifecycle.acknowledgePlayback(turn, segment.id, frames,
      complete && (segment.endFrame === undefined ? played === written : played! >= segment.endFrame), receipt.sampleRate)) return false;
    if (frames > 0) {
      // Creating a track or receiving PCM is not evidence of audible output.
      // The earliest valid native progress/append/drain receipt owns latency.
      const metrics = this.exchange?.metrics;
      if (metrics && metrics.firstPlaybackMs === undefined) {
        this.trace('render-progress', { segmentId: segment.id, frames });
        const at = this.now(); metrics.firstPlaybackMs = at - metrics.stoppedAt;
        if (metrics.speechEndedAt !== undefined) metrics.firstPlaybackFromSpeechMs = at - metrics.speechEndedAt;
      }
      if (this.lifecycle.phase !== 'playing' || this.view.speakingText !== segment.text) {
        this.lifecycle.transition('playing'); this.publish({ speakingText: segment.text });
      }
    }
    return true;
  }
  private frame(pcm: Uint8Array, frameAt: number, sampleClock?: NativeTimeInterval) {
    if (this.ended || this.inputModePending || this.textPending || this.view.inputMode === 'text' || ['paused', 'error', 'connecting', 'initializing'].includes(this.lifecycle.phase)) return;
    const values = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
    let energy = 0; for (let offset = 0; offset < pcm.length; offset += 2) { const value = values.getInt16(offset, true) / 32768; energy += value * value; }
    const rms = Math.sqrt(energy / (pcm.length / 2));
    const speech = this.gate.isSpeech(rms);
    if (speech) this.idleSince = this.now();
    if (speech) {
      this.lastSpeechAt = frameAt; this.speechRevision++;
      this.lastSpeechSampleClock = sampleClock && { ...sampleClock };
      this.discardPreparation(this.pendingSpeech);
    }
    this.trailingSilenceFrames = speech ? 0 : Math.min(35, this.trailingSilenceFrames + 1);
    this.preRoll.push(pcm); if (this.preRoll.length > 10) this.preRoll.shift();
    // Early chunks may use only an idle ASR path. Reserve the second slot for
    // the final tail: a slow first request must not make ordinary continued
    // speech overflow the two-chunk queue simply because we started early.
    const recognitionRoom = !this.pendingSpeech || !this.pendingSpeech.inFlight && this.pendingSpeech.queue.length === 0;
    const status = this.gate.push(rms, 20, recognitionRoom);
    if (status === 'start') {
      const pending = this.pendingSpeech;
      if (pending?.final && !pending.cancelled && (pending.inFlight || pending.queue.length)
        && this.lifecycle.phase === 'recognizing' && this.turn && this.turn.id === pending.turnId && this.lifecycle.isCurrent(this.turn)) {
        // A slow recognizer is not a reason to erase the previous sentence.
        // Keep its upload and verified prefix, and wait for this new tail too.
        pending.final = false; pending.continued = true;
      } else {
        this.cancelPendingSpeech();
        if (this.turn && this.lifecycle.isCurrent(this.turn)) void this.stopTurn().catch(error => { if (!this.ended) this.fail(error); });
      }
      this.capture = [...this.preRoll]; this.captureBytes = this.capture.reduce((n, frame) => n + frame.length, 0);
      this.segmentHasSpeech = true;
    } else if (this.capture) { this.capture.push(pcm); this.captureBytes += pcm.length; }
    if (this.capture && speech) this.segmentHasSpeech = true;
    if (status === 'discard') {
      this.capture = null; this.captureBytes = 0; this.segmentHasSpeech = false;
      const pending = this.pendingSpeech;
      if (pending?.continued) {
        // The tentative continuation was only short noise. Its predecessor
        // still has its original endpoint and must not wait forever for a tail.
        pending.continued = false; pending.final = true; pending.wake?.(); pending.wake = undefined;
      }
    }
    if (status === 'end' || status === 'recognize' || status === 'segment' || this.captureBytes >= 960000) {
      const final = status === 'end';
      const chunks = this.capture; this.capture = null; this.captureBytes = 0;
      let utterance: Uint8Array | undefined;
      if (chunks?.length && this.segmentHasSpeech) {
        // Only a real pause trims silence. Continuing segments keep every
        // frame, and the following segment begins strictly after this one.
        const trimFrames = final || status === 'recognize' ? Math.max(0, this.trailingSilenceFrames - 10) : 0;
        const trimmed = chunks.slice(0, Math.max(1, chunks.length - trimFrames));
        utterance = new Uint8Array(trimmed.reduce((n, item) => n + item.length, 0));
        let offset = 0; for (const part of trimmed) { utterance.set(part, offset); offset += part.length; }
      }
      this.submitSpeech(utterance, final);
      this.preRoll = []; this.trailingSilenceFrames = 0; this.segmentHasSpeech = false;
      if (final) this.gate.reset();
      else if (!['error', 'paused', 'ended'].includes(this.lifecycle.phase)) { this.capture = []; this.gate.segmentBoundary(status !== 'recognize'); }
    }
    // Capture arrives at 10Hz, but frame analysis remains at 20ms.
    this.view.level = Math.min(1, rms * 8);
  }
  private cancelPendingSpeech() {
    const speech = this.pendingSpeech;
    this.pendingSpeech = undefined;
    if (speech) { this.discardPreparation(speech); speech.cancelled = true; speech.queue = []; speech.wake?.(); speech.wake = undefined; }
  }
  private discardPreparation(speech: PendingSpeech | undefined) {
    const preparation = speech?.preparation;
    if (!preparation || preparation.abort.signal.aborted) return;
    preparation.abort.abort();
    if (this.exchange && this.exchange.turnId === speech?.turnId) {
      this.exchange!.metrics.contextPreparationDiscarded = (this.exchange!.metrics.contextPreparationDiscarded ?? 0) + 1;
      this.trace('context-discarded');
    }
  }
  private beginPreparation(speech: PendingSpeech, turn: CallTurn, text: string, early = false): LocalPreparation {
    const abort = new AbortController(), cancel = () => abort.abort();
    turn.signal.addEventListener('abort', cancel, { once: true });
    abort.signal.addEventListener('abort', () => turn.signal.removeEventListener('abort', cancel), { once: true });
    if (turn.signal.aborted) abort.abort();
    let commit = () => {};
    const commitReady = early ? new Promise<void>((resolve, reject) => {
      const revoke = () => reject(new DOMException('Aborted', 'AbortError'));
      abort.signal.addEventListener('abort', revoke, { once: true });
      commit = () => { abort.signal.removeEventListener('abort', revoke); resolve(); };
      if (abort.signal.aborted) revoke();
    }) : Promise.resolve();
    void commitReady.catch(() => {});
    const preparation: LocalPreparation = { text, revision: this.speechRevision, abort, startedAt: this.now(), result: undefined!, commit };
    if (this.exchange?.turnId === turn.id) {
      this.exchange!.metrics.contextPreparationAttempts = (this.exchange!.metrics.contextPreparationAttempts ?? 0) + 1;
      this.trace('context-start');
    }
    // Observe both synchronous failures and late rejection after cancellation.
    preparation.result = Promise.resolve().then(() => {
      if (abort.signal.aborted) throw new DOMException('Aborted', 'AbortError');
      return this.deps.context(text, this.exchanges, abort.signal, 'voice', undefined, early ? {
        mode: 'early-local', waitForEndpoint: () => {
          const waitingAt = this.now();
          return commitReady.finally(() => { preparation.endpointGateWaitMs = Math.max(0, this.now() - waitingAt); });
        },
      } : undefined);
    }).then(value => ({ ok: true as const, value }), error => ({ ok: false as const, error })).finally(() => {
      preparation.endedAt = this.now();
      if (!abort.signal.aborted && this.exchange?.turnId === turn.id && this.lifecycle.isCurrent(turn)) {
        this.trace('context-end', { durationMs: preparation.endedAt - preparation.startedAt });
      }
    });
    if (early) { speech.preparationAttempted = true; speech.preparation = preparation; }
    return preparation;
  }
  private clearCapture() { this.cancelPendingSpeech(); this.capture = null; this.captureBytes = 0; this.preRoll = []; this.trailingSilenceFrames = 0; this.segmentHasSpeech = false; this.lastSpeechAt = undefined; this.lastSpeechSampleClock = undefined; this.lastCaptureReceiptAt = undefined; this.gate.reset(); }
  private submitSpeech(pcm: Uint8Array | undefined, final: boolean) {
    if (this.ended || ['error', 'paused', 'connecting', 'initializing'].includes(this.lifecycle.phase)) return;
    let speech = this.pendingSpeech;
    const start = !speech;
    if (!speech) {
      if (!pcm) return;
      speech = { queue: [], inFlight: false, final: false, cancelled: false };
      this.pendingSpeech = speech;
    }
    if (pcm) {
      if (speech.queue.length + Number(speech.inFlight) >= MAX_PENDING_ASR_SEGMENTS) {
        const tail = speech.queue[0];
        if (speech.continued && speech.inFlight && speech.queue.length === 1 && tail.length + pcm.length <= 960000) {
          // Only combine audio that has not been uploaded yet. Keep the same
          // two-request / 30-second-per-WAV bounds when another fragment joins.
          const merged = new Uint8Array(tail.length + pcm.length); merged.set(tail); merged.set(pcm, tail.length); speech.queue[0] = merged;
        } else { this.saveExchange(true); this.fail(new Error('voice:utterance_queue_full')); return; }
      } else speech.queue.push(pcm);
    }
    if (final) {
      speech.continued = false;
      speech.final = true; speech.stoppedAt = this.now(); speech.speechEndedAt = this.lastSpeechAt;
      speech.speechSampleClock = this.lastSpeechSampleClock && { ...this.lastSpeechSampleClock };
      if (this.exchange && this.exchange.turnId === speech.turnId) Object.assign(this.exchange.metrics, {
        stoppedAt: speech.stoppedAt, speechEndedAt: speech.speechEndedAt,
        captureBatchClock: this.captureBatchClock,
        speechSampleClock: speech.speechSampleClock,
        vadWaitMs: speech.speechEndedAt === undefined ? undefined : Math.max(0, speech.stoppedAt - speech.speechEndedAt),
      });
      if (this.exchange?.turnId === speech.turnId) this.trace('endpoint');
    }
    speech.wake?.(); speech.wake = undefined;
    if (start) void this.respond(speech).catch(error => { if (!this.ended && this.pendingSpeech === speech) this.fail(error); });
  }
  private saveExchange(interrupted: boolean) {
    if (!this.exchange) return;
    const segments = this.lifecycle.receipt().filter(segment => segment.turnId === this.exchange!.turnId).map(segment => {
      const span = this.segmentSpans.get(segment.id); this.segmentSpans.delete(segment.id);
      return span ? { ...segment, playbackStartFrame: span.start, playbackEndFrame: span.end } : segment;
    });
    this.exchange.segments = segments; this.exchange.heardText = segments.filter(s => s.playedAt !== undefined).map(s => s.text).join('');
    this.exchange.interrupted = interrupted;
    this.exchange.recordedAt = Date.now();
    const saved = this.exchange;
    // Streaming ASR drafts are useful subtitles, but cancellation/failure may
    // only leave the prefix whose recognition actually completed.
    this.view.userText = saved.userText;
    this.exchanges.push(saved); this.exchange = undefined;
    this.deps.onExchange?.({ ...saved, segments: saved.segments.map(segment => ({ ...segment })), metrics: {
      ...saved.metrics, timeline: copyCallTrace(saved.metrics.timeline),
      captureBatchClock: saved.metrics.captureBatchClock && { ...saved.metrics.captureBatchClock },
      speechSampleClock: saved.metrics.speechSampleClock && { ...saved.metrics.speechSampleClock },
      playback: saved.metrics.playback && { ...saved.metrics.playback },
    } });
  }
  private maybeConfirmPresence() {
    if (this.presenceAsked || this.ended || this.sourceWithdrawn || this.view.inputMode !== 'voice'
      || this.view.muted || this.routePending || this.mutePending || this.inputModePending || this.textPending
      || this.capture || this.pendingSpeech || this.stopping || this.lifecycle.phase !== 'listening'
      || this.now() - this.idleSince < (this.deps.presenceDelayMs ?? 20_000)) return;
    this.presenceAsked = true;
    const speech: PendingSpeech = { queue: [], inFlight: false, final: true, cancelled: false, stoppedAt: this.now() };
    this.pendingSpeech = speech;
    void this.respond(speech, '', true).catch(error => { if (!this.ended) this.fail(error); });
  }
  private async respond(speech: PendingSpeech, typedText?: string, presence = false) {
    if (this.ended || speech.cancelled || this.pendingSpeech !== speech || ['error', 'paused', 'connecting', 'initializing'].includes(this.lifecycle.phase)) return;
    if (this.stopping) await this.stopping;
    if (this.turn && this.lifecycle.isCurrent(this.turn)) await this.stopTurn();
    if (this.ended || speech.cancelled || this.pendingSpeech !== speech || this.lifecycle.phase !== 'listening') return;
    const turn = this.lifecycle.beginTurn(typedText === undefined ? 'voice' : 'text'); this.turn = turn; this.playbackStarted = false; this.outputPending = false;
    speech.turnId = turn.id;
    const metrics: CallTurnMetrics = { turnId: turn.id, stoppedAt: speech.stoppedAt ?? this.now(), ...(typedText === undefined ? {
      speechEndedAt: speech.speechEndedAt,
      captureBatchClock: this.captureBatchClock,
      speechSampleClock: speech.speechSampleClock && { ...speech.speechSampleClock },
      vadWaitMs: speech.speechEndedAt === undefined ? undefined : Math.max(0, this.now() - speech.speechEndedAt), latencyBasis: 'js-capture-receipt-with-frame-offset' as const,
    } : {}) };
    this.exchange = { turnId: turn.id, userText: typedText ?? '', generatedText: '', heardText: '', interrupted: false, segments: [], metrics, ...(presence ? { origin: 'presence-check' as const } : {}) };
    if (speech.final) this.trace('endpoint');
    this.publish({ userText: typedText ?? '', generatedText: '', heardText: '', speakingText: '', error: undefined });
    const current = () => { if (!this.lifecycle.isCurrent(turn)) throw new DOMException('Aborted', 'AbortError'); };
    let worker: Promise<void> | undefined;
    let workerError: unknown, workerFailedCurrent = false;
    let firstTtsStartedAt: number | undefined;
    try {
      const abortRecognitionWake = () => speech.wake?.();
      turn.signal.addEventListener('abort', abortRecognitionWake, { once: true });
      let userText = typedText ?? '';
      let recognitionAttempt = 0;
      try {
        while (!speech.final || speech.queue.length) {
          current(); if (speech.cancelled || this.pendingSpeech !== speech) throw new DOMException('Aborted', 'AbortError');
          const pcm = speech.queue.shift();
          if (!pcm) { await new Promise<void>(resolve => { speech.wake = resolve; }); continue; }
          speech.inFlight = true;
          let recognized: string;
          const recognitionStartedAt = this.now();
          const recognitionId = `asr:${turn.id}:${++recognitionAttempt}`;
          const recognitionRevision = this.speechRevision;
          let firstRecognitionText = true;
          try {
            recognized = (await this.api.recognize(pcmWav(pcm), { signal: turn.signal,
              onRequest: () => { current(); this.trace('asr-send', { requestId: recognitionId }); this.deps.onRequest?.('asr', pcm.length / 32000, recognitionId); }, onUsage: usage => this.deps.onUsage?.('asr', usage, recognitionId),
              onText: text => {
                current();
                if (text.trim() && firstRecognitionText) { firstRecognitionText = false; this.trace('asr-first', { requestId: recognitionId }); }
                const draft = [userText, text.trim()].filter(Boolean).join('\n');
                if (draft.length > MAX_CALL_TEXT_LENGTH) throw new Error('voice:utterance_transcript_limit');
                this.publish({ userText: draft });
              },
            })).trim();
          } finally {
            speech.inFlight = false;
            metrics.asrRequestMs = (metrics.asrRequestMs ?? 0) + Math.max(0, this.now() - recognitionStartedAt);
          }
          current(); if (speech.cancelled || this.pendingSpeech !== speech) throw new DOMException('Aborted', 'AbortError');
          this.trace('asr-final', { requestId: recognitionId });
          const merged = [userText, recognized].filter(Boolean).join('\n');
          if (merged.length > MAX_CALL_TEXT_LENGTH) throw new Error('voice:utterance_transcript_limit');
          userText = merged;
          // Only complete ASR results are facts. Cancellation preserves this
          // verified prefix and never promotes streaming drafts or queued PCM.
          this.exchange!.userText = userText; this.publish({ userText });
          if (this.deps.prepareContextDuringEndpoint && !speech.final && !speech.queue.length
            && !speech.preparationAttempted && userText && recognitionRevision === this.speechRevision) {
            this.beginPreparation(speech, turn, userText, true);
          }
        }
      } finally { turn.signal.removeEventListener('abort', abortRecognitionWake); }
      current();
      if (this.pendingSpeech === speech) this.pendingSpeech = undefined;
      if (typedText === undefined) metrics.asrMs = Math.max(0, this.now() - metrics.stoppedAt);
      if (!userText && !presence) { this.exchange = undefined; this.lifecycle.transition('listening'); this.publish(); return; }
      this.exchange!.userText = userText;
      if (userText) this.presenceAsked = false;
      const contextStartedAt = this.now();
      let prepared: ContextValue;
      const early = speech.preparation;
      if (early && !early.abort.signal.aborted && early.text === userText && early.revision === this.speechRevision) {
        early.commit();
        const result = await early.result; current();
        if (result.ok && !early.abort.signal.aborted) {
          prepared = result.value;
          metrics.contextPreparationMs = (early.endedAt ?? this.now()) - early.startedAt;
          metrics.contextEndpointGateWaitMs = early.endpointGateWaitMs;
          metrics.contextPreparationOverlapMs = Math.max(0, Math.min(early.endedAt ?? this.now(), metrics.stoppedAt) - early.startedAt);
        } else {
          this.discardPreparation(speech);
          const retry = this.beginPreparation(speech, turn, userText);
          const fresh = await retry.result; current(); if (!fresh.ok) throw fresh.error;
          prepared = fresh.value; metrics.contextPreparationMs = (retry.endedAt ?? this.now()) - retry.startedAt;
        }
      } else {
        this.discardPreparation(speech);
        this.trace('context-start');
        metrics.contextPreparationAttempts = (metrics.contextPreparationAttempts ?? 0) + 1;
        prepared = await this.deps.context(presence ? '通话中的停顿' : userText, this.exchanges, turn.signal, presence || typedText === undefined ? 'voice' : 'text', presence ? 'presence-check' : undefined); current();
        metrics.contextPreparationMs = this.now() - contextStartedAt;
        this.trace('context-end', { durationMs: metrics.contextPreparationMs });
      }
      metrics.contextResidualWaitMs = this.now() - contextStartedAt;
      const messages = Array.isArray(prepared) ? prepared : prepared.messages;
      const contextualReview = Array.isArray(prepared) ? undefined : prepared.reviewSpeech;
      const assertSources = Array.isArray(prepared) ? undefined : prepared.assertCurrent;
      const observedSourceCheck = (durationMs: number) => {
        metrics.sourceCheckCount = (metrics.sourceCheckCount ?? 0) + 1;
        metrics.sourceCheckMs = (metrics.sourceCheckMs ?? 0) + durationMs;
        if (this.exchange?.turnId === turn.id) this.trace('source-check', { durationMs });
      };
      const validateSources = assertSources ? async () => {
        const started = this.now();
        try { await assertSources(); }
        finally { observedSourceCheck(Math.max(0, this.now() - started)); }
      } : undefined;
      this.lifecycle.transition('generating'); this.publish({ userText });
      const queue: SpokenSegment[] = []; let finished = false;
      let filtered = false, accepted = 0;
      let wake: (() => void) | undefined, room: (() => void) | undefined;
      let prefetchNext: (() => void) | undefined;
      let offerLeading: (() => void) | undefined;
      const notifyRoom = () => { room?.(); room = undefined; };
      const segmentDrain = this.view.capabilities?.segmentDrain === true;
      worker = (async () => {
        let segmentStart = 0;
        let prefetchReady = false;
        const prepareSynthesis = (segment: SpokenSegment, isPrefetch = false) => {
          let activate!: (start: number) => void;
          let fullyActive = false, leadingRequested = false, firstPacketBytes = 0;
          let permitLeading!: () => void, finishLeading!: () => void, failLeading!: (error: unknown) => void;
          const leadingPermission = new Promise<void>(resolve => { permitLeading = resolve; });
          const leadingComplete = new Promise<void>((resolve, reject) => { finishLeading = resolve; failLeading = reject; });
          void leadingComplete.catch(() => {});
          let resolveActivationCleanup: () => void = () => {};
          const activation = new Promise<number>((resolve, reject) => {
            activate = start => { fullyActive = true; resolve(start); };
            const abort = () => { const error = new DOMException('Aborted', 'AbortError'); reject(error); failLeading(error); };
            turn.signal.addEventListener('abort', abort, { once: true });
            resolveActivationCleanup = () => turn.signal.removeEventListener('abort', abort);
          });
          // One future stream remains bounded at its first callback. A backend
          // with segment-frame drain can admit one ready 200ms prefix; all
          // remaining PCM still waits for the preceding full segment receipt.
          const done = (async () => {
            await validateSources?.(); current();
            if (firstTtsStartedAt === undefined) firstTtsStartedAt = this.now();
            let receipt: PlaybackReceipt = { playedFrames: 0, writtenFrames: 0 };
            let firstSegmentPcm = true;
            const append = async (pcm: Uint8Array) => {
              // Match the native bridge block budget. A large provider event
              // must not keep reusing one permission check while audio drains.
              for (let offset = 0; offset < pcm.length; offset += 9600) {
                const block = pcm.subarray(offset, offset + 9600);
                await validateSources?.(); current();
                this.trace('append-start', { segmentId: segment.id, frames: block.length / 2 });
                this.outputPending = true;
                receipt = await this.audio.append(turn.id, block, turn.signal); current();
                metrics.enqueuedPcmBytes = (metrics.enqueuedPcmBytes ?? 0) + block.length;
                const clock = this.audio.clockSnapshot?.() ?? this.nativeClock;
                const nativeTiming = clock && clock.routeGeneration === receipt.routeGeneration && receipt.nativeWriteCompletedAtMs !== undefined
                  ? mapNativeTime(clock, receipt.nativeWriteCompletedAtMs, this.now()) : undefined;
                this.trace('append-end', { segmentId: segment.id, frames: receipt.writtenFrames, nativeTiming, playback: this.observePlayback(receipt) });
                this.acknowledgePlayback(turn, receipt);
                prefetchReady = true; prefetchNext?.();
              }
            };
            await this.api.synthesize(segment.text, this.deps.voice, this.deps.style, { signal: turn.signal,
              onRequest: () => { current(); metrics.ttsInputCharacters = (metrics.ttsInputCharacters ?? 0) + Array.from(segment.text).length; this.trace('tts-send', { segmentId: segment.id, requestId: `tts:${segment.id}` }); this.deps.onRequest?.('tts', undefined, `tts:${segment.id}`); }, onUsage: usage => this.deps.onUsage?.('tts', usage, `tts:${segment.id}`), onPcm: async pcm => {
                current();
                metrics.synthesizedPcmBytes = (metrics.synthesizedPcmBytes ?? 0) + pcm.length;
                if (isPrefetch) metrics.prefetchedPcmBytes = (metrics.prefetchedPcmBytes ?? 0) + pcm.length;
                const first = firstSegmentPcm;
                if (first) { firstSegmentPcm = false; firstPacketBytes = pcm.length; this.trace('tts-first-pcm', { segmentId: segment.id }); }
                if (first) offerLeading?.();
                if (metrics.firstPcmMs === undefined) { metrics.firstPcmMs = this.now() - metrics.stoppedAt; metrics.ttsFirstChunkMs = this.now() - firstTtsStartedAt!; }
                if (first) await Promise.race([activation, leadingPermission]); else await activation;
                current();
                if (first && leadingRequested && !fullyActive) {
                  const prefixBytes = Math.min(9600, pcm.length);
                  await append(pcm.subarray(0, prefixBytes)); finishLeading();
                  if (prefixBytes < pcm.length) {
                    await activation; current();
                    await append(pcm.subarray(prefixBytes));
                  }
                } else { await activation; current(); await append(pcm); if (first && leadingRequested) finishLeading(); }
              } });
            current(); return receipt;
          })().catch(error => {
            failLeading(error);
            if (!workerFailedCurrent) workerError = error;
            if (this.lifecycle.isCurrent(turn) && !this.ended) { workerFailedCurrent = true; this.lifecycle.invalidate(); }
            wake?.(); room?.(); throw error;
          }).finally(() => resolveActivationCleanup());
          // Errors may arrive while the preceding sentence is draining.
          // Keep both pending promises observed, including cancellation.
          void done.catch(() => {}); void activation.catch(() => {});
          return { segment, done, activate, tryLead: () => {
            // Tiny packets stay on the legacy activation path: an early 10ms
            // fragment would move the pause into the middle of a sentence.
            if (!segmentDrain || fullyActive || leadingRequested || firstPacketBytes < 9600) return undefined;
            leadingRequested = true; permitLeading(); return leadingComplete;
          } };
        };
        let prefetched: ReturnType<typeof prepareSynthesis> | undefined;
        const leadNext = () => prefetched?.tryLead();
        prefetchNext = () => {
          if (!prefetchReady || prefetched || !this.lifecycle.isCurrent(turn)) return;
          const next = queue.shift();
          if (next) { prefetched = prepareSynthesis(next, true); notifyRoom(); }
        };
        while (!finished || queue.length || prefetched) {
          current();
          const segment = prefetched?.segment ?? queue.shift();
          if (!segment) { await new Promise<void>(resolve => { wake = resolve; }); current(); continue; }
          notifyRoom();
          prefetchReady = false;
          await validateSources?.(); current();
          this.lifecycle.transition('generating'); this.publish({ speakingText: '' });
          this.activeSegment = { turnId: turn.id, id: segment.id, text: segment.text, startFrame: segmentStart };
          this.segmentSpans.set(segment.id, { start: segmentStart });
          const synthesis = prefetched ?? prepareSynthesis(segment); prefetched = undefined;
          // The first network request and track setup are independent. PCM is
          // gated until setup succeeds, then revalidated immediately before use.
          if (!this.playbackStarted) { await this.audio.beginPlayback(turn.id, turn.signal); current(); this.playbackStarted = true; }
          synthesis.activate(segmentStart);
          const completed = await synthesis.done; current();
          const endFrame = completed.writtenFrames;
          if (!Number.isSafeInteger(endFrame) || endFrame <= segmentStart) throw new Error('voice:audio_playback_receipt');
          this.activeSegment.endFrame = endFrame;
          this.segmentSpans.set(segment.id, { start: segmentStart, end: endFrame });
          prefetchReady = true;
          prefetchNext();
          let leading: Promise<void> | undefined;
          const tryOffer = () => {
            if (leading) return;
            leading = leadNext();
            if (leading) void leading.catch(() => {});
          };
          offerLeading = segmentDrain ? tryOffer : undefined;
          try {
            tryOffer();
            const receipt = await this.audio.drain(turn.id, turn.signal, segmentDrain ? endFrame : undefined); current();
            offerLeading = undefined;
            if (receipt.complete !== true || (segmentDrain
              ? receipt.throughFrame !== endFrame || receipt.playedFrames < endFrame || receipt.writtenFrames < endFrame
              : receipt.playedFrames !== receipt.writtenFrames || receipt.writtenFrames !== endFrame)
              || !this.acknowledgePlayback(turn, receipt, true)) throw new Error('voice:audio_playback_receipt');
            this.trace('segment-drained', { segmentId: segment.id, frames: receipt.playedFrames, playback: this.observePlayback(receipt) });
            this.publish({ heardText: this.lifecycle.receipt().filter(s => s.turnId === turn.id && s.playedAt !== undefined).map(s => s.text).join('') });
            // The next segment owns its pending prefix once this boundary is
            // confirmed. Waiting for that write here would delay its remaining
            // stream and starve later short segments on a small native buffer.
          } finally { offerLeading = undefined; }
          segmentStart = endFrame;
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
      }).finally(() => { prefetchNext = undefined; offerLeading = undefined; });
      const abortWake = () => { wake?.(); room?.(); };
      turn.signal.addEventListener('abort', abortWake, { once: true });
      const enqueue = async (text: string) => {
        current();
        this.trace('speakable');
        const reviewStarted = this.now();
        this.trace('review-start');
        let safe: string;
        metrics.speechReviewCount = (metrics.speechReviewCount ?? 0) + 1;
        try { safe = reviewCallSpeech(contextualReview ? await contextualReview(text, observedSourceCheck) : text,userText); }
        finally { metrics.speechReviewMs = (metrics.speechReviewMs ?? 0) + Math.max(0, this.now() - reviewStarted); }
        current();
        this.trace('review-end', { durationMs: this.now() - reviewStarted });
        if (safe !== text.trim()) filtered = true;
        if (!safe) return;
        while (queue.length >= 3) { if (workerError) throw workerError; await new Promise<void>(resolve => { room = resolve; }); current(); }
        if (workerError) throw workerError;
        const segment = this.lifecycle.recordGenerated(turn, safe); if (segment) {
          queue.push(segment); accepted++;
          metrics.firstSpokenSegmentMs ??= this.now() - metrics.stoppedAt;
        }
        prefetchNext?.(); wake?.(); wake = undefined;
      };
      const phrases = new SpeechDeadlineQueue({ signal: turn.signal, onSentence: enqueue, scheduler: this.deps.speechDeadlineScheduler,
        onFailure: error => {
          if (this.lifecycle.isCurrent(turn) && !this.ended) { workerError = error; workerFailedCurrent = true; this.lifecycle.invalidate(); }
          wake?.(); room?.();
        } });
      try {
        // Prepared sources may have been revoked while context was assembled.
        // Check before transmission as well as before synthesis and playback.
        await validateSources?.(); current();
        const llmStartedAt = this.now();
        await this.api.dialogue(messages, { signal: turn.signal, onRequest: () => { current(); this.trace('llm-send', { requestId: `dialogue:${turn.id}` }); this.deps.onRequest?.('dialogue', undefined, `dialogue:${turn.id}`); }, onUsage: usage => this.deps.onUsage?.('dialogue', usage, `dialogue:${turn.id}`), onText: async delta => {
          current(); if (delta && metrics.firstTextMs === undefined) { this.trace('llm-first'); metrics.firstTextMs = this.now() - metrics.stoppedAt; metrics.llmFirstTokenMs = this.now() - llmStartedAt; }
          this.exchange!.generatedText += delta;
          const dialogue=inspectDialogueSegment(this.exchange!.generatedText,'voice',false);
          if(dialogue.status==='reject')throw Error('voice:reply_filtered');
          if(dialogue.status==='ready')this.publish({generatedText:this.exchange!.generatedText});
          await phrases.push(delta);
        } });
        current();
        if(this.exchange!.generatedText.trim()&&inspectDialogueSegment(this.exchange!.generatedText,'voice',true).status!=='ready')throw Error('voice:reply_filtered');
        await phrases.push('', true);
        if (accepted === 0) throw new Error(filtered ? 'voice:reply_filtered' : 'voice:reply_empty');
        finished = true; wake?.(); await worker; current(); if (workerError) throw workerError;
      } finally { phrases.dispose(); finished = true; wake?.(); room?.(); turn.signal.removeEventListener('abort', abortWake); }
      // A fully drained turn no longer needs an AudioTrack or its native progress ticker.
      await this.audio.interrupt(turn.id); current();
      this.outputPending = false;
      this.saveExchange(false); this.idleSince = this.now(); this.lifecycle.transition('listening'); this.publish();
    } catch (error) {
      const failedExchange = this.exchange;
      if ((!this.lifecycle.isCurrent(turn) && !workerFailedCurrent) || this.ended || this.turn?.id !== turn.id || failedExchange?.turnId !== turn.id) return;
      this.lifecycle.invalidate(); await this.audio.interrupt().catch(() => {}); await worker;
      // A manual stop/device pause may have saved this exchange while native
      // cleanup was pending. Its late result has no authority over a new turn.
      if (this.ended || this.turn?.id !== turn.id || this.exchange !== failedExchange) return;
      this.saveExchange(true); this.fail(workerFailedCurrent ? workerError : error);
    }
  }
  async setInputMode(mode: CallInputMode): Promise<void> {
    if (mode !== 'voice' && mode !== 'text') throw new Error('voice:input_mode_unavailable');
    if (this.ended) return;
    if (this.inputModePending || this.textPending) throw new Error('voice:input_mode_pending');
    if (mode === this.view.inputMode) return;
    if (this.routePending || this.mutePending || ['initializing', 'connecting', 'interrupting'].includes(this.lifecycle.phase)
      || (this.view.capabilities && ['paused', 'error'].includes(this.lifecycle.phase))) throw new Error('voice:input_unavailable');
    if (this.view.capabilities && !this.audio.setInputMode) throw new Error('voice:input_mode_unavailable');
    this.inputModePending = true; this.clearCapture(); this.publish({ inputModePending: true, level: 0 });
    try {
      await this.stopTurn();
      if (this.ended) return;
      if (this.view.capabilities && ['paused', 'error'].includes(this.lifecycle.phase)) return;
      if (this.view.capabilities) await this.audio.setInputMode!(mode);
      if (!this.ended) { this.clearCapture(); this.idleSince = this.now(); this.presenceAsked = false; this.publish({ inputMode: mode, level: 0 }); }
    } catch (error) { if (!this.ended) this.fail(error); throw error; }
    finally { this.inputModePending = false; this.publish({ inputModePending: false }); }
  }
  /** Accept one real user text before the shared response pipeline runs; never auto-resume or retry it. */
  async sendText(text: string): Promise<boolean> {
    if (typeof text !== 'string' || !text.trim()) throw new Error('voice:text_empty');
    if (text.length > MAX_CALL_TEXT_LENGTH) throw new Error('voice:text_limit');
    if (this.ended || this.sourceWithdrawn || this.view.inputMode !== 'text' || this.inputModePending || this.textPending
      || this.routePending || this.mutePending || !['listening', 'generating', 'playing'].includes(this.lifecycle.phase)) return false;
    if (this.now() - this.startedAt > 60 * 60_000 || this.exchanges.length >= 200) { await this.end(); return false; }
    this.textPending = true; this.clearCapture();
    try {
      // Explicit sending replaces the old response only after its stop receipt is known.
      await this.stopTurn();
      if (this.ended || this.sourceWithdrawn || this.inputModePending || this.view.inputMode !== 'text' || this.lifecycle.phase !== 'listening') return false;
      const speech: PendingSpeech = { queue: [], inFlight: false, final: true, cancelled: false, stoppedAt: this.now() };
      this.pendingSpeech = speech;
      const response = this.respond(speech, text);
      void response.catch(error => { if (!this.ended && this.pendingSpeech === speech) this.fail(error); });
      return speech.turnId !== undefined;
    } finally { this.textPending = false; }
  }
  interrupt(): Promise<void> {
    this.clearCapture();
    return this.stopTurn();
  }
  private stopTurn(): Promise<void> {
    if (this.stopping) return this.stopping;
    if (this.ended || ['paused', 'error', 'connecting', 'initializing'].includes(this.lifecycle.phase)) return Promise.resolve();
    const exchange = this.exchange; const start = this.now();
    this.trace('interrupt');
    const turn = this.turn, segment = this.activeSegment;
    this.lifecycle.interrupt();
    this.publish({ speakingText: '' });
    const stopping = (async () => {
      try {
        const receipt = await this.audio.interrupt();
        this.outputPending = false;
        if (turn && segment?.turnId === turn.id && receipt.turnId === turn.id
          && Number.isSafeInteger(receipt.playedFrames) && receipt.playedFrames >= segment.startFrame
          && receipt.playedFrames <= receipt.writtenFrames) {
          this.lifecycle.recordStoppedPlayback(turn, segment.id, Math.min(receipt.playedFrames, segment.endFrame ?? receipt.playedFrames) - segment.startFrame, receipt.sampleRate);
        }
      } catch (error) {
        if (!this.ended) this.fail(error);
        throw error;
      } finally {
        if (this.exchange === exchange) this.trace('stop-ack', { durationMs: this.now() - start });
        if (exchange) { exchange.metrics.interruptedAt = start; exchange.metrics.stopAcknowledgementMs = this.now() - start; }
        if (this.exchange === exchange) this.saveExchange(true);
        if (!this.ended && this.lifecycle.phase === 'interrupting') { this.idleSince = this.now(); this.lifecycle.transition('listening'); this.publish(); }
      }
    })();
    this.stopping = stopping;
    // Clear before callers awaiting the promise may start another turn.
    const clear = () => { if (this.stopping === stopping) this.stopping = undefined; };
    void stopping.then(clear, clear);
    return stopping;
  }
  private fail(error: unknown) {
    // Capacitor rejects with plain objects on some Android/WebView versions.
    // Only fixed voice codes are accepted from those objects, never raw data.
    const bridgeMessage = (error as { message?: unknown })?.message;
    const message = error instanceof CallApiError ? error.code : error instanceof Error ? error.message
      : typeof bridgeMessage === 'string' && /^voice:[a-z_:-]{1,80}$/.test(bridgeMessage) ? bridgeMessage : 'voice:unknown';
    if (message === 'voice:source_withdrawn') this.sourceWithdrawn = true;
    this.recoveryRevision++;
    const cause: CallView['pauseCause'] = this.sourceWithdrawn ? 'source'
      : error instanceof CallApiError ? 'network'
        : /permission|microphone_denied|microphone_disabled/.test(message) ? 'permission' : 'device';
    // A failed HTTP stage has already cancelled its turn and stopped its output.
    // Keep a healthy recorder/session instead of needlessly rebuilding audio.
    // No capture is consumed while phase=error, and no request is retried here.
    const preserveAudio = error instanceof CallApiError && !this.audioSuspended;
    this.lifecycle.invalidate(); if (this.lifecycle.phase !== 'ended') this.lifecycle.transition('error');
    this.clearCapture(); this.publish({ speakingText: '', error: message, pauseCause: this.view.pauseCause === 'user' ? 'user' : cause,
      errorStage: error instanceof CallApiError ? error.stage : undefined,
      errorHttpStatus: error instanceof CallApiError ? error.httpStatus : undefined });
    if (!preserveAudio && this.view.capabilities && this.audio.pause) {
      this.audioSuspended = true;
      this.pausing = this.audio.pause().catch(() => this.audio.close()).catch(() => {});
    }
  }
  private mutePending = false;
  async mute(value: boolean) {
    if (this.ended || this.mutePending || this.inputModePending || this.textPending) return;
    const recognizing = !!this.pendingSpeech || this.exchange?.origin === 'presence-check';
    this.idleSince = this.now();
    this.mutePending = true; this.clearCapture();
    try { if (recognizing) await this.stopTurn(); await this.audio.mute(value); if (!this.ended) this.publish({ muted: value, level: 0 }); }
    catch (error) { if (!this.ended) this.fail(error); throw error; }
    finally { this.mutePending = false; }
  }
  /** Explicit user pause cannot be undone by foreground/focus notifications. */
  async pause(): Promise<void> {
    if (this.ended || this.sourceWithdrawn) return;
    this.recoveryRevision++;
    this.routeControl++; this.routeOperation?.abort.abort(); this.routeOperation = undefined; this.routePending = false;
    this.lifecycle.pause(); this.clearCapture(); this.saveExchange(true);
    this.audioSuspended = true;
    this.publish({ pauseCause: 'user', speakingText: '', level: 0, routing: false, routeWait: undefined });
    this.pausing = (async () => {
      await this.audio.interrupt();
      if (this.audio.pause) await this.audio.pause(); else await this.audio.close();
    })().catch(error => { if (!this.ended) this.fail(error); });
    await this.pausing;
  }
  resume(): Promise<void> { return this.requestResume('user'); }
  private requestResume(trigger: 'user' | 'focus'): Promise<void> {
    if (this.resuming) return this.resuming;
    if (trigger === 'focus' && (this.view.pauseCause !== 'focus' || this.automaticRecoveryRevision === this.recoveryRevision
      || typeof document !== 'undefined' && document.visibilityState !== 'visible')) return Promise.resolve();
    if (this.ended || this.sourceWithdrawn || this.routePending || this.inputModePending || this.textPending || this.mutePending
      || !['paused', 'error'].includes(this.lifecycle.phase)) return Promise.resolve();
    const revision = this.recoveryRevision;
    if (trigger === 'focus') this.automaticRecoveryRevision = revision;
    const resuming = this.restoreAudio(revision);
    this.resuming = resuming;
    const clear = () => { if (this.resuming === resuming) this.resuming = undefined; };
    void resuming.then(clear, clear);
    return resuming;
  }
  private async restoreAudio(revision: number) {
    if (this.ended || this.sourceWithdrawn || this.routePending || this.inputModePending || this.textPending || !['paused', 'error'].includes(this.lifecycle.phase)) return;
    // A late stopPlayback from the previous device/focus event must never
    // flush output belonging to a newly resumed turn.
    try { await this.deviceStopping; await this.stopping; } catch { return; }
    await this.pausing;
    if (this.ended || this.sourceWithdrawn || revision !== this.recoveryRevision || this.routePending || !['paused', 'error'].includes(this.lifecycle.phase)) return;
    // A rejected permission/start has no live native session to resume.
    if (!this.view.capabilities) { await this.start(); return; }
    const events = this.routeEvents;
    this.diagnostic('resume-request');
    this.lifecycle.transition('connecting'); this.publish({ error: undefined });
    try {
      const result = this.view.pauseCause === 'network' && !this.audioSuspended ? this.view.capabilities : await this.audio.resume();
      if (this.ended) return;
      if (revision !== this.recoveryRevision) {
        // A user/device pause may have completed before this old native resume
        // acknowledged. Make sure its late completion cannot reopen capture.
        if (this.audio.pause) await this.audio.pause(); else await this.audio.close();
        return;
      }
      if (this.lifecycle.phase === 'paused' && events !== this.routeEvents) return;
      // Reconcile the last acknowledged mute setting after a failed control
      // request. Capture remains excluded while the call is connecting.
      await this.audio.mute(this.view.muted);
      if (this.ended || revision !== this.recoveryRevision) return;
      if (this.lifecycle.phase === 'paused' && events !== this.routeEvents) return;
      if (!this.ended) {
        this.diagnostic('resume-confirmed', { routeGeneration: result.routeGeneration });
        this.observeRoute(result.routeObservation);
        // Previous output is gone only after native stop/pause and this
        // explicit recovery have acknowledged. A stale old stop cannot clear
        // the guard for a fresh turn because capture is still connecting here.
        this.outputPending = false;
        this.audioSuspended = false;
        this.clearCapture();
        this.idleSince = this.now(); this.presenceAsked = false;
        if (this.lifecycle.phase === 'connecting') this.lifecycle.transition('listening');
        this.publish({ pauseCause: undefined, errorStage: undefined, errorHttpStatus: undefined, capabilities: { ...this.view.capabilities, routes: result.routes,
          routeGeneration: result.routeGeneration ?? this.view.capabilities.routeGeneration,
          routeObservation: result.routeObservation,
          echoCancellation: result.echoCancellation ?? this.view.capabilities.echoCancellation,
          noiseSuppression: result.noiseSuppression ?? this.view.capabilities.noiseSuppression } });
      }
    } catch (error) {
      if (revision !== this.recoveryRevision) return;
      if (this.lifecycle.phase === 'paused' && events !== this.routeEvents) return;
      if (!this.ended) this.fail(error);
    }
  }
  async refreshRoutes(requestBluetooth = false) {
    if (this.ended || this.routePending || !this.audio.routes) return;
    const query = ++this.routeQuery, events = this.routeEvents;
    if (requestBluetooth) await this.audio.requestBluetooth?.();
    if (this.ended || query !== this.routeQuery) return;
    const result = await this.audio.routes();
    if (!this.ended && query === this.routeQuery && events === this.routeEvents && this.view.capabilities) {
      this.observeRoute(result.routeObservation);
      this.publish({ capabilities: { ...this.view.capabilities, routes: result.routes, routeGeneration: result.routeGeneration ?? this.view.capabilities.routeGeneration,
        routeObservation: result.routeObservation } });
    }
  }
  async selectRoute(deviceId: number) {
    if (this.ended || this.routePending || this.inputModePending || this.textPending || !this.audio.route || !this.view.capabilities) return;
    if (!this.view.capabilities.routes.some(route => route.id === deviceId)) throw new Error('voice:route_unavailable');
    // Re-selecting the active headset must not flush speech or restart its microphone.
    if (this.view.capabilities.routes.some(route => route.id === deviceId && route.selected)) return;
    const operation = { id: ++this.routeControl, abort: new AbortController(), legacyConnecting: false };
    this.routeOperation = operation; this.routePending = true; this.routeQuery++;
    this.diagnostic('route-request', { requestedRouteType: this.view.capabilities.routes.find(route => route.id === deviceId)?.type,
      routeGeneration: this.view.capabilities.routeGeneration });
    const events = this.routeEvents;
    this.clearCapture(); this.publish({ routing: true, level: 0, routeWait: { requestId: operation.id, deviceId,
      requestedType: this.view.capabilities.routes.find(route => route.id === deviceId)?.type, startedAt: Date.now(), stage: 'waiting' } });
    const current = () => !this.ended && this.routeOperation === operation && !operation.abort.signal.aborted;
    try {
      // Stop old output and inference before changing acoustic conditions.
      // Hold capture throughout both stop acknowledgement and route selection.
      await this.interrupt();
      if (!current()) return;
      const result = await this.audio.route(deviceId, operation.abort.signal);
      if (current() && events === this.routeEvents) {
        this.diagnostic('route-confirmed', { routeGeneration: result.routeGeneration });
        this.observeRoute(result.routeObservation);
        this.publish({ capabilities: { ...this.view.capabilities, routes: result.routes, routeGeneration: result.routeGeneration,
          routeObservation: result.routeObservation } });
      }
    } catch (error) {
      // Native route confirmation is cancelled by focus/background/device loss.
      // Its late rejection must not replace the already authoritative pause.
      if (!current() || this.lifecycle.phase === 'paused' && events !== this.routeEvents) return;
      if (this.lifecycle.phase !== 'error') this.fail(error);
      throw error;
    }
    finally {
      if (this.routeOperation === operation) {
        this.clearCapture();
        // API <=30 acknowledges the request before SCO connects. Keep its
        // explicit recovery controls until selected, cancelled or lost.
        if (!operation.legacyConnecting) {
          this.routeOperation = undefined; this.routePending = false; this.publish({ routing: false, routeWait: undefined });
        }
      }
    }
  }
  cancelRouteWait(): Promise<void> {
    if (this.routeCancelling) return this.routeCancelling;
    const waiting = this.routeOperation;
    if (this.ended || !waiting || !this.view.routeWait) return Promise.resolve();
    const control = ++this.routeControl, previous = this.view.routeWait;
    this.routeOperation = undefined; waiting.abort.abort(); this.routePending = true; this.routeQuery++;
    this.lifecycle.pause(); this.clearCapture(); this.saveExchange(true);
    this.recoveryRevision++; this.audioSuspended = true; this.view.pauseCause = 'user';
    this.diagnostic('route-cancel-request', { requestId: `route:${waiting.id}` });
    this.publish({ routing: true, level: 0, routeWait: { ...previous, stage: 'cancelling' } });
    const events = this.routeEvents;
    const operation = (async () => {
      try {
        if (!this.audio.cancelRouteWait) { await this.audio.close(); throw new Error('voice:route_cancel_unavailable'); }
        const result = await this.audio.cancelRouteWait();
        if (this.ended || control !== this.routeControl) return;
        this.outputPending = false;
        this.diagnostic('route-cancel-confirmed', { requestId: `route:${waiting.id}`, routeGeneration: result?.routeGeneration });
        if (result && this.view.capabilities) this.publish({ capabilities: { ...this.view.capabilities, routes: result.routes,
          routeGeneration: result.routeGeneration ?? this.view.capabilities.routeGeneration, routeObservation: result.routeObservation } });
        if (events === this.routeEvents || /^(?:voice:)?route[-_]cancelled$/.test(this.view.error ?? '')) this.publish({ error: 'voice:route_cancelled' });
      } catch (error) {
        if (this.ended || control !== this.routeControl) return;
        this.fail(error); throw error;
      } finally {
        if (!this.ended && control === this.routeControl) {
          this.clearCapture(); this.routePending = false; this.publish({ routing: false, routeWait: undefined });
        }
      }
    })();
    this.routeCancelling = operation;
    const clear = () => { if (this.routeCancelling === operation) this.routeCancelling = undefined; };
    void operation.then(clear, clear); return operation;
  }
  async end(): Promise<CallExchange[]> {
    if (!this.ended) {
      this.routeControl++; this.routeOperation?.abort.abort(); this.routeOperation = undefined;
      const pendingStop = this.stopping;
      this.ended = true; this.lifecycle.end(); this.clearCapture();
      this.recoveryRevision++;
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
    return this.exchanges.map(exchange => ({ ...exchange, segments: exchange.segments.map(segment => ({ ...segment })), metrics: {
      ...exchange.metrics, timeline: copyCallTrace(exchange.metrics.timeline),
      captureBatchClock: exchange.metrics.captureBatchClock && { ...exchange.metrics.captureBatchClock },
      speechSampleClock: exchange.metrics.speechSampleClock && { ...exchange.metrics.speechSampleClock },
      playback: exchange.metrics.playback && { ...exchange.metrics.playback },
    } }));
  }
  /** Bounded software-only evidence, including route changes outside an active turn. */
  getDiagnostics(): CallTrace { return copyCallTrace(this.diagnostics)!; }
}
