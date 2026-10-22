/** Native elapsedRealtime -> JS performance.now offset, bounded by one bridge round trip. */
export interface NativeClockSnapshot {
  status: 'unknown' | 'unsupported' | 'calibrating' | 'calibrated' | 'failed' | 'stale';
  serial: number; routeGeneration: number;
  attempts: number; samples: number;
  /** JS time = native time + offset. No midpoint is presented as exact. */
  offsetMinMs?: number; offsetMaxMs?: number;
  roundTripMs?: number; calibratedAtJsMs?: number;
}
export interface NativeTimeInterval {
  nativeAtMs: number; jsEarliestMs: number; jsLatestMs: number;
  calibrationAgeMs: number; uncertaintyMs: number; routeGeneration: number;
  basis: 'bridge-roundtrip';
}
export const NATIVE_CLOCK_MAX_AGE_MS = 30_000;
export const NATIVE_CLOCK_PROBE_TIMEOUT_MS = 250;
export function clockSample(nativeAtMs: number, sentJsMs: number, receivedJsMs: number):
  Pick<NativeClockSnapshot, 'offsetMinMs' | 'offsetMaxMs' | 'roundTripMs' | 'calibratedAtJsMs'> | undefined {
  if (![nativeAtMs, sentJsMs, receivedJsMs].every(Number.isFinite) || nativeAtMs < 0 || sentJsMs < 0 ||
      receivedJsMs < sentJsMs || receivedJsMs - sentJsMs > NATIVE_CLOCK_PROBE_TIMEOUT_MS) return undefined;
  return { offsetMinMs: sentJsMs - nativeAtMs, offsetMaxMs: receivedJsMs - nativeAtMs,
    roundTripMs: receivedJsMs - sentJsMs, calibratedAtJsMs: receivedJsMs };
}
export function mapNativeTime(clock: NativeClockSnapshot, nativeAtMs: number, nowJsMs: number): NativeTimeInterval | undefined {
  const age = nowJsMs - (clock.calibratedAtJsMs ?? Number.NaN);
  if (clock.status !== 'calibrated' || !Number.isFinite(nativeAtMs) || nativeAtMs < 0 || !Number.isFinite(age) ||
      age < 0 || age > NATIVE_CLOCK_MAX_AGE_MS || clock.offsetMinMs === undefined || clock.offsetMaxMs === undefined) return undefined;
  if (![clock.offsetMinMs, clock.offsetMaxMs].every(Number.isFinite) || clock.offsetMinMs > clock.offsetMaxMs ||
      nativeAtMs + clock.offsetMinMs > nowJsMs) return undefined;
  // Bounds describe bridge uncertainty at calibration, with age visible. They
  // are not an assertion of zero clock drift or a physical speaker timestamp.
  return { nativeAtMs, jsEarliestMs: nativeAtMs + clock.offsetMinMs, jsLatestMs: nativeAtMs + clock.offsetMaxMs,
    calibrationAgeMs: age, uncertaintyMs: clock.offsetMaxMs - clock.offsetMinMs,
    routeGeneration: clock.routeGeneration, basis: 'bridge-roundtrip' };
}
