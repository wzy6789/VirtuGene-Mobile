import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

// Runs extracted production Java methods with JVM doubles. No Android device,
// permission window, microphone, model request, APK task or dependency install.
const root = resolve('.');
const headsetSuite = process.argv.includes('--headset');
const headsetScenarios = headsetSuite ? (await import('./voice-default-headset.mjs')).headsetScenarios : '';
const evidence = resolve(headsetSuite ? '.tmp-preview/voice-default-headset-20261016' : '.tmp-preview/voice-native-lifecycle-20261016');
const pluginFile = 'android/app/src/main/java/com/virtugene/app/plugins/VoiceCallAudioPlugin.java';
const beforeFile = join(evidence, 'before', 'VoiceCallAudioPlugin.java');
const mode = process.argv.includes('--before') ? 'before' : 'after';
mkdirSync(join(evidence, mode), { recursive: true });
if (process.argv.includes('--capture-before')) {
  assert.equal(existsSync(beforeFile), false, 'Refuse to overwrite the actual pre-change snapshot');
  mkdirSync(join(evidence, 'before'), { recursive: true });
  writeFileSync(beforeFile, readFileSync(pluginFile));
}
const source = readFileSync(mode === 'before' ? beforeFile : pluginFile, 'utf8');
const syntax = source.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g,
  token => token.replace(/[^\r\n]/g, ' '));
const extracted = [];
function method(name, optional = false) {
  const found = new RegExp('(?:public|private|protected)\\s+(?:static\\s+)?[\\w.<>]+\\s+' + name + '\\s*\\([^)]*\\)\\s*\\{', 'g').exec(syntax);
  if (!found && optional) return '';
  assert.ok(found, `Missing production method: ${name}`);
  const start = found.index, brace = syntax.indexOf('{', start); let depth = 1;
  for (let end = brace + 1; end < syntax.length; end++) {
    if (syntax[end] === '{') depth++;
    if (syntax[end] === '}' && --depth === 0) {
      const text = source.slice(start, end + 1);
      extracted.push({ name, startLine: source.slice(0, start).split('\n').length, sha256: createHash('sha256').update(text).digest('hex') });
      return text;
    }
  }
  throw new Error('Unclosed production method: ' + name);
}
const names = ['focusForSession', 'start', 'permissionReady', 'setInputMode', 'inputPermissionReady', 'switchInput', 'restoreServiceInput',
  'cancelInputSwitch', 'completeInputSwitch', 'begin', 'owns', 'resume', 'pause', 'stop', 'close', 'releaseCapture', 'handleOnPause'];
const methods = names.map(name => method(name)).join('\n');
const optionalMethods = ['awaitResumeRoute', 'finishResume', 'cancelPendingResume', 'cancelPendingStart', 'handleOnResume', 'handleOnStop'].map(name => method(name, true)).join('\n');
const routeMethods = ['prepareDefaultRoute', 'rememberExplicitRoute', 'awaitDefaultAudioStart', 'finishDefaultAudioStart', 'cancelPendingAudioStart',
  'findOutput', 'legacySystemOutput', 'startLegacySco', 'stopLegacySco', 'privateInputExpected', 'privateOutputExpected', 'verifyActiveRoute'].map(name => method(name, true)).join('\n');
