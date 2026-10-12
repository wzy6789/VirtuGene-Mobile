package com.virtugene.app.plugins;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.BroadcastReceiver;
import android.media.AudioAttributes;
import android.media.AudioDeviceCallback;
import android.media.AudioDeviceInfo;
import android.media.AudioFocusRequest;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioRecord;
import android.media.AudioTrack;
import android.media.MediaRecorder;
import android.media.audiofx.AcousticEchoCanceler;
import android.media.audiofx.NoiseSuppressor;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Base64;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "VoiceCallAudio", permissions = {
    @Permission(strings = { Manifest.permission.RECORD_AUDIO }, alias = "microphone"),
    @Permission(strings = { Manifest.permission.BLUETOOTH_CONNECT }, alias = "bluetooth")
})
public final class VoiceCallAudioPlugin extends Plugin {
    private final Object lock = new Object();
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService output = Executors.newSingleThreadExecutor();
    private AudioManager manager;
    private AudioRecord recorder;
    private AudioTrack track;
    private AcousticEchoCanceler echo;
    private NoiseSuppressor noise;
    private AudioFocusRequest focusRequest;
    private AudioDeviceCallback devices;
    private Thread capture;
    private volatile boolean running, muted, paused;
    private volatile long heartbeat;
    private volatile long captureGeneration, captureRevision;
    private long captureSequence;
    private String callId, playbackTurn, pendingCallId, pendingCallbackId;
    private long epoch, writtenFrames;
    private int queuedBytes, previousMode, voiceFrames;
    private boolean previousSpeaker;
    private boolean ownsAudioMode;
    private Runnable playbackTicker;
    private Runnable durationLimit;
    private BroadcastReceiver scoReceiver;
    private boolean legacyScoRequested, legacyScoConnected;
    private LegacyScoPcm scoOutput;
    private Runnable scoTimeout;
    private long scoGeneration;
    private int routedInput, routedOutput, routedCommunication;
    private final AudioManager.OnAudioFocusChangeListener focus = change -> {
        if (change == AudioManager.AUDIOFOCUS_LOSS || change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT || change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK) suspend("audio-focus");
        else if (change == AudioManager.AUDIOFOCUS_GAIN && running) event("focusAvailable", new JSObject());
    };

