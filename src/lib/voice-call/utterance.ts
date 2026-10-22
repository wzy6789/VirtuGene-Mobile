/** Deterministic stop-phrase detection over 20ms microphone frames, before any billable ASR call. */
export class UtteranceGate {
  private active = false;
  private voiced = 0;
  private silent = 0;
  private elapsed = 0;
  private earlyBoundaries = 0;
  private segmentVoiced = 0;
  private forcedBoundary = false;
  private noise = 0.005;
  constructor(private readonly silenceMs = 700, private readonly maxMs = 30_000) {}
  reset() { this.active = false; this.forcedBoundary = false; this.earlyBoundaries = this.segmentVoiced = this.voiced = this.silent = this.elapsed = 0; }
  isSpeech(rms: number): boolean { return Number.isFinite(rms) && rms > Math.max(0.018, this.noise * 3); }
  /** A PCM boundary continues the same speech; only silence ends it. */
  segmentBoundary(forced = true) { this.elapsed = this.segmentVoiced = 0; if (forced) this.forcedBoundary = true; }
  push(rms: number, ms = 20, recognitionRoom = true): 'none' | 'start' | 'recognize' | 'segment' | 'end' | 'discard' {
    if (!Number.isFinite(rms) || ms <= 0 || ms > 100) return 'none';
    const speech = this.isSpeech(rms);
    if (!this.active && !speech) this.noise = this.noise * 0.98 + Math.min(rms, 0.02) * 0.02;
    if (!this.active) {
      this.voiced = speech ? this.voiced + ms : 0;
      if (this.voiced < 80) return 'none';
      this.active = true; this.segmentVoiced = this.elapsed = this.voiced; this.silent = 0; return 'start';
    }
    this.elapsed += ms;
    if (speech) { this.voiced += ms; this.segmentVoiced += ms; this.silent = 0; } else this.silent += ms;
    if (this.silent >= this.silenceMs) {
      const result = this.voiced >= 200 ? 'end' : 'discard'; this.reset(); return result;
    }
    // Upload the completed audio prefix while the ordinary end-of-turn grace
    // period continues. Never infer a finished user turn from this boundary.
    // A resumed clause gets one further early upload, so a comma pause does
    // not consume the only opportunity to recognize the final clause early.
    // Cap at two per utterance; never fill a slow ASR queue with hesitations.
    if (!this.forcedBoundary && this.earlyBoundaries < 2 && recognitionRoom && this.segmentVoiced >= 200 && this.silent >= 240) {
      this.earlyBoundaries++; this.segmentBoundary(false); return 'recognize';
    }
    if (this.elapsed >= this.maxMs) { this.segmentBoundary(); return 'segment'; }
    return 'none';
  }
}

