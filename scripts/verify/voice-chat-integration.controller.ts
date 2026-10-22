// Presentation/persistence fixture only. It never opens an audio device or API.
export class VoiceCallController {
  constructor(_id: string, private options: { onView(view: unknown): void }) {}
  async start() {
    this.options.onView({ phase: 'listening', inputMode: 'text', muted: false, userText: '', generatedText: '', heardText: '', level: 0 });
  }
  async end() { return (window as any).integrationCallExchanges ?? []; }
  getRecords() { return (window as any).integrationCallExchanges ?? []; }
}