const beforeRouteStubs = source.includes('private boolean prepareDefaultRoute()') ? '' : `
  private boolean prepareDefaultRoute(){return true;}
  private void rememberExplicitRoute(int id){}
  private void cancelPendingAudioStart(String reason){}
`;
// Both suspend overloads are copied verbatim as a block, without matching braces
// in comments/strings, and with the same helper implementation as the plugin.
const suspendStart = source.indexOf('private void suspend(String reason)');
const suspendEnd = source.indexOf('@PluginMethod public void beginPlayback', suspendStart);
assert.ok(suspendStart >= 0 && suspendEnd > suspendStart);
const suspendMethods = source.slice(suspendStart, suspendEnd);
extracted.push({ name: 'suspend-overloads', sha256: createHash('sha256').update(suspendMethods).digest('hex') });
const java = `package com.virtugene.app.plugins;
import java.util.*;
import java.util.function.Consumer;
import java.util.concurrent.Executor;

class LifecyclePluginBase {
  protected void handleOnResume() {} protected void handleOnPause() {} protected void handleOnStop() {}
}
public final class VoiceNativeLifecycleCheck extends LifecyclePluginBase {
  static int checks; static final List<String> failures = new ArrayList<>();
  static final Map<String,int[]> scenarios = new LinkedHashMap<>(); static String scenario;
  static void check(boolean ok, String why) { checks++; scenarios.get(scenario)[1]++; if (!ok) {
    scenarios.get(scenario)[2]++; if (failures.size() < 40) failures.add(scenario + ": " + why);
  } }
  static void run(String name, Runnable action) { scenario=name; scenarios.computeIfAbsent(name, x -> new int[3])[0]++;
    Build.VERSION.SDK_INT=36;SystemClock.now=10000;
    try { action.run(); } catch(Throwable error) { check(false, "unexpected " + error.getClass().getSimpleName() + ": " + error.getMessage()); }
  }
  enum PermissionState { GRANTED, DENIED, DENIED_ALWAYS }
  static class Build { static class VERSION { static int SDK_INT = 36; } }
  static class SystemClock { static long now=10000;static long elapsedRealtime() { return now; } }
  static class JSObject extends HashMap<String,Object> {
    Integer getInteger(String key) { return (Integer)get(key); }
  }
  static class PluginCall {
    final String id, callback; final boolean capture; boolean resolved; String error; int rejections;final Map<String,Integer> extra=new HashMap<>();final Map<String,Boolean> flags=new HashMap<>();
    PluginCall(String id,String callback,boolean capture) { this.id=id;this.callback=callback;this.capture=capture; }
    String getString(String key) { return id; } String getCallbackId() { return callback; }
    Boolean getBoolean(String key,boolean fallback) { return key.equals("requirePrivateRoute") ? flags.getOrDefault(key,fallback) : capture; }
    Integer getInt(String key){return extra.get(key);}Integer getInt(String key,int fallback){return extra.getOrDefault(key,fallback);}
    void resolve() { resolved=true; } void resolve(JSObject ignored) { resolve(); }
    void reject(String reason) { error=reason;rejections++; }
  }
  static class Handler {
    final Map<Runnable,Long> scheduled=new LinkedHashMap<>();
    void post(Runnable action) { scheduled.put(action,0L); }
    void postDelayed(Runnable action,long delay) { scheduled.put(action,delay); }
    void removeCallbacks(Runnable action) { scheduled.remove(action); }
    void fire(long delay) { for(var entry:new ArrayList<>(scheduled.entrySet())) if(entry.getValue()==delay) { scheduled.remove(entry.getKey());entry.getKey().run(); } }
  }
  static class Thread { boolean alive=true; boolean isAlive(){return alive;} }
  static class Intent { final Map<String,Object> extras=new HashMap<>(); Intent(Object context,Class<?> cls){} Intent putExtra(String key,String value){extras.put(key,value);return this;}
    Intent putExtra(String key,int value){extras.put(key,value);return this;}int getIntExtra(String key,int fallback){Object v=extras.get(key);return v instanceof Integer?(Integer)v:fallback;}}
  static class IntentFilter {IntentFilter(String action){}}static abstract class BroadcastReceiver {public abstract void onReceive(Context context,Intent intent);}
  static class Context {
    int starts;boolean failStart;void startForegroundService(Intent value){startService(value);}
    void startService(Intent value){if(failStart)throw new SecurityException("fixture service denial");starts++;}
    void stopService(Intent value){} Executor getMainExecutor(){return Runnable::run;}
    Intent registerReceiver(BroadcastReceiver receiver,IntentFilter filter){return null;}void unregisterReceiver(BroadcastReceiver receiver){}
  }
  static class AudioAttributes {
    static final int USAGE_VOICE_COMMUNICATION=2,CONTENT_TYPE_SPEECH=1;
    static class Builder { Builder setUsage(int value){return this;}Builder setContentType(int value){return this;}AudioAttributes build(){return new AudioAttributes();} }
  }
  static class AudioFocusRequest {
    static class Builder { Builder(int value){}Builder setAudioAttributes(AudioAttributes value){return this;}
      Builder setOnAudioFocusChangeListener(AudioManager.OnAudioFocusChangeListener value,Handler handler){return this;}
      AudioFocusRequest build(){return new AudioFocusRequest();} }
  }
  static class AudioDeviceInfo {
    static final int TYPE_BUILTIN_EARPIECE=1,TYPE_BUILTIN_SPEAKER=2,TYPE_WIRED_HEADSET=3,TYPE_WIRED_HEADPHONES=4,TYPE_BLUETOOTH_SCO=7,TYPE_BLUETOOTH_A2DP=8,TYPE_USB_DEVICE=11,TYPE_BUILTIN_MIC=15,TYPE_USB_HEADSET=22,TYPE_HEARING_AID=23,TYPE_BLE_HEADSET=26;
    final int id,type;AudioDeviceInfo(){this(1,1);}AudioDeviceInfo(int id,int type){this.id=id;this.type=type;}int getId(){return id;}int getType(){return type;}
  }
  static class AudioDeviceCallback { public void onAudioDevicesAdded(AudioDeviceInfo[] added){}public void onAudioDevicesRemoved(AudioDeviceInfo[] removed){} }
  static class AudioManager {
    static final int AUDIOFOCUS_GAIN_TRANSIENT=2,STREAM_VOICE_CALL=0,AUDIOFOCUS_REQUEST_GRANTED=1,MODE_IN_COMMUNICATION=3;
    static final int AUDIOFOCUS_LOSS=-1,AUDIOFOCUS_LOSS_TRANSIENT=-2,AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK=-3,AUDIOFOCUS_GAIN=1;
    static final int GET_DEVICES_OUTPUTS=2,SCO_AUDIO_STATE_ERROR=-1,SCO_AUDIO_STATE_DISCONNECTED=0,SCO_AUDIO_STATE_CONNECTED=1;
    static final String EXTRA_SCO_AUDIO_STATE="state",ACTION_SCO_AUDIO_STATE_UPDATED="sco";
    interface OnAudioFocusChangeListener {void onChange(int change);} interface OnCommunicationDeviceChangedListener {void onChange(AudioDeviceInfo device);}
    boolean microphoneMuted,focusDenied,speaker,scoSupported=true,scoOn,acceptRoute=true,confirmRoute=true;int mode,focusRequests,routeRequests,scoStarts,scoStops;AudioDeviceInfo requested;
    AudioDeviceInfo communication=new AudioDeviceInfo(1,1);List<AudioDeviceInfo> available=new ArrayList<>(List.of(communication,new AudioDeviceInfo(2,2)));AudioDeviceInfo[] outputs=available.toArray(new AudioDeviceInfo[0]);
    boolean isMicrophoneMute(){return microphoneMuted;}
    int getMode(){return mode;}void setMode(int value){mode=value;}boolean isSpeakerphoneOn(){return speaker;}void setSpeakerphoneOn(boolean value){speaker=value;}
    AudioDeviceInfo[] getDevices(int flags){return outputs;}List<AudioDeviceInfo> getAvailableCommunicationDevices(){return available;}
    AudioDeviceInfo getCommunicationDevice(){return communication;}boolean setCommunicationDevice(AudioDeviceInfo device){routeRequests++;requested=device;if(acceptRoute&&confirmRoute)communication=device;return acceptRoute;}
    boolean isBluetoothScoAvailableOffCall(){return scoSupported;}void startBluetoothSco(){scoStarts++;}void stopBluetoothSco(){scoStops++;}void setBluetoothScoOn(boolean value){scoOn=value;}
    int requestAudioFocus(AudioFocusRequest value){focusRequests++;return focusDenied?0:1;}
    int requestAudioFocus(OnAudioFocusChangeListener value,int stream,int duration){return requestAudioFocus((AudioFocusRequest)null);}
    void registerAudioDeviceCallback(AudioDeviceCallback value,Handler handler){}void unregisterAudioDeviceCallback(AudioDeviceCallback value){}
    void addOnCommunicationDeviceChangedListener(Executor executor,OnCommunicationDeviceChangedListener listener){}
    void removeOnCommunicationDeviceChangedListener(OnCommunicationDeviceChangedListener listener){}void clearCommunicationDevice(){communication=new AudioDeviceInfo(1,1);}
    void abandonAudioFocusRequest(AudioFocusRequest value){}void abandonAudioFocus(OnAudioFocusChangeListener value){}
  }
  static class AudioRecord {static final int RECORDSTATE_RECORDING=3;int state,stops,releases;boolean failRelease;AudioDeviceInfo route;
    void startRecording(){state=3;}void stop(){stops++;state=0;}int getRecordingState(){return state;}
    AudioDeviceInfo getRoutedDevice(){return route;}
    void release(){releases++;if(failRelease)throw new IllegalStateException("fixture cleanup failure");}}
  static class AudioTrack {AudioDeviceInfo route;AudioDeviceInfo getRoutedDevice(){return route;}} static class Effect {void release(){} boolean getEnabled(){return true;} }
  static class AcousticEchoCanceler extends Effect {} static class NoiseSuppressor extends Effect {}
  static class VoiceCallService {
    static final String SESSION="nativeSession"; static final VoiceCallServiceSessions registry=new VoiceCallServiceSessions();
    static VoiceCallServiceSessions.Ticket register(Runnable end,boolean capture){return registry.register(end,capture);}
    static long requestCapture(Context context,VoiceCallServiceSessions.Ticket ticket,boolean enabled,Consumer<RuntimeException> reply){
      return registry.requestCapture(ticket,enabled,reply,()->context.startService(new Intent(context,VoiceCallService.class)));}
    static boolean cancelCapture(Context context,VoiceCallServiceSessions.Ticket ticket,long serial){
      return registry.cancelCapture(ticket,serial,()->context.startService(new Intent(context,VoiceCallService.class)));}
    static void stopMatching(Context context,VoiceCallServiceSessions.Ticket ticket){registry.release(ticket,()->context.stopService(new Intent(context,VoiceCallService.class)));}
  }
  private final Object lock=new Object(); private final AudioSessionAuthority sessions=new AudioSessionAuthority(lock);
  private final Handler main=new Handler(); private final Context context=new Context(); private final AudioManager manager=new AudioManager();
  private PermissionState permission=PermissionState.GRANTED;private boolean failPermissionLaunch;private int permissionLaunches,allocations,captureStarts,outputStops,events,captureRate;
  private boolean running,muted,paused,captureEnabled,activityPaused,pendingStartPermissionReady;
  private PluginCall pendingStartCall,pendingModeCall;private String callId,pendingCallId,pendingCallbackId;
  private final AudioDefaultRoute defaultRoute=new AudioDefaultRoute();private PluginCall pendingAudioStart,pendingRouteCall,pendingResumeCall;private Runnable defaultRoutePoll,resumeRoutePoll;private int requestedDefaultDevice,expectedLegacyOutputType;private boolean selectingRoute;
  private BroadcastReceiver scoReceiver;private Runnable scoTimeout;private long scoGeneration;
  private long pendingModeServiceSerial=-1;private Runnable modeServiceTimeout;
  private AudioRecord recorder;private AudioTrack track;private AcousticEchoCanceler echo;private NoiseSuppressor noise;private AudioFocusRequest focusRequest;
  private AudioManager.OnAudioFocusChangeListener focus;private AudioDeviceCallback devices;private AudioManager.OnCommunicationDeviceChangedListener communicationDevices;
  private Thread capture;private long heartbeat,captureHeartbeatAtStart,captureRevision,captureGeneration,clockProbeSequence,captureSequence,routeGeneration,routeControlSession,routeRequestHighWater,cancelledRouteRequest;
  private int outputCleanupFailures,captureCleanupFailures,previousMode,voiceFrames,routedInput,routedOutput,routedCommunication,confirmedCommunication;
  private boolean previousSpeaker,ownsAudioMode,legacyScoRequested,legacyScoConnected;private Object scoOutput;
  private Runnable durationLimit;private VoiceCallServiceSessions.Ticket serviceSession;
  private PermissionState getPermissionState(String alias){return permission;}
  private void requestPermissionForAlias(String alias,PluginCall call,String callback){permissionLaunches++;if(failPermissionLaunch)throw new IllegalStateException("fixture launcher unavailable");}
  private Context getContext(){return context;}
  private void replaceCapture(int rate){allocations++;captureRate=rate;recorder=new AudioRecord();}
  private void startCapture(int rate){captureStarts++;captureHeartbeatAtStart=heartbeat;recorder.startRecording();capture=new Thread();}
  private JSObject stopOutput(){outputStops++;JSObject value=new JSObject();value.put("cleanupFailures",0);return value;}
  private void cancelRoute(String reason){}
  private void rememberRoute(){}private JSObject routes(){return new JSObject();}private JSObject routeObservation(){return new JSObject();}
  private void event(String type,JSObject value){events++;}
  ${methods}
  ${optionalMethods}
  ${routeMethods}
  ${beforeRouteStubs}
  ${suspendMethods}
  private static PluginCall call(String cb,boolean capture){return new PluginCall("same-call",cb,capture);}
  private static void clean(VoiceNativeLifecycleCheck plugin){plugin.close();}
  private void acknowledge(RuntimeException failure){VoiceCallService.registry.activationFinished(serviceSession,failure).run();}
  private static void configureHeadset(VoiceNativeLifecycleCheck p,int type){p.manager.available=new ArrayList<>(List.of(new AudioDeviceInfo(1,1),new AudioDeviceInfo(2,2),new AudioDeviceInfo(9,type)));p.manager.outputs=p.manager.available.toArray(new AudioDeviceInfo[0]);}
  private static void tick(VoiceNativeLifecycleCheck p,long ms){SystemClock.now+=ms;p.main.fire(100);}
  private static Intent scoIntent(int state){return new Intent(null,VoiceCallService.class).putExtra(AudioManager.EXTRA_SCO_AUDIO_STATE,state);}
  public static void main(String[] args) {
    for(int round=0;round<30;round++) {
      ${headsetScenarios}
      if (${!headsetSuite}) {
      run("permission-launcher-exception-retry",()->{var p=new VoiceNativeLifecycleCheck();p.permission=PermissionState.DENIED;p.failPermissionLaunch=true;var first=call("launch",true);
        boolean threw=false;try{p.start(first);}catch(RuntimeException error){threw=true;}check(!threw,"launcher exception escapes");check(first.error!=null,"failed launcher must reply");
        check(p.pendingCallId==null,"failed launcher keeps pending owner");p.failPermissionLaunch=false;p.permission=PermissionState.GRANTED;var retry=call("retry",true);p.start(retry);
        check(retry.resolved&&p.running,"explicit retry remains blocked");clean(p);});
      for(PermissionState denied:new PermissionState[]{PermissionState.DENIED,PermissionState.DENIED_ALWAYS})run("permission-"+denied.name().toLowerCase(),()->{
        var p=new VoiceNativeLifecycleCheck();p.permission=denied;var c=call("denied",true);p.start(c);check(p.permissionLaunches==1&&!p.running,"request before denial");p.permissionReady(c);
        check("voice:microphone_denied".equals(c.error)&&p.pendingCallId==null&&p.allocations==0,"denial must release pending without audio");p.handleOnResume();check(!p.running,"denied permission auto-reopens");clean(p);});
      run("initial-permission-accepted-in-foreground",()->{var p=new VoiceNativeLifecycleCheck();p.permission=PermissionState.DENIED;var c=call("accept",true);p.start(c);p.permission=PermissionState.GRANTED;p.permissionReady(c);
        check(c.resolved&&p.running&&p.captureStarts==1,"accepted foreground permission starts once");clean(p);});
      run("permission-dialog-pause-grant-resume",()->{var p=new VoiceNativeLifecycleCheck();p.permission=PermissionState.DENIED;var c=call("dialog",true);p.start(c);p.handleOnPause();p.permission=PermissionState.GRANTED;p.permissionReady(c);
        check(!p.running&&p.allocations==0&&!c.resolved,"permission callback starts while activity paused");p.handleOnResume();check(p.running&&c.resolved&&p.captureStarts==1,"normal permission dialog needs an extra start");p.handleOnResume();check(p.captureStarts==1,"duplicate resume starts twice");clean(p);});
      run("permission-dialog-pause-resume-grant",()->{var p=new VoiceNativeLifecycleCheck();p.permission=PermissionState.DENIED;var c=call("dialog-late",true);p.start(c);p.handleOnPause();p.handleOnResume();
        check(!p.running&&p.allocations==0,"resume commits without an accepted permission result");p.permission=PermissionState.GRANTED;p.permissionReady(c);check(p.running&&c.resolved&&p.captureStarts==1,"late foreground grant cannot complete");clean(p);});
      run("deferred-grant-rechecks-revocation-privacy-and-capture-lease",()->{for(int branch=0;branch<3;branch++){var p=new VoiceNativeLifecycleCheck();p.permission=PermissionState.DENIED;var c=call("deferred-recheck",true);p.start(c);p.handleOnPause();p.permission=PermissionState.GRANTED;p.permissionReady(c);Object other=new Object();
        if(branch==0)p.permission=PermissionState.DENIED;else if(branch==1)p.manager.microphoneMuted=true;else AudioCaptureLease.acquire(other);
        p.handleOnResume();check(!p.running&&p.allocations==0&&c.error!=null,"deferred start bypasses current microphone gate "+branch);clean(p);AudioCaptureLease.release(other);}});
      run("background-stop-cancels-initial-permission",()->{var p=new VoiceNativeLifecycleCheck();p.permission=PermissionState.DENIED;var c=call("home",true);p.start(c);p.handleOnPause();p.handleOnStop();
        check(p.pendingCallId==null&&c.error!=null,"background stop retains initial request");p.permission=PermissionState.GRANTED;p.permissionReady(c);p.handleOnResume();check(!p.running&&p.allocations==0,"late grant resurrects a background request");
        var retry=call("manual-return",true);p.start(retry);check(retry.resolved&&p.running,"manual foreground retry cannot start");clean(p);});
      run("background-after-deferred-grant-cancels-initial-permission",()->{var p=new VoiceNativeLifecycleCheck();p.permission=PermissionState.DENIED;var c=call("home-deferred",true);p.start(c);p.handleOnPause();p.permission=PermissionState.GRANTED;p.permissionReady(c);p.handleOnStop();p.handleOnResume();
        check(!p.running&&p.allocations==0&&c.error!=null,"stop failed to revoke an accepted but deferred grant");clean(p);});
      run("background-start-and-resume-rejected",()->{var p=new VoiceNativeLifecycleCheck();p.handleOnPause();p.handleOnStop();var c=call("background-text",false);p.start(c);check(!p.running&&!c.resolved&&c.error!=null,"background text start accepted");clean(p);
        p=new VoiceNativeLifecycleCheck();p.start(call("text",false));p.handleOnPause();int requests=p.manager.focusRequests;var resumed=call("background-resume",false);p.resume(resumed);check(p.paused&&!resumed.resolved&&p.manager.focusRequests==requests,"background resume restarts focus/audio");clean(p);});
      run("pending-stop-rejects-late-same-id-callback",()->{var p=new VoiceNativeLifecycleCheck();p.permission=PermissionState.DENIED;var old=call("old",true);p.start(old);var stop=call("stop",false);p.stop(stop);check(stop.resolved&&p.pendingCallId==null,"pending stop does not clear owner");
        var fresh=call("fresh",true);p.start(fresh);p.permission=PermissionState.GRANTED;p.permissionReady(old);check(!p.running&&"fresh".equals(p.pendingCallbackId),"old same-call callback consumes replacement");p.permissionReady(fresh);check(p.running&&fresh.resolved,"fresh callback blocked");clean(p);});
      run("same-id-wrong-callback-cannot-deny-or-start",()->{var p=new VoiceNativeLifecycleCheck();p.permission=PermissionState.DENIED;var current=call("current",true);p.start(current);var wrong=call("wrong",true);p.permissionReady(wrong);
        check(!p.running&&"current".equals(p.pendingCallbackId)&&"voice:cancelled".equals(wrong.error),"wrong callback changes pending request");p.permission=PermissionState.GRANTED;p.permissionReady(current);check(p.running&&current.resolved,"real callback cannot start");clean(p);});
      run("text-mode-works-with-permanent-denial-and-privacy-mute",()->{var p=new VoiceNativeLifecycleCheck();p.permission=PermissionState.DENIED_ALWAYS;p.manager.microphoneMuted=true;var c=call("text",false);p.start(c);
        check(c.resolved&&p.running&&!p.captureEnabled&&p.allocations==0&&p.permissionLaunches==0,"text start requests or allocates microphone");p.handleOnPause();p.handleOnResume();check(p.paused,"foreground return auto-resumes a live call");var resumed=call("manual",false);p.resume(resumed);check(resumed.resolved&&!p.paused&&p.allocations==0,"manual text resume depends on microphone");clean(p);});
      run("text-to-voice-pending-permission-background-cancel",()->{var p=new VoiceNativeLifecycleCheck();p.start(call("text",false));p.permission=PermissionState.DENIED;var modeCall=call("enable",true);p.setInputMode(modeCall);check(p.pendingModeCall==modeCall&&p.allocations==0,"mode request is not awaiting permission");
        p.handleOnPause();p.handleOnStop();p.permission=PermissionState.GRANTED;p.inputPermissionReady(modeCall);p.handleOnResume();check(p.pendingModeCall==null&&!p.captureEnabled&&p.paused&&p.allocations==0&&modeCall.error!=null,"late mode permission enables microphone");clean(p);});
      run("text-to-voice-launcher-exception-and-explicit-retry",()->{var p=new VoiceNativeLifecycleCheck();p.start(call("text",false));p.permission=PermissionState.DENIED;p.failPermissionLaunch=true;var bad=call("bad-mode",true);p.setInputMode(bad);check(bad.error!=null&&p.pendingModeCall==null&&!p.captureEnabled,"mode launcher failure sticks pending");
        p.failPermissionLaunch=false;p.permission=PermissionState.GRANTED;var good=call("good-mode",true);p.setInputMode(good);check(p.allocations==0,"microphone allocated before service acknowledgement");p.acknowledge(null);check(good.resolved&&p.captureEnabled&&p.allocations==1,"manual mode retry fails");clean(p);});
      run("mode-service-denial-and-late-ack-after-pause",()->{var p=new VoiceNativeLifecycleCheck();p.start(call("text",false));var modeCall=call("mode-denied",true);p.setInputMode(modeCall);p.acknowledge(new SecurityException("fixture-only"));check(modeCall.error!=null&&!p.captureEnabled&&p.allocations==0,"service denial still allocates capture");clean(p);
        p=new VoiceNativeLifecycleCheck();p.start(call("text-late",false));var late=call("mode-late",true);p.setInputMode(late);p.handleOnPause();p.acknowledge(null);p.handleOnResume();check(late.error!=null&&!p.captureEnabled&&p.allocations==0&&p.paused,"late foreground-service ack reopens microphone");clean(p);});
      run("initial-service-denial-releases-capture-for-explicit-retry",()->{var p=new VoiceNativeLifecycleCheck();p.context.failStart=true;var denied=call("service-denied",true);p.start(denied);check(!p.running&&denied.error!=null&&p.recorder==null,"service launch denial retains microphone/session");
        p.context.failStart=false;var retry=call("service-retry",true);p.start(retry);check(p.running&&retry.resolved,"service denial strands capture lease");clean(p);});
      run("resume-rechecks-permission-privacy-and-focus",()->{for(int branch=0;branch<3;branch++){var p=new VoiceNativeLifecycleCheck();p.start(call("voice",true));p.handleOnPause();p.handleOnResume();
        if(branch==0)p.permission=PermissionState.DENIED;else if(branch==1)p.manager.microphoneMuted=true;else p.manager.focusDenied=true;
        var c=call("resume",true);p.resume(c);check(c.error!=null&&p.paused&&!c.resolved,"resume bypasses permission/privacy/focus denial "+branch);clean(p);}});
      }
    }
    for(var row:scenarios.entrySet())System.out.println("SCENARIO|"+row.getKey()+"|"+row.getValue()[0]+"|"+row.getValue()[1]+"|"+row.getValue()[2]);
    for(String failure:failures)System.out.println("FAIL|"+failure);
    System.out.println("TOTAL|"+checks+"|"+scenarios.values().stream().mapToInt(v->v[2]).sum());
    if(scenarios.values().stream().anyMatch(v->v[2]>0))System.exit(1);
  }
}
`;
const out = join(evidence, mode), javaFile = join(out, 'VoiceNativeLifecycleCheck.java');
writeFileSync(javaFile, java);
const javaHome = process.env.JAVA_HOME || (existsSync('D:/Java/jdk-21') ? 'D:/Java/jdk-21' : '');
const executable = name => javaHome ? join(javaHome, 'bin', process.platform === 'win32' ? `${name}.exe` : name) : name;
const helpers = ['AudioSessionAuthority', 'AudioCaptureLease', 'VoiceCallServiceSessions', 'AudioCleanup', 'AudioRouteLoss', 'AudioDefaultRoute']
  .map(name => `android/app/src/main/java/com/virtugene/app/plugins/${name}.java`);
