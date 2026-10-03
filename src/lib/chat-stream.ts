import { normalizeBubbleText, normalizeChatResponse } from './chat-pacing';
import { stripRoleplayActions } from './ai/text';

/** Explicit separators keep already-visible text in the same bubble as it grows. */
export function streamedReplyParts(raw: string, final = false): string[] {
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
    text = text.replace(/[（(][^（）()]{0,10}$/, match => /[0-9A-Za-z]/.test(match) ? match : '');
  }
  const parts = stripRoleplayActions(text).split(/\n?-{3,}\n?/).map(normalizeBubbleText).filter(Boolean);
  return parts.length <= 3 ? parts : [...parts.slice(0, 2), parts.slice(2).join(' ')];
}

/** Only the preview subscribes; token bursts never update the historical message store. */
export class ChatReplyStream {
  readonly ids = Array.from({ length: 3 }, () => crypto.randomUUID());
  readonly createdAt = Date.now();
  raw = '';
  published = false;
  private snapshot: string[] = [];
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(readonly sessionId: string, private onFirstText: () => void) {}
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
    const parts = streamedReplyParts(this.raw, final);
    if (parts.length === this.snapshot.length && parts.every((part, index) => part === this.snapshot[index])) return;
    this.snapshot = parts;
    if (parts.length && !this.published) { this.published = true; this.onFirstText(); }
    this.listeners.forEach(listener => listener());
  }
  dispose() { clearTimeout(this.timer); this.listeners.clear(); }
}
