/**
 * Bounded startup policy used by NativeCallAudio. It does not own audio,
 * permission, networking, cancellation or playback history.
 *
 * Route history contains numeric performance observations only. Track counters
 * never survive a new track. A decision is frozen at beginTrack, so observations
 * from that track cannot retrospectively improve its startup decision.
 */
export interface PlaybackBufferBinding {
  callId: string;
  routeGeneration: number;
  trackId: string;
}

export interface PlaybackBufferDevice {
  sampleRate: number;
  /** Effective size from getBufferSizeInFrames(), not a configured queue limit. */
  bufferFrames?: number;
  /** Actual initial threshold read from this new track, after existing tuning. */
  startThresholdFrames?: number;
  canAdjustStartThreshold?: boolean;
}

export interface PlaybackSupplySample {
  /** Monotonic time in the same clock domain as beginTrack/finishTrack. */
  atMs: number;
  /** Positive supply interval minus the preceding packet's audio duration. */
  supplyGapMs: number;
  /** Necessary local work, excluded from supplyGapMs to avoid double counting. */
  serviceMs: number;
}

export interface PlaybackBufferDecision {
  binding: Readonly<PlaybackBufferBinding>;
  mode: 'adaptive' | 'device-default';
  reason: 'estimated' | 'cold-start' | 'unknown-device' | 'unsupported' | 'device-outside-range';
  /** Present only when this policy can request a bounded, nonzero threshold. */
  requestedFrames?: number;
  /** Existing observed default is retained when adjustment cannot be justified. */
  retainedDefaultFrames?: number;
  targetMs?: number;
  sampleCount: number;
  newestSampleAgeMs?: number;
  oldestSampleAgeMs?: number;
  supplyGapP90Ms: number;
  serviceP90Ms: number;
  routeFloorMs: number;
  maximumTargetMs?: number;
}

export interface PlaybackBufferFeedback {
  completed: boolean;
  samples: readonly PlaybackSupplySample[];
  /** Cumulative counts for this track, restricted to the active supply period. */
  underrunStart?: number;
  underrunEnd?: number;
}

const MIN_MS = 40, MAX_MS = 160, STEP_MS = 20;
export const PLAYBACK_BUFFER_HISTORY_LIMIT = 16;
export const PLAYBACK_BUFFER_HISTORY_MAX_AGE_MS = 30_000;
const counter = (value: number | undefined): value is number => Number.isSafeInteger(value) && value! >= 0;
const positiveCounter = (value: number | undefined): value is number => counter(value) && value > 0;
const quantile90 = (values: number[]) => values.length ? values.sort((a, b) => a - b)[Math.ceil(values.length * .9) - 1] : 0;
const sameRoute = (a: PlaybackBufferBinding, b: PlaybackBufferBinding) => a.callId === b.callId && a.routeGeneration === b.routeGeneration;
const sameTrack = (a: PlaybackBufferBinding, b: PlaybackBufferBinding) => sameRoute(a, b) && a.trackId === b.trackId;

export class PlaybackBufferPolicy {
  private route?: PlaybackBufferBinding;
  private history: PlaybackSupplySample[] = [];
  private floorMs = MIN_MS;
  private stableTracks = 0;
  private lastFeedbackAtMs?: number;
  private lastNowMs?: number;
  private active?: { binding: PlaybackBufferBinding; startedAtMs: number; decision: PlaybackBufferDecision };

  reset(): void {
    this.route = undefined; this.history = []; this.floorMs = MIN_MS;
    this.stableTracks = 0; this.lastFeedbackAtMs = undefined; this.lastNowMs = undefined; this.active = undefined;
  }

