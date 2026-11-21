import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import type { CallInputMode } from './input';
import { clockSample, mapNativeTime, NATIVE_CLOCK_MAX_AGE_MS, NATIVE_CLOCK_PROBE_TIMEOUT_MS, type NativeClockSnapshot, type NativeTimeInterval } from './clock';
import { PlaybackBufferPolicy, PLAYBACK_BUFFER_HISTORY_LIMIT, type PlaybackBufferBinding, type PlaybackSupplySample } from './playback-buffer-policy';

export interface CallRoute { id: number; type?: number; label: string; selected: boolean }
export interface RouteObservation {
  inputObserved: boolean; outputObserved: boolean; communicationObserved: boolean;
  inputType?: number; outputType?: number; communicationType?: number;
  observedAtMs: number; routeGeneration: number;
}
export interface AudioCapabilities { routes: CallRoute[]; sampleRate: 16000; echoCancellation: boolean; noiseSuppression: boolean; bluetoothPermissionNeeded?: boolean; routeGeneration?: number; segmentDrain?: boolean; clockProbe?: boolean; routeObservation?: RouteObservation;
  routeCancellation?: boolean; routeControlSession?: number; playbackBufferTuning?: boolean }
export interface RouteSnapshot { routes: CallRoute[]; routeGeneration?: number; routeObservation?: RouteObservation; routeControlSession?: number; cancelledRequestId?: number }
export interface PlaybackReceipt { turnId?: string; playedFrames: number; writtenFrames: number; complete?: boolean; sampleRate?: number; cleanupFailures?: number; throughFrame?: number;
  bufferFrames?: number; startThresholdFrames?: number; underrunCount?: number; nativeWriteCompletedAtMs?: number; routeGeneration?: number;
  startupPaddingFrames?: number; nativeQueuedFrames?: number }
export type NativeAudioEvent = {
  callId: string; type: 'capture' | 'interrupted' | 'paused' | 'playback' | 'ended' | 'routes' | 'routeLost' | 'focusAvailable' | 'clock';
  at: number; sequence?: number; pcm?: string; sampleRate?: number; reason?: string;
  routeGeneration?: number;
  /** Native boottime values stay separate from JS performance.now(). */
  captureReadCompletedAtMs?: number; captureGeneration?: number;
  captureTimestampFrame?: number; captureTimestampAtMs?: number; captureTimestampSampleRate?: number;
  captureFrameEnd?: number; captureFrameSampleRate?: number; captureSampleEndAtMs?: number;
  captureSampleTimeBasis?: 'audio-record-timestamp-estimate';
  routeObservation?: RouteObservation; clock?: NativeClockSnapshot; timing?: NativeTimeInterval;
  turnId?: string; playedFrames?: number; writtenFrames?: number; first?: boolean; routes?: CallRoute[];
  bufferFrames?: number; startThresholdFrames?: number; underrunCount?: number;
  startupPaddingFrames?: number; nativeQueuedFrames?: number;
  echoCancellation?: boolean; noiseSuppression?: boolean;
  cleanupFailures?: number;
};
export interface NativeCallPlugin {
  addListener(event: 'audio', callback: (data: NativeAudioEvent) => void): Promise<PluginListenerHandle>;
  start(options: { callId: string; captureEnabled?: boolean; preferredRouteId?: number; preferredRouteType?: number; requirePrivateRoute?: boolean }): Promise<AudioCapabilities>;
  clockProbe?(options: { callId: string; probeSequence: number; routeGeneration: number }): Promise<{
    callId: string; probeSequence: number; routeGeneration: number; nativeAtMs: number;
  }>;
  setInputMode?(options: { callId: string; captureEnabled: boolean }): Promise<void>;
  heartbeat(options: { callId: string }): Promise<void>;
  mute(options: { callId: string; muted: boolean }): Promise<void>;
  pause?(options: { callId: string }): Promise<void>;
  resume(options: { callId: string }): Promise<RouteSnapshot>;
  beginPlayback(options: { callId: string; turnId: string }): Promise<void | PlaybackReceipt>;
  tunePlaybackBuffer?(options: { callId: string; turnId: string; targetMs: number; routeGeneration: number }): Promise<PlaybackReceipt>;
  appendPcm(options: { callId: string; turnId: string; pcm: string }): Promise<PlaybackReceipt>;
  drain(options: { callId: string; turnId: string; throughFrame?: number }): Promise<PlaybackReceipt>;
  stopPlayback(options: { callId: string }): Promise<PlaybackReceipt>;
  stop(options: { callId: string }): Promise<void>;
  getRoutes(options: { callId: string }): Promise<RouteSnapshot>;
  setRoute(options: { callId: string; deviceId: number; requestId?: number; routeControlSession?: number }): Promise<RouteSnapshot>;
  cancelRouteRequest?(options: { callId: string; requestId: number; routeControlSession: number }): Promise<RouteSnapshot>;
  requestBluetooth(): Promise<void>;
}
const native = registerPlugin<NativeCallPlugin>('VoiceCallAudio');
interface BufferTrack {
  binding: PlaybackBufferBinding;
  samples: PlaybackSupplySample[];
  previous?: { completedAt: number; audioMs: number; underruns?: number };
  intervals: number; underruns: number; invalidCounter: boolean;
}
const validCounter = (value: number | undefined): value is number => Number.isSafeInteger(value) && value! >= 0;
function encode(bytes: Uint8Array): string {
  let result = ''; for (let i = 0; i < bytes.length; i += 8192) result += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(result);
}
function boundedBridge<T>(operation: Promise<T>, timeoutMs: number | undefined, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
    const abort = () => { cleanup(); reject(new DOMException('Aborted', 'AbortError')); };
    const timer = timeoutMs === undefined ? undefined : setTimeout(() => { cleanup(); reject(new Error('voice:audio_bridge_timeout')); }, timeoutMs);
    if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
    operation.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
  });
}
export function decodeCapture(event: NativeAudioEvent): Uint8Array | null {
  if (event.type !== 'capture' || event.sampleRate !== 16000 || !event.pcm || event.pcm.length > 5000) return null;
  try {
    const value = atob(event.pcm); if (value.length !== 3200) return null;
    return Uint8Array.from(value, char => char.charCodeAt(0));
  } catch { return null; }
}

