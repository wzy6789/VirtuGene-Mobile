import type { NativeClockSnapshot, NativeTimeInterval } from './clock';
import type { RouteObservation } from './native-audio';
/** Diagnostic timestamps are software observations, never physical audible sound. */
export type CallTraceStage = 'endpoint' | 'asr-send' | 'asr-first' | 'asr-final'
  | 'context-start' | 'context-end' | 'context-discarded' | 'source-check' | 'review-start' | 'review-end'
  | 'llm-send' | 'llm-first' | 'speakable' | 'tts-send' | 'tts-first-pcm'
  | 'append-start' | 'append-end' | 'render-progress' | 'segment-drained'
  | 'interrupt' | 'stop-ack' | 'route-request' | 'route-confirmed' | 'route-observed' | 'route-lost'
  | 'resume-request' | 'resume-confirmed' | 'clock-correlation' | 'capture-progress' | 'native-playback-progress'
  | 'route-cancel-request' | 'route-cancel-confirmed';
export interface CallTraceEvent {
  stage: CallTraceStage;
  /** JS monotonic time; may precede endpoint for early recognition. */
  at: number;
  requestId?: string;
  segmentId?: string;
  durationMs?: number;
  frames?: number;
  routeGeneration?: number;
  requestedRouteType?: number;
  routeObservation?: RouteObservation;
  nativeTiming?: NativeTimeInterval;
  clock?: NativeClockSnapshot;
  playback?: { sampleRate: number; queuedFrames: number; bufferFrames?: number; startThresholdFrames?: number; underrunCount?: number;
    startupPaddingFrames?: number; voiceQueuedFrames?: number };
}
export interface CallTrace {
  clock: 'js-monotonic';
  callId?: string;
  turnId?: string;
  events: CallTraceEvent[];
  dropped: number;
}
/** Per-turn bounded evidence: no audio, text, keys, model payloads or device names. */
export function recordCallTrace(trace: CallTrace, event: CallTraceEvent): void {
  if (!Number.isFinite(event.at)) return;
  // Retain startup plus the latest tail so high packet counts cannot hide stop acknowledgements.
  if (trace.events.length >= 128) { trace.events.splice(32, 1); trace.dropped++; }
  // Explicit field projection prevents accidental payload logging by a caller.
  trace.events.push(project(event));
}
function project(event: CallTraceEvent): CallTraceEvent {
  const route = event.routeObservation, timing = event.nativeTiming, clock = event.clock, playback = event.playback;
  return { stage: event.stage, at: event.at,
    ...(event.requestId === undefined ? {} : { requestId: event.requestId }),
    ...(event.segmentId === undefined ? {} : { segmentId: event.segmentId }),
    ...(event.durationMs === undefined ? {} : { durationMs: event.durationMs }),
    ...(event.frames === undefined ? {} : { frames: event.frames }),
    ...(event.routeGeneration === undefined ? {} : { routeGeneration: event.routeGeneration }),
    ...(event.requestedRouteType === undefined ? {} : { requestedRouteType: event.requestedRouteType }),
    ...(route === undefined ? {} : { routeObservation: {
      inputObserved: route.inputObserved, outputObserved: route.outputObserved, communicationObserved: route.communicationObserved,
      inputType: route.inputType, outputType: route.outputType, communicationType: route.communicationType,
      observedAtMs: route.observedAtMs, routeGeneration: route.routeGeneration,
    } }),
    ...(timing === undefined ? {} : { nativeTiming: {
      nativeAtMs: timing.nativeAtMs, jsEarliestMs: timing.jsEarliestMs, jsLatestMs: timing.jsLatestMs,
      calibrationAgeMs: timing.calibrationAgeMs, uncertaintyMs: timing.uncertaintyMs,
      routeGeneration: timing.routeGeneration, basis: timing.basis,
    } }),
    ...(clock === undefined ? {} : { clock: {
      status: clock.status, serial: clock.serial, routeGeneration: clock.routeGeneration,
      attempts: clock.attempts, samples: clock.samples, offsetMinMs: clock.offsetMinMs,
      offsetMaxMs: clock.offsetMaxMs, roundTripMs: clock.roundTripMs, calibratedAtJsMs: clock.calibratedAtJsMs,
    } }),
    ...(playback === undefined ? {} : { playback: {
      sampleRate: playback.sampleRate, queuedFrames: playback.queuedFrames, bufferFrames: playback.bufferFrames,
      startThresholdFrames: playback.startThresholdFrames, underrunCount: playback.underrunCount,
      startupPaddingFrames: playback.startupPaddingFrames, voiceQueuedFrames: playback.voiceQueuedFrames,
    } }),
  };
}
export function copyCallTrace(trace: CallTrace | undefined): CallTrace | undefined {
  return trace && { ...trace, events: trace.events.map(project) };
}