  beginTrack(binding: PlaybackBufferBinding, device: PlaybackBufferDevice, nowMs: number): PlaybackBufferDecision {
    this.assertTime(nowMs);
    if (!binding.callId || !binding.trackId || !counter(binding.routeGeneration)) throw new Error('voice:buffer_binding');
    if (!positiveCounter(device.sampleRate)) throw new Error('voice:buffer_sample_rate');
    if (this.active && sameTrack(this.active.binding, binding)) throw new Error('voice:buffer_track_active');
    if (!this.route || !sameRoute(this.route, binding)) this.resetRoute(binding);
    this.prune(nowMs);
    const p90 = quantile90(this.history.map(sample => sample.supplyGapMs));
    const service = quantile90(this.history.map(sample => sample.serviceMs));
    const ages = this.history.map(sample => nowMs - sample.atMs);
    const base = {
      binding: Object.freeze({ ...binding }), sampleCount: this.history.length,
      newestSampleAgeMs: ages.length ? Math.min(...ages) : undefined,
      oldestSampleAgeMs: ages.length ? Math.max(...ages) : undefined,
      supplyGapP90Ms: p90, serviceP90Ms: service, routeFloorMs: this.floorMs,
    };
    const observedDefault = positiveCounter(device.startThresholdFrames) ? device.startThresholdFrames : undefined;
    const retain = (reason: PlaybackBufferDecision['reason']): PlaybackBufferDecision => ({ ...base, mode: 'device-default', reason,
      retainedDefaultFrames: observedDefault, targetMs: observedDefault === undefined ? undefined : observedDefault * 1000 / device.sampleRate });
    let decision: PlaybackBufferDecision;
    if (device.canAdjustStartThreshold === false) decision = retain('unsupported');
    else if (device.canAdjustStartThreshold !== true || !positiveCounter(device.bufferFrames) || observedDefault === undefined) decision = retain('unknown-device');
    else {
      const capacityMs = device.bufferFrames * 1000 / device.sampleRate;
      const maximumTargetMs = Math.min(MAX_MS, Math.floor(capacityMs / STEP_MS) * STEP_MS);
      // An unexpectedly larger device default is not lowered without evidence.
      if (maximumTargetMs < MIN_MS || observedDefault > device.bufferFrames || observedDefault * 1000 / device.sampleRate > maximumTargetMs) decision = retain('device-outside-range');
      else {
        const lowerBound = Math.max(MIN_MS, Math.ceil(observedDefault * 1000 / device.sampleRate / STEP_MS) * STEP_MS);
        // Callback supply intervals include local work and are not evidence of
        // audible starvation by themselves. Retain the existing startup budget
        // until a completed track actually reported an active-supply underrun.
        // Only that recovery window may use the bounded history estimate.
        const estimated = this.floorMs > MIN_MS ? Math.ceil((MIN_MS + p90 + service) / STEP_MS) * STEP_MS : MIN_MS;
        const targetMs = Math.min(maximumTargetMs, Math.max(lowerBound, this.floorMs, estimated));
        decision = { ...base, mode: 'adaptive', reason: this.history.length ? 'estimated' : 'cold-start',
          targetMs, requestedFrames: Math.ceil(targetMs * device.sampleRate / 1000), maximumTargetMs };
      }
    }
    const frozen = Object.freeze(decision);
    this.active = { binding: { ...binding }, startedAtMs: nowMs, decision: frozen };
    return frozen;
  }

  /** Stale, duplicate and cancelled feedback never trains the next decision. */
  finishTrack(binding: PlaybackBufferBinding, feedback: PlaybackBufferFeedback, nowMs: number): boolean {
    if (!this.active || !sameTrack(this.active.binding, binding)) return false;
    this.assertTime(nowMs);
    const active = this.active; this.active = undefined;
    if (!feedback.completed) return true;
    this.prune(nowMs);
    for (const sample of feedback.samples) {
      if (!Number.isFinite(sample.atMs) || sample.atMs < active.startedAtMs || sample.atMs > nowMs
        || !Number.isFinite(sample.supplyGapMs) || sample.supplyGapMs < 0 || !Number.isFinite(sample.serviceMs) || sample.serviceMs < 0
        || nowMs - sample.atMs > PLAYBACK_BUFFER_HISTORY_MAX_AGE_MS) continue;
      this.history.push({ ...sample });
    }
    this.history.sort((a, b) => a.atMs - b.atMs);
    this.history = this.history.slice(-PLAYBACK_BUFFER_HISTORY_LIMIT);
    if (counter(feedback.underrunStart) && counter(feedback.underrunEnd) && feedback.underrunEnd >= feedback.underrunStart) {
      if (feedback.underrunEnd > feedback.underrunStart) {
        const previousTarget = active.decision.mode === 'adaptive' ? active.decision.targetMs ?? MIN_MS : MIN_MS;
        this.floorMs = Math.min(MAX_MS, Math.max(this.floorMs, previousTarget) + STEP_MS);
        this.stableTracks = 0;
      } else if (++this.stableTracks >= 8) {
        this.floorMs = Math.max(MIN_MS, this.floorMs - STEP_MS); this.stableTracks = 0;
      }
    } else this.stableTracks = 0; // Unknown is not a clean track or zero underruns.
    this.lastFeedbackAtMs = nowMs;
    return true;
  }

  private assertTime(nowMs: number): void {
    if (!Number.isFinite(nowMs) || nowMs < 0 || (this.lastNowMs !== undefined && nowMs < this.lastNowMs)) throw new Error('voice:buffer_clock');
    this.lastNowMs = nowMs;
  }
  private resetRoute(binding: PlaybackBufferBinding): void {
    this.route = { ...binding }; this.history = []; this.floorMs = MIN_MS; this.stableTracks = 0; this.lastFeedbackAtMs = undefined;
  }
  private prune(nowMs: number): void {
    this.history = this.history.filter(sample => sample.atMs <= nowMs && nowMs - sample.atMs <= PLAYBACK_BUFFER_HISTORY_MAX_AGE_MS);
    if (this.lastFeedbackAtMs !== undefined && nowMs - this.lastFeedbackAtMs > PLAYBACK_BUFFER_HISTORY_MAX_AGE_MS) {
      this.floorMs = MIN_MS; this.stableTracks = 0;
    }
  }
}

/** EOF is an explicit content-preserving release request, not zero buffering. */
export function playbackBufferRelease(queuedFrames: number, thresholdFrames: number, endOfStream: boolean): 'wait' | 'threshold' | 'eof-tail' {
  if (!counter(queuedFrames) || !positiveCounter(thresholdFrames)) throw new Error('voice:buffer_frames');
  if (queuedFrames >= thresholdFrames) return 'threshold';
  return endOfStream && queuedFrames > 0 ? 'eof-tail' : 'wait';
}