/** One owner for listeners, heartbeat and native session. Stale calls never share playback authority. */
export class NativeCallAudio {
  private listener?: PluginListenerHandle;
  private heartbeat?: ReturnType<typeof setInterval>;
  private turnId: string | null = null;
  private active = false;
  private sequence = -1;
  private suspended = false;
  private suspensionRevision = 0;
  private routeGeneration = -1;
  private callback?: (event: NativeAudioEvent) => void;
  private serial = 0;
  private muted = false;
  private releaseUnconfirmed = false;
  private startAbort?: AbortController;
  private inputMode: CallInputMode = 'voice';
  private modeAbort?: AbortController;
  private clock: NativeClockSnapshot = { status: 'unknown', serial: 0, routeGeneration: -1, attempts: 0, samples: 0 };
  private clockAbort?: AbortController;
  private clockSupported = false;
  private clockSequence = 0;
  private lastClockAttemptMs = -Infinity;
  private routeSequence = 0;
  private routeRequest?: { id: number; serial: number; suspension: number; abort: AbortController };
  private lastRouteRequestId?: number;
  private routeCancellation = false;
  private routeControlSession?: number;
  private routeCancelling?: Promise<RouteSnapshot | void>;
  /** User choice stays within this logical call, including dead-native recovery. */
  private preferredRoute?: { id: number; type: number };
  /** Default headset privacy survives native recreation without becoming a user selection. */
  private privateRouteRequired = false;
  private requestedRouteDeviceId?: number;
  private awaitingLegacyRoute = false;
  private readonly bufferPolicy = new PlaybackBufferPolicy();
  private bufferTrack?: BufferTrack;
  private bufferTuning = false;
  constructor(readonly callId: string, private readonly plugin: NativeCallPlugin = native, private readonly bridgeTimeoutMs = 2000,
    private readonly playbackTimeoutMs = 18_000, private readonly routeTimeoutMs = 31_000) {}
  async start(onEvent: (event: NativeAudioEvent) => void, options?: { inputMode?: CallInputMode }): Promise<AudioCapabilities> {
    if (this.releaseUnconfirmed) throw new Error('voice:audio_release_failed');
    if (this.active) throw new Error('voice:already_active');
    if (this.plugin === native && (Capacitor.getPlatform() !== 'android' || !Capacitor.isPluginAvailable('VoiceCallAudio'))) throw new Error('voice:android_required');
    this.active = true;
    this.inputMode = options?.inputMode ?? 'voice';
    this.serial++; this.callback = onEvent;
    const serial = this.serial;
    const startup = new AbortController(); this.startAbort = startup;
    this.sequence = -1; this.suspended = false; this.suspensionRevision = 0; this.routeGeneration = -1;
    this.bufferPolicy.reset(); this.bufferTrack = undefined; this.bufferTuning = false;
    this.resetClock(); this.clockSupported = false; this.clockSequence = 0;
    try {
      const registration = this.plugin.addListener('audio', event => {
        if (!this.active || serial !== this.serial || event.callId !== this.callId) return;
        if (!this.acceptRouteGeneration(event.routeGeneration)) return;
        if ((event.type === 'capture' || event.type === 'interrupted') && (this.inputMode === 'text' || this.modeAbort)) return;
        if (event.type === 'capture') {
          if (this.suspended || this.muted || !Number.isSafeInteger(event.sequence) || event.sequence! <= this.sequence) return;
          this.sequence = event.sequence!;
        }
        if (event.type === 'playback' && event.turnId !== this.turnId) return;
        if (event.type === 'routes' && this.awaitingLegacyRoute && this.requestedRouteDeviceId === -3) {
          const selected = event.routes?.find(route => route.id === this.requestedRouteDeviceId && route.selected);
          if (selected?.type === 7) { this.preferredRoute = { id: selected.id, type: selected.type }; this.privateRouteRequired = true; this.requestedRouteDeviceId = undefined; this.awaitingLegacyRoute = false; }
        }
        if (event.type === 'interrupted' || event.type === 'paused' || event.type === 'routeLost' || event.type === 'ended') {
          this.discardBufferTrack(); this.turnId = null;
        }
        if (event.type === 'paused' || event.type === 'routeLost' || event.type === 'ended') {
          const legacyConnecting = event.type === 'paused' && this.requestedRouteDeviceId === -3 && /bluetooth[-_]connecting/.test(event.reason ?? '');
          this.invalidateRoute(legacyConnecting); this.suspended = true; this.suspensionRevision++; this.resetClock();
        }
        if (event.cleanupFailures && event.cleanupFailures > 0) {
          this.suspensionRevision++;
          this.releaseUnconfirmed = true; this.suspended = true; this.turnId = null; this.resetClock();
          onEvent({ ...event, type: 'paused', reason: 'voice:audio_release_failed' }); return;
        }
        onEvent({ ...event, timing: mapNativeTime(this.clockSnapshot(), event.at, performance.now()) });
        if (event.type === 'routes' && !this.suspended && this.clock.status === 'unknown') this.scheduleClock();
      }).then(handle => {
        if (startup.signal.aborted || serial !== this.serial) {
          void boundedBridge(handle.remove(), this.bridgeTimeoutMs).catch(() => {});
        }
        return handle;
      });
      const handle = await boundedBridge(registration, this.bridgeTimeoutMs, startup.signal);
      if (!this.active || serial !== this.serial) {
        await boundedBridge(handle.remove(), this.bridgeTimeoutMs);
        throw new DOMException('Aborted', 'AbortError');
      }
      this.listener = handle;
      // The OS permission dialog has no artificial response deadline. Closing
      // the call cancels this wait; native stop revokes the pending request.
      const result = await boundedBridge(this.plugin.start({ callId: this.callId, captureEnabled: this.inputMode === 'voice',
        ...(this.privateRouteRequired ? { requirePrivateRoute: true } : {}),
        ...(this.preferredRoute ? { preferredRouteId: this.preferredRoute.id, preferredRouteType: this.preferredRoute.type } : {}) }), undefined, startup.signal);
      if (!this.active || serial !== this.serial) throw new DOMException('Aborted', 'AbortError');
      if (!this.acceptRouteGeneration(result.routeGeneration)) throw new DOMException('Aborted', 'AbortError');
      const selected = result.routes.find(route => route.selected);
      if (this.privateRouteRequired && selected && (selected.type === 1 || selected.type === 2)) throw new Error('voice:headset_unavailable');
      if (selected?.type !== undefined && [3, 4, 7, 11, 22, 23, 26].includes(selected.type)) this.privateRouteRequired = true;
      this.routeCancellation = result.routeCancellation === true && typeof this.plugin.cancelRouteRequest === 'function'
        && Number.isSafeInteger(result.routeControlSession) && result.routeControlSession! > 0;
      this.routeControlSession = this.routeCancellation ? result.routeControlSession : undefined;
      this.bufferTuning = result.playbackBufferTuning === true && typeof this.plugin.tunePlaybackBuffer === 'function';
      this.lastRouteRequestId = undefined;
      this.clockSupported = result.clockProbe === true && typeof this.plugin.clockProbe === 'function';
      this.scheduleClock();
      this.startHeartbeat(serial, onEvent);
      return result;
    } catch (error) { if (serial === this.serial) await this.close(); throw error; }
    finally { if (this.startAbort === startup) this.startAbort = undefined; }
  }
  async setInputMode(mode: CallInputMode): Promise<void> {
    if (mode !== 'voice' && mode !== 'text') throw new Error('voice:invalid_input_mode');
    if (this.releaseUnconfirmed) throw new Error('voice:audio_release_failed');
    if (!this.active || this.suspended) throw new Error('voice:input_unavailable');
    if (this.modeAbort) throw new Error('voice:input_busy');
    if (mode === this.inputMode) return;
    if (!this.plugin.setInputMode) throw new Error('voice:input_unavailable');
    const serial = this.serial, request = new AbortController(); this.modeAbort = request;
    try {
      // Switching to voice may display an OS permission dialog. Closing the
      // call revokes the pending native request instead of imposing a deadline.
      await boundedBridge(this.plugin.setInputMode({ callId: this.callId, captureEnabled: mode === 'voice' }), undefined, request.signal);
      if (!this.active || serial !== this.serial) throw new DOMException('Aborted', 'AbortError');
      // A committed native mode remains true if a later pause notification
      // reaches JS before this acknowledgement. Preserve suspension separately.
      this.inputMode = mode;
    } finally { if (this.modeAbort === request) this.modeAbort = undefined; }
  }
  async beginPlayback(turnId: string, signal: AbortSignal): Promise<void> {
    this.assertActive(signal); this.turnId = turnId;
    this.discardBufferTrack();
    try {
      const initial = await boundedBridge(this.plugin.beginPlayback({ callId: this.callId, turnId }), this.bridgeTimeoutMs, signal);
      this.assertTurn(turnId, signal);
      if (!initial || !validCounter(initial.sampleRate) || initial.sampleRate === 0 || this.routeGeneration < 0) return;
      this.assertReceiptGeneration(initial);
      const binding = { callId: this.callId, routeGeneration: this.routeGeneration, trackId: `${this.serial}:${turnId}` };
      const decision = this.bufferPolicy.beginTrack(binding, { sampleRate: initial.sampleRate,
        bufferFrames: initial.bufferFrames, startThresholdFrames: initial.startThresholdFrames, canAdjustStartThreshold: this.bufferTuning }, performance.now());
      this.bufferTrack = { binding, samples: [], intervals: 0, underruns: 0, invalidCounter: false };
      // Stable/cold starts use the existing threshold and add no tuning bridge.
      if (decision.requestedFrames !== undefined && decision.requestedFrames > (initial.startThresholdFrames ?? Infinity)) {
        const tuned = await boundedBridge(this.plugin.tunePlaybackBuffer!({ callId: this.callId, turnId,
          targetMs: decision.targetMs!, routeGeneration: binding.routeGeneration }), this.bridgeTimeoutMs, signal);
        this.assertTurn(turnId, signal); this.assertReceiptGeneration(tuned);
        if (this.bufferTrack?.binding !== binding || tuned.writtenFrames !== 0 || tuned.playedFrames !== 0) throw new Error('voice:audio_playback_receipt');
      }
    }
    catch (error) { if (this.turnId === turnId) { this.turnId = null; this.discardBufferTrack(); } throw error; }
  }
  async append(turnId: string, pcm: Uint8Array, signal: AbortSignal): Promise<PlaybackReceipt> {
    this.assertTurn(turnId, signal);
    // Avoid large bridge serialization bursts. Native queue is bounded to three seconds.
    let result: PlaybackReceipt = { playedFrames: 0, writtenFrames: 0 };
    for (let offset = 0; offset < pcm.length; offset += 9600) {
      this.assertTurn(turnId, signal);
      const started = performance.now();
      result = await boundedBridge(this.plugin.appendPcm({ callId: this.callId, turnId, pcm: encode(pcm.subarray(offset, offset + 9600)) }), this.playbackTimeoutMs, signal);
      this.assertTurn(turnId, signal);
      this.assertReceiptGeneration(result);
      this.recordBufferSupply(result, started, performance.now(), Math.min(9600, pcm.length - offset));
    }
    return result;
  }
  async drain(turnId: string, signal: AbortSignal, throughFrame?: number): Promise<PlaybackReceipt> {
    this.assertTurn(turnId, signal);
    if (throughFrame !== undefined && (!Number.isSafeInteger(throughFrame) || throughFrame < 0)) throw new Error('voice:audio_playback_receipt');
    if (this.bufferTrack) this.bufferTrack.previous = undefined;
    const result = await boundedBridge(this.plugin.drain({ callId: this.callId, turnId,
      ...(throughFrame === undefined ? {} : { throughFrame }) }), this.playbackTimeoutMs, signal);
    if (throughFrame !== undefined && result.throughFrame !== throughFrame) throw new Error('voice:audio_playback_receipt');
    this.assertTurn(turnId, signal); this.assertReceiptGeneration(result);
    if (this.bufferTrack) this.bufferTrack.previous = undefined;
    return result;
  }
  async interrupt(completedTurnId?: string): Promise<PlaybackReceipt> {
    if (completedTurnId !== undefined && completedTurnId !== this.turnId) throw new DOMException('Aborted', 'AbortError');
    const serial = this.serial, suspension = this.suspensionRevision, track = this.bufferTrack;
    if (completedTurnId === undefined) this.discardBufferTrack();
    this.turnId = null;
    try {
      const receipt = this.active ? await boundedBridge(this.plugin.stopPlayback({ callId: this.callId }), this.bridgeTimeoutMs) : { playedFrames: 0, writtenFrames: 0 };
      if (receipt.cleanupFailures && receipt.cleanupFailures > 0) {
        this.releaseUnconfirmed = true; throw new Error('voice:audio_release_failed');
      }
      if (track && this.bufferTrack === track) {
        const completed = completedTurnId !== undefined && this.active && !this.suspended && serial === this.serial
          && suspension === this.suspensionRevision && this.turnId === null && track.binding.routeGeneration === this.routeGeneration
          && receipt.turnId === completedTurnId && validCounter(receipt.writtenFrames) && receipt.writtenFrames > 0
          && validCounter(receipt.playedFrames) && receipt.playedFrames >= receipt.writtenFrames;
        this.finishBufferTrack(track, completed);
      }
      return receipt;
    }
    catch (error) { if (serial === this.serial) { this.discardBufferTrack(); this.suspended = true; this.suspensionRevision++; this.resetClock(); } throw error; }
  }
  async mute(muted: boolean) {
    const serial = this.serial;
    if (!this.active) throw new Error('voice:inactive');
    // Block already queued native PCM as soon as mute is requested. Unmute
    // becomes effective only after acknowledgement from this same session.
    if (muted) this.muted = true;
    try {
      await boundedBridge(this.plugin.mute({ callId: this.callId, muted }), this.bridgeTimeoutMs);
      if (!this.active || serial !== this.serial) throw new DOMException('Aborted', 'AbortError');
      this.muted = muted;
    } catch (error) {
      if (serial === this.serial) { this.suspended = true; this.suspensionRevision++; this.turnId = null; this.resetClock(); }
      throw error;
    }
  }
  async pause() {
    this.invalidateRoute();
    this.discardBufferTrack();
    this.suspended = true; this.suspensionRevision++; this.turnId = null; this.resetClock();
    if (this.active) {
      if (!this.plugin.pause) { await this.close(); return; }
      await boundedBridge(this.plugin.pause({ callId: this.callId }), this.bridgeTimeoutMs);
    }
  }
  async resume() {
    if (this.releaseUnconfirmed) throw new Error('voice:audio_release_failed');
    const serial = this.serial;
    const suspension = this.suspensionRevision;
    try {
      if (!this.active) throw new Error('voice:inactive');
      const result = await boundedBridge(this.plugin.resume({ callId: this.callId }), Math.max(this.bridgeTimeoutMs, 9000));
      if (!this.active || serial !== this.serial) throw new DOMException('Aborted', 'AbortError');
      if (suspension !== this.suspensionRevision || !this.acceptRouteGeneration(result.routeGeneration)) {
        // A late acknowledgement may have restarted native capture after a newer pause.
        if (this.plugin.pause) {
          try { await boundedBridge(this.plugin.pause({ callId: this.callId }), this.bridgeTimeoutMs); }
          catch { await this.close(); }
        } else await this.close();
        throw new DOMException('Aborted', 'AbortError');
      }
      this.suspended = false;
      this.resetClock(); this.scheduleClock();
      if (!this.heartbeat && this.callback) this.startHeartbeat(serial, this.callback);
      return result;
    } catch (error) {
      if (serial !== this.serial) throw new DOMException('Aborted', 'AbortError');
      this.suspended = true; this.suspensionRevision++; this.turnId = null; this.resetClock();
      const code = (error as { message?: unknown })?.message;
      const message = error instanceof Error ? error.message : typeof code === 'string' && /^voice:[a-z_:-]{1,80}$/.test(code) ? code : '';
      // Restart only dead audio sessions, on an explicit user recovery action.
      if (!/voice:(inactive|capture_ended)/.test(message) || !this.callback) throw error;
      const callback = this.callback, cleanup = this.close(), recoverySerial = this.serial;
      await cleanup;
      if (this.serial !== recoverySerial) throw new DOMException('Aborted', 'AbortError');
      const result = await this.start(callback, { inputMode: this.inputMode });
      if (this.muted) await this.mute(true);
      return result;
    }
  }
  async routes() {
    const serial = this.serial;
    if (!this.active) throw new Error('voice:inactive');
    const result = await boundedBridge(this.plugin.getRoutes({ callId: this.callId }), this.bridgeTimeoutMs);
    if (!this.active || serial !== this.serial) throw new DOMException('Aborted', 'AbortError');
    return result;
  }
  async route(deviceId: number, signal?: AbortSignal) {
    const serial = this.serial, suspension = this.suspensionRevision;
    if (!this.active) throw new Error('voice:inactive');
    if (this.routeRequest || this.routeCancelling) throw new Error('voice:route_pending');
    const request = { id: ++this.routeSequence, serial, suspension, abort: new AbortController() };
    this.routeRequest = request; this.lastRouteRequestId = request.id;
    this.requestedRouteDeviceId = deviceId; this.awaitingLegacyRoute = false;
    const abort = () => { if (this.routeRequest === request) this.invalidateRoute(); };
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const current = () => this.active && this.serial === serial && this.routeRequest === request && !request.abort.signal.aborted && this.suspensionRevision === suspension;
    try {
      if (!current()) throw new DOMException('Aborted', 'AbortError');
      await this.interrupt();
      if (!current()) throw new DOMException('Aborted', 'AbortError');
      const result = await boundedBridge(this.plugin.setRoute({ callId: this.callId, deviceId,
        ...(this.routeCancellation ? { requestId: request.id, routeControlSession: this.routeControlSession } : {}) }), this.routeTimeoutMs, request.abort.signal);
      if (!current() || (this.routeCancellation && result.routeControlSession !== this.routeControlSession)) throw new DOMException('Aborted', 'AbortError');
      if (!this.acceptRouteGeneration(result.routeGeneration)) throw new DOMException('Aborted', 'AbortError');
      const selected = result.routes.find(route => route.id === deviceId && route.selected);
      if (selected && Number.isSafeInteger(selected.type)) {
        this.preferredRoute = { id: selected.id, type: selected.type! };
        this.privateRouteRequired = [3, 4, 7, 11, 22, 23, 26].includes(selected.type!);
      }
      this.requestedRouteDeviceId = undefined;
      this.scheduleClock();
      return result;
    } catch (error) {
      if (this.lastRouteRequestId === request.id && !this.awaitingLegacyRoute) this.requestedRouteDeviceId = undefined;
      if (current()) { this.suspended = true; this.suspensionRevision++; this.turnId = null; this.resetClock(); }
      throw error;
    } finally {
      signal?.removeEventListener('abort', abort);
      if (this.routeRequest === request) this.routeRequest = undefined;
    }
  }
  private invalidateRoute(preserveLegacy = false) {
    const request = this.routeRequest; this.routeRequest = undefined;
    this.awaitingLegacyRoute = preserveLegacy;
    if (!preserveLegacy) this.requestedRouteDeviceId = undefined;
    request?.abort.abort();
  }
  /** Explicitly cancel selection even if native audio is already paused. */
  cancelRouteWait(): Promise<RouteSnapshot | void> {
    if (this.routeCancelling) return this.routeCancelling;
    const serial = this.serial, session = this.routeControlSession;
    const requestId = this.lastRouteRequestId ?? ++this.routeSequence;
    this.lastRouteRequestId = undefined;
    this.requestedRouteDeviceId = undefined;
    this.invalidateRoute(); this.suspended = true; this.suspensionRevision++; this.turnId = null; this.resetClock();
    const operation = (async () => {
      if (!this.active) return;
      if (!this.routeCancellation || session === undefined || !this.plugin.cancelRouteRequest) {
        // Older native pause returns early when already paused, leaving its
        // pending selection alive. Only confirmed close revokes that session.
        await this.close(); return;
      }
      const result = await boundedBridge(this.plugin.cancelRouteRequest({ callId: this.callId, requestId, routeControlSession: session }), this.bridgeTimeoutMs);
      if (!this.active || serial !== this.serial || session !== this.routeControlSession) throw new DOMException('Aborted', 'AbortError');
      if (result.routeControlSession !== session || result.cancelledRequestId !== requestId || !this.acceptRouteGeneration(result.routeGeneration)) throw new Error('voice:route_cancel_failed');
      return result;
    })();
    this.routeCancelling = operation;
    const clear = () => { if (this.routeCancelling === operation) this.routeCancelling = undefined; };
    void operation.then(clear, clear); return operation;
  }
  async requestBluetooth() { return this.plugin.requestBluetooth(); }
  clockSnapshot(): NativeClockSnapshot {
    const value = { ...this.clock };
    if (value.status === 'calibrated' && performance.now() - value.calibratedAtJsMs! > NATIVE_CLOCK_MAX_AGE_MS) value.status = 'stale';
    return value;
  }
  private resetClock() {
    this.clockAbort?.abort(); this.clockAbort = undefined;
    this.clock = { status: 'unknown', serial: this.serial, routeGeneration: this.routeGeneration, attempts: 0, samples: 0 };
  }
  private scheduleClock() {
    if (!this.active || this.suspended || this.clockAbort) return;
    const serial = this.serial, generation = this.routeGeneration;
    const publish = () => {
      if (this.active && !this.suspended && serial === this.serial && generation === this.routeGeneration) {
        try { this.callback?.({ callId: this.callId, type: 'clock', at: performance.now(), routeGeneration: generation, clock: this.clockSnapshot() }); }
        catch { /* A diagnostic consumer cannot break the audio lifecycle. */ }
      }
    };
    if (!this.clockSupported || !this.plugin.clockProbe || generation < 0) {
      this.clock = { status: 'unsupported', serial, routeGeneration: generation, attempts: 0, samples: 0 }; publish(); return;
    }
    const request = new AbortController(); this.clockAbort = request; this.lastClockAttemptMs = performance.now();
    this.clock = { status: 'calibrating', serial, routeGeneration: generation, attempts: 0, samples: 0 };
    // Diagnostic only: no await in start/resume/PCM. One group and at most
    // three bounded requests; an unresponsive bridge is not retried periodically.
    void (async () => {
      let intersectionMin = -Infinity, intersectionMax = Infinity;
      for (let count = 0; count < 3; count++) {
        if (!this.active || this.suspended || serial !== this.serial || generation !== this.routeGeneration || request.signal.aborted) return;
        const sequence = ++this.clockSequence, sent = performance.now(); this.clock.attempts++;
        const response = await boundedBridge(this.plugin.clockProbe!({ callId: this.callId, probeSequence: sequence, routeGeneration: generation }), NATIVE_CLOCK_PROBE_TIMEOUT_MS, request.signal);
        const received = performance.now();
        if (!this.active || this.suspended || serial !== this.serial || generation !== this.routeGeneration || request.signal.aborted) return;
        if (response.callId !== this.callId || response.probeSequence !== sequence || response.routeGeneration !== generation) throw new Error('voice:clock_owner');
        const sample = clockSample(response.nativeAtMs, sent, received);
        if (!sample) throw new Error('voice:clock_sample');
        intersectionMin = Math.max(intersectionMin, sample.offsetMinMs!); intersectionMax = Math.min(intersectionMax, sample.offsetMaxMs!);
        if (intersectionMin > intersectionMax) throw new Error('voice:clock_unstable');
        this.clock.samples++;
        if (this.clock.roundTripMs === undefined || sample.roundTripMs! < this.clock.roundTripMs) Object.assign(this.clock, sample);
      }
      this.clock.status = 'calibrated'; publish();
    })().catch(() => {
      if (!request.signal.aborted && this.active && !this.suspended && serial === this.serial && generation === this.routeGeneration) {
        this.clock = { status: 'failed', serial, routeGeneration: generation, attempts: this.clock.attempts, samples: this.clock.samples }; publish();
      }
    }).finally(() => { if (this.clockAbort === request) this.clockAbort = undefined; });
  }
  private acceptRouteGeneration(value: number | undefined): boolean {
    if (value === undefined) return true;
    if (!Number.isSafeInteger(value) || value < 0 || value < this.routeGeneration) return false;
    if (this.routeGeneration !== value) {
      this.bufferTrack = undefined; this.bufferPolicy.reset();
      this.routeGeneration = value; this.resetClock();
    }
    return true;
  }
  async close(): Promise<void> {
    this.invalidateRoute();
    this.bufferTrack = undefined; this.bufferPolicy.reset(); this.bufferTuning = false;
    this.requestedRouteDeviceId = undefined;
    this.serial++;
    this.resetClock();
    this.startAbort?.abort(); this.startAbort = undefined;
    this.modeAbort?.abort(); this.modeAbort = undefined;
    this.active = false; this.turnId = null;
    if (this.heartbeat) clearInterval(this.heartbeat); this.heartbeat = undefined;
    const listener = this.listener; this.listener = undefined;
    try { await boundedBridge(this.plugin.stop({ callId: this.callId }), this.bridgeTimeoutMs); this.releaseUnconfirmed = false; }
    catch (error) { this.releaseUnconfirmed = true; throw error; }
    finally { if (listener) await boundedBridge(listener.remove(), this.bridgeTimeoutMs); }
  }
  private startHeartbeat(serial: number, onEvent: (event: NativeAudioEvent) => void) {
    let pending = false;
    this.heartbeat = setInterval(() => {
      if (!this.active || serial !== this.serial || pending) return;
      if (this.clock.status === 'calibrated' && performance.now() - this.lastClockAttemptMs >= NATIVE_CLOCK_MAX_AGE_MS) this.scheduleClock();
      pending = true;
      void boundedBridge(this.plugin.heartbeat({ callId: this.callId }), this.bridgeTimeoutMs).catch(() => {
        if (!this.active || serial !== this.serial) return;
        // Do not accumulate native requests or silently retry a broken bridge.
        if (this.heartbeat) clearInterval(this.heartbeat); this.heartbeat = undefined;
        if (!this.suspended) { this.suspended = true; this.suspensionRevision++; this.turnId = null; this.resetClock(); onEvent({ callId: this.callId, type: 'paused', reason: 'native-unavailable', at: performance.now() }); }
      }).finally(() => { pending = false; });
    }, 500);
  }
  private assertActive(signal: AbortSignal) {
    if (this.releaseUnconfirmed) throw new Error('voice:audio_release_failed');
    if (!this.active || this.suspended || signal.aborted) throw new DOMException('Aborted', 'AbortError');
  }
  private recordBufferSupply(receipt: PlaybackReceipt, started: number, completed: number, bytes: number) {
    const track = this.bufferTrack;
    if (!track || track.binding.routeGeneration !== this.routeGeneration) return;
    const previous = track.previous;
    if (previous) {
      track.intervals++;
      if (validCounter(previous.underruns) && validCounter(receipt.underrunCount) && receipt.underrunCount >= previous.underruns) {
        track.underruns += receipt.underrunCount - previous.underruns;
      } else track.invalidCounter = true;
      // Supply includes source review, transport and bridge pacing. It is not a network RTT.
      track.samples.push({ atMs: completed, supplyGapMs: Math.max(0, started - previous.completedAt - previous.audioMs), serviceMs: completed - started });
      if (track.samples.length > PLAYBACK_BUFFER_HISTORY_LIMIT) track.samples.shift();
    }
    // The bridge input is always 24kHz PCM16; SCO resampling changes native frames, not this duration.
    track.previous = { completedAt: completed, audioMs: bytes / 48, underruns: receipt.underrunCount };
  }
  private finishBufferTrack(track: BufferTrack, completed: boolean) {
    if (this.bufferTrack !== track) return;
    this.bufferTrack = undefined;
    const known = track.intervals > 0 && !track.invalidCounter;
    this.bufferPolicy.finishTrack(track.binding, { completed, samples: track.samples,
      ...(known ? { underrunStart: 0, underrunEnd: track.underruns } : {}) }, performance.now());
  }
  private discardBufferTrack() {
    if (this.bufferTrack) this.finishBufferTrack(this.bufferTrack, false);
  }
  private assertTurn(turn: string, signal: AbortSignal) { this.assertActive(signal); if (this.turnId !== turn) throw new DOMException('Aborted', 'AbortError'); }
  private assertReceiptGeneration(receipt: PlaybackReceipt) {
    if (receipt.routeGeneration !== undefined && receipt.routeGeneration !== this.routeGeneration) throw new DOMException('Aborted', 'AbortError');
  }
}