/** Incremental speech-only segmentation. Parenthesized stage directions never reach TTS. */
export class SpokenSentenceBuffer {
  private emitted = false;
  private buffer = '';
  private visiblePoints = 0;
  private highSurrogate = '';
  private brackets: string[] = [];
  private suppressed = false;
  private stars = false;
  private tag: string | null = null;
  private hiddenTags: string[] = [];
  private bufferedAt?: number;
  constructor(private readonly now: () => number = () => performance.now()) {}
  /** Qualifiers must not be detached from an apparently affirmative first clause. */
  private qualifies(text: string): boolean {
    const start = text.trimStart().replace(/^(?:接下来|然后|另外|同时|最后|首先|其次)/, '').replace(/^(?:我们|你们|他们|大家|我|你|他|她)(?:也|还|可能|或许)?/, '');
    return /^(?:但|不过|只是|除非|否则|然而|而是|而不|不|没|未|无|别|并非|并不|不能|不会|not\b|never\b|unless\b|except\b|but\b|however\b|cannot\b|can't\b|don't\b|if\b)/i.test(start);
  }
  private urlAtEnd(text: string): boolean { return /(?:https?:\/\/|www\.)\S*$/i.test(text); }
  private commitmentPrefix(text: string): boolean { return /(?:保证|承诺|一定|肯定|绝对|必定|(?:我|我们)(?:确实|现在|也|还是|真的|当然)?(?:会|能|可以))/.test(text); }
  /** A completed verb can still be inside a condition or a denied assertion.
   * Keep that scope attached until punctuation/final text establishes its end. */
  private dependentPrefix(text: string): boolean {
    return /(?:不是|并非|不代表|不意味着|不等于|(?:别|不要)以为|不能(?:说|认为|以为|认定|证明)|(?:不|没)(?:觉得|认为|以为)|如果|只要|只有|除非|即使|哪怕|就算|倘若|假如|无论|不管|虽然)/.test(text);
  }
  private readyBoundary(): number {
    const last = this.buffer.slice(-1);
    if (/[。！？!?；;\n]/.test(last) && !this.urlAtEnd(this.buffer)) return this.buffer.length;
    // A dot needs right context: 12.34, example.com, Dr. Smith and URL paths
    // must not be pronounced as unrelated sentences.
    if (/\.\s$/.test(this.buffer)) {
      const prefix = this.buffer.trimEnd();
      if (!this.urlAtEnd(prefix) && !/(?:\d|\b[A-Z]|\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc|e\.g|i\.e))\.$/i.test(prefix)) return prefix.length;
    }
    const minimum = this.emitted ? 36 : 12;
    if (this.visiblePoints < minimum + 5) return 0;
    const clause = this.clauseBoundary(minimum);
    if (clause) return clause;
    // Retain punctuation phrase budgets, and use a 100-code-point whole-token
    // budget for whitespace. Right context protects immediate qualifications.
    const soft = /[，,、：: ]/g;
    let match: RegExpExecArray | null;
    while ((match = soft.exec(this.buffer))) {
      const end = match.index + 1, prefix = this.buffer.slice(0, end), tail = this.buffer.slice(end).trimStart();
      if (Array.from(prefix).length < minimum || Array.from(tail).length < 4 || this.qualifies(tail) || this.commitmentPrefix(prefix)) continue;
      const before = this.buffer.slice(0, match.index), separator = match[0];
      if (separator === ' ' && this.visiblePoints < 100) continue;
      if ((separator === ':' && /[A-Za-z0-9]$/.test(before)) || (separator === ',' && /\d$/.test(before))) continue;
      if (separator !== ' ' && this.urlAtEnd(prefix)) continue;
      return end;
    }
    return 0;
  }
  private clauseBoundary(minimum: number): number {
    if (this.visiblePoints < minimum + 5) return 0;
    // This is a conservative syntactic opportunity, not semantic endpoint AI.
    // Require an already complete predicate plus a new-clause marker and actual
    // following words. A bare character budget never authorizes early speech.
    const starts = /然后|接下来|另外|同时|最后|首先|其次|第一步|第二步|我们先|你可以先/g;
    let start: RegExpExecArray | null;
    while ((start = starts.exec(this.buffer))) {
      const prefix = this.buffer.slice(0, start.index), tail = this.buffer.slice(start.index);
      if (Array.from(prefix).length < minimum || this.urlAtEnd(prefix) || this.qualifies(tail)) continue;
      if (this.commitmentPrefix(prefix) || this.dependentPrefix(prefix)) continue;
      if (!/(?:了|过|吧|呢|清楚|明白|完成|了解|解决|来看|来处理|开始|结束|[两三四五六七八九十]步)$/.test(prefix)) continue;
      const following = tail.slice(start[0].length);
      if (/^[\u3400-\u9fff]{4}/.test(following) && !this.qualifies(following)) return start.index;
    }
    return 0;
  }
  /** Only an already safe complete clause can use the elapsed-time budget.
   * Unsafe tokens/qualifications still wait for final text or the existing size limit. */
  deadlineDelay(): number | undefined {
    if (this.bufferedAt === undefined || !this.clauseBoundary(this.emitted ? 12 : 4)) return undefined;
    return Math.max(0, this.bufferedAt + (this.emitted ? 700 : 450) - this.now());
  }
  flushDue(): string[] {
    const delay = this.deadlineDelay();
    if (delay === undefined || delay > 0) return [];
    const boundary = this.clauseBoundary(this.emitted ? 12 : 4);
    const part = this.buffer.slice(0, boundary).trim();
    this.buffer = this.buffer.slice(boundary); this.visiblePoints = Array.from(this.buffer).length;
    this.bufferedAt = this.buffer ? this.now() : undefined;
    this.emitted = true;
    return part ? [part] : [];
  }
  push(delta: string, final = false): string[] {
    const output: string[] = [];
    let text = this.highSurrogate + delta; this.highSurrogate = '';
    // SSE text deltas may split a UTF-16 surrogate pair even though each JSON
    // message is valid. Hold one high surrogate until its matching next delta.
    if (!final && /[\uD800-\uDBFF]$/.test(text)) { this.highSurrogate = text.slice(-1); text = text.slice(0, -1); }
    for (const char of text) {
      if (char.length === 1 && /[\uD800-\uDFFF]/.test(char)) throw new Error('voice:invalid_speech_unicode');
      if (this.tag !== null) {
        if (char === '>') {
          const match = /^(\/?)\s*(think|analysis|style|instruction)(?:\s|$)/i.exec(this.tag.trim());
          if (match) {
            const name = match[2].toLowerCase();
            if (!match[1]) this.hiddenTags.push(name);
            else {
              const index = this.hiddenTags.lastIndexOf(name);
              // An unrelated closing tag must never reveal a hidden parent.
              if (index >= 0) this.hiddenTags.splice(index);
            }
          }
          this.tag = null;
        } else this.tag = (this.tag + char).slice(0, 80);
        continue;
      }
      if (char === '<') { this.tag = ''; continue; }
      if (this.hiddenTags.length) continue;
      if (char === '*') { this.stars = true; continue; }
      if (this.stars) { this.suppressed = !this.suppressed; this.stars = false; }
      if (char === '(' || char === '（' || char === '[' || char === '【') { this.brackets.push(char); continue; }
      if (char === ')' || char === '）' || char === ']' || char === '】') { this.brackets.pop(); continue; }
      if (this.brackets.length) continue;
      if (this.suppressed || char === '>') continue;
      if (!this.buffer) this.bufferedAt = this.now();
      this.buffer += char; this.visiblePoints++;
      const boundary = this.readyBoundary();
      if (boundary) {
        const part = this.buffer.slice(0, boundary).trim(); this.buffer = this.buffer.slice(boundary); this.visiblePoints = Array.from(this.buffer).length;
        this.bufferedAt = this.buffer ? this.now() : undefined;
        if (part) { output.push(part); this.emitted = true; }
      }
      // Unsplittable tokens are allowed past the former arbitrary 100-unit cut,
      // but never buffered without bound. Fail closed rather than utter a
      // misleading fragment or silently discard the rest of the answer.
      if (this.visiblePoints > 1024) throw new Error('voice:speech_boundary_limit');
    }
    if (final) { const part = this.buffer.trim(); this.buffer = ''; this.visiblePoints = 0; this.bufferedAt = undefined; if (part) { output.push(part); this.emitted = true; } }
    else output.push(...this.flushDue());
    return output;
  }
  reset() { this.buffer = ''; this.visiblePoints = 0; this.bufferedAt = undefined; this.highSurrogate = ''; this.brackets = []; this.hiddenTags = []; this.emitted = false; this.suppressed = this.stars = false; this.tag = null; }
}

export function pcmWav(pcm: Uint8Array, sampleRate = 16_000): Uint8Array {
  if (pcm.length % 2 || pcm.length > sampleRate * 2 * 30 || ![16_000, 24_000, 48_000].includes(sampleRate)) throw new Error('voice:invalid_pcm');
  const wav = new Uint8Array(44 + pcm.length), view = new DataView(wav.buffer);
  const tag = (offset: number, text: string) => { for (let i = 0; i < text.length; i++) wav[offset + i] = text.charCodeAt(i); };
  tag(0, 'RIFF'); view.setUint32(4, 36 + pcm.length, true); tag(8, 'WAVE'); tag(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  tag(36, 'data'); view.setUint32(40, pcm.length, true); wav.set(pcm, 44); return wav;
}
