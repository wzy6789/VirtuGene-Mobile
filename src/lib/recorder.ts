/**
 * 录音工具 —— 原生 MediaRecorder 实现（自定义 Capacitor 插件 NativeAudioRecorder）：
 * - 绕开 WebView getUserMedia 权限层（OPPO/ColorOS 上 WebView 麦克风会被误拒，原生最可靠）
 * - 输出 AAC/m4a 单声道 16kHz → base64 dataURL（消息存储 / 播放 / 云端转文字链路不变）
 * - 电平用原生 getMaxAmplitude 轮询（150ms），驱动声波 UI
 * 权限：RECORD_AUDIO（语音插件/原生插件声明，ChatInput 里先 ensureRecordPermission）
 */
import { registerPlugin } from '@capacitor/core';
import { IS_CAPACITOR } from './platform';

interface NativeAudioRecorderPlugin {
  start(): Promise<{ ok?: boolean }>;
  stop(): Promise<{ dataUrl: string; durationSec: number; durationMs: number }>;
  cancel(): Promise<{ ok?: boolean }>;
  isRecording(): Promise<{ recording: boolean }>;
  amplitude(): Promise<{ amplitude: number }>;
}

const NativeAudioRecorder = registerPlugin<NativeAudioRecorderPlugin>('NativeAudioRecorder');

export interface RecordingResult {
  dataUrl: string;
  durationSec: number;
  durationMs: number;
}

export class AudioRecorder {
  private startedAt = 0;
  private stopAt = 0;
  private ampTimer: ReturnType<typeof setInterval> | null = null;
  private active = false;
  private level = 0;
  private onLevel: ((level: number) => void) | null = null;

  get isRecording(): boolean {
    return this.active;
  }

  /** 当前电平（0~1） */
  get currentLevel(): number {
    return this.level;
  }

  /** 已录制毫秒数 */
  get elapsedMs(): number {
    return this.active ? Date.now() - this.startedAt : this.stopAt - this.startedAt;
  }

  async start(onLevel?: (level: number) => void): Promise<void> {
    if (this.active) return;
    if (!IS_CAPACITOR) throw new Error('需要 App 环境');
    this.onLevel = onLevel ?? null;
    try {
      await NativeAudioRecorder.start();
    } catch (e) {
      throw new Error((e as Error)?.message ?? '录音启动失败');
    }
    this.active = true;
    this.startedAt = Date.now();
    this.ampTimer = setInterval(() => {
      void NativeAudioRecorder.amplitude()
        .then(({ amplitude }) => {
          this.level = Math.min(1, (amplitude || 0) / 32767);
          this.onLevel?.(this.level);
        })
        .catch(() => {});
    }, 150);
  }

  /** 停止并返回录音结果（base64 dataURL + 时长）；失败返回 null */
  stop(): Promise<RecordingResult | null> {
    if (this.ampTimer) {
      clearInterval(this.ampTimer);
      this.ampTimer = null;
    }
    this.active = false;
    this.stopAt = Date.now();
    return NativeAudioRecorder.stop()
      .then((res) => ({ dataUrl: res.dataUrl, durationSec: res.durationSec, durationMs: res.durationMs }))
      .catch(() => null);
  }

  /** 取消录音（丢弃） */
  cancel(): void {
    if (this.ampTimer) {
      clearInterval(this.ampTimer);
      this.ampTimer = null;
    }
    this.active = false;
    void NativeAudioRecorder.cancel().catch(() => {});
  }
}
