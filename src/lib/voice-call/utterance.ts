/** Deterministic stop-phrase detection over 20ms microphone frames, before any billable ASR call. */
export class UtteranceGate {
  private active = false;
  private voiced = 0;
  private silent = 0;
  private elapsed = 0;
  private noise = 0.005;
  constructor(private readonly silenceMs = 700, private readonly maxMs = 30_000) {}
  reset() { this.active = false; this.voiced = this.silent = this.elapsed = 0; }
  isSpeech(rms: number): boolean { return Number.isFinite(rms) && rms > Math.max(0.018, this.noise * 3); }
  push(rms: number, ms = 20): 'none' | 'start' | 'end' | 'discard' {
    if (!Number.isFinite(rms) || ms <= 0 || ms > 100) return 'none';
    const speech = this.isSpeech(rms);
    if (!this.active && !speech) this.noise = this.noise * 0.98 + Math.min(rms, 0.02) * 0.02;
    if (!this.active) {
      this.voiced = speech ? this.voiced + ms : 0;
      if (this.voiced < 80) return 'none';
      this.active = true; this.elapsed = this.voiced; this.silent = 0; return 'start';
    }
    this.elapsed += ms;
    if (speech) { this.voiced += ms; this.silent = 0; } else this.silent += ms;
    if (this.silent >= this.silenceMs || this.elapsed >= this.maxMs) {
      const result = this.voiced >= 200 ? 'end' : 'discard'; this.reset(); return result;
    }
    return 'none';
  }
}

/** Incremental speech-only segmentation. Parenthesized stage directions never reach TTS. */
export class SpokenSentenceBuffer {
  private buffer = '';
  private brackets: string[] = [];
  private suppressed = false;
  private stars = false;
  private tag: string | null = null;
  private hiddenTags: string[] = [];
  push(delta: string, final = false): string[] {
    const output: string[] = [];
    for (const char of delta) {
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
      this.buffer += char;
      if (/[。！？!?；;\n]/.test(char) || (this.buffer.length >= 36 && /[，,、：: ]/.test(char)) || this.buffer.length >= 100) {
        const part = this.buffer.trim(); this.buffer = ''; if (part) output.push(part);
      }
    }
    if (final) { const part = this.buffer.trim(); this.buffer = ''; if (part) output.push(part); }
    return output;
  }
  reset() { this.buffer = ''; this.brackets = []; this.hiddenTags = []; this.suppressed = this.stars = false; this.tag = null; }
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
