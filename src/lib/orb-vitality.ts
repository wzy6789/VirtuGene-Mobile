export type OrbMotionIntensity = 'gentle' | 'lively' | 'reduced';
export type OrbMotionContext = 'reading' | 'interaction' | 'voice';
export interface OrbSignal { captureLevel?: number; playback?: boolean }
export const ORB_MOTION_INTENSITIES: readonly OrbMotionIntensity[] = ['gentle', 'lively', 'reduced'];

/** Discrete events get one finite burst; reading cannot extend the deadline. */
export const ORB_INTERACTION_MS = 780;
export function orbInteractionEnergy(remainingMs: number) {
  return Math.max(0, Math.min(1, remainingMs / 180));
}

/** Reading stays quiet; deliberate interaction carries expressive body energy. */
export function orbVitalityProfile(intensity: OrbMotionIntensity, context: OrbMotionContext) {
  const lively = intensity === 'lively';
  return {
    body: context === 'reading' ? lively ? .38 : .24 : context === 'voice' ? .3 : lively ? 1.05 : .72,
    breath: lively ? .8 : .5, light: lively ? 1 : .72, touch: lively ? 1 : .8,
  };
}

/** Phase is integrated by the shared clock; state changes never restart it. */
export function sampleOrbCore(time: number, phase: number) {
  const clock = time / 1000;
  const breath = Math.sin(clock * Math.PI * 2 / 6.8 + phase + .16 * Math.sin(clock / 9 + phase));
  return { breath, x: Math.sin(clock / 3.8 + phase) * 13, y: Math.cos(clock / 4.9 + phase) * 9,
    secondX: Math.cos(clock / 5.1 + phase + 1.7) * 11, secondY: Math.sin(clock / 4.1 + phase + 2.1) * 12,
    third: Math.sin(clock / 6.3 + phase + 3.4) };
}

/** No inferred audio amplitude: missing/invalid capture is silence. */
export function normalizeOrbSignal(signal?: OrbSignal) {
  const level = signal?.captureLevel;
  return { capture: typeof level === 'number' && Number.isFinite(level) ? Math.max(0, Math.min(1, level)) : 0,
    playback: signal?.playback === true ? 1 : 0 };
}