    @Override public void load() { manager = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE); }
    @PluginMethod public void start(PluginCall call) {
        synchronized (lock) {
            String id = call.getString("callId");
            if (id == null || id.isEmpty() || id.length() > 160) { call.reject("voice:invalid_call"); return; }
            if (running || pendingCallId != null) { call.reject("voice:already_active"); return; }
            pendingCallId = id;
            pendingCallbackId = call.getCallbackId();
        }
        if (getPermissionState("microphone") != PermissionState.GRANTED) { requestPermissionForAlias("microphone", call, "permissionReady"); return; }
        begin(call);
    }
    @PermissionCallback private void permissionReady(PluginCall call) {
        synchronized (lock) {
            if (pendingCallId == null || !pendingCallId.equals(call.getString("callId")) || !call.getCallbackId().equals(pendingCallbackId)) { call.reject("voice:cancelled"); return; }
            if (getPermissionState("microphone") != PermissionState.GRANTED) { pendingCallId = pendingCallbackId = null; call.reject("voice:microphone_denied"); return; }
        }
        begin(call);
    }
    @PluginMethod public void requestBluetooth(PluginCall call) {
        if (Build.VERSION.SDK_INT < 31 || getPermissionState("bluetooth") == PermissionState.GRANTED) { call.resolve(); return; }
        requestPermissionForAlias("bluetooth", call, "bluetoothReady");
    }
    @PermissionCallback private void bluetoothReady(PluginCall call) {
        if (getPermissionState("bluetooth") == PermissionState.GRANTED) call.resolve(); else call.reject("voice:bluetooth_denied");
    }
    private void begin(PluginCall call) {
        synchronized (lock) {
            if (running) { call.reject("voice:already_active"); return; }
            String id = call.getString("callId");
            if (pendingCallId == null || !pendingCallId.equals(id) || !call.getCallbackId().equals(pendingCallbackId)) { call.reject("voice:cancelled"); return; }
            pendingCallId = pendingCallbackId = null;
            if (id == null || id.length() > 160 || id.isEmpty()) { call.reject("voice:invalid_call"); return; }
            if (!AudioCaptureLease.acquire(this)) { call.reject("voice:microphone_busy"); return; }
            try {
                previousMode = manager.getMode(); previousSpeaker = manager.isSpeakerphoneOn();
                AudioAttributes attributes = new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build();
                int granted;
                if (Build.VERSION.SDK_INT >= 26) {
                    focusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT).setAudioAttributes(attributes).setOnAudioFocusChangeListener(focus, main).build();
                    granted = manager.requestAudioFocus(focusRequest);
                } else granted = manager.requestAudioFocus(focus, AudioManager.STREAM_VOICE_CALL, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT);
                if (granted != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) throw new IllegalStateException("audio-focus");
                manager.setMode(AudioManager.MODE_IN_COMMUNICATION);
                ownsAudioMode = true;
                replaceCapture(16000);
                callId = id; running = true; paused = false; muted = false; heartbeat = SystemClock.elapsedRealtime();
                captureSequence = 0;
                final String limitedCall = id;
                durationLimit = () -> { synchronized (lock) { if (running && limitedCall.equals(callId)) { JSObject reason = new JSObject(); reason.put("reason", "duration-limit"); event("ended", reason); close(); } } };
                main.postDelayed(durationLimit, 60 * 60 * 1000L);
                VoiceCallService.onEnd = () -> main.post(() -> { if (running) { event("ended", new JSObject()); close(); } });
                Intent service = new Intent(getContext(), VoiceCallService.class);
                if (Build.VERSION.SDK_INT >= 26) getContext().startForegroundService(service); else getContext().startService(service);
                devices = new AudioDeviceCallback() {
                    @Override public void onAudioDevicesAdded(AudioDeviceInfo[] added) { event("routes", routes()); }
                    @Override public void onAudioDevicesRemoved(AudioDeviceInfo[] removed) {
                        synchronized (lock) {
                            if (!running) return;
                            int[] ids = new int[removed.length];
                            for (int i = 0; i < removed.length; i++) ids[i] = removed[i].getId();
                            boolean lost = AudioRouteLoss.affectsCall(ids, routedInput, routedOutput, routedCommunication);
                            if (lost) {
                                // Stop capture and output natively before waiting for WebView.
                                suspend("route-lost"); routedInput = routedOutput = routedCommunication = 0;
                                event("routeLost", routes());
                            } else event("routes", routes());
                        }
                    }
                };
                manager.registerAudioDeviceCallback(devices, main);
                recorder.startRecording();
                final AudioRecord input = recorder; final long generation = ++captureGeneration;
                capture = new Thread(() -> captureLoop(input, generation, 16000), "VirtuGene-call-capture"); capture.start();
                JSObject result = routes(); result.put("sampleRate", 16000); result.put("echoCancellation", echo != null && echo.getEnabled()); result.put("noiseSuppression", noise != null && noise.getEnabled());
                call.resolve(result);
            } catch (Exception error) { close(); call.reject("voice:audio_start_failed"); }
        }
    }
    private void event(String type, JSObject data) {
        String id = callId; if (id == null) return;
        data.put("type", type); data.put("callId", id); data.put("at", SystemClock.elapsedRealtime());
        notifyListeners("audio", data, false);
    }
    private void replaceCapture(int sampleRate) {
        captureGeneration++; captureRevision++; lock.notifyAll();
        if (recorder != null) { try { recorder.stop(); } catch (Exception ignored) {} recorder.release(); recorder = null; }
        if (echo != null) { echo.release(); echo = null; } if (noise != null) { noise.release(); noise = null; }
        int minimum = AudioRecord.getMinBufferSize(sampleRate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
        recorder = new AudioRecord(MediaRecorder.AudioSource.VOICE_COMMUNICATION, sampleRate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, Math.max(minimum, sampleRate * 2 / 5));
        if (recorder.getState() != AudioRecord.STATE_INITIALIZED) throw new IllegalStateException("capture");
        if (AcousticEchoCanceler.isAvailable()) { echo = AcousticEchoCanceler.create(recorder.getAudioSessionId()); if (echo != null) echo.setEnabled(true); }
        if (NoiseSuppressor.isAvailable()) { noise = NoiseSuppressor.create(recorder.getAudioSessionId()); if (noise != null) noise.setEnabled(true); }
        if (running) {
            if (!paused && !muted) recorder.startRecording();
            final AudioRecord input = recorder; final long generation = captureGeneration;
            capture = new Thread(() -> captureLoop(input, generation, sampleRate), "VirtuGene-call-capture"); capture.start();
        }
    }
    private void captureLoop(AudioRecord input, long generation, int sampleRate) {
        android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_AUDIO);
        short[] raw = new short[sampleRate / 50]; byte[] batch = new byte[3200]; int batchOffset = 0;
        LegacyScoPcm converter = new LegacyScoPcm();
        long revision = captureRevision;
        try {
            while (running && generation == captureGeneration) {
                if (paused || muted) {
                    batchOffset = 0; voiceFrames = 0;
                    synchronized (lock) { if (running && (paused || muted) && generation == captureGeneration) lock.wait(100); }
                    continue;
                }
                int n = input.read(raw, 0, raw.length, AudioRecord.READ_BLOCKING);
                if (!running || generation != captureGeneration) break;
                if (revision != captureRevision) { revision = captureRevision; batchOffset = 0; voiceFrames = 0; continue; }
                if (paused) { batchOffset = 0; continue; }
                if (n <= 0) { suspend("capture-error"); break; }
                if (SystemClock.elapsedRealtime() - heartbeat > 2000 && !paused) suspend("bridge-stalled");
                if (paused || muted) { batchOffset = 0; voiceFrames = 0; continue; }
                short[] frame = sampleRate == 8000 ? converter.input8kTo16k(raw, n) : raw;
                if (sampleRate == 8000) n *= 2;
                double energy = 0;
                for (int i = 0; i < n; i++) energy += frame[i] * (double) frame[i];
                double rms = Math.sqrt(energy / n) / 32768.0;
                voiceFrames = rms >= 0.035 ? voiceFrames + 1 : 0;
                if (voiceFrames >= 4 && canBargeIn()) {
                    JSObject interruption = null;
                    synchronized (lock) { if (running && generation == captureGeneration && playbackTurn != null) interruption = stopOutput(); }
                    if (interruption != null) { interruption.put("reason", "speech"); event("interrupted", interruption); }
                }
                for (int i = 0; i < n; i++) {
                    batch[batchOffset++] = (byte) (frame[i] & 255); batch[batchOffset++] = (byte) ((frame[i] >> 8) & 255);
                    if (batchOffset >= batch.length) {
                        synchronized (lock) {
                            if (!running || paused || muted || generation != captureGeneration || revision != captureRevision) { batchOffset = 0; break; }
                            rememberRoute();
                            JSObject data = new JSObject(); data.put("pcm", Base64.encodeToString(batch, Base64.NO_WRAP)); data.put("sequence", captureSequence++); data.put("sampleRate", 16000); event("capture", data);
                        }
                        batchOffset = 0;
                    }
                }
            }
        } catch (Exception ignored) { if (running && generation == captureGeneration) suspend("capture-error"); }
    }
    private boolean canBargeIn() {
        try {
            AcousticEchoCanceler activeEcho = echo;
            if (activeEcho != null && activeEcho.getEnabled()) return true;
            if (Build.VERSION.SDK_INT >= 31) { AudioDeviceInfo device = manager.getCommunicationDevice(); return device != null && device.getType() != AudioDeviceInfo.TYPE_BUILTIN_SPEAKER; }
            return !manager.isSpeakerphoneOn();
        } catch (Exception ignored) { return false; }
    }
    private boolean owns(PluginCall call) { return running && callId != null && callId.equals(call.getString("callId")); }
    @PluginMethod public void heartbeat(PluginCall call) { if (!owns(call)) { call.reject("voice:inactive"); return; } heartbeat = SystemClock.elapsedRealtime(); call.resolve(); }
    @PluginMethod public void mute(PluginCall call) {
        synchronized (lock) {
            if (!owns(call)) { call.reject("voice:inactive"); return; }
            boolean value = call.getBoolean("muted", false);
            if (value == muted) { call.resolve(); return; }
            try {
                muted = value; captureRevision++; voiceFrames = 0;
                if (muted) recorder.stop(); else if (!paused) recorder.startRecording();
                lock.notifyAll(); call.resolve();
            } catch (Exception error) { suspend("capture-error"); call.reject("voice:capture_failed"); }
        }
    }
    @PluginMethod public void resume(PluginCall call) {
        if (!owns(call)) { call.reject("voice:inactive"); return; }
        if (legacyScoRequested && !legacyScoConnected) { call.reject("voice:bluetooth_connecting"); return; }
        if (capture == null || !capture.isAlive()) { close(); call.reject("voice:capture_ended"); return; }
        int granted = Build.VERSION.SDK_INT >= 26 ? manager.requestAudioFocus(focusRequest) : manager.requestAudioFocus(focus, AudioManager.STREAM_VOICE_CALL, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT);
        if (granted != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) { call.reject("voice:audio_focus"); return; }
        synchronized (lock) {
            try {
                if (!muted && recorder.getRecordingState() != AudioRecord.RECORDSTATE_RECORDING) recorder.startRecording();
                heartbeat = SystemClock.elapsedRealtime(); captureRevision++; paused = false; lock.notifyAll(); call.resolve(routes());
            } catch (Exception error) { close(); call.reject("voice:capture_ended"); }
        }
    }
    @PluginMethod public void pause(PluginCall call) {
        synchronized (lock) {
            if (!owns(call)) { call.reject("voice:inactive"); return; }
            suspend("request-error", false); call.resolve();
        }
    }
    private void suspend(String reason) { suspend(reason, true); }
    private void suspend(String reason, boolean notify) {
        synchronized (lock) {
            if (!running || paused) return;
            paused = true; captureRevision++; stopOutput();
            if (recorder != null) { try { recorder.stop(); } catch (Exception ignored) {} }
            if (notify) { JSObject data = new JSObject(); data.put("reason", reason); event("paused", data); }
        }
    }
    @PluginMethod public void beginPlayback(PluginCall call) {
        synchronized (lock) {
            if (!owns(call) || paused) { call.reject("voice:inactive"); return; }
            String turn = call.getString("turnId");
            if (turn == null || turn.isEmpty() || turn.length() > 200) { call.reject("voice:invalid_turn"); return; }
            stopOutput();
            try {
            int playbackRate = legacyScoConnected ? 8000 : 24000;
            scoOutput = legacyScoConnected ? new LegacyScoPcm() : null;
            int minimum = AudioTrack.getMinBufferSize(playbackRate, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT);
            track = new AudioTrack.Builder().setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
                .setAudioFormat(new AudioFormat.Builder().setSampleRate(playbackRate).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).setEncoding(AudioFormat.ENCODING_PCM_16BIT).build())
                .setBufferSizeInBytes(Math.max(minimum, 4800)).setTransferMode(AudioTrack.MODE_STREAM).build();
            if (track.getState() != AudioTrack.STATE_INITIALIZED) { stopOutput(); call.reject("voice:playback_failed"); return; }
            writtenFrames = 0; playbackTurn = turn; track.play(); call.resolve();
            } catch (Exception error) { stopOutput(); call.reject("voice:playback_failed"); return; }
            final long generation = epoch;
            playbackTicker = new Runnable() {
                private long lastReported;
                private boolean started;
                @Override public void run() {
                    synchronized (lock) {
                        if (!running || paused || track == null || generation != epoch) return;
                        long played = head(track), now = SystemClock.elapsedRealtime();
                        if (played > 0 && (!started || now - lastReported >= 100)) {
                            JSObject report = new JSObject(); report.put("turnId", playbackTurn); report.put("playedFrames", played); report.put("writtenFrames", writtenFrames); report.put("first", !started);
                            report.put("sampleRate", track.getSampleRate());
                            started = true; lastReported = now; event("playback", report);
                        }
                        main.postDelayed(this, 20);
                    }
                }
            };
            main.post(playbackTicker);
        }
    }
    @PluginMethod public void appendPcm(PluginCall call) {
        String encoded = call.getString("pcm"); byte[] decoded;
        try { if (encoded == null || encoded.length() > 128000) throw new IllegalArgumentException(); decoded = Base64.decode(encoded, Base64.DEFAULT); }
        catch (Exception error) { call.reject("voice:invalid_pcm"); return; }
        final AudioTrack active; final long generation; final byte[] pcm;
        synchronized (lock) {
            if (!owns(call) || paused || track == null || !playbackTurn.equals(call.getString("turnId"))) { call.reject("voice:stale_audio"); return; }
            if (decoded.length % 2 != 0 || decoded.length == 0 || queuedBytes + decoded.length > (legacyScoConnected ? 48000 : 144000)) { call.reject("voice:audio_backpressure"); return; }
            pcm = scoOutput == null ? decoded : scoOutput.output24kTo8k(decoded);
            queuedBytes += pcm.length; active = track; generation = epoch;
        }
        output.execute(() -> {
            int offset = 0; long started = SystemClock.elapsedRealtime();
            try {
                while (offset < pcm.length) {
                    synchronized (lock) {
                        if (generation != epoch || !running || paused || active != track) throw new IllegalStateException();
                        int n = active.write(pcm, offset, pcm.length - offset, AudioTrack.WRITE_NON_BLOCKING);
                        if (n < 0) throw new IllegalStateException();
                        offset += n; writtenFrames += n / 2;
                    }
                    if (SystemClock.elapsedRealtime() - started > 10000) throw new IllegalStateException();
                    if (offset < pcm.length) Thread.sleep(5);
                }
                synchronized (lock) { if (generation != epoch) throw new IllegalStateException(); JSObject result = new JSObject(); result.put("writtenFrames", writtenFrames); result.put("playedFrames", head(active)); result.put("sampleRate", active.getSampleRate()); call.resolve(result); }
            } catch (Exception error) { call.reject("voice:stale_or_stalled_audio"); }
            finally { synchronized (lock) { if (generation == epoch) queuedBytes = Math.max(0, queuedBytes - pcm.length); } }
        });
    }
    private long head(AudioTrack active) { return Integer.toUnsignedLong(active.getPlaybackHeadPosition()); }
    @PluginMethod public void drain(PluginCall call) {
        final AudioTrack active; final long generation;
        synchronized (lock) { if (!owns(call) || track == null || !playbackTurn.equals(call.getString("turnId"))) { call.reject("voice:stale_audio"); return; } active = track; generation = epoch; }
        output.execute(() -> {
            long started = SystemClock.elapsedRealtime();
            try {
                for (;;) {
                    synchronized (lock) {
                        if (generation != epoch || active != track || paused || !running) throw new IllegalStateException();
                        long played = head(active);
                        if (played >= writtenFrames) { JSObject result = new JSObject(); result.put("playedFrames", played); result.put("writtenFrames", writtenFrames); result.put("complete", true); result.put("sampleRate", active.getSampleRate()); call.resolve(result); return; }
                    }
                    if (SystemClock.elapsedRealtime() - started > 15000) throw new IllegalStateException();
                    Thread.sleep(10);
                }
            } catch (Exception error) { call.reject("voice:stale_or_stalled_audio"); }
        });
    }
    private JSObject stopOutput() {
        synchronized (lock) {
            long played = 0;
            if (track != null) { try { played = head(track); } catch (Exception ignored) {} }
            JSObject result = new JSObject(); result.put("playedFrames", played); result.put("writtenFrames", writtenFrames); result.put("turnId", playbackTurn);
            if (track != null) { try { result.put("sampleRate", track.getSampleRate()); } catch (Exception ignored) {} }
            epoch++; playbackTurn = null; queuedBytes = 0; writtenFrames = 0;
            if (playbackTicker != null) { main.removeCallbacks(playbackTicker); playbackTicker = null; }
            if (track != null) {
                AudioTrack old = track; track = null;
                result.put("cleanupFailures", AudioCleanup.run(old::pause, old::flush, old::release));
            }
            return result;
        }
    }
    @PluginMethod public void stopPlayback(PluginCall call) { if (!owns(call)) { call.reject("voice:inactive"); return; } call.resolve(stopOutput()); }
    private void rememberRoute() {
        try {
            if (recorder != null && recorder.getRoutedDevice() != null) routedInput = recorder.getRoutedDevice().getId();
            if (track != null && track.getRoutedDevice() != null) routedOutput = track.getRoutedDevice().getId();
            if (Build.VERSION.SDK_INT >= 31) {
                AudioDeviceInfo device = manager.getCommunicationDevice();
                routedCommunication = device == null ? 0 : device.getId();
            }
        } catch (RuntimeException ignored) { /* retain last observed route during a transient device change */ }
    }
    private static String routeLabel(int type, String product) {
        String kind;
        switch (type) {
            case AudioDeviceInfo.TYPE_BUILTIN_SPEAKER: return "扬声器";
            case AudioDeviceInfo.TYPE_BUILTIN_EARPIECE: return "听筒";
            case AudioDeviceInfo.TYPE_WIRED_HEADSET:
            case AudioDeviceInfo.TYPE_WIRED_HEADPHONES: kind = "有线耳机"; break;
            case AudioDeviceInfo.TYPE_USB_HEADSET: kind = "USB 耳机"; break;
            case AudioDeviceInfo.TYPE_USB_DEVICE: kind = "USB 音频设备"; break;
            case AudioDeviceInfo.TYPE_BLUETOOTH_SCO:
            case AudioDeviceInfo.TYPE_BLE_HEADSET: kind = "蓝牙通话耳机"; break;
            case AudioDeviceInfo.TYPE_BLE_SPEAKER: kind = "蓝牙扬声器"; break;
            case AudioDeviceInfo.TYPE_HEARING_AID: kind = "助听器"; break;
            default: kind = "声音设备";
        }
        String name = product == null ? "" : product.trim();
        return name.isEmpty() || name.equals(kind) ? kind : kind + " · " + name;
    }
    private static AudioDeviceInfo findOutput(AudioDeviceInfo[] outputs, int type) {
        for (AudioDeviceInfo device : outputs) if (device.getType() == type) return device;
        return null;
    }
    private AudioDeviceInfo legacySystemOutput(AudioDeviceInfo[] outputs) {
        // Before API 31 Android exposes one system-selected non-speaker path,
        // not individually selectable wired outputs. Prefer its observed device;
        // never advertise an earpiece that would actually play through a headset.
        for (AudioDeviceInfo device : outputs) {
            int type = device.getType();
            if (device.getId() == routedOutput && (type == AudioDeviceInfo.TYPE_WIRED_HEADSET || type == AudioDeviceInfo.TYPE_WIRED_HEADPHONES
                || type == AudioDeviceInfo.TYPE_USB_HEADSET || type == AudioDeviceInfo.TYPE_USB_DEVICE)) return device;
        }
        for (int type : new int[] { AudioDeviceInfo.TYPE_WIRED_HEADSET, AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
            AudioDeviceInfo.TYPE_USB_HEADSET, AudioDeviceInfo.TYPE_USB_DEVICE, AudioDeviceInfo.TYPE_BUILTIN_EARPIECE }) {
            AudioDeviceInfo device = findOutput(outputs, type);
            if (device != null) return device;
        }
        return null;
    }
    private static JSObject routeRow(int id, AudioDeviceInfo device, boolean selected) {
        JSObject row = new JSObject(); row.put("id", id); row.put("type", device.getType());
        row.put("label", routeLabel(device.getType(), device.getProductName() == null ? "" : device.getProductName().toString()));
        row.put("selected", selected); return row;
    }
    private JSObject routes() {
        synchronized (lock) { rememberRoute(); }
        JSObject result = new JSObject(); JSArray rows = new JSArray();
        result.put("echoCancellation", echo != null && echo.getEnabled());
        result.put("noiseSuppression", noise != null && noise.getEnabled());
        if (Build.VERSION.SDK_INT >= 31) {
            try {
                AudioDeviceInfo selected = manager.getCommunicationDevice();
                for (AudioDeviceInfo device : manager.getAvailableCommunicationDevices()) {
                    rows.put(routeRow(device.getId(), device, selected != null && selected.getId() == device.getId()));
                }
            } catch (SecurityException ignored) { result.put("bluetoothPermissionNeeded", true); }
        } else {
            AudioDeviceInfo[] outputs = manager.getDevices(AudioManager.GET_DEVICES_OUTPUTS);
            AudioDeviceInfo speaker = findOutput(outputs, AudioDeviceInfo.TYPE_BUILTIN_SPEAKER);
            AudioDeviceInfo system = legacySystemOutput(outputs);
            if (speaker != null) rows.put(routeRow(-1, speaker, manager.isSpeakerphoneOn() && !legacyScoConnected));
            if (system != null) rows.put(routeRow(-2, system, !manager.isSpeakerphoneOn() && !legacyScoConnected));
            AudioDeviceInfo bluetooth = findOutput(outputs, AudioDeviceInfo.TYPE_BLUETOOTH_SCO);
            if (bluetooth != null && manager.isBluetoothScoAvailableOffCall()) rows.put(routeRow(-3, bluetooth, legacyScoConnected));
        }
        result.put("routes", rows); return result;
    }
    @PluginMethod public void getRoutes(PluginCall call) { if (!owns(call)) { call.reject("voice:inactive"); return; } call.resolve(routes()); }
    @PluginMethod public void setRoute(PluginCall call) {
        if (!owns(call)) { call.reject("voice:inactive"); return; }
        int id = call.getInt("deviceId", 0); stopOutput();
        try {
            boolean found = false;
            if (Build.VERSION.SDK_INT >= 31) { for (AudioDeviceInfo device : manager.getAvailableCommunicationDevices()) if (device.getId() == id) { found = manager.setCommunicationDevice(device); break; } }
            else if (id == -3) {
                boolean available = false;
                for (AudioDeviceInfo device : manager.getDevices(AudioManager.GET_DEVICES_OUTPUTS)) if (device.getType() == AudioDeviceInfo.TYPE_BLUETOOTH_SCO) available = true;
                if (!available || !manager.isBluetoothScoAvailableOffCall()) { call.reject("voice:route_unavailable"); return; }
                startLegacySco(); found = true;
            } else if (id == -1 || id == -2) {
                synchronized (lock) {
                    AudioDeviceInfo[] outputs = manager.getDevices(AudioManager.GET_DEVICES_OUTPUTS);
                    if ((id == -1 ? findOutput(outputs, AudioDeviceInfo.TYPE_BUILTIN_SPEAKER) : legacySystemOutput(outputs)) == null) {
                        call.reject("voice:route_unavailable"); return;
                    }
                    boolean changed = legacyScoRequested || legacyScoConnected;
                    stopLegacySco();
                    if (changed) { suspend("route-change"); replaceCapture(16000); }
                    manager.setSpeakerphoneOn(id == -1); found = true;
                }
            }
            if (!found) { call.reject("voice:route_unavailable"); return; }
            call.resolve(routes());
        } catch (SecurityException error) { call.reject("voice:bluetooth_denied"); }
        catch (Exception error) { suspend("route-error"); call.reject("voice:route_failed"); }
    }
    private void startLegacySco() {
        synchronized (lock) {
            stopLegacySco(); suspend("bluetooth-connecting"); legacyScoRequested = true;
            final long generation = ++scoGeneration;
            scoReceiver = new BroadcastReceiver() {
                @Override public void onReceive(Context context, Intent intent) {
                    synchronized (lock) {
                        if (!running || !legacyScoRequested || generation != scoGeneration) return;
                        int state = intent.getIntExtra(AudioManager.EXTRA_SCO_AUDIO_STATE, AudioManager.SCO_AUDIO_STATE_ERROR);
                        if (state == AudioManager.SCO_AUDIO_STATE_CONNECTED) {
                            try { manager.setBluetoothScoOn(true); legacyScoConnected = true; replaceCapture(8000); event("routes", routes()); }
                            catch (Exception error) { stopLegacySco(); event("routeLost", routes()); }
                        } else if (state == AudioManager.SCO_AUDIO_STATE_DISCONNECTED || state == AudioManager.SCO_AUDIO_STATE_ERROR) {
                            boolean wasConnected = legacyScoConnected;
                            legacyScoConnected = false;
                            if (wasConnected) { suspend("bluetooth-disconnected"); stopLegacySco(); try { replaceCapture(16000); } catch (Exception ignored) {} event("routeLost", routes()); }
                        }
                    }
                }
            };
            Intent sticky = getContext().registerReceiver(scoReceiver, new IntentFilter(AudioManager.ACTION_SCO_AUDIO_STATE_UPDATED));
            manager.setSpeakerphoneOn(false); manager.startBluetoothSco();
            if (sticky != null && sticky.getIntExtra(AudioManager.EXTRA_SCO_AUDIO_STATE, -1) == AudioManager.SCO_AUDIO_STATE_CONNECTED) scoReceiver.onReceive(getContext(), sticky);
            final String id = callId;
            scoTimeout = () -> { synchronized (lock) { if (running && id.equals(callId) && generation == scoGeneration && legacyScoRequested && !legacyScoConnected) { stopLegacySco(); event("routeLost", routes()); } } };
            main.postDelayed(scoTimeout, 8000);
        }
    }
    private void stopLegacySco() {
        boolean owned = legacyScoRequested || legacyScoConnected || scoReceiver != null;
        scoGeneration++;
        if (scoTimeout != null) { main.removeCallbacks(scoTimeout); scoTimeout = null; }
        legacyScoRequested = false; legacyScoConnected = false;
        if (scoReceiver != null) { try { getContext().unregisterReceiver(scoReceiver); } catch (Exception ignored) {} scoReceiver = null; }
        if (owned && Build.VERSION.SDK_INT < 31) { try { manager.setBluetoothScoOn(false); manager.stopBluetoothSco(); } catch (Exception ignored) {} }
    }
    @PluginMethod public void stop(PluginCall call) {
        synchronized (lock) {
            if (pendingCallId != null && pendingCallId.equals(call.getString("callId"))) pendingCallId = pendingCallbackId = null;
            if (!owns(call)) { call.resolve(); return; }
            if (close() > 0) call.reject("voice:audio_release_failed"); else call.resolve();
        }
    }
    private int close() {
        synchronized (lock) {
            running = false; paused = true; pendingCallId = pendingCallbackId = null; captureGeneration++; captureRevision++; lock.notifyAll();
            int failures = 0;
            JSObject stopped = stopOutput();
            Integer outputFailures = stopped.getInteger("cleanupFailures");
            failures += outputFailures == null ? 0 : outputFailures;
            failures += AudioCleanup.run(this::stopLegacySco); scoOutput = null;
            if (durationLimit != null) { main.removeCallbacks(durationLimit); durationLimit = null; }
            AudioRecord oldRecorder = recorder; recorder = null;
            // A stopped/muted recorder may legitimately reject stop; release still runs.
            if (oldRecorder != null) { try { oldRecorder.stop(); } catch (Exception ignored) {} failures += AudioCleanup.run(oldRecorder::release); }
            AcousticEchoCanceler oldEcho = echo; echo = null;
            NoiseSuppressor oldNoise = noise; noise = null;
            if (oldEcho != null) failures += AudioCleanup.run(oldEcho::release);
            if (oldNoise != null) failures += AudioCleanup.run(oldNoise::release);
            AudioDeviceCallback oldDevices = devices; devices = null;
            if (oldDevices != null) failures += AudioCleanup.run(() -> manager.unregisterAudioDeviceCallback(oldDevices));
            boolean ownedMode = ownsAudioMode; ownsAudioMode = false;
            if (ownedMode && Build.VERSION.SDK_INT >= 31) failures += AudioCleanup.run(() -> manager.clearCommunicationDevice());
            AudioFocusRequest oldFocus = focusRequest; focusRequest = null;
            failures += AudioCleanup.run(() -> {
                if (oldFocus != null && Build.VERSION.SDK_INT >= 26) manager.abandonAudioFocusRequest(oldFocus); else manager.abandonAudioFocus(focus);
            });
            if (ownedMode) failures += AudioCleanup.run(() -> {
                if (manager.getMode() == AudioManager.MODE_IN_COMMUNICATION) {
                    manager.setMode(previousMode);
                    if (Build.VERSION.SDK_INT < 31) manager.setSpeakerphoneOn(previousSpeaker);
                }
            });
            VoiceCallService.onEnd = null; callId = null;
            failures += AudioCleanup.run(() -> getContext().stopService(new Intent(getContext(), VoiceCallService.class)));
            AudioCaptureLease.release(this);
            routedInput = routedOutput = routedCommunication = 0;
            return failures;
        }
    }
    @Override protected void handleOnPause() { suspend("background-or-lock"); }
    @Override protected void handleOnDestroy() { close(); output.shutdownNow(); super.handleOnDestroy(); }
}
