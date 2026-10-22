import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import assert from 'node:assert/strict';
const dir = '.tmp-preview/voice-clock-route-20261015/native'; mkdirSync(dir, { recursive: true });
const source = readFileSync('android/app/src/main/java/com/virtugene/app/plugins/VoiceCallAudioPlugin.java', 'utf8');
function method(start) {
  const index = source.indexOf(start); assert.ok(index >= 0, start); const brace = source.indexOf('{', index); let depth = 1, cursor = brace + 1;
  while (depth && cursor < source.length) { if (source[cursor] === '{') depth++; if (source[cursor] === '}') depth--; cursor++; }
  return source.slice(index, cursor).replace('@PluginMethod ', '');
}
const java = `import java.util.*;
public class ClockRouteCheck {
  static int checks,batchBoundaries; static long now=10000000,nanosFraction;static double maxLegacyOvercountMs;
  static void check(boolean value){checks++;if(!value)throw new AssertionError("check "+checks);}
  static class SystemClock { static long elapsedRealtime(){return now;} static long elapsedRealtimeNanos(){return now*1000000+nanosFraction;} }
  static class Build {static class VERSION {static int SDK_INT=34;}}
  static class JSObject extends HashMap<String,Object> {
    Object opt(String key){return get(key);} boolean optBoolean(String key,boolean fallback){Object value=get(key);return value instanceof Boolean?(Boolean)value:fallback;}
  }
  static class PluginCall {
    JSObject data=new JSObject(),result;String error;boolean failResolve;
    PluginCall(Object sequence,Object generation){data.put("probeSequence",sequence);data.put("routeGeneration",generation);data.put("callId","call");}
    String getString(String key){return (String)data.get(key);} JSObject getData(){return data;}
    void resolve(JSObject data){if(failResolve)throw new IllegalStateException("disposed bridge");result=data;}void reject(String value){error=value;}
  }
  static class AudioDeviceInfo {int type; AudioDeviceInfo(int t){type=t;}int getType(){return type;}}
  static class AudioRecord {static final int RECORDSTATE_RECORDING=3; int state=3; AudioDeviceInfo route;boolean fail;
    int getRecordingState(){return state;}AudioDeviceInfo getRoutedDevice(){if(fail)throw new IllegalStateException();return route;}}
  static class AudioTrack {static final int PLAYSTATE_PLAYING=3;int state=3;long frames=1;AudioDeviceInfo route;boolean fail;String failedGetter="";
    int getPlaybackHeadPosition(){return getter("head",(int)frames);}
    int getPlayState(){return state;}AudioDeviceInfo getRoutedDevice(){if(fail)throw new IllegalStateException();return route;}
    int getter(String name,int value){if(failedGetter.equals(name))throw new IllegalStateException();return value;}
    int getSampleRate(){return getter("rate",8000);}int getBufferSizeInFrames(){return getter("buffer",1024);}
    int getUnderrunCount(){return getter("underrun",2);}int getStartThresholdInFrames(){return getter("threshold",256);}}
  static class AudioManager {AudioDeviceInfo communication;boolean fail;AudioDeviceInfo getCommunicationDevice(){if(fail)throw new IllegalStateException();return communication;}}
  Object lock=new Object();boolean running=true,paused=false;String callId="call";long routeGeneration=7,clockProbeSequence=0;
  AudioRecord recorder=new AudioRecord();AudioTrack track=new AudioTrack();AudioManager manager=new AudioManager();JSObject emitted;
  long writtenFrames;static class Padding {int frames(){return 0;}}Padding startupPadding=new Padding();
  boolean owns(PluginCall call){return running&&callId!=null&&callId.equals(call.getString("callId"));}
  long head(AudioTrack value){return value.frames;}
  void notifyListeners(String name,JSObject data,boolean retain){emitted=data;}
  ${method('private static Double captureSampleEndAt(')}
  ${method('private static Long captureBatchFrameEnd(')}
  ${method('@PluginMethod public void clockProbe(')}
  ${method('private JSObject routeObservation(')}
  ${method('private void putPlaybackObservation(')}
  ${method('private void event(')}
  static boolean flag(JSObject value,String key){return Boolean.TRUE.equals(value.get(key));}
  public static void main(String[] args){
    for(int round=0;round<30;round++){
      ClockRouteCheck p=new ClockRouteCheck(); PluginCall c=new PluginCall(1,7);p.clockProbe(c);
      check(c.result!=null&&((Number)c.result.get("nativeAtMs")).longValue()==now&&"call".equals(c.result.get("callId")));
      check(((Number)c.result.get("probeSequence")).intValue()==1&&((Number)c.result.get("routeGeneration")).intValue()==7);
      c=new PluginCall(1,7);p.clockProbe(c);check(c.result==null&&"voice:clock_owner".equals(c.error));
      c=new PluginCall(2,6);p.clockProbe(c);check(c.result==null&&"voice:clock_owner".equals(c.error));
      c=new PluginCall(2,7);c.data.put("callId","other");p.clockProbe(c);check(c.result==null&&"voice:clock_inactive".equals(c.error));
      p.paused=true;c=new PluginCall(2,7);p.clockProbe(c);check(c.result==null&&"voice:clock_inactive".equals(c.error));
      p.paused=false;p.routeGeneration++;c=new PluginCall(2,7);p.clockProbe(c);check(c.result==null);
      c=new PluginCall(2,8);p.clockProbe(c);check(c.result!=null);
      for(Object bad:new Object[]{0,-1,1.5,"3",null,Double.NaN,Double.POSITIVE_INFINITY,9007199254740992d}){
        c=new PluginCall(bad,8);p.clockProbe(c);check(c.result==null&&"voice:clock_owner".equals(c.error));
      }
      p=new ClockRouteCheck();p.manager.communication=new AudioDeviceInfo(7);
      JSObject evidence=p.routeObservation();check(!flag(evidence,"inputObserved")&&!flag(evidence,"outputObserved")&&flag(evidence,"communicationObserved"));
      check(!evidence.containsKey("inputType")&&!evidence.containsKey("outputType"));
      p.recorder.route=new AudioDeviceInfo(7);p.track.route=new AudioDeviceInfo(7);evidence=p.routeObservation();
      check(flag(evidence,"inputObserved")&&flag(evidence,"outputObserved")&&((Number)evidence.get("inputType")).intValue()==7);
      check(((Number)evidence.get("observedAtMs")).longValue()==now&&((Number)evidence.get("routeGeneration")).longValue()==7);
      check(evidence.keySet().stream().allMatch(key->Set.of("inputObserved","outputObserved","communicationObserved","inputType","outputType","communicationType","observedAtMs","routeGeneration").contains(key)));
      p.track.frames=0;check(!flag(p.routeObservation(),"outputObserved"));p.track.frames=1;p.recorder.state=1;check(!flag(p.routeObservation(),"inputObserved"));
      p.recorder.state=3;p.recorder.fail=true;check(!flag(p.routeObservation(),"inputObserved")&&flag(p.routeObservation(),"outputObserved"));
      p.recorder.fail=false;p.track.fail=true;p.manager.fail=true;evidence=p.routeObservation();check(flag(evidence,"inputObserved")&&!flag(evidence,"outputObserved")&&!flag(evidence,"communicationObserved"));
      p.paused=true;evidence=p.routeObservation();check(!flag(evidence,"inputObserved")&&!flag(evidence,"outputObserved")&&!flag(evidence,"communicationObserved"));
      p.paused=false;p.track.fail=false;p.manager.fail=false;JSObject data=new JSObject();data.put("first",true);p.event("playback",data);
      check(p.emitted.containsKey("routeObservation")&&((Number)p.emitted.get("at")).longValue()==now);
      data=new JSObject();data.put("first",false);p.event("playback",data);check(!p.emitted.containsKey("routeObservation"));
      Build.VERSION.SDK_INT=29;check(!flag(p.routeObservation(),"communicationObserved"));Build.VERSION.SDK_INT=34;
      for(int api:new int[]{22,23,24,30,31,34}){
        Build.VERSION.SDK_INT=api;JSObject output=new JSObject();p.putPlaybackObservation(output,p.track);
        check(((Number)output.get("sampleRate")).intValue()==8000&&((Number)output.get("routeGeneration")).longValue()==7);
        check(output.containsKey("bufferFrames")== (api>=23));check(output.containsKey("underrunCount")== (api>=24));check(output.containsKey("startThresholdFrames")== (api>=31));
      }
      Build.VERSION.SDK_INT=34;
      for(String getter:new String[]{"rate","buffer","underrun","threshold","head"}){
        p.track.failedGetter=getter;JSObject output=new JSObject();p.putPlaybackObservation(output,p.track);
        String missing=getter.equals("rate")?"sampleRate":getter.equals("buffer")?"bufferFrames":getter.equals("underrun")?"underrunCount":getter.equals("head")?"nativeQueuedFrames":"startThresholdFrames";
        check(!output.containsKey(missing)&&output.size()==6&&((Number)output.get("startupPaddingFrames")).intValue()==0);
      }
      p.track.failedGetter="";JSObject unavailable=new JSObject();p.putPlaybackObservation(unavailable,null);check(unavailable.size()==1&&unavailable.containsKey("routeGeneration"));
      for(int rate:new int[]{8000,16000}){
        long frames=rate*2;Double end=captureSampleEndAt(frames,frames+rate/10,100100000000L,rate,100000);
        check(end!=null&&Math.abs(end-100000)<0.001);
        check(captureSampleEndAt(frames,frames,0,rate,100000)==null);
        check(captureSampleEndAt(frames,frames,101000000000L,rate,100000)==null);
        check(captureSampleEndAt(frames,frames,99000000000L,rate,100000)==null);
        int[] reads=rate==8000?new int[]{79,117,33,160,145,99,152}:new int[]{199,277,51,320,145,299,152};
        long readEnd=0;int batch=0,emitted=0,partial=0;int multiplier=rate==8000?2:1;
        for(int block=0;block<50;block++){
          int raw=reads[block%reads.length];readEnd+=raw;
          for(int sample=1;sample<=raw*multiplier;sample++){
            if(++batch==1600){
              Long boundary=captureBatchFrameEnd(readEnd,raw,sample,rate);emitted++;
              check(boundary!=null&&boundary==emitted*(long)(1600/multiplier));
              batchBoundaries++;maxLegacyOvercountMs=Math.max(maxLegacyOvercountMs,(readEnd-boundary)*1000.0/rate);
              if(readEnd>boundary)partial++;
              batch=0;
            }
          }
        }
        check(partial>0&&emitted>2);
        if(rate==8000)check(captureBatchFrameEnd(1000,160,1,rate)==null);
      }
    }
    ClockRouteCheck fraction=new ClockRouteCheck();PluginCall precise=new PluginCall(1,7);nanosFraction=750000;fraction.clockProbe(precise);
    check(Math.abs(((Number)precise.result.get("nativeAtMs")).doubleValue()-(now+0.75))<0.001);
    PluginCall disposed=new PluginCall(2,7);disposed.failResolve=true;fraction.clockProbe(disposed);check(fraction.running&&!fraction.paused);
    System.out.println(checks+":"+batchBoundaries+":"+maxLegacyOvercountMs);
  }
}`;
writeFileSync(`${dir}/ClockRouteCheck.java`, java);
const javaHome = process.env.JAVA_HOME || (existsSync('D:/Java/jdk-21') ? 'D:/Java/jdk-21' : ''); const bin = name => javaHome ? join(javaHome, 'bin', `${name}.exe`) : name;
const compile = spawnSync(bin('javac'), ['-encoding', 'UTF-8', '-d', dir, `${dir}/ClockRouteCheck.java`], { encoding: 'utf8' }); assert.equal(compile.status, 0, compile.stderr);
const run = spawnSync(bin('java'), ['-cp', dir, 'ClockRouteCheck'], { encoding: 'utf8' }); assert.equal(run.status, 0, run.stderr);
const [checks, shortReadBatchBoundaries, maxUncorrectedReadTailMs] = run.stdout.trim().split(':').map(Number);
const report = { checks, shortReadBatchBoundaries, maxUncorrectedReadTailMs, correctedBatchFrameError: 0, apiCalls: 0, rounds: 30, scope: 'Actual Java clockProbe/routeObservation/event/capture estimate/batch boundary/playback getter methods with JVM device/clock/call doubles; not Android runtime or acoustic evidence' };
writeFileSync(`${dir}/../native.json`, JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
