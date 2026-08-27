/**
 * 录音工具（MediaRecorder，WebView 内原生支持）：
 * - getUserMedia 采麦克风（单声道 + 降噪），MediaRecorder 输出 webm/opus
 * - 录音期间通过 AnalyserNode 提供音量电平（0~1），供 UI 画声波
 * - stop() 返回 dataURL + 时长；cancel() 丢弃
 * 权限：Android 需 RECORD_AUDIO（Capacitor WebView 的 onPermissionRequest 会自动放行，
 * 只要权限已授予 —— 见 speech-recognition.ts 的 ensureRecordPermission）
 */

export interface RecordingResult {
  dataUrl: string;
  durationSec: number;
  /** 实际录到的时长（毫秒） */
  durationMs: number;
}

export class AudioRecorder {
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private startedAt = 0;
  private stopAt = 0;
  private analyser: AnalyserNode | null = null;
  private audioCtx: AudioContext | null = null;
  private rafId = 0;
  private level = 0;
  private onLevel: ((level: number) => void) | null = null;
  private mimeType = 'audio/webm;codecs=opus';

  get isRecording(): boolean {
    return this.recorder?.state === 'recording';
  }

  /** 当前电平（最近一次采样，0~1） */
  get currentLevel(): number {
    return this.level;
  }

  /** 已录制毫秒数 */
  get elapsedMs(): number {
    return this.recorder?.state === 'recording' ? Date.now() - this.startedAt : this.stopAt - this.startedAt;
  }

  async start(onLevel?: (level: number) => void): Promise<void> {
    if (this.isRecording) return;
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('设备不支持录音');

    this.onLevel = onLevel ?? null;
    this.chunks = [];
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
    });
    this.stream = stream;

    // 电平采样（AnalyserNode 旁路，不消耗音频）
    try {
      this.audioCtx = new AudioContext();
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 512;
      const src = this.audioCtx.createMediaStreamSource(stream);
      src.connect(this.analyser);
      const data = new Uint8Array(this.analyser.frequencyBinCount);
      const tick = () => {
        if (!this.analyser) return;
        this.analyser.getByteFrequencyData(data);
        const avg = data.reduce((s, v) => s + v, 0) / data.length / 255;
        this.level = Math.min(1, avg * 2.2);
        this.onLevel?.(this.level);
        this.rafId = requestAnimationFrame(tick);
      };
      this.rafId = requestAnimationFrame(tick);
    } catch {
      /* 电平不可用不影响录音 */
    }

    // MediaRecorder：优先 webm/opus（Android WebView 原生支持），否则用默认格式
    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : '';
    this.mimeType = mime || 'audio/webm';
    const recorder = mime
      ? new MediaRecorder(stream, { mimeType: mime })
      : new MediaRecorder(stream);
    this.recorder = recorder;
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) this.chunks.push(e.data);
    };
    recorder.start(200);
    this.startedAt = Date.now();
  }

  /** 停止并返回录音结果；无有效数据返回 null */
  stop(): Promise<RecordingResult | null> {
    return new Promise((resolve) => {
      const recorder = this.recorder;
      if (!recorder || recorder.state === 'inactive') {
        this.cleanup();
        resolve(null);
        return;
      }
      this.stopAt = Date.now();
      recorder.onstop = () => {
        const durationMs = this.stopAt - this.startedAt;
        const blob = new Blob(this.chunks, { type: this.mimeType });
        this.cleanup();
        if (blob.size === 0) {
          resolve(null);
          return;
        }
        const reader = new FileReader();
        reader.onload = () => {
          resolve({ dataUrl: reader.result as string, durationSec: Math.max(1, Math.round(durationMs / 1000)), durationMs });
        };
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      };
      recorder.stop();
    });
  }

  /** 取消录音（丢弃） */
  cancel(): void {
    const recorder = this.recorder;
    if (recorder && recorder.state !== 'inactive') {
      recorder.onstop = () => this.cleanup();
      try {
        recorder.stop();
      } catch {
        this.cleanup();
      }
    } else {
      this.cleanup();
    }
  }

  private cleanup(): void {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    this.analyser = null;
    try {
      void this.audioCtx?.close();
    } catch {
      /* ignore */
    }
    this.audioCtx = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.recorder = null;
    this.chunks = [];
    this.level = 0;
    this.onLevel = null;
  }
}
