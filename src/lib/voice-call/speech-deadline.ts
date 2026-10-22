import { SpokenSentenceBuffer } from './utterance';

export interface SpeechDeadlineScheduler {
  now(): number;
  set(callback: () => void, delayMs: number): unknown;
  clear(handle: unknown): void;
}
const timers: SpeechDeadlineScheduler = {
  now: () => performance.now(),
  set: (callback, delay) => setTimeout(callback, delay),
  clear: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** One ordered review queue shared by text deltas and a bounded safe-clause timer. */
export class SpeechDeadlineQueue {
  private readonly scheduler: SpeechDeadlineScheduler;
  private readonly splitter: SpokenSentenceBuffer;
  private tail: Promise<void> = Promise.resolve();
  private timer?: unknown;
  private disposed = false;
  private ended = false;
  private failed = false;
  private failure: unknown;
  private readonly abort = () => this.dispose();
  constructor(private readonly options: {
    signal: AbortSignal;
    onSentence(text: string): Promise<void>;
    onFailure(error: unknown): void;
    scheduler?: SpeechDeadlineScheduler;
  }) {
    this.scheduler = options.scheduler ?? timers;
    this.splitter = new SpokenSentenceBuffer(() => this.scheduler.now());
    options.signal.addEventListener('abort', this.abort, { once: true });
    if (options.signal.aborted) this.dispose();
  }
  async push(delta: string, final = false): Promise<void> {
    this.current();
    if (this.ended) throw new DOMException('Aborted', 'AbortError');
    this.clearTimer();
    const parts = this.splitter.push(delta, final);
    const operation = this.enqueue(parts);
    if (final) this.ended = true; else this.schedule();
    try { await this.wait(operation); this.current(); }
    finally { if (final) this.dispose(); }
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.clearTimer(); this.splitter.reset();
    this.options.signal.removeEventListener('abort', this.abort);
  }
  private current() {
    if (this.failed) throw this.failure;
    if (this.disposed || this.options.signal.aborted) throw new DOMException('Aborted', 'AbortError');
  }
  private enqueue(parts: string[]): Promise<void> {
    if (!parts.length) return this.tail;
    const operation = this.tail.then(async () => {
      for (const part of parts) { this.current(); await this.options.onSentence(part); this.current(); }
    }).catch(error => {
      this.fail(error); throw error;
    });
    this.tail = operation;
    // Timer work may fail before another text delta arrives. Keep it observed.
    void operation.catch(() => {});
    return operation;
  }
  private schedule() {
    if (this.disposed || this.ended) return;
    const delay = this.splitter.deadlineDelay();
    if (delay === undefined) return;
    this.timer = this.scheduler.set(() => {
      this.timer = undefined;
      if (this.disposed || this.ended || this.options.signal.aborted) return;
      try { this.enqueue(this.splitter.flushDue()); this.schedule(); }
      catch (error) { this.fail(error); }
    }, Math.max(1, Math.ceil(delay)));
  }
  private clearTimer() {
    if (this.timer !== undefined) { this.scheduler.clear(this.timer); this.timer = undefined; }
  }
  private fail(error: unknown) {
    if (this.failed) return;
    this.failed = true; this.failure = error;
    if (!this.disposed && !this.options.signal.aborted) {
      try { this.options.onFailure(error); } catch { /* Preserve the original review failure. */ }
    }
    this.dispose();
  }
  private wait(operation: Promise<void>): Promise<void> {
    return new Promise((resolve, reject) => {
      const signal = this.options.signal;
      const abort = () => { signal.removeEventListener('abort', abort); reject(new DOMException('Aborted', 'AbortError')); };
      signal.addEventListener('abort', abort, { once: true });
      operation.then(() => { signal.removeEventListener('abort', abort); resolve(); }, error => { signal.removeEventListener('abort', abort); reject(error); });
      if (signal.aborted) abort();
    });
  }
}
