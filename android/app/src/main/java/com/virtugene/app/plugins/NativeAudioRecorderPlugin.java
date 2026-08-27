package com.virtugene.app.plugins;

import android.Manifest;
import android.media.MediaRecorder;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;

/**
 * 原生录音插件（绕开 WebView getUserMedia 权限层——OPPO/ColorOS 上 WebView 麦克风
 * 会被误拒，原生 MediaRecorder 最可靠）。
 * 输出：AAC/m4a 单声道 16kHz，base64 dataURL（与 WebView 录音同一数据形态，消息/转文字链路不变）。
 * 注册：MainActivity.onCreate 中 super.onCreate() 之前 registerPlugin(...)。
 */
@CapacitorPlugin(
    name = "NativeAudioRecorder",
    permissions = { @Permission(strings = { Manifest.permission.RECORD_AUDIO }, alias = "recordAudio") }
)
public class NativeAudioRecorderPlugin extends Plugin {

    private MediaRecorder recorder;
    private File outputFile;
    private long startedAt;

    @PluginMethod
    public void start(PluginCall call) {
        try {
            if (recorder != null) {
                call.reject("already recording");
                return;
            }
            File dir = new File(getContext().getCacheDir(), "recordings");
            if (!dir.exists()) {
                //noinspection ResultOfMethodCallIgnored
                dir.mkdirs();
            }
            outputFile = new File(dir, "voice-" + System.currentTimeMillis() + ".m4a");
            recorder = new MediaRecorder();
            recorder.setAudioSource(MediaRecorder.AudioSource.MIC);
            recorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4);
            recorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC);
            recorder.setAudioSamplingRate(16000);
            recorder.setAudioEncodingBitRate(32000);
            recorder.setAudioChannels(1);
            recorder.setOutputFile(outputFile.getAbsolutePath());
            recorder.prepare();
            recorder.start();
            startedAt = System.currentTimeMillis();
            call.resolve(new JSObject());
        } catch (Exception e) {
            call.reject("start failed: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        int durationMs;
        try {
            if (recorder == null) {
                call.reject("not recording");
                return;
            }
            durationMs = (int) (System.currentTimeMillis() - startedAt);
            try {
                recorder.stop();
            } catch (RuntimeException ignored) {
                // 录音太短或已停止，忽略底层异常
            }
            recorder.release();
            recorder = null;
            String dataUrl = fileToDataUrl(outputFile, "audio/mp4");
            JSObject ret = new JSObject();
            ret.put("dataUrl", dataUrl);
            ret.put("durationSec", Math.max(1, durationMs / 1000));
            ret.put("durationMs", durationMs);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("stop failed: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        try {
            if (recorder != null) {
                try {
                    recorder.stop();
                } catch (RuntimeException ignored) {
                }
                recorder.release();
                recorder = null;
            }
            if (outputFile != null && outputFile.exists()) {
                //noinspection ResultOfMethodCallIgnored
                outputFile.delete();
            }
            call.resolve(new JSObject());
        } catch (Exception e) {
            call.reject("cancel failed: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void isRecording(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("recording", recorder != null);
        call.resolve(ret);
    }

    /** 当前振幅（0~32767），供 JS 画声波 */
    @PluginMethod
    public void amplitude(PluginCall call) {
        JSObject ret = new JSObject();
        int amp = 0;
        if (recorder != null) {
            try {
                amp = recorder.getMaxAmplitude();
            } catch (Exception ignored) {
            }
        }
        ret.put("amplitude", amp);
        call.resolve(ret);
    }

    private String fileToDataUrl(File f, String mime) {
        try {
            FileInputStream in = new FileInputStream(f);
            byte[] bytes = new byte[(int) f.length()];
            int read = 0;
            while (read < bytes.length) {
                int n = in.read(bytes, read, bytes.length - read);
                if (n < 0) break;
                read += n;
            }
            in.close();
            String b64 = Base64.encodeToString(bytes, Base64.NO_WRAP);
            return "data:" + mime + ";base64," + b64;
        } catch (IOException e) {
            return "";
        }
    }
}
