import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

export interface CallRoute { id: number; type?: number; label: string; selected: boolean }
export interface AudioCapabilities { routes: CallRoute[]; sampleRate: 16000; echoCancellation: boolean; noiseSuppression: boolean; bluetoothPermissionNeeded?: boolean }
export interface PlaybackReceipt { turnId?: string; playedFrames: number; writtenFrames: number; complete?: boolean; sampleRate?: number }
export type NativeAudioEvent = {
  callId: string; type: 'capture' | 'interrupted' | 'paused' | 'playback' | 'ended' | 'routes' | 'routeLost' | 'focusAvailable';
  at: number; sequence?: number; pcm?: string; sampleRate?: number; reason?: string;
  turnId?: string; playedFrames?: number; writtenFrames?: number; first?: boolean; routes?: CallRoute[];
  echoCancellation?: boolean; noiseSuppression?: boolean;
};
export interface NativeCallPlugin {
  addListener(event: 'audio', callback: (data: NativeAudioEvent) => void): Promise<PluginListenerHandle>;
  start(options: { callId: string }): Promise<AudioCapabilities>;
  heartbeat(options: { callId: string }): Promise<void>;
  mute(options: { callId: string; muted: boolean }): Promise<void>;
  pause?(options: { callId: string }): Promise<void>;
  resume(options: { callId: string }): Promise<{ routes: CallRoute[] }>;
  beginPlayback(options: { callId: string; turnId: string }): Promise<void>;
  appendPcm(options: { callId: string; turnId: string; pcm: string }): Promise<PlaybackReceipt>;
  drain(options: { callId: string; turnId: string }): Promise<PlaybackReceipt>;
  stopPlayback(options: { callId: string }): Promise<PlaybackReceipt>;
  stop(options: { callId: string }): Promise<void>;
  getRoutes(options: { callId: string }): Promise<{ routes: CallRoute[] }>;
  setRoute(options: { callId: string; deviceId: number }): Promise<{ routes: CallRoute[] }>;
  requestBluetooth(): Promise<void>;
}
const native = registerPlugin<NativeCallPlugin>('VoiceCallAudio');
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
  private callback?: (event: NativeAudioEvent) => void;
  private serial = 0;
  private muted = false;
  private releaseUnconfirmed = false;
  private startAbort?: AbortController;
  constructor(readonly callId: string, private readonly plugin: NativeCallPlugin = native, private readonly bridgeTimeoutMs = 2000,
    private readonly playbackTimeoutMs = 18_000) {}
  async start(onEvent: (event: NativeAudioEvent) => void): Promise<AudioCapabilities> {
    if (this.releaseUnconfirmed) throw new Error('voice:audio_release_failed');
    if (this.active) throw new Error('voice:already_active');
    if (this.plugin === native && (Capacitor.getPlatform() !== 'android' || !Capacitor.isPluginAvailable('VoiceCallAudio'))) throw new Error('voice:android_required');
    this.active = true;
    this.serial++; this.callback = onEvent;
    const serial = this.serial;
    const startup = new AbortController(); this.startAbort = startup;
    this.sequence = -1; this.suspended = false;
    try {
      const registration = this.plugin.addListener('audio', event => {
        if (!this.active || serial !== this.serial || event.callId !== this.callId) return;
        if (event.type === 'capture') {
          if (this.suspended || this.muted || !Number.isSafeInteger(event.sequence) || event.sequence! <= this.sequence) return;
          this.sequence = event.sequence!;
        }
        if (event.type === 'playback' && event.turnId !== this.turnId) return;
        if (event.type === 'interrupted' || event.type === 'paused' || event.type === 'routeLost' || event.type === 'ended') this.turnId = null;
        if (event.type === 'paused' || event.type === 'ended') this.suspended = true;
        onEvent(event);
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
      const result = await boundedBridge(this.plugin.start({ callId: this.callId }), undefined, startup.signal);
      if (!this.active || serial !== this.serial) throw new DOMException('Aborted', 'AbortError');
      this.startHeartbeat(serial, onEvent);
      return result;
    } catch (error) { if (serial === this.serial) await this.close(); throw error; }
    finally { if (this.startAbort === startup) this.startAbort = undefined; }
  }
  async beginPlayback(turnId: string, signal: AbortSignal): Promise<void> {
    this.assertActive(signal); this.turnId = turnId;
    try { await boundedBridge(this.plugin.beginPlayback({ callId: this.callId, turnId }), this.bridgeTimeoutMs, signal); this.assertTurn(turnId, signal); }
    catch (error) { if (this.turnId === turnId) this.turnId = null; throw error; }
  }
  async append(turnId: string, pcm: Uint8Array, signal: AbortSignal): Promise<PlaybackReceipt> {
    this.assertTurn(turnId, signal);
    // Avoid large bridge serialization bursts. Native queue is bounded to three seconds.
    let result: PlaybackReceipt = { playedFrames: 0, writtenFrames: 0 };
    for (let offset = 0; offset < pcm.length; offset += 9600) {
      this.assertTurn(turnId, signal);
      result = await boundedBridge(this.plugin.appendPcm({ callId: this.callId, turnId, pcm: encode(pcm.subarray(offset, offset + 9600)) }), this.playbackTimeoutMs, signal);
      this.assertTurn(turnId, signal);
    }
    return result;
  }
  async drain(turnId: string, signal: AbortSignal): Promise<PlaybackReceipt> {
    this.assertTurn(turnId, signal);
    const result = await boundedBridge(this.plugin.drain({ callId: this.callId, turnId }), this.playbackTimeoutMs, signal);
    this.assertTurn(turnId, signal); return result;
  }
  async interrupt(): Promise<PlaybackReceipt> {
    this.turnId = null;
    try { return this.active ? await boundedBridge(this.plugin.stopPlayback({ callId: this.callId }), this.bridgeTimeoutMs) : { playedFrames: 0, writtenFrames: 0 }; }
    catch (error) { this.suspended = true; throw error; }
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
      if (serial === this.serial) { this.suspended = true; this.turnId = null; }
      throw error;
    }
  }
  async pause() {
    this.suspended = true; this.turnId = null;
    if (this.active) {
      if (!this.plugin.pause) { await this.close(); return; }
      await boundedBridge(this.plugin.pause({ callId: this.callId }), this.bridgeTimeoutMs);
    }
  }
  async resume() {
    const serial = this.serial;
    try {
      if (!this.active) throw new Error('voice:inactive');
      const result = await boundedBridge(this.plugin.resume({ callId: this.callId }), this.bridgeTimeoutMs);
      if (!this.active || serial !== this.serial) throw new DOMException('Aborted', 'AbortError');
      this.suspended = false;
      if (!this.heartbeat && this.callback) this.startHeartbeat(serial, this.callback);
      return result;
    } catch (error) {
      if (serial !== this.serial) throw new DOMException('Aborted', 'AbortError');
      this.suspended = true; this.turnId = null;
      const message = error instanceof Error ? error.message : String(error);
      // Restart only dead audio sessions, on an explicit user recovery action.
      if (!/voice:(inactive|capture_ended)/.test(message) || !this.callback) throw error;
      const callback = this.callback, cleanup = this.close(), recoverySerial = this.serial;
      await cleanup;
      if (this.serial !== recoverySerial) throw new DOMException('Aborted', 'AbortError');
      const result = await this.start(callback);
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
  async route(deviceId: number) {
    const serial = this.serial;
    if (!this.active) throw new Error('voice:inactive');
    try {
      await this.interrupt();
      if (!this.active || serial !== this.serial) throw new DOMException('Aborted', 'AbortError');
      const result = await boundedBridge(this.plugin.setRoute({ callId: this.callId, deviceId }), this.bridgeTimeoutMs);
      if (!this.active || serial !== this.serial) throw new DOMException('Aborted', 'AbortError');
      return result;
    } catch (error) {
      if (serial === this.serial) { this.suspended = true; this.turnId = null; }
      throw error;
    }
  }
  async requestBluetooth() { return this.plugin.requestBluetooth(); }
  async close(): Promise<void> {
    this.serial++;
    this.startAbort?.abort(); this.startAbort = undefined;
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
      pending = true;
      void boundedBridge(this.plugin.heartbeat({ callId: this.callId }), this.bridgeTimeoutMs).catch(() => {
        if (!this.active || serial !== this.serial) return;
        // Do not accumulate native requests or silently retry a broken bridge.
        if (this.heartbeat) clearInterval(this.heartbeat); this.heartbeat = undefined;
        if (!this.suspended) { this.suspended = true; this.turnId = null; onEvent({ callId: this.callId, type: 'paused', reason: 'native-unavailable', at: performance.now() }); }
      }).finally(() => { pending = false; });
    }, 500);
  }
  private assertActive(signal: AbortSignal) { if (!this.active || this.suspended || signal.aborted) throw new DOMException('Aborted', 'AbortError'); }
  private assertTurn(turn: string, signal: AbortSignal) { this.assertActive(signal); if (this.turnId !== turn) throw new DOMException('Aborted', 'AbortError'); }
}
