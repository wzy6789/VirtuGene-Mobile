import { normalizeBubbleText, normalizeChatResponse, normalizeChatParagraphBoundaries, mergeReplyParts, joinReplyText, MAX_REPLY_PARTS } from './chat-pacing';
import { stripRoleplayActions } from './ai/text';

/** Explicit separators keep already-visible text in the same bubble as it grows. */
export function streamedReplyParts(raw: string, final = false, preservePublished = false,options:{longForm?:boolean}={}): string[] {
  let text = raw;
  if (/^\s*(?:```(?:json)?\s*)?\{/.test(text)) {
    const candidate = text.replace(/^\s*```(?:json)?\s*/, '').replace(/\s*```\s*$/, '');
    try {
      const parsed = JSON.parse(candidate);
      if (!Array.isArray(parsed?.messages)) return [];
      text = normalizeChatResponse(candidate);
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
  private longForm=false;
  constructor(readonly sessionId: string, private onFirstText: () => void) {}
  configure(options:{longForm:boolean}) { if(!this.raw&&!this.published)this.longForm=options.longForm; }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.snapshot;
  push = (raw: string) => {
    this.raw = raw;
    if (!this.published) this.flush();
    else if (!this.timer) this.timer = setTimeout(() => this.flush(), 32);
  };
  finish(raw = this.raw) { this.raw = raw; this.flush(true); }
  private flush(final = false) {
    clearTimeout(this.timer); this.timer = undefined;
    const parts = streamedReplyParts(this.raw, final, true,{longForm:this.longForm});
    if (parts.length === this.snapshot.length && parts.every((part, index) => part === this.snapshot[index])) return;
    this.snapshot = parts;
    if (parts.length && !this.published) { this.published = true; this.firstTextAt=Date.now(); this.onFirstText(); }
    this.listeners.forEach(listener => listener());
  }
  dispose() { clearTimeout(this.timer); this.listeners.clear(); }
}
