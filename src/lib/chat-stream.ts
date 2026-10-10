import { normalizeBubbleText, normalizeChatResponse, normalizeChatParagraphBoundaries, normalizeChatQuotationEscapes, mergeReplyParts, joinReplyText, followUpDelay, MAX_REPLY_PARTS,type ChatTextOptions } from './chat-pacing';
import { stripRoleplayActions } from './ai/text';

/** Explicit separators keep already-visible text in the same bubble as it grows. */
export function streamedReplyParts(raw: string, final = false, preservePublished = false,options:ChatTextOptions={}): string[] {
  let text = raw;
  if (/^\s*(?:```(?:json)?\s*)?\{/.test(text)) {
    const candidate = text.replace(/^\s*```(?:json)?\s*/, '').replace(/\s*```\s*$/, '');
    try {
      const parsed = JSON.parse(candidate);
      if (!Array.isArray(parsed?.messages)) return [];
      text = normalizeChatResponse(candidate,options);
    } catch { return []; } // Never flash a partial JSON envelope in a chat bubble.
  }
  if (!final) {
    // A separator or short stage direction may arrive over several SSE frames.
    text = text.replace(/-{1,2}$/, '');
    // Hold incomplete asides of any length; never flash an action before its
    // closing bracket lets us distinguish it from a factual note.
    const pending = text.match(/[（(][^（）()]*$/u);
    if (pending) text = text.slice(0, pending.index);
    // Keep trailing line-break whitespace pending until the next character
    // decides whether an English word boundary needs a space.
    text = text.replace(/[ \t]*[\r\n]+[ \t]*$/u, '');
  }
  text=normalizeChatQuotationEscapes(text,options,final);
  const parts = normalizeChatParagraphBoundaries(stripRoleplayActions(text),options).split(/\n?-{3,}\n?/).map(normalizeBubbleText).filter(Boolean);
  if (parts.length <= MAX_REPLY_PARTS) return parts;
  // Published SSE bubbles retain their identities. Never move text backwards
  // into an earlier visible row merely because a later part became shorter.
  return preservePublished ? [...parts.slice(0, MAX_REPLY_PARTS - 1), parts.slice(MAX_REPLY_PARTS - 1).reduce(joinReplyText)] : mergeReplyParts(parts);
}

/** Only the preview subscribes; token bursts never update the historical message store. */
export class ChatReplyStream {
  readonly ids = Array.from({ length: MAX_REPLY_PARTS }, () => crypto.randomUUID());
  readonly createdAt = Date.now();
  raw = '';
  published = false;
  firstTextAt?: number;
  private snapshot: string[] = [];
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private revealTimer: ReturnType<typeof setTimeout> | undefined;
  private lastRevealAt = 0;
  private final = false;
  private stopped = false;
  private drained = new Set<() => void>();
  private options:ChatTextOptions={};
  get textOptions():ChatTextOptions { return {...this.options}; }
  constructor(readonly sessionId: string, private onFirstText: () => void) {}
  configure(options:ChatTextOptions) { if(!this.raw&&!this.published)this.options={...options}; }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.snapshot;
  push = (raw: string) => {
    if (this.stopped || this.final) return;
    this.raw = raw;
    if (!this.published) this.flush();
    else if (!this.timer) this.timer = setTimeout(() => this.flush(), 32);
  };
  /** Completion waits for queued bubbles: saving must not bypass their cadence. */
  finish(raw = this.raw): Promise<void> {
    if (this.stopped) return Promise.resolve();
    this.raw = raw;
    this.final = true;
    return new Promise(resolve => { this.drained.add(resolve); this.flush(); });
  }
  /** Freeze only what was visible. A stop must never reveal queued text. */
  stop() {
    if (this.stopped) return;
    this.stopped = true;
    clearTimeout(this.timer); this.timer = undefined;
    clearTimeout(this.revealTimer); this.revealTimer = undefined;
    this.resolveDrain();
  }
  private resolveDrain() {
    this.drained.forEach(resolve => resolve()); this.drained.clear();
  }
  private flush() {
    clearTimeout(this.timer); this.timer = undefined;
    clearTimeout(this.revealTimer); this.revealTimer = undefined;
    if (this.stopped) return;
    const parts = streamedReplyParts(this.raw, this.final, true,this.options);
    let visible = Math.min(this.snapshot.length, parts.length);
    const now = performance.now();
    // Credit elapsed generation time since the previous bubble appeared. Even
    // a complete multi-part response can reveal at most one new row per tick.
    if (parts.length > visible && (!visible || now - this.lastRevealAt >= followUpDelay(parts[visible - 1]))) {
      visible++;
      this.lastRevealAt = now;
    }
    const next = parts.slice(0, visible);
    if (next.length !== this.snapshot.length || next.some((part, index) => part !== this.snapshot[index])) {
      this.snapshot = next;
      if (next.length && !this.published) { this.published = true; this.firstTextAt=Date.now(); this.onFirstText(); }
      this.listeners.forEach(listener => listener());
    }
    if (this.stopped) return;
    if (visible < parts.length) {
      const remaining = followUpDelay(parts[visible - 1]) - (performance.now() - this.lastRevealAt);
      this.revealTimer = setTimeout(() => this.flush(), Math.max(1, Math.ceil(remaining)));
    } else if (this.final) this.resolveDrain();
  }
  dispose() { this.stop(); this.listeners.clear(); }
}
