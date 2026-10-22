import type { CallInputMode } from './input';

export type CallPhase = 'initializing' | 'connecting' | 'listening' | 'recognizing' | 'generating' | 'playing' | 'interrupting' | 'paused' | 'error' | 'ended';
export interface CallTurn {
  id: string;
  generation: number;
  signal: AbortSignal;
}
export interface SpokenSegment {
  playbackSampleRate?: number;
  /** Cumulative native-track frame boundaries; end absent until synthesis has finished writing. */
  playbackStartFrame?: number;
  playbackEndFrame?: number;
  id: string;
  turnId: string;
  text: string;
  generatedAt: number;
  /** Full playback acknowledgement only; synthesis/network delivery is not listening evidence. */
  playedAt?: number;
  interrupted: boolean;
  playedFrames: number;
}
const transitions: Record<CallPhase, readonly CallPhase[]> = {
  initializing: ['connecting', 'error', 'ended'],
  connecting: ['listening', 'paused', 'error', 'ended'],
  listening: ['recognizing', 'generating', 'interrupting', 'paused', 'error', 'ended'],
  recognizing: ['generating', 'listening', 'interrupting', 'paused', 'error', 'ended'],
  generating: ['playing', 'listening', 'interrupting', 'paused', 'error', 'ended'],
  playing: ['generating', 'listening', 'interrupting', 'paused', 'error', 'ended'],
  interrupting: ['listening', 'paused', 'error', 'ended'],
  paused: ['connecting', 'listening', 'error', 'ended'],
  error: ['connecting', 'ended'],
  ended: [],
};

/** Shared cancellation/receipt authority used by UI, transport and native playback callbacks. */
export class CallLifecycle {
  phase: CallPhase = 'initializing';
  private generation = 0;
  private controller?: AbortController;
  private turn?: CallTurn;
  private segments = new Map<string, SpokenSegment>();
  constructor(readonly callId: string, private readonly now: () => number = Date.now) {}
  transition(phase: CallPhase) {
    if (phase === this.phase) return;
    if (!transitions[this.phase].includes(phase)) throw new Error(`voice:transition:${this.phase}:${phase}`);
    this.phase = phase;
  }
  beginTurn(inputMode: CallInputMode = 'voice'): CallTurn {
    if (!['listening', 'interrupting'].includes(this.phase)) throw new Error('voice:turn_not_ready');
    this.invalidate();
    this.controller = new AbortController();
    this.turn = { id: `${this.callId}:${this.generation}`, generation: this.generation, signal: this.controller.signal };
    this.transition(this.phase === 'interrupting' ? 'listening' : this.phase);
    this.transition(inputMode === 'text' ? 'generating' : 'recognizing');
    return this.turn;
  }
  isCurrent(turn: CallTurn): boolean {
    return this.phase !== 'ended' && this.turn?.id === turn.id && turn.generation === this.generation && !turn.signal.aborted;
  }
  recordGenerated(turn: CallTurn, text: string): SpokenSegment | null {
    if (!this.isCurrent(turn) || !text.trim()) return null;
    const row: SpokenSegment = { id: `${turn.id}:segment:${this.segments.size}`, turnId: turn.id, text, generatedAt: this.now(), interrupted: false, playedFrames: 0 };
    this.segments.set(row.id, row);
    return { ...row };
  }
  acknowledgePlayback(turn: CallTurn, segmentId: string, frames: number, complete: boolean, sampleRate?: number): boolean {
    if (!this.isCurrent(turn) || !Number.isSafeInteger(frames) || frames < 0) return false;
    const row = this.segments.get(segmentId);
    if (!row || row.turnId !== turn.id || row.interrupted || frames < row.playedFrames) return false;
    row.playedFrames = frames;
    if (sampleRate === 8000 || sampleRate === 24000) row.playbackSampleRate = sampleRate;
    if (complete && frames > 0 && row.playedAt === undefined) row.playedAt = this.now();
    return true;
  }
  /** A stop receipt may update partial audit frames, never certify full listening. */
  recordStoppedPlayback(turn: CallTurn, segmentId: string, frames: number, sampleRate?: number): boolean {
    const row = this.segments.get(segmentId);
    if (!turn.signal.aborted || !row || row.turnId !== turn.id || !row.interrupted || row.playedAt !== undefined
      || !Number.isSafeInteger(frames) || frames < row.playedFrames) return false;
    row.playedFrames = frames;
    if (sampleRate === 8000 || sampleRate === 24000) row.playbackSampleRate = sampleRate;
    return true;
  }
  /** Invalidate before stopping native audio: late bridge callbacks can never certify listening. */
  invalidate() {
    this.generation++;
    this.controller?.abort();
    if (this.turn) for (const row of this.segments.values()) if (row.turnId === this.turn.id && row.playedAt === undefined) row.interrupted = true;
    this.turn = undefined;
  }
  interrupt() {
    if (['ended', 'error', 'paused', 'initializing', 'connecting'].includes(this.phase)) return;
    this.invalidate(); this.transition('interrupting');
  }
  pause() {
    if (this.phase === 'ended' || this.phase === 'paused' || !transitions[this.phase].includes('paused')) return;
    this.invalidate(); this.transition('paused');
  }
  end() { this.invalidate(); this.transition('ended'); }
  receipt(): SpokenSegment[] { return [...this.segments.values()].map(row => ({ ...row })); }
  /** Conservative context projection: partial frames never imply the whole sentence was heard. */
  heardText(): string { return this.receipt().filter(row => row.playedAt !== undefined).map(row => row.text).join(''); }
}
