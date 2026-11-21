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
import android.media.AudioTimestamp;
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
    private final AudioSessionAuthority sessions = new AudioSessionAuthority(lock);
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService output = Executors.newSingleThreadExecutor();
    private AudioManager manager;
    private AudioRecord recorder;
    private AudioTrack track;
    private AcousticEchoCanceler echo;
    private NoiseSuppressor noise;
    private AudioFocusRequest focusRequest;
    private AudioDeviceCallback devices;
    private AudioManager.OnCommunicationDeviceChangedListener communicationDevices;
    private PluginCall pendingRouteCall;
    private PluginCall pendingDrainCall;
    private Long pendingDrainTarget;
    private long pendingDrainEpoch, pendingDrainStartedAt;
    private boolean selectingRoute;
    private Runnable routeConfirmation;
    private Thread capture;
    private volatile boolean running, muted, paused, captureEnabled;
    private volatile long heartbeat;
    private volatile long captureGeneration, captureRevision;
    private long captureSequence;
    private String callId, playbackTurn, pendingCallId, pendingCallbackId;
    private long epoch, writtenFrames;
    private int tailRestoreThreshold, tailRestoreBuffer;
    private final AudioStartupPadding startupPadding = new AudioStartupPadding();
    private int queuedBytes, previousMode, voiceFrames;
    // Losing the track reference is not proof that its device resources were released.
    // Keep failures for this plugin lifetime, including native-initiated interruptions.
    private volatile int outputCleanupFailures;
    private int captureCleanupFailures;
    private boolean activityPaused, pendingStartPermissionReady;
    private PluginCall pendingStartCall;
    private final AudioDefaultRoute defaultRoute = new AudioDefaultRoute();
    private PluginCall pendingAudioStart;
    private PluginCall pendingResumeCall;
    private Runnable resumeRoutePoll;
    private Runnable defaultRoutePoll;
    private int requestedDefaultDevice, expectedLegacyOutputType;
    private PluginCall pendingModeCall;
    private long pendingModeServiceSerial = -1;
    private Runnable modeServiceTimeout;
    private boolean previousSpeaker;
    private boolean ownsAudioMode;
    private Runnable playbackTicker;
    private Runnable durationLimit;
    private VoiceCallServiceSessions.Ticket serviceSession;
    private BroadcastReceiver scoReceiver;
    private boolean legacyScoRequested, legacyScoConnected;
    private LegacyScoPcm scoOutput;
    private Runnable scoTimeout;
    private long scoGeneration;
    private int routedInput, routedOutput, routedCommunication;
    // User-confirmed route stays separate from passive getRoutes observations.
    private int confirmedCommunication;
    private long routeGeneration;
    private long routeControlSession, routeRequestHighWater, cancelledRouteRequest;
    private long clockProbeSequence;
    private long captureObservationGeneration = -1, captureObservationRoute = -1;
    private AudioManager.OnAudioFocusChangeListener focus;
    private AudioManager.OnAudioFocusChangeListener focusForSession(long session) {
        return change -> sessions.guard(session, () -> {
            if (!running) return;
            if (change == AudioManager.AUDIOFOCUS_LOSS || change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT || change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK) {
                if (pendingAudioStart != null) { cancelPendingAudioStart("voice:audio_focus"); close(); }
                else suspend("audio-focus");
            }
            else if (change == AudioManager.AUDIOFOCUS_GAIN) event("focusAvailable", new JSObject());
        }).run();
    }

    @Override public void load() { manager = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE); }
    @PluginMethod public void start(PluginCall call) {
        synchronized (lock) {
            if (outputCleanupFailures > 0 || captureCleanupFailures > 0) { call.reject("voice:audio_release_failed"); return; }
            if (activityPaused) { call.reject("voice:background-or-lock"); return; }
            String id = call.getString("callId");
            if (id == null || id.isEmpty() || id.length() > 160) { call.reject("voice:invalid_call"); return; }
            if (running || pendingCallId != null) { call.reject("voice:already_active"); return; }
            pendingCallId = id;
            pendingCallbackId = call.getCallbackId();
            pendingStartCall = call; pendingStartPermissionReady = false;
            try {
                if (call.getBoolean("captureEnabled", true) && getPermissionState("microphone") != PermissionState.GRANTED) { requestPermissionForAlias("microphone", call, "permissionReady"); return; }
                begin(call);
            } catch (RuntimeException error) {
                if (pendingStartCall == call) cancelPendingStart("voice:audio_start_failed");
                else call.reject("voice:audio_start_failed");
            }
        }
    }
    private void cancelPendingStart(String reason) {
        PluginCall pending = pendingStartCall;
        pendingStartCall = null; pendingStartPermissionReady = false;
        pendingCallId = pendingCallbackId = null;
        if (pending != null) pending.reject(reason);
    }
    @PermissionCallback private void permissionReady(PluginCall call) {
        synchronized (lock) {
            if (pendingCallId == null || !pendingCallId.equals(call.getString("callId")) || !call.getCallbackId().equals(pendingCallbackId)) { call.reject("voice:cancelled"); return; }
            if (getPermissionState("microphone") != PermissionState.GRANTED) { cancelPendingStart("voice:microphone_denied"); return; }
            // Permission dialogs may temporarily pause the Activity. An accepted
            // result can finish after resume, unless a real stop cancels it.
            pendingStartPermissionReady = true;
            if (activityPaused) return;
        }
        begin(call);
    }
    @PluginMethod public void setInputMode(PluginCall call) {
        synchronized (lock) {
            if (!owns(call) || paused || activityPaused) { call.reject("voice:input_unavailable"); return; }
            if (outputCleanupFailures > 0 || captureCleanupFailures > 0) { call.reject("voice:audio_release_failed"); return; }
            if (pendingModeCall != null) { call.reject("voice:input_busy"); return; }
            boolean enabled = call.getBoolean("captureEnabled", true);
            if (enabled == captureEnabled) { call.resolve(); return; }
            pendingModeCall = call;
            if (enabled && getPermissionState("microphone") != PermissionState.GRANTED) {
                try { requestPermissionForAlias("microphone", call, "inputPermissionReady"); }
                catch (RuntimeException error) { pendingModeCall = null; call.reject("voice:input_unavailable"); }
                return;
            }
            switchInput(call);
        }
    }
    @PermissionCallback private void inputPermissionReady(PluginCall call) { switchInput(call); }
    private void switchInput(PluginCall call) {
        synchronized (lock) {
            if (pendingModeCall == null || !pendingModeCall.getCallbackId().equals(call.getCallbackId())) { call.reject("voice:cancelled"); return; }
            if (!owns(call) || paused || activityPaused) { cancelInputSwitch("voice:input_unavailable", true); return; }
            boolean enabled = call.getBoolean("captureEnabled", true);
            if (enabled) {
                if (getPermissionState("microphone") != PermissionState.GRANTED) { cancelInputSwitch("voice:microphone_denied", false); return; }
                if (manager.isMicrophoneMute()) { cancelInputSwitch("voice:microphone_disabled", false); return; }
            }
            try {
                pendingModeServiceSerial = VoiceCallService.requestCapture(getContext(), serviceSession, enabled, error -> completeInputSwitch(call, error));
                if (pendingModeServiceSerial < 0) { cancelInputSwitch("voice:input_unavailable", false); return; }
                modeServiceTimeout = () -> {
                    synchronized (lock) {
                        if (pendingModeCall != null && pendingModeCall.getCallbackId().equals(call.getCallbackId())) cancelInputSwitch("voice:audio_bridge_timeout", true);
                    }
                };
                main.postDelayed(modeServiceTimeout, 3000);
            } catch (RuntimeException error) { cancelInputSwitch("voice:input_unavailable", false); }
        }
    }
    private void restoreServiceInput() {
        try { VoiceCallService.requestCapture(getContext(), serviceSession, captureEnabled, null); }
        catch (RuntimeException ignored) { suspend("input-switch-error"); }
    }
    private void cancelInputSwitch(String reason, boolean restore) {
        PluginCall pending = pendingModeCall; pendingModeCall = null;
        if (modeServiceTimeout != null) { main.removeCallbacks(modeServiceTimeout); modeServiceTimeout = null; }
        if (pendingModeServiceSerial >= 0) {
            try {
                boolean cancelled = VoiceCallService.cancelCapture(getContext(), serviceSession, pendingModeServiceSerial);
                if (!cancelled && restore && running) restoreServiceInput();
            } catch (RuntimeException ignored) { /* suspended/closing; never enable capture to recover a failed request */ }
        }
        pendingModeServiceSerial = -1;
        if (pending != null) pending.reject(reason);
    }
    private void completeInputSwitch(PluginCall call, RuntimeException serviceError) {
        synchronized (lock) {
            if (pendingModeCall == null || !pendingModeCall.getCallbackId().equals(call.getCallbackId())) return;
            if (!owns(call) || paused || activityPaused) { cancelInputSwitch("voice:input_unavailable", true); return; }
            pendingModeCall = null; pendingModeServiceSerial = -1;
            if (modeServiceTimeout != null) { main.removeCallbacks(modeServiceTimeout); modeServiceTimeout = null; }
            if (serviceError != null) { call.reject("voice:input_unavailable"); return; }
            boolean enabled = call.getBoolean("captureEnabled", true);
            if (enabled) {
                if (getPermissionState("microphone") != PermissionState.GRANTED || manager.isMicrophoneMute() || !AudioCaptureLease.acquire(this)) {
                    restoreServiceInput(); call.reject("voice:microphone_unavailable"); return;
                }
                try {
                    // Service confirmation precedes any microphone allocation.
                    replaceCapture(legacyScoConnected ? 8000 : 16000);
                    captureEnabled = true;
                    startCapture(legacyScoConnected ? 8000 : 16000);
                } catch (Exception error) {
                    captureEnabled = false;
                    releaseCapture();
                    restoreServiceInput();
                    if (captureCleanupFailures > 0) suspend("voice:audio_release_failed");
                    call.reject(captureCleanupFailures > 0 ? "voice:audio_release_failed" : "voice:capture_failed"); return;
                }
            } else {
                if (releaseCapture() > 0) {
                    restoreServiceInput();
                    suspend("voice:audio_release_failed"); call.reject("voice:audio_release_failed"); return;
                }
                captureEnabled = false;
            }
            event("routes", routes()); call.resolve();
        }
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
            if (activityPaused) return;
            pendingCallId = pendingCallbackId = null;
            pendingStartCall = null; pendingStartPermissionReady = false;
            defaultRoute.reset(); requestedDefaultDevice = expectedLegacyOutputType = 0;
            if (call.getBoolean("requirePrivateRoute", false)) defaultRoute.requirePrivate();
            Integer preferredId = call.getInt("preferredRouteId"), preferredType = call.getInt("preferredRouteType");
            if ((preferredId == null) != (preferredType == null)) { call.reject("voice:route_unavailable"); return; }
            if (preferredId != null) defaultRoute.remember(preferredId, preferredType);
            boolean wantsCapture = call.getBoolean("captureEnabled", true);
            if (wantsCapture && getPermissionState("microphone") != PermissionState.GRANTED) { call.reject("voice:microphone_denied"); return; }
            if (wantsCapture && manager.isMicrophoneMute()) { call.reject("voice:microphone_disabled"); return; }
            if (id == null || id.length() > 160 || id.isEmpty()) { call.reject("voice:invalid_call"); return; }
            if (wantsCapture && !AudioCaptureLease.acquire(this)) { call.reject("voice:microphone_busy"); return; }
            routeControlSession = sessions.begin(); routeRequestHighWater = cancelledRouteRequest = 0;
            final long session = routeControlSession;
            try {
                previousMode = manager.getMode(); previousSpeaker = manager.isSpeakerphoneOn();
                AudioAttributes attributes = new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build();
                int granted;
                // Both initial and resumed focus requests retain this native
                // session's listener; a replacement session gets a new one.
                focus = focusForSession(session);
                if (Build.VERSION.SDK_INT >= 26) {
                    focusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT).setAudioAttributes(attributes).setOnAudioFocusChangeListener(focus, main).build();
                    granted = manager.requestAudioFocus(focusRequest);
                } else granted = manager.requestAudioFocus(focus, AudioManager.STREAM_VOICE_CALL, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT);
                if (granted != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) throw new IllegalStateException("audio-focus");
                manager.setMode(AudioManager.MODE_IN_COMMUNICATION);
                ownsAudioMode = true;
                captureEnabled = wantsCapture;
                callId = id; running = true; paused = true; muted = false; heartbeat = SystemClock.elapsedRealtime();
                pendingAudioStart = call;
                clockProbeSequence = 0;
                captureSequence = 0;
                durationLimit = sessions.guard(session, () -> { if (running) { JSObject reason = new JSObject(); reason.put("reason", "duration-limit"); event("ended", reason); close(); } });
                main.postDelayed(durationLimit, 60 * 60 * 1000L);
                serviceSession = VoiceCallService.register(() -> main.post(sessions.guard(session, () -> { if (running) { event("ended", new JSObject()); close(); } })), captureEnabled);
                Intent service = new Intent(getContext(), VoiceCallService.class).putExtra(VoiceCallService.SESSION, serviceSession.id);
                if (Build.VERSION.SDK_INT >= 26) getContext().startForegroundService(service); else getContext().startService(service);
                devices = new AudioDeviceCallback() {
                    @Override public void onAudioDevicesAdded(AudioDeviceInfo[] added) {
                        sessions.guard(session, () -> { if (running) event("routes", routes()); }).run();
                    }
                    @Override public void onAudioDevicesRemoved(AudioDeviceInfo[] removed) {
                        sessions.guard(session, () -> {
                            if (!running) return;
                            int[] ids = new int[removed.length];
                            for (int i = 0; i < removed.length; i++) ids[i] = removed[i].getId();
                            boolean lost = AudioRouteLoss.affectsCall(ids, routedInput, routedOutput, routedCommunication);
                            if (lost) {
                                // Stop capture and output natively before waiting for WebView.
                                suspend("route-lost"); routedInput = routedOutput = routedCommunication = 0;
                                event("routeLost", routes());
                            } else event("routes", routes());
                        }).run();
                    }
                };
                manager.registerAudioDeviceCallback(devices, main);
                if (Build.VERSION.SDK_INT >= 31) {
                    communicationDevices = device -> sessions.guard(session, () -> {
                        // Read the current device, not a possibly late callback payload.
                        if (running) { verifyActiveRoute(); event("routes", routes()); }
                    }).run();
                    manager.addOnCommunicationDeviceChangedListener(getContext().getMainExecutor(), communicationDevices);
                }
                awaitDefaultAudioStart(call, session);
            } catch (Exception error) { close(); call.reject("voice:audio_start_failed"); }
        }
    }
    /** AudioManager routing APIs do not require an extra Bluetooth profile permission prompt. */
    private boolean prepareDefaultRoute() {
        boolean connected = false;
        AudioDeviceInfo[] outputs = manager.getDevices(AudioManager.GET_DEVICES_OUTPUTS);
        for (AudioDeviceInfo device : outputs) if (AudioDefaultRoute.connectedHeadsetType(device.getType())) connected = true;
        if (Build.VERSION.SDK_INT >= 31) {
            java.util.List<AudioDeviceInfo> available = manager.getAvailableCommunicationDevices();
            int[] ids = new int[available.size()], types = new int[available.size()];
            for (int i = 0; i < ids.length; i++) { ids[i] = available.get(i).getId(); types[i] = available.get(i).getType(); }
            AudioDeviceInfo current = manager.getCommunicationDevice();
            int selected = defaultRoute.choose(current == null ? 0 : current.getId(), current == null ? 0 : current.getType(), ids, types, connected);
            if (selected == AudioDefaultRoute.WAIT) return false;
            if (current != null && current.getId() == selected) { confirmedCommunication = selected; return true; }
            if (requestedDefaultDevice != selected) {
                selectingRoute = true;
                try {
                    boolean accepted = false;
                    for (AudioDeviceInfo device : available) if (device.getId() == selected) { accepted = manager.setCommunicationDevice(device); break; }
                    if (!accepted) throw new IllegalStateException("voice:headset_unavailable");
                    requestedDefaultDevice = selected;
                } finally { selectingRoute = false; }
            }
            current = manager.getCommunicationDevice();
            if (current != null && current.getId() == selected) { confirmedCommunication = selected; return true; }
            return false;
        }
        java.util.ArrayList<Integer> ids = new java.util.ArrayList<>(), types = new java.util.ArrayList<>();
        AudioDeviceInfo system = legacySystemOutput(outputs);
        if (system != null) { ids.add(-2); types.add(system.getType()); }
        if (findOutput(outputs, AudioDeviceInfo.TYPE_BUILTIN_SPEAKER) != null) { ids.add(-1); types.add(AudioDeviceInfo.TYPE_BUILTIN_SPEAKER); }
        if (findOutput(outputs, AudioDeviceInfo.TYPE_BLUETOOTH_SCO) != null && manager.isBluetoothScoAvailableOffCall()) { ids.add(-3); types.add(AudioDeviceInfo.TYPE_BLUETOOTH_SCO); }
        int[] routeIds = new int[ids.size()], routeTypes = new int[types.size()];
        for (int i = 0; i < routeIds.length; i++) { routeIds[i] = ids.get(i); routeTypes[i] = types.get(i); }
        int currentId = legacyScoConnected ? -3 : manager.isSpeakerphoneOn() ? -1 : -2;
        int currentType = legacyScoConnected ? AudioDeviceInfo.TYPE_BLUETOOTH_SCO : manager.isSpeakerphoneOn() ? AudioDeviceInfo.TYPE_BUILTIN_SPEAKER : system == null ? 0 : system.getType();
        int selected = defaultRoute.choose(currentId, currentType, routeIds, routeTypes, connected);
        if (selected == AudioDefaultRoute.WAIT) return false;
        if (selected == -3) {
            expectedLegacyOutputType = AudioDeviceInfo.TYPE_BLUETOOTH_SCO;
            if (!legacyScoRequested) startLegacySco();
            return legacyScoConnected;
        }
        if (legacyScoRequested || legacyScoConnected) stopLegacySco();
        manager.setSpeakerphoneOn(selected == -1);
        expectedLegacyOutputType = selected == -1 ? AudioDeviceInfo.TYPE_BUILTIN_SPEAKER : system.getType();
        return true;
    }
    private void rememberExplicitRoute(int id) {
        if (Build.VERSION.SDK_INT >= 31) {
            for (AudioDeviceInfo device : manager.getAvailableCommunicationDevices()) if (device.getId() == id) { defaultRoute.remember(id, device.getType()); requestedDefaultDevice = 0; return; }
        } else {
            AudioDeviceInfo[] outputs = manager.getDevices(AudioManager.GET_DEVICES_OUTPUTS);
            AudioDeviceInfo device = id == -1 ? findOutput(outputs, AudioDeviceInfo.TYPE_BUILTIN_SPEAKER) : id == -3 ? findOutput(outputs, AudioDeviceInfo.TYPE_BLUETOOTH_SCO) : legacySystemOutput(outputs);
            if (device != null) { defaultRoute.remember(id, device.getType()); requestedDefaultDevice = 0; expectedLegacyOutputType = device.getType(); }
        }
    }
    private void awaitDefaultAudioStart(PluginCall call, long session) {
        final long deadline = SystemClock.elapsedRealtime() + 8000;
        defaultRoutePoll = new Runnable() {
            @Override public void run() {
                synchronized (lock) {
                    if (pendingAudioStart != call || !running || routeControlSession != session) return;
                    if (activityPaused) { cancelPendingAudioStart("voice:background-or-lock"); close(); return; }
                    try {
                        if (prepareDefaultRoute()) { finishDefaultAudioStart(call); return; }
                        if (SystemClock.elapsedRealtime() >= deadline) { cancelPendingAudioStart("voice:headset_unavailable"); close(); return; }
                        main.postDelayed(this, 100);
                    } catch (RuntimeException error) { cancelPendingAudioStart("voice:headset_unavailable"); close(); }
                }
            }
        };
        defaultRoutePoll.run();
    }
    private void finishDefaultAudioStart(PluginCall call) {
        if (pendingAudioStart != call || activityPaused || !running) return;
        // No AudioRecord is allocated until the requested communication route is effective.
        if (captureEnabled && (getPermissionState("microphone") != PermissionState.GRANTED || manager.isMicrophoneMute())) { cancelPendingAudioStart("voice:microphone_unavailable"); close(); return; }
        if (defaultRoutePoll != null) { main.removeCallbacks(defaultRoutePoll); defaultRoutePoll = null; }
        heartbeat = SystemClock.elapsedRealtime();
        paused = false;
        if (captureEnabled) { replaceCapture(legacyScoConnected ? 8000 : 16000); if (capture == null) startCapture(legacyScoConnected ? 8000 : 16000); }
        routeGeneration++;
        JSObject result = routes(); result.put("sampleRate", 16000);
        result.put("echoCancellation", echo != null && echo.getEnabled()); result.put("noiseSuppression", noise != null && noise.getEnabled());
        pendingAudioStart = null; call.resolve(result);
    }
    private void cancelPendingAudioStart(String reason) {
        PluginCall pending = pendingAudioStart; pendingAudioStart = null;
        if (defaultRoutePoll != null) { main.removeCallbacks(defaultRoutePoll); defaultRoutePoll = null; }
        if (pending != null) pending.reject(reason);
    }
    private void event(String type, JSObject data) {
        String id = callId; if (id == null) return;
        data.put("type", type); data.put("callId", id); data.put("at", SystemClock.elapsedRealtime()); data.put("routeGeneration", routeGeneration);
        if ("playback".equals(type) && data.optBoolean("first", false)) data.put("routeObservation", routeObservation());
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
        if (running && captureEnabled) startCapture(sampleRate);
    }
    private void startCapture(int sampleRate) {
        if (!paused && !muted) recorder.startRecording();
        final AudioRecord input = recorder; final long generation = ++captureGeneration;
        capture = new Thread(() -> captureLoop(input, generation, sampleRate), "VirtuGene-call-capture"); capture.start();
    }
    private int releaseCapture() {
        captureGeneration++; captureRevision++; voiceFrames = 0; capture = null; routedInput = 0; lock.notifyAll();
        AudioRecord oldRecorder = recorder; recorder = null;
        if (oldRecorder != null) { try { oldRecorder.stop(); } catch (Exception ignored) {} captureCleanupFailures += AudioCleanup.run(oldRecorder::release); }
        AcousticEchoCanceler oldEcho = echo; echo = null;
        NoiseSuppressor oldNoise = noise; noise = null;
        if (oldEcho != null) captureCleanupFailures += AudioCleanup.run(oldEcho::release);
        if (oldNoise != null) captureCleanupFailures += AudioCleanup.run(oldNoise::release);
        if (captureCleanupFailures == 0) AudioCaptureLease.release(this);
        return captureCleanupFailures;
    }
    private void captureLoop(AudioRecord input, long generation, int sampleRate) {
        android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_AUDIO);
        short[] raw = new short[sampleRate / 50]; byte[] batch = new byte[3200]; int batchOffset = 0;
        LegacyScoPcm converter = new LegacyScoPcm();
        AudioTimestamp captureTimestamp = new AudioTimestamp();
        long revision = captureRevision;
        long nativeFramesRead = 0;
        boolean sampleClockContinuous = true;
        try {
            while (running && captureEnabled && generation == captureGeneration) {
                if (paused || muted) {
                    batchOffset = 0;
                    synchronized (lock) {
                        if (running && (paused || muted) && generation == captureGeneration) { voiceFrames = 0; lock.wait(100); }
                    }
                    continue;
                }
                int n = input.read(raw, 0, raw.length, AudioRecord.READ_BLOCKING);
                final long readCompletedAt = SystemClock.elapsedRealtime();
                if (n > 0) nativeFramesRead += n;
                synchronized (lock) {
                    if (!running || !captureEnabled || generation != captureGeneration) break;
                    if (revision != captureRevision) { revision = captureRevision; sampleClockContinuous = false; batchOffset = 0; voiceFrames = 0; continue; }
                    if (paused) { batchOffset = 0; continue; }
                    if (n <= 0) { suspend("capture-error"); break; }
                    if (SystemClock.elapsedRealtime() - heartbeat > 2000) suspend("bridge-stalled");
                    if (paused || muted) { batchOffset = 0; voiceFrames = 0; continue; }
                }
                short[] frame = sampleRate == 8000 ? converter.input8kTo16k(raw, n) : raw;
                if (sampleRate == 8000) n *= 2;
                double energy = 0;
                for (int i = 0; i < n; i++) energy += frame[i] * (double) frame[i];
                double rms = Math.sqrt(energy / n) / 32768.0;
                synchronized (lock) {
                    if (!running || !captureEnabled || paused || muted || generation != captureGeneration || revision != captureRevision) { batchOffset = 0; continue; }
                    voiceFrames = rms >= 0.035 ? voiceFrames + 1 : 0;
                    if (voiceFrames >= 4 && canBargeIn() && playbackTurn != null) {
                        JSObject interruption = stopOutput();
                        interruption.put("reason", "speech"); event("interrupted", interruption);
                    }
                }
                for (int i = 0; i < n; i++) {
                    batch[batchOffset++] = (byte) (frame[i] & 255); batch[batchOffset++] = (byte) ((frame[i] >> 8) & 255);
                    if (batchOffset >= batch.length) {
                        synchronized (lock) {
                            if (!running || !captureEnabled || paused || muted || generation != captureGeneration || revision != captureRevision) { batchOffset = 0; break; }
                            if (!verifyActiveRoute()) { batchOffset = 0; break; }
                            rememberRoute();
                            JSObject data = new JSObject(); data.put("pcm", Base64.encodeToString(batch, Base64.NO_WRAP)); data.put("sequence", captureSequence++); data.put("sampleRate", 16000);
                            data.put("captureReadCompletedAtMs", readCompletedAt); data.put("captureGeneration", generation);
                            Long batchFrameEnd = captureBatchFrameEnd(nativeFramesRead, sampleRate == 8000 ? n / 2 : n, i + 1, sampleRate);
                            if (batchFrameEnd != null) data.put("captureFrameEnd", batchFrameEnd);
                            data.put("captureFrameSampleRate", sampleRate);
                            if (captureObservationGeneration != generation || captureObservationRoute != routeGeneration) {
                                data.put("routeObservation", routeObservation()); captureObservationGeneration = generation; captureObservationRoute = routeGeneration;
                            }
                            // framePosition uses the native rate, 8k on legacy SCO, not resampled 16k.
                            try {
                                if (input.getTimestamp(captureTimestamp, AudioTimestamp.TIMEBASE_BOOTTIME) == AudioRecord.SUCCESS) {
                                    data.put("captureTimestampFrame", captureTimestamp.framePosition);
                                    data.put("captureTimestampAtMs", captureTimestamp.nanoTime / 1_000_000.0);
                                    data.put("captureTimestampSampleRate", sampleRate);
                                    Double sampleEnd = sampleClockContinuous && batchFrameEnd != null ? captureSampleEndAt(batchFrameEnd, captureTimestamp.framePosition, captureTimestamp.nanoTime, sampleRate, readCompletedAt) : null;
                                    if (sampleEnd != null) { data.put("captureSampleEndAtMs", sampleEnd); data.put("captureSampleTimeBasis", "audio-record-timestamp-estimate"); }
                                }
                            } catch (Exception ignored) { /* Diagnostics must not stop capture. */ }
                            event("capture", data);
                        }
                        batchOffset = 0;
                    }
                }
            }
        } catch (Exception ignored) {
            synchronized (lock) { if (running && captureEnabled && generation == captureGeneration) suspend("capture-error"); }
        }
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
    /** Read-count estimate only; an unavailable or discontinuous clock stays absent. */
    private static Long captureBatchFrameEnd(long totalReadFrames, int rawReadFrames, int emittedFrames, int sampleRate) {
        int multiplier = sampleRate == 8000 ? 2 : sampleRate == 16000 ? 1 : 0;
        if (multiplier == 0 || rawReadFrames < 0 || totalReadFrames < rawReadFrames || emittedFrames < 0 ||
            emittedFrames > rawReadFrames * multiplier || emittedFrames % multiplier != 0) return null;
        return totalReadFrames - rawReadFrames + emittedFrames / multiplier;
    }
    private static Double captureSampleEndAt(long readFrames, long timestampFrames, long timestampNanos, int sampleRate, long readCompletedAt) {
        if (readFrames < 0 || timestampFrames < 0 || timestampNanos <= 0 || sampleRate <= 0) return null;
        double estimate = timestampNanos / 1_000_000.0 + (readFrames - (double) timestampFrames) * 1000.0 / sampleRate;
        if (!Double.isFinite(estimate) || estimate < 0 || estimate > readCompletedAt + 20 || estimate < readCompletedAt - 500) return null;
        return estimate;
    }
    @PluginMethod public void clockProbe(PluginCall call) {
        synchronized (lock) {
            if (!owns(call) || paused) { call.reject("voice:clock_inactive"); return; }
            Object sequenceValue = call.getData().opt("probeSequence"), generationValue = call.getData().opt("routeGeneration");
            if (!(sequenceValue instanceof Number) || !(generationValue instanceof Number)) { call.reject("voice:clock_owner"); return; }
            double sequence = ((Number) sequenceValue).doubleValue(), generation = ((Number) generationValue).doubleValue();
            if (!Double.isFinite(sequence) || sequence != Math.floor(sequence) || sequence <= clockProbeSequence || sequence > 9007199254740991d ||
                !Double.isFinite(generation) || generation != routeGeneration) { call.reject("voice:clock_owner"); return; }
            clockProbeSequence = (long) sequence;
            JSObject result = new JSObject(); result.put("callId", callId); result.put("probeSequence", clockProbeSequence);
            result.put("routeGeneration", routeGeneration); result.put("nativeAtMs", SystemClock.elapsedRealtimeNanos() / 1_000_000.0);
            try { call.resolve(result); } catch (RuntimeException ignored) { /* A disposed diagnostic bridge owns no audio state. */ }
        }
    }
    @PluginMethod public void heartbeat(PluginCall call) {
        synchronized (lock) {
            if (!owns(call)) { call.reject("voice:inactive"); return; }
            heartbeat = SystemClock.elapsedRealtime(); call.resolve();
        }
    }
    @PluginMethod public void mute(PluginCall call) {
        synchronized (lock) {
            if (!owns(call)) { call.reject("voice:inactive"); return; }
            boolean value = call.getBoolean("muted", false);
            if (value == muted) { call.resolve(); return; }
            try {
                muted = value; captureRevision++; voiceFrames = 0;
                if (captureEnabled) { if (muted) recorder.stop(); else if (!paused) recorder.startRecording(); }
                lock.notifyAll(); call.resolve();
            } catch (Exception error) { suspend("capture-error"); call.reject("voice:capture_failed"); }
        }
    }
    @PluginMethod public void resume(PluginCall call) {
        synchronized (lock) {
            if (outputCleanupFailures > 0 || captureCleanupFailures > 0) { call.reject("voice:audio_release_failed"); return; }
            if (activityPaused) { call.reject("voice:background-or-lock"); return; }
            if (!owns(call)) { call.reject("voice:inactive"); return; }
            if (pendingResumeCall != null || pendingRouteCall != null || pendingAudioStart != null) { call.reject("voice:route_pending"); return; }
            if (captureEnabled && getPermissionState("microphone") != PermissionState.GRANTED) { suspend("microphone_denied"); call.reject("voice:microphone_denied"); return; }
            if (captureEnabled && manager.isMicrophoneMute()) { suspend("microphone_disabled"); call.reject("voice:microphone_disabled"); return; }
            if (captureEnabled && (capture == null || !capture.isAlive())) { close(); call.reject("voice:capture_ended"); return; }
            try {
                int granted = Build.VERSION.SDK_INT >= 26 ? manager.requestAudioFocus(focusRequest) : manager.requestAudioFocus(focus, AudioManager.STREAM_VOICE_CALL, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT);
                if (granted != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) { call.reject("voice:audio_focus"); return; }
            } catch (RuntimeException error) { suspend("audio-focus"); call.reject("voice:audio_focus"); return; }
            // Re-selection is asynchronous on Android. Keep capture/output paused
            // until the requested headset is actually confirmed, as on first start.
            suspend("resume-routing", false);
            pendingResumeCall = call;
            requestedDefaultDevice = 0;
            awaitResumeRoute(call, routeControlSession);
        }
    }
    private void awaitResumeRoute(PluginCall call, long session) {
        final long deadline = SystemClock.elapsedRealtime() + 8000;
        resumeRoutePoll = new Runnable() {
            @Override public void run() {
                synchronized (lock) {
                    if (pendingResumeCall != call || !running || routeControlSession != session) return;
                    if (activityPaused) { cancelPendingResume("voice:background-or-lock"); return; }
                    if (captureEnabled && (getPermissionState("microphone") != PermissionState.GRANTED || manager.isMicrophoneMute())) {
                        cancelPendingResume("voice:microphone_unavailable"); return;
                    }
                    try {
                        // Focus was acquired before entering this wait. A focus-loss
                        // callback cancels the wait even though audio is already paused.
                        if (manager.getMode() != AudioManager.MODE_IN_COMMUNICATION) manager.setMode(AudioManager.MODE_IN_COMMUNICATION);
                        if (SystemClock.elapsedRealtime() >= deadline) { cancelPendingResume("voice:headset_unavailable"); return; }
                        if (prepareDefaultRoute()) { finishResume(call); return; }
                        main.postDelayed(this, 100);
                    } catch (RuntimeException error) { cancelPendingResume("voice:headset_unavailable"); }
                }
            }
        };
        resumeRoutePoll.run();
    }
    private void finishResume(PluginCall call) {
        if (pendingResumeCall != call || activityPaused || !running) return;
        try {
            if (captureEnabled && !muted && recorder.getRecordingState() != AudioRecord.RECORDSTATE_RECORDING) recorder.startRecording();
            heartbeat = SystemClock.elapsedRealtime(); captureRevision++; paused = false;
            rememberRoute(); routeGeneration++;
            if (resumeRoutePoll != null) { main.removeCallbacks(resumeRoutePoll); resumeRoutePoll = null; }
            pendingResumeCall = null;
            lock.notifyAll(); call.resolve(routes());
        } catch (Exception error) { cancelPendingResume("voice:capture_ended"); close(); }
    }
    private void cancelPendingResume(String reason) {
        PluginCall pending = pendingResumeCall; pendingResumeCall = null;
        if (resumeRoutePoll != null) { main.removeCallbacks(resumeRoutePoll); resumeRoutePoll = null; }
        if (pending != null) { try { pending.reject(reason); } catch (RuntimeException ignored) { /* disposed bridge */ } }
    }
    @PluginMethod public void pause(PluginCall call) {
        synchronized (lock) {
            if (!owns(call)) { call.reject("voice:inactive"); return; }
            suspend("request-error", false);
            if (outputCleanupFailures > 0 || captureCleanupFailures > 0) call.reject("voice:audio_release_failed"); else call.resolve();
        }
    }
    private void suspend(String reason) { suspend(reason, true); }
    private void suspend(String reason, boolean notify) {
        synchronized (lock) {
            cancelPendingResume("voice:cancelled");
            if (!running || paused) return;
            cancelRoute("voice:route_failed");
            if (pendingModeCall != null) cancelInputSwitch("voice:cancelled", true);
            paused = true; captureRevision++; stopOutput();
            if (recorder != null) { try { recorder.stop(); } catch (Exception ignored) {} }
            if (notify) {
                JSObject data = new JSObject();
                data.put("reason", outputCleanupFailures > 0 || captureCleanupFailures > 0 ? "voice:audio_release_failed" : reason);
                data.put("cleanupFailures", outputCleanupFailures + captureCleanupFailures); event("paused", data);
            }
        }
    }
    @PluginMethod public void beginPlayback(PluginCall call) {
        synchronized (lock) {
            if (!owns(call) || paused) { call.reject("voice:inactive"); return; }
            String turn = call.getString("turnId");
            if (turn == null || turn.isEmpty() || turn.length() > 200) { call.reject("voice:invalid_turn"); return; }
            stopOutput();
            if (outputCleanupFailures > 0 || captureCleanupFailures > 0) { call.reject("voice:audio_release_failed"); return; }
            try {
            int playbackRate = legacyScoConnected ? 8000 : 24000;
            scoOutput = legacyScoConnected ? new LegacyScoPcm() : null;
            int minimum = AudioTrack.getMinBufferSize(playbackRate, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT);
            track = new AudioTrack.Builder().setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
                .setAudioFormat(new AudioFormat.Builder().setSampleRate(playbackRate).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).setEncoding(AudioFormat.ENCODING_PCM_16BIT).build())
                .setBufferSizeInBytes(Math.max(minimum, playbackRate / 10 * 2)).setTransferMode(AudioTrack.MODE_STREAM).build();
            if (track.getState() != AudioTrack.STATE_INITIALIZED) { stopOutput(); call.reject("voice:playback_failed"); return; }
            configurePlaybackStart(track, playbackRate);
            writtenFrames = 0; playbackTurn = turn; track.play();
            JSObject initial = new JSObject(); initial.put("playedFrames", 0); initial.put("writtenFrames", 0);
            initial.put("turnId", playbackTurn); putPlaybackObservation(initial, track); call.resolve(initial);
            } catch (Exception error) { stopOutput(); call.reject("voice:playback_failed"); return; }
            final long generation = epoch;
            playbackTicker = new Runnable() {
                private long lastReported;
                private long lastRouteCheck;
                private boolean started;
                @Override public void run() {
                    synchronized (lock) {
                        if (!running || paused || track == null || generation != epoch) return;
                        long played = head(track), now = SystemClock.elapsedRealtime();
                        if (now - lastRouteCheck >= 100) {
                            lastRouteCheck = now;
                            if (!verifyActiveRoute()) return;
                        }
                        checkDrainProgress(played);
                        if (played > 0 && (!started || now - lastReported >= 100)) {
                            JSObject report = new JSObject(); report.put("turnId", playbackTurn); report.put("playedFrames", played); report.put("writtenFrames", writtenFrames); report.put("first", !started);
                            report.put("sampleRate", track.getSampleRate());
                            putPlaybackObservation(report, track);
                            started = true; lastReported = now; event("playback", report);
                        }
                        main.postDelayed(this, 20);
                    }
                }
            };
            main.post(playbackTicker);
        }
    }
    private void configurePlaybackStart(AudioTrack output, int sampleRate) {
        // MODE_STREAM otherwise waits for the entire (possibly ROM-expanded)
        // buffer before the first sound. Keep its capacity for network jitter,
        // but let Android 12+ start after 40 ms. At 8 kHz a fixed 4800-byte
        // capacity used to add a 300 ms floor, so construction also scales by rate.
        if (Build.VERSION.SDK_INT >= 31) {
            try { output.setStartThresholdInFrames(Math.max(1, sampleRate * 40 / 1000)); }
            catch (RuntimeException ignored) { /* Optional tuning: retain the device default if unsupported. */ }
        }
    }
    @PluginMethod public void tunePlaybackBuffer(PluginCall call) {
        synchronized (lock) {
            if (!owns(call) || paused || track == null || !playbackTurn.equals(call.getString("turnId"))) { call.reject("voice:stale_audio"); return; }
            Object raw = call.getData().opt("targetMs"), route = call.getData().opt("routeGeneration");
            if (!(raw instanceof Number) || !Double.isFinite(((Number) raw).doubleValue())
                || ((Number) raw).doubleValue() != Math.floor(((Number) raw).doubleValue())
                || ((Number) raw).doubleValue() < 40 || ((Number) raw).doubleValue() > 160
                || !(route instanceof Number) || ((Number) route).doubleValue() != routeGeneration) { call.reject("voice:invalid_playback_buffer"); return; }
            if (writtenFrames != 0 || queuedBytes != 0 || head(track) != 0) { call.reject("voice:playback_already_started"); return; }
            if (!verifyActiveRoute()) { call.reject("voice:stale_audio"); return; }
            if (Build.VERSION.SDK_INT >= 31) {
                try {
                    int rate = track.getSampleRate(), existing = track.getStartThresholdInFrames(), buffer = track.getBufferSizeInFrames();
                    int requested = (int) Math.ceil(((Number) raw).doubleValue() * rate / 1000.0);
                    int maximum = Math.min(buffer, rate * 160 / 1000);
                    // Never lower an OEM default or exceed its currently effective buffer.
                    if (existing > 0 && existing <= maximum && requested > existing) track.setStartThresholdInFrames(Math.min(maximum, requested));
                } catch (RuntimeException ignored) { /* Optional tuning; retain the platform setting if unsupported. */ }
            }
            JSObject result = new JSObject(); result.put("playedFrames", 0); result.put("writtenFrames", 0);
            result.put("turnId", playbackTurn); putPlaybackObservation(result, track); call.resolve(result);
        }
    }
    @PluginMethod public void appendPcm(PluginCall call) {
        String encoded = call.getString("pcm"); byte[] decoded;
        try { if (encoded == null || encoded.length() > 128000) throw new IllegalArgumentException(); decoded = Base64.decode(encoded, Base64.DEFAULT); }
        catch (Exception error) { call.reject("voice:invalid_pcm"); return; }
        final AudioTrack active; final long generation; final byte[] pcm;
        synchronized (lock) {
            if (!owns(call) || paused || track == null || !playbackTurn.equals(call.getString("turnId"))) { call.reject("voice:stale_audio"); return; }
            if (!verifyActiveRoute()) { call.reject("voice:stale_audio"); return; }
            if (decoded.length % 2 != 0 || decoded.length == 0 || queuedBytes + decoded.length > (legacyScoConnected ? 48000 : 144000)) { call.reject("voice:audio_backpressure"); return; }
            restoreShortSegmentBuffer(track);
            pcm = scoOutput == null ? decoded : scoOutput.output24kTo8k(decoded);
            queuedBytes += pcm.length; active = track; generation = epoch;
        }
        output.execute(() -> {
            int offset = 0; long started = SystemClock.elapsedRealtime(), lastRouteCheck = started;
            boolean routeChecked = false;
            try {
                while (offset < pcm.length) {
                    synchronized (lock) {
                        if (generation != epoch || !running || paused || active != track) throw new IllegalStateException();
                        if (!routeChecked || SystemClock.elapsedRealtime() - lastRouteCheck >= 100) {
                            routeChecked = true;
                            lastRouteCheck = SystemClock.elapsedRealtime();
                            if (!verifyActiveRoute()) throw new IllegalStateException();
                        }
                        int n = active.write(pcm, offset, pcm.length - offset, AudioTrack.WRITE_NON_BLOCKING);
                        if (n < 0) throw new IllegalStateException();
                        offset += n; writtenFrames += n / 2;
                    }
                    if (SystemClock.elapsedRealtime() - started > 10000) throw new IllegalStateException();
                    if (offset < pcm.length) Thread.sleep(5);
                }
                double completedAt = SystemClock.elapsedRealtimeNanos() / 1_000_000.0;
                synchronized (lock) { if (generation != epoch) throw new IllegalStateException(); JSObject result = new JSObject(); result.put("writtenFrames", writtenFrames); result.put("playedFrames", head(active)); result.put("sampleRate", active.getSampleRate()); result.put("nativeWriteCompletedAtMs", completedAt); putPlaybackObservation(result, active); call.resolve(result); }
            } catch (Exception error) { call.reject("voice:stale_or_stalled_audio"); }
            finally { synchronized (lock) { if (generation == epoch) queuedBytes = Math.max(0, queuedBytes - pcm.length); } }
        });
    }
    private long head(AudioTrack active) { return startupPadding.voicePosition(Integer.toUnsignedLong(active.getPlaybackHeadPosition())); }
    /** Read-only track diagnostics; unsupported getters cannot fail playback. */
    private void putPlaybackObservation(JSObject value, AudioTrack active) {
        value.put("routeGeneration", routeGeneration);
        if (active == null) return;
        value.put("startupPaddingFrames", startupPadding.frames());
        try { value.put("nativeQueuedFrames", Math.max(0L, writtenFrames + startupPadding.frames() - Integer.toUnsignedLong(active.getPlaybackHeadPosition()))); } catch (RuntimeException ignored) {}
        try { value.put("sampleRate", active.getSampleRate()); } catch (RuntimeException ignored) {}
        if (Build.VERSION.SDK_INT >= 23) { try { value.put("bufferFrames", active.getBufferSizeInFrames()); } catch (RuntimeException ignored) {} }
        if (Build.VERSION.SDK_INT >= 24) { try { value.put("underrunCount", active.getUnderrunCount()); } catch (RuntimeException ignored) {} }
        if (Build.VERSION.SDK_INT >= 31) { try { value.put("startThresholdFrames", active.getStartThresholdInFrames()); } catch (RuntimeException ignored) {} }
    }
    @PluginMethod public void drain(PluginCall call) {
        final AudioTrack active; final long generation; final Long throughFrame;
        synchronized (lock) {
            if (!owns(call) || track == null || !playbackTurn.equals(call.getString("turnId"))) { call.reject("voice:stale_audio"); return; }
            if (pendingDrainCall != null) { call.reject("voice:drain_pending"); return; }
            Object raw = call.getData().opt("throughFrame");
            if (call.getData().has("throughFrame")) {
                if (!(raw instanceof Number) || !Double.isFinite(((Number) raw).doubleValue())
                    || ((Number) raw).doubleValue() != Math.floor(((Number) raw).doubleValue())
                    || ((Number) raw).doubleValue() < 0 || ((Number) raw).doubleValue() > writtenFrames) { call.reject("voice:invalid_drain_target"); return; }
                throughFrame = ((Number) raw).longValue();
            } else throughFrame = null;
            active = track; generation = epoch;
            pendingDrainCall = call; pendingDrainTarget = throughFrame;
            pendingDrainEpoch = generation; pendingDrainStartedAt = SystemClock.elapsedRealtime();
            try {
                long played = head(active);
                releaseShortSegment(active, played, throughFrame == null ? writtenFrames : throughFrame);
                checkDrainProgress(played);
            }
            catch (RuntimeException error) { cancelDrain("voice:stale_or_stalled_audio"); }
        }
    }
    /** Existing playback ticker owns observation; never occupy the PCM writer while waiting. */
    private void checkDrainProgress(long played) {
        PluginCall call = pendingDrainCall;
        if (call == null) return;
        if (pendingDrainEpoch != epoch || track == null || paused || !running) { cancelDrain("voice:stale_or_stalled_audio"); return; }
        long target = pendingDrainTarget == null ? writtenFrames : pendingDrainTarget;
        if (played >= target) {
            JSObject result = new JSObject(); result.put("playedFrames", played); result.put("writtenFrames", writtenFrames);
            result.put("complete", true); result.put("sampleRate", track.getSampleRate());
            putPlaybackObservation(result, track);
            if (pendingDrainTarget != null) result.put("throughFrame", pendingDrainTarget);
            pendingDrainCall = null; pendingDrainTarget = null;
            try { call.resolve(result); }
            catch (RuntimeException error) { try { call.reject("voice:stale_or_stalled_audio"); } catch (RuntimeException ignored) { /* Keep native progress/cleanup alive after bridge disposal. */ } }
        } else if (SystemClock.elapsedRealtime() - pendingDrainStartedAt > 15000) cancelDrain("voice:stale_or_stalled_audio");
    }
    private void cancelDrain(String reason) {
        PluginCall call = pendingDrainCall; pendingDrainCall = null; pendingDrainTarget = null;
        if (call != null) { try { call.reject(reason); } catch (RuntimeException ignored) { /* Audio cleanup must outlive a disposed bridge. */ } }
    }
    /** A fully supplied short first segment may never reach the stream's startup threshold.
     * Release only real queued frames; playback-head progress remains the completion authority. */
    private void releaseShortSegment(AudioTrack active, long played, long target) {
        if (!running || paused || active != track || played != 0 || target != writtenFrames || target <= 0) return;
        try {
            if (Build.VERSION.SDK_INT >= 31) {
                int threshold = active.getStartThresholdInFrames();
                if (target < threshold && tailRestoreThreshold == 0) {
                    tailRestoreThreshold = threshold;
                    active.setStartThresholdInFrames((int) target);
                }
            } else {
                int buffer = active.getBufferSizeInFrames();
                if (target < buffer && tailRestoreBuffer == 0) {
                    tailRestoreBuffer = buffer;
                    // Older devices may clamp to a larger minimum. Never synthesize a heard receipt.
                    try { active.setBufferSizeInFrames((int) target); } catch (RuntimeException ignored) { /* A readable effective size still permits the bounded fallback. */ }
                    int effective = active.getBufferSizeInFrames();
                    if (effective > target) queueStartupPadding(active, target, effective);
                }
            }
        } catch (RuntimeException ignored) { /* Optional tuning; the normal drain deadline still applies. */ }
    }
    private void restoreShortSegmentBuffer(AudioTrack active) {
        // A following segment may arrive before the first short segment starts. Do not re-block it.
        if (tailRestoreThreshold == 0 && tailRestoreBuffer == 0) return;
        try {
            if (head(active) == 0) return;
            if (Build.VERSION.SDK_INT >= 31 && tailRestoreThreshold > 0) {
                active.setStartThresholdInFrames(tailRestoreThreshold);
                tailRestoreThreshold = 0;
            }
            if (tailRestoreBuffer > 0) {
                active.setBufferSizeInFrames(tailRestoreBuffer);
                tailRestoreBuffer = 0;
            }
        } catch (RuntimeException ignored) { /* Retry only on another append; no zero buffer fallback. */ }
    }
    private JSObject stopOutput() {
        synchronized (lock) {
            cancelDrain("voice:stale_or_stalled_audio");
            long played = 0;
            if (track != null) { try { played = head(track); } catch (Exception ignored) {} }
            JSObject result = new JSObject(); result.put("playedFrames", played); result.put("writtenFrames", writtenFrames); result.put("turnId", playbackTurn);
            if (track != null) { try { result.put("sampleRate", track.getSampleRate()); } catch (Exception ignored) {} }
            epoch++; playbackTurn = null; queuedBytes = 0; writtenFrames = 0;
            tailRestoreThreshold = tailRestoreBuffer = 0;
            startupPadding.reset();
            if (playbackTicker != null) { main.removeCallbacks(playbackTicker); playbackTicker = null; }
            if (track != null) {
                AudioTrack old = track; track = null;
                outputCleanupFailures += AudioCleanup.output(() -> old.getState() == AudioTrack.STATE_INITIALIZED, old::pause, old::flush, old::release);
            }
            result.put("cleanupFailures", outputCleanupFailures);
            return result;
        }
    }
    @PluginMethod public void stopPlayback(PluginCall call) {
        synchronized (lock) {
            if (!owns(call)) { call.reject("voice:inactive"); return; }
            call.resolve(stopOutput());
        }
    }
    /** Old devices may clamp the smallest buffer above a complete first segment.
     * Add only bounded silence after it, on the cancellable writer; never count it as voice. */
    private void queueStartupPadding(AudioTrack active, long target, int threshold) {
        if (active != track || paused || !running || queuedBytes != 0 || head(active) != 0 || target != writtenFrames) return;
        int frames = startupPadding.claim(target, threshold, active.getSampleRate());
        if (frames == 0) return;
        final long generation = epoch;
        final int bytes = frames * 2;
        queuedBytes += bytes;
        output.execute(() -> {
            byte[] silence = new byte[Math.min(9600, bytes)];
            int remaining = bytes;
            long started = SystemClock.elapsedRealtime(), lastRouteCheck = started;
            boolean routeChecked = false;
            try {
                while (remaining > 0) {
                    synchronized (lock) {
                        if (generation != epoch || !running || paused || active != track) throw new IllegalStateException();
                        if (!routeChecked || SystemClock.elapsedRealtime() - lastRouteCheck >= 100) {
                            routeChecked = true; lastRouteCheck = SystemClock.elapsedRealtime();
                            if (!verifyActiveRoute()) throw new IllegalStateException();
                        }
                        int n = active.write(silence, 0, Math.min(silence.length, remaining), AudioTrack.WRITE_NON_BLOCKING);
                        if (n < 0 || n % 2 != 0) throw new IllegalStateException();
                        startupPadding.written(n / 2); remaining -= n;
                    }
                    if (SystemClock.elapsedRealtime() - started > 10000) throw new IllegalStateException();
                    if (remaining > 0) Thread.sleep(5);
                }
            } catch (Exception error) {
                synchronized (lock) { if (generation == epoch) cancelDrain("voice:stale_or_stalled_audio"); }
            } finally {
                synchronized (lock) { if (generation == epoch) queuedBytes = Math.max(0, queuedBytes - bytes); }
            }
        });
    }
    private static boolean privateOutputExpected(int type) {
        return type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO || type == AudioDeviceInfo.TYPE_BLE_HEADSET
            || type == AudioDeviceInfo.TYPE_WIRED_HEADSET || type == AudioDeviceInfo.TYPE_WIRED_HEADPHONES
            || type == AudioDeviceInfo.TYPE_USB_HEADSET;
    }
    private static boolean privateInputExpected(int type) {
        // Output-only headphones, USB devices, speakers and hearing aids may legitimately use the phone mic.
        return type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO || type == AudioDeviceInfo.TYPE_BLE_HEADSET
            || type == AudioDeviceInfo.TYPE_WIRED_HEADSET;
    }
    /** Called under lock before capture emission/write and on native device changes. No reroute/rebuild. */
    private boolean verifyActiveRoute() {
        if (!running || paused) return false;
        if (pendingRouteCall != null || selectingRoute) return true;
        if (Build.VERSION.SDK_INT < 31) {
            try {
                AudioDeviceInfo input = recorder == null ? null : recorder.getRoutedDevice();
                AudioDeviceInfo output = track == null ? null : track.getRoutedDevice();
                if (AudioRouteLoss.privateRouteFellBack(privateInputExpected(expectedLegacyOutputType), input != null && input.getType() == AudioDeviceInfo.TYPE_BUILTIN_MIC)
                    || AudioRouteLoss.privateRouteFellBack(privateOutputExpected(expectedLegacyOutputType), output != null && (output.getType() == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER || output.getType() == AudioDeviceInfo.TYPE_BUILTIN_EARPIECE))) {
                    routeGeneration++; suspend("route-lost"); return false;
                }
                return true;
            } catch (RuntimeException error) { routeGeneration++; suspend("route-error"); return false; }
        }
        try {
            AudioDeviceInfo communication = manager.getCommunicationDevice();
            int current = communication == null ? 0 : communication.getId();
            if (AudioRouteLoss.unexpectedCommunicationChange(confirmedCommunication, current, false)) {
                routeGeneration++; suspend("route-lost"); return false;
            }
            if (confirmedCommunication == 0 && current > 0) confirmedCommunication = current;
            if (communication == null) return true;
            AudioDeviceInfo input = recorder == null ? null : recorder.getRoutedDevice();
            AudioDeviceInfo output = track == null ? null : track.getRoutedDevice();
            boolean inputFallback = AudioRouteLoss.privateRouteFellBack(privateInputExpected(communication.getType()),
                input != null && input.getType() == AudioDeviceInfo.TYPE_BUILTIN_MIC);
            boolean outputFallback = AudioRouteLoss.privateRouteFellBack(privateOutputExpected(communication.getType()),
                output != null && (output.getType() == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER || output.getType() == AudioDeviceInfo.TYPE_BUILTIN_EARPIECE));
            if (inputFallback || outputFallback) { routeGeneration++; suspend("route-lost"); return false; }
            // A null I/O route means unobserved, never proof of successful duplex routing.
            return true;
        } catch (RuntimeException error) { routeGeneration++; suspend("route-error"); return false; }
    }
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
    /** Current I/O observations, deliberately excluding device IDs and names. */
    private JSObject routeObservation() {
        JSObject value = new JSObject();
        boolean inputObserved = false, outputObserved = false, communicationObserved = false;
        if (running && !paused) {
            try {
                AudioDeviceInfo input = recorder != null && recorder.getRecordingState() == AudioRecord.RECORDSTATE_RECORDING ? recorder.getRoutedDevice() : null;
                if (input != null) { value.put("inputType", input.getType()); inputObserved = true; }
            } catch (RuntimeException ignored) { /* Unobservable is not verified. */ }
            try {
                AudioDeviceInfo output = track != null && track.getPlayState() == AudioTrack.PLAYSTATE_PLAYING && head(track) > 0 ? track.getRoutedDevice() : null;
                if (output != null) { value.put("outputType", output.getType()); outputObserved = true; }
            } catch (RuntimeException ignored) { /* Keep the other direction's evidence. */ }
            try {
                AudioDeviceInfo communication = Build.VERSION.SDK_INT >= 31 ? manager.getCommunicationDevice() : null;
                if (communication != null) { value.put("communicationType", communication.getType()); communicationObserved = true; }
            } catch (RuntimeException ignored) { /* Selected communication is not proof of I/O. */ }
        }
        value.put("inputObserved", inputObserved); value.put("outputObserved", outputObserved); value.put("communicationObserved", communicationObserved);
        value.put("observedAtMs", SystemClock.elapsedRealtime()); value.put("routeGeneration", routeGeneration); return value;
    }
    private JSObject routes() {
        synchronized (lock) {
            rememberRoute();
            JSObject result = new JSObject(); JSArray rows = new JSArray();
            result.put("routeGeneration", routeGeneration);
            result.put("segmentDrain", true);
            result.put("playbackBufferTuning", Build.VERSION.SDK_INT >= 31);
            result.put("clockProbe", true);
            result.put("routeCancellation", true); result.put("routeControlSession", routeControlSession);
            result.put("routeObservation", routeObservation());
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
    }
    @PluginMethod public void getRoutes(PluginCall call) {
        synchronized (lock) {
            if (!owns(call)) { call.reject("voice:inactive"); return; }
            call.resolve(routes());
        }
    }
    @PluginMethod public void setRoute(PluginCall call) {
        synchronized (lock) {
            if (!owns(call)) { call.reject("voice:inactive"); return; }
            if (pendingRouteCall != null) { call.reject("voice:route_pending"); return; }
            final long request = claimRouteRequest(call);
            if (request == Long.MIN_VALUE) return;
            cancelPendingResume("voice:cancelled");
            int id = call.getInt("deviceId", 0);
            // Duplicate UI/bridge selections must not tear down a live Bluetooth stream.
            try {
                AudioDeviceInfo current = Build.VERSION.SDK_INT >= 31 ? manager.getCommunicationDevice() : null;
                if ((current != null && current.getId() == id)
                    || (Build.VERSION.SDK_INT < 31 && id == -3 && legacyScoRequested)) { rememberExplicitRoute(id); call.resolve(routes()); return; }
            } catch (SecurityException error) { call.reject("voice:bluetooth_denied"); return; }
            stopOutput();
            if (outputCleanupFailures > 0 || captureCleanupFailures > 0) { call.reject("voice:audio_release_failed"); return; }
            try {
                boolean found = false;
                if (Build.VERSION.SDK_INT >= 31) {
                    // The SDK may synchronously deliver a route callback while accepting a user selection.
                    selectingRoute = true;
                    try {
                        for (AudioDeviceInfo device : manager.getAvailableCommunicationDevices()) if (device.getId() == id) { found = manager.setCommunicationDevice(device); break; }
                    } finally { selectingRoute = false; }
                    if (!found) { call.reject("voice:route_unavailable"); return; }
                    // Acceptance is asynchronous; acknowledge only the effective communication route.
                    pendingRouteCall = call;
                    final long deadline = SystemClock.elapsedRealtime() + 30000;
                    routeConfirmation = new Runnable() {
                        @Override public void run() {
                            synchronized (lock) {
                                if (pendingRouteCall != call) return;
                                if (!owns(call) || (request > 0 && request != routeRequestHighWater)) { cancelRoute("voice:route_failed"); return; }
                                AudioDeviceInfo selected;
                                try { selected = manager.getCommunicationDevice(); }
                                catch (Exception error) { cancelRoute("voice:route_failed"); suspend("route-error"); return; }
                                if (selected != null && selected.getId() == id) {
                                    rememberExplicitRoute(id);
                                    confirmedCommunication = id; routeGeneration++;
                                    pendingRouteCall = null; routeConfirmation = null; call.resolve(routes()); return;
                                }
                                if (SystemClock.elapsedRealtime() >= deadline) {
                                    cancelRoute("voice:route_failed");
                                    try { manager.clearCommunicationDevice(); }
                                    catch (Exception ignored) { /* permission may have been revoked while waiting */ }
                                    suspend("route-error"); return;
                                }
                                main.postDelayed(this, 100);
                            }
                        }
                    };
                    main.post(routeConfirmation); return;
                }
                else if (id == -3) {
                    boolean available = false;
                    for (AudioDeviceInfo device : manager.getDevices(AudioManager.GET_DEVICES_OUTPUTS)) if (device.getType() == AudioDeviceInfo.TYPE_BLUETOOTH_SCO) available = true;
                    if (!available || !manager.isBluetoothScoAvailableOffCall()) { call.reject("voice:route_unavailable"); return; }
                    startLegacySco(); found = true;
                } else if (id == -1 || id == -2) {
                    AudioDeviceInfo[] outputs = manager.getDevices(AudioManager.GET_DEVICES_OUTPUTS);
                    if ((id == -1 ? findOutput(outputs, AudioDeviceInfo.TYPE_BUILTIN_SPEAKER) : legacySystemOutput(outputs)) == null) {
                        call.reject("voice:route_unavailable"); return;
                    }
                    boolean changed = legacyScoRequested || legacyScoConnected;
                    stopLegacySco();
                    if (changed) { suspend("route-change"); if (captureEnabled) replaceCapture(16000); }
                    manager.setSpeakerphoneOn(id == -1); found = true;
                }
                if (!found) { call.reject("voice:route_unavailable"); return; }
                rememberExplicitRoute(id);
                call.resolve(routes());
            } catch (SecurityException error) { call.reject("voice:bluetooth_denied"); }
            catch (Exception error) { suspend("route-error"); call.reject("voice:route_failed"); }
        }
    }
    private void cancelRoute(String reason) {
        PluginCall pending = pendingRouteCall; pendingRouteCall = null;
        if (routeConfirmation != null) { main.removeCallbacks(routeConfirmation); routeConfirmation = null; }
        if (pending != null) { try { pending.reject(reason); } catch (RuntimeException ignored) { /* A disposed bridge owns no route. */ } }
    }
    /** A request identity is separate from passive I/O route generations. */
    private long claimRouteRequest(PluginCall call) {
        Object raw = call.getData().opt("requestId");
        if (raw == null) return 0; // Older native clients retain the existing route contract.
        Object owner = call.getData().opt("routeControlSession");
        if (!(raw instanceof Number) || !(owner instanceof Number)) { call.reject("voice:route_request"); return Long.MIN_VALUE; }
        double request = ((Number) raw).doubleValue(), session = ((Number) owner).doubleValue();
        if (!Double.isFinite(request) || request <= 0 || request != Math.floor(request) || request > 9007199254740991d ||
            !Double.isFinite(session) || session != routeControlSession || request <= routeRequestHighWater) {
            call.reject("voice:route_cancelled"); return Long.MIN_VALUE;
        }
        routeRequestHighWater = (long) request; return (long) request;
    }
    @PluginMethod public void cancelRouteRequest(PluginCall call) {
        synchronized (lock) {
            if (!owns(call)) { call.reject("voice:inactive"); return; }
            Object raw = call.getData().opt("requestId"), owner = call.getData().opt("routeControlSession");
            if (!(raw instanceof Number) || !(owner instanceof Number)) { call.reject("voice:route_request"); return; }
            double requested = ((Number) raw).doubleValue(), session = ((Number) owner).doubleValue();
            if (!Double.isFinite(requested) || requested <= 0 || requested != Math.floor(requested) || requested > 9007199254740991d ||
                !Double.isFinite(session) || session != routeControlSession || requested < routeRequestHighWater) {
                call.reject("voice:route_cancelled"); return;
            }
            long request = (long) requested;
            if (request > cancelledRouteRequest) {
                routeRequestHighWater = cancelledRouteRequest = request;
                // Do not use suspend's already-paused early return as cancellation.
                cancelRoute("voice:route_cancelled"); stopLegacySco();
                if (!paused) suspend("route-cancelled");
                else { stopOutput(); if (recorder != null) { try { recorder.stop(); } catch (Exception ignored) {} } }
                confirmedCommunication = 0; routeGeneration++;
                if (Build.VERSION.SDK_INT >= 31) { try { manager.clearCommunicationDevice(); } catch (Exception ignored) { /* No implicit speaker fallback is played while paused. */ } }
                if (outputCleanupFailures > 0 || captureCleanupFailures > 0) { call.reject("voice:audio_release_failed"); return; }
            }
            JSObject result = routes(); result.put("cancelledRequestId", request); call.resolve(result);
        }
    }
    private void startLegacySco() {
        synchronized (lock) {
            if (legacyScoRequested) return;
            stopLegacySco(); if (pendingResumeCall == null) suspend("bluetooth-connecting"); legacyScoRequested = true;
            final long generation = ++scoGeneration;
            scoReceiver = new BroadcastReceiver() {
                @Override public void onReceive(Context context, Intent intent) {
                    synchronized (lock) {
                        if (!running || !legacyScoRequested || generation != scoGeneration) return;
                        int state = intent.getIntExtra(AudioManager.EXTRA_SCO_AUDIO_STATE, AudioManager.SCO_AUDIO_STATE_ERROR);
                        if (state == AudioManager.SCO_AUDIO_STATE_CONNECTED) {
                            // Some headsets emit CONNECTED repeatedly (including a sticky broadcast).
                            if (legacyScoConnected) return;
                            try { manager.setBluetoothScoOn(true); legacyScoConnected = true; if (captureEnabled && pendingAudioStart == null) replaceCapture(8000); event("routes", routes()); }
                            catch (Exception error) { stopLegacySco(); event("routeLost", routes()); }
                        } else if (state == AudioManager.SCO_AUDIO_STATE_DISCONNECTED || state == AudioManager.SCO_AUDIO_STATE_ERROR) {
                            boolean wasConnected = legacyScoConnected;
                            legacyScoConnected = false;
                            if (wasConnected) { suspend("bluetooth-disconnected"); stopLegacySco(); try { if (captureEnabled) replaceCapture(16000); } catch (Exception ignored) {} event("routeLost", routes()); }
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
            if (pendingCallId != null && pendingCallId.equals(call.getString("callId"))) cancelPendingStart("voice:cancelled");
            if (!owns(call)) { if (outputCleanupFailures > 0 || captureCleanupFailures > 0) call.reject("voice:audio_release_failed"); else call.resolve(); return; }
            if (close() > 0) call.reject("voice:audio_release_failed"); else call.resolve();
        }
    }
    private int close() {
        synchronized (lock) {
            cancelRoute("voice:cancelled");
            sessions.invalidate();
            cancelPendingStart("voice:cancelled");
            cancelPendingAudioStart("voice:cancelled");
            cancelPendingResume("voice:cancelled");
            if (pendingModeCall != null) cancelInputSwitch("voice:cancelled", false);
            running = false; paused = true; pendingCallId = pendingCallbackId = null; captureGeneration++; captureRevision++; lock.notifyAll();
            int failures = 0;
            JSObject stopped = stopOutput();
            Integer outputFailures = stopped.getInteger("cleanupFailures");
            failures += outputFailures == null ? 0 : outputFailures;
            failures += AudioCleanup.run(this::stopLegacySco); scoOutput = null;
            if (durationLimit != null) { main.removeCallbacks(durationLimit); durationLimit = null; }
            failures += releaseCapture(); captureEnabled = false;
            AudioDeviceCallback oldDevices = devices; devices = null;
            if (oldDevices != null) failures += AudioCleanup.run(() -> manager.unregisterAudioDeviceCallback(oldDevices));
            AudioManager.OnCommunicationDeviceChangedListener oldCommunication = communicationDevices; communicationDevices = null;
            if (Build.VERSION.SDK_INT >= 31 && oldCommunication != null) failures += AudioCleanup.run(() -> manager.removeOnCommunicationDeviceChangedListener(oldCommunication));
            boolean ownedMode = ownsAudioMode; ownsAudioMode = false;
            if (ownedMode && Build.VERSION.SDK_INT >= 31) failures += AudioCleanup.run(() -> manager.clearCommunicationDevice());
            AudioFocusRequest oldFocus = focusRequest; focusRequest = null;
            AudioManager.OnAudioFocusChangeListener oldFocusListener = focus; focus = null;
            failures += AudioCleanup.run(() -> {
                if (oldFocus != null && Build.VERSION.SDK_INT >= 26) manager.abandonAudioFocusRequest(oldFocus);
                else if (oldFocusListener != null) manager.abandonAudioFocus(oldFocusListener);
            });
            if (ownedMode) failures += AudioCleanup.run(() -> {
                if (manager.getMode() == AudioManager.MODE_IN_COMMUNICATION) {
                    manager.setMode(previousMode);
                    if (Build.VERSION.SDK_INT < 31) manager.setSpeakerphoneOn(previousSpeaker);
                }
            });
            VoiceCallServiceSessions.Ticket oldServiceSession = serviceSession; serviceSession = null; callId = null;
            failures += AudioCleanup.run(() -> VoiceCallService.stopMatching(getContext(), oldServiceSession));
            routedInput = routedOutput = routedCommunication = 0;
            confirmedCommunication = 0; routeGeneration++;
            return failures;
        }
    }
    @Override protected void handleOnPause() {
        synchronized (lock) {
            activityPaused = true;
            if (pendingAudioStart != null) { cancelPendingAudioStart("voice:background-or-lock"); close(); }
            else suspend("background-or-lock");
        }
    }
    @Override protected void handleOnStop() {
        synchronized (lock) {
            activityPaused = true;
            cancelPendingStart("voice:background-or-lock");
            if (pendingAudioStart != null) { cancelPendingAudioStart("voice:background-or-lock"); close(); }
            cancelRoute("voice:cancelled"); stopLegacySco();
            if (pendingModeCall != null) cancelInputSwitch("voice:cancelled", true);
            suspend("background-or-lock");
        }
        super.handleOnStop();
    }
    @Override protected void handleOnResume() {
        synchronized (lock) {
            activityPaused = false;
            if (pendingStartPermissionReady && pendingStartCall != null) begin(pendingStartCall);
        }
        super.handleOnResume();
    }
    @Override protected void handleOnDestroy() { close(); output.shutdownNow(); super.handleOnDestroy(); }
}
