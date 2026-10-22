import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const dir = '.tmp-preview/voice-route-recovery-20261016/native'; mkdirSync(dir, { recursive: true });
const path = 'android/app/src/main/java/com/virtugene/app/plugins/VoiceCallAudioPlugin.java';
const source = readFileSync(path, 'utf8');
function method(marker) {
  const start = source.indexOf(marker); assert.ok(start >= 0, marker);
  let p = source.indexOf('{', start), depth = 1;
  for (let i = p + 1; i < source.length; i++) { if (source[i] === '{') depth++; if (source[i] === '}' && !--depth) return source.slice(start, i + 1); }
  throw Error(`Unclosed ${marker}`);
}
const extracted = ['private long claimRouteRequest(', '@PluginMethod public void cancelRouteRequest(',
  '@PluginMethod public void setRoute(', 'private void cancelRoute(String reason)'].map(method).join('\n');
const java = `import java.util.*;
public class RouteRecoveryCheck {
 @interface PluginMethod {}
 static class JSObject extends HashMap<String,Object> { Object opt(String k){return get(k);} }
 static class PluginCall { final JSObject data=new JSObject(); JSObject result; String error; boolean throwReject;
  PluginCall(long session,long request){data.put("callId","call");data.put("routeControlSession",session);data.put("requestId",request);}
  JSObject getData(){return data;} int getInt(String k,int d){return data.get(k) instanceof Number?((Number)data.get(k)).intValue():d;}
  String getString(String k){return (String)data.get(k);} void reject(String e){error=e;if(throwReject)throw new IllegalStateException("disposed");}
  void resolve(JSObject v){result=v;}
 }
 static class Build { static class VERSION {static int SDK_INT=36;} }
 static class SystemClock {static long now;static long elapsedRealtime(){return now;} }
 static class AudioDeviceInfo {static final int TYPE_BUILTIN_SPEAKER=2, TYPE_BLUETOOTH_SCO=7;int id,type;
  AudioDeviceInfo(int i,int t){id=i;type=t;} int getId(){return id;} int getType(){return type;}}
 static class AudioManager { static final int GET_DEVICES_OUTPUTS=2;AudioDeviceInfo current;boolean accept=true;int setCalls,clearCalls,speakerCalls;
  AudioDeviceInfo[] devices={new AudioDeviceInfo(1,1),new AudioDeviceInfo(2,2),new AudioDeviceInfo(7,7)};
  AudioDeviceInfo getCommunicationDevice(){return current;} AudioDeviceInfo[] getAvailableCommunicationDevices(){return devices;}
  boolean setCommunicationDevice(AudioDeviceInfo d){setCalls++;return accept;} void clearCommunicationDevice(){clearCalls++;current=null;}
  AudioDeviceInfo[] getDevices(int kind){return devices;} boolean isBluetoothScoAvailableOffCall(){return true;} void setSpeakerphoneOn(boolean b){speakerCalls++;}
 }
 static class Recorder {int stops;void stop(){stops++;}}
 static class Handler {List<Runnable> pending=new ArrayList<>();void post(Runnable r){pending.add(r);}void postDelayed(Runnable r,long ms){pending.add(r);}void removeCallbacks(Runnable r){pending.removeIf(x->x==r);}}
 static class Harness {final Object lock=new Object(); final AudioManager manager=new AudioManager();final Handler main=new Handler();
  PluginCall pendingRouteCall;Runnable routeConfirmation; boolean selectingRoute,paused=true,running=true,captureEnabled;
  long routeControlSession=10,routeRequestHighWater,cancelledRouteRequest,routeGeneration,scoGeneration;
  int outputCleanupFailures,captureCleanupFailures,confirmedCommunication,stops,scoStops,explicitSelections,resumeCancellations;boolean legacyScoRequested,legacyScoConnected;Recorder recorder=new Recorder();
  boolean owns(PluginCall c){return running&&"call".equals(c.getString("callId"));}
  JSObject routes(){JSObject v=new JSObject();v.put("routeControlSession",routeControlSession);v.put("routeGeneration",routeGeneration);return v;}
  void cancelPendingResume(String reason){resumeCancellations++;}
  void stopOutput(){stops++;} void suspend(String reason){if(!running||paused)return;cancelRoute("voice:route_failed");paused=true;stopOutput();recorder.stop();}
  void startLegacySco(){legacyScoRequested=true;scoGeneration++;}void stopLegacySco(){legacyScoRequested=legacyScoConnected=false;scoGeneration++;scoStops++;}
  void replaceCapture(int rate){} void rememberExplicitRoute(int id){explicitSelections++;}
  AudioDeviceInfo findOutput(AudioDeviceInfo[] rows,int type){for(AudioDeviceInfo d:rows)if(d.type==type)return d;return null;}
  AudioDeviceInfo legacySystemOutput(AudioDeviceInfo[] rows){return rows[0];}
  ${extracted}
 }
 static int checks;
 static void check(boolean v,String label){checks++;if(!v)throw new AssertionError(label);}
 static PluginCall route(Harness h,long id,int device){PluginCall c=new PluginCall(h.routeControlSession,id);c.data.put("deviceId",device);h.setRoute(c);return c;}
 public static void main(String[] args){
  for(int round=0;round<30;round++){
   Build.VERSION.SDK_INT=36; SystemClock.now=0;
   Harness h=new Harness();PluginCall pending=route(h,1,7);Runnable old=h.routeConfirmation;
   check(pending.error==null&&h.pendingRouteCall==pending,"valid async route is pending even while audio paused");
   PluginCall cancel=new PluginCall(10,1);h.cancelRouteRequest(cancel);
   check(h.pendingRouteCall==null&&h.routeConfirmation==null&&h.main.pending.isEmpty(),"cancel removes pending owner and callbacks");
   check("voice:route_cancelled".equals(pending.error)&&cancel.result!=null,"both cancelled operation and cancellation acknowledgement are honest");
   check(h.paused&&h.stops==2&&h.recorder.stops==1&&h.manager.speakerCalls==0,"already-paused cancel still flushes and never implicitly selects speaker");
   old.run();check(h.manager.setCalls==1&&h.pendingRouteCall==null,"late route poll cannot reacquire authority");
   Harness busy=new Harness();PluginCall original=route(busy,1,7);Runnable originalPoll=busy.routeConfirmation;
   PluginCall duplicateWhileBusy=route(busy,2,1);
   check("voice:route_pending".equals(duplicateWhileBusy.error)&&busy.routeRequestHighWater==1,"rejected busy request cannot consume current selection ownership");
   busy.manager.current=busy.manager.devices[2];originalPoll.run();
   check(original.result!=null&&original.error==null,"first in-flight route still confirms after rejected overlapping selection");
   PluginCall laterCancel=new PluginCall(10,1);busy.cancelRouteRequest(laterCancel);
   check(laterCancel.result!=null&&busy.paused,"first request remains cancellable after busy rejection");
   PluginCall duplicate=new PluginCall(10,1);int stops=h.stops;h.paused=false;h.cancelRouteRequest(duplicate);
   check(duplicate.result!=null&&!h.paused&&h.stops==stops,"duplicate old cancellation cannot pause a recovered session");
   int resumeCancels=h.resumeCancellations;
   PluginCall cancelledSet=route(h,1,7);check(h.resumeCancellations==resumeCancels,"rejected stale route cannot cancel a newer pending recovery");check("voice:route_cancelled".equals(cancelledSet.error),"cancel-before-set tombstone blocks replay");
   PluginCall current=route(h,2,1);Runnable fresh=h.routeConfirmation;
   PluginCall older=new PluginCall(10,1);h.cancelRouteRequest(older);
   check("voice:route_cancelled".equals(older.error)&&h.pendingRouteCall==current&&!h.paused,"older cancel cannot alter newer route");
   h.manager.current=h.manager.devices[0];fresh.run();check(current.result!=null&&h.pendingRouteCall==null,"newer request can confirm normally");
   PluginCall foreign=new PluginCall(9,3);h.cancelRouteRequest(foreign);check(foreign.error!=null&&!h.paused,"same callId with old native session cannot cancel replacement");
   for(Object invalid:new Object[]{-1,0,1.5,Double.NaN,Double.POSITIVE_INFINITY,9007199254740992d,"3",null}){
    PluginCall bad=new PluginCall(10,3);bad.data.put("requestId",invalid);int before=h.stops;h.cancelRouteRequest(bad);
    check(bad.error!=null&&h.stops==before&&!h.paused,"invalid cancellation leaves current audio authority alone");
   }
   Harness cancelFirst=new Harness();cancelFirst.cancelRouteRequest(new PluginCall(10,5));PluginCall late=route(cancelFirst,5,7);
   check(late.error!=null&&cancelFirst.manager.setCalls==0,"native cancellation received before delayed setRoute is permanent");
   Harness disposed=new Harness();PluginCall disposedPending=route(disposed,1,7);disposedPending.throwReject=true;
   PluginCall confirmed=new PluginCall(10,1);disposed.cancelRouteRequest(confirmed);
   check(confirmed.result!=null&&disposed.paused&&disposed.pendingRouteCall==null,"disposed pending bridge cannot break cancellation cleanup");
   Harness cleanup=new Harness();cleanup.outputCleanupFailures=1;PluginCall failed=new PluginCall(10,1);cleanup.cancelRouteRequest(failed);
   check("voice:audio_release_failed".equals(failed.error)&&cleanup.paused&&failed.result==null,"unconfirmed cleanup never reports cancellation success");
   Build.VERSION.SDK_INT=30;Harness legacy=new Harness();PluginCall sco=route(legacy,1,-3);
   check(sco.result!=null&&legacy.legacyScoRequested,"legacy request retains its asynchronous SCO setup");
   long generation=legacy.scoGeneration;legacy.cancelRouteRequest(new PluginCall(10,1));
   check(!legacy.legacyScoRequested&&legacy.scoGeneration>generation&&legacy.paused&&legacy.manager.speakerCalls==0,"legacy cancel stops SCO generation without phone fallback");
  }
  System.out.println("{\\"checks\\":"+checks+",\\"rounds\\":30,\\"apiCalls\\":0,\\"androidRuntime\\":false}");
 }
}`;
writeFileSync(`${dir}/RouteRecoveryCheck.java`, java);
const compile = spawnSync('javac', ['-encoding','UTF-8','-d',dir,`${dir}/RouteRecoveryCheck.java`], { encoding:'utf8', timeout:30000 });
writeFileSync(`${dir}/compile.txt`, compile.stdout+compile.stderr); assert.equal(compile.status,0,compile.stderr||String(compile.error));
const run = spawnSync('java',['-cp',dir,'RouteRecoveryCheck'],{encoding:'utf8',timeout:30000});
writeFileSync(`${dir}/run.txt`,run.stdout+run.stderr);assert.equal(run.status,0,run.stderr||String(run.error));
const report={...JSON.parse(run.stdout),sourceHash:createHash('sha256').update(source).digest('hex'),
 scope:'Actual Java route request/claim/cancel/poll methods, OS AudioManager/Handler/recorder doubles; not Android or physical sound.'};
writeFileSync(`${dir}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