const compile = spawnSync(executable('javac'), ['-encoding', 'UTF-8', '-d', out, ...helpers, javaFile], { encoding: 'utf8', timeout: 30000 });
writeFileSync(join(out, 'javac.txt'), (compile.stdout ?? '') + (compile.stderr ?? '') + (compile.error ?? ''));
assert.equal(compile.status, 0, compile.stderr || String(compile.error));
const result = spawnSync(executable('java'), ['-cp', out, 'com.virtugene.app.plugins.VoiceNativeLifecycleCheck'], { encoding: 'utf8', timeout: 30000 });
writeFileSync(join(out, 'result.txt'), (result.stdout ?? '') + (result.stderr ?? '') + (result.error ?? ''));
const rows = (result.stdout ?? '').trim().split(/\r?\n/);
const total = rows.find(row => row.startsWith('TOTAL|'))?.split('|');
assert.ok(total, result.stderr || String(result.error));
const report = {
  mode, passed: result.status === 0, checks: Number(total[1]), failedChecks: Number(total[2]), roundsPerScenario: 30,
  scenarios: rows.filter(row => row.startsWith('SCENARIO|')).map(row => { const [, name, rounds, checks, failed] = row.split('|'); return { name, rounds: Number(rounds), checks: Number(checks), failed: Number(failed) }; }),
  failures: rows.filter(row => row.startsWith('FAIL|')).map(row => row.slice(5)),
  cwd: root, actualExecutionModel: '未确认', actualReasoningStrength: '未确认', realApiCalls: 0, businessModelTokens: 0, realMicrophoneUsed: false,
  androidRuntimeExecuted: false, apkBuiltOrInstalled: false,
  extractedProductionMethods: extracted,
  sourceSha256: createHash('sha256').update(source).digest('hex'),
  productionHelpers: helpers.map(path => ({ path, sha256: createHash('sha256').update(readFileSync(path)).digest('hex') })),
  limitations: ['JVM doubles execute extracted production methods; Android permission windows, Activity callback delivery, AMS foreground eligibility and OEM behavior are not executed.',
    'AudioRecord/AudioTrack, focus, notification/service OS operations, resource allocation and capture threads are doubled; this is neither physical sound nor microphone/Android verification.',
    'The existing live-call safety policy pauses and cancels a pending text-to-voice switch on Activity pause; foreground return does not automatically resume that live call.',
    'No same-condition before/after screenshot or recording. No emulator binary/system image/AVD found in the local SDK.'],
};
writeFileSync(join(evidence, `${mode}.json`), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ mode, passed: report.passed, checks: report.checks, failedChecks: report.failedChecks, scenarios: report.scenarios.length, report: join(evidence, `${mode}.json`) }));
process.exitCode = result.status ?? 1;
