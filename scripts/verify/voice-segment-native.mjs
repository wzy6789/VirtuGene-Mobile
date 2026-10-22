import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
const dir = '.tmp-preview/voice-segment-playback-20261015';
for (const mode of ['before', 'after']) {
  const source = readFileSync(mode === 'before' ? `${dir}/before/VoiceCallAudioPlugin.java` : 'android/app/src/main/java/com/virtugene/app/plugins/VoiceCallAudioPlugin.java', 'utf8');
  const start = source.indexOf('@PluginMethod public void drain('), end = source.indexOf('private JSObject stopOutput()', start);
  const method = source.slice(start,end).replace('@PluginMethod ', '');
  const java = `import java.util.*;
public class SegmentDrainCheck {
  static int checks, invalidRejected; static long now;
  static void check(boolean ok) { checks++; if(!ok)throw new AssertionError("check "+checks); }
  static class SystemClock { static long elapsedRealtime(){return now;} }
  static class Build { static class VERSION { static int SDK_INT=31; } }
  static class Thread { static void sleep(long ms){now+=ms;} }
  static class JSObject extends HashMap<String,Object> {
    Object opt(String key){return get(key);} boolean has(String key){return containsKey(key);}
    public Object put(String key,Object value){return super.put(key,value);}
  }
  static class PluginCall {
    JSObject data=new JSObject(), result; String error; boolean failResolve,failReject;
    String getString(String key){return "turn";} JSObject getData(){return data;}
    void resolve(JSObject value){if(failResolve)throw new IllegalStateException("disposed bridge");result=value;} void reject(String reason){if(failReject)throw new IllegalStateException("disposed bridge");error=reason;}
  }
  static class AudioTrack { int rate=24000; boolean stalled; int getSampleRate(){return rate;}
    int getStartThresholdInFrames(){return rate/25;} int getBufferSizeInFrames(){return rate/10;}
    int setStartThresholdInFrames(int n){return n;} int setBufferSizeInFrames(int n){return n;} }
  static class Executor { Runnable pending; void execute(Runnable r){pending=r;} }
  Object lock=new Object(); AudioTrack track=new AudioTrack(); Executor output=new Executor();
  long epoch=1,writtenFrames=1200,initialHead=600; boolean paused,running=true; String playbackTurn="turn";
  PluginCall pendingDrainCall; Long pendingDrainTarget; long pendingDrainEpoch,pendingDrainStartedAt;
  int tailRestoreThreshold,tailRestoreBuffer;
  boolean owns(PluginCall call){return true;} long head(AudioTrack active){return Math.min(writtenFrames,initialHead+(active.stalled?0:now*active.rate/1000));}
  void putPlaybackObservation(JSObject value, AudioTrack active){}
  void queueStartupPadding(AudioTrack active,long target,int threshold){}
  ${method}
  void settle(PluginCall call){${mode==='after'?'for(int step=0;step<1000&&call.result==null&&call.error==null;step++){now+=20;checkDrainProgress(head(track));}':'output.pending.run();'}}
  static PluginCall target(Object target){PluginCall c=new PluginCall();c.data.put("throughFrame",target);return c;}
  public static void main(String[] args){
    for(int rate:new int[]{8000,24000}){
      now=0;SegmentDrainCheck p=new SegmentDrainCheck();p.track.rate=rate;
      PluginCall c=target(600L);p.drain(c);p.settle(c);
      check(c.error==null&&c.result!=null);
      check(${mode==='after'?'now==0 && ((Number)c.result.get("playedFrames")).longValue()==600 && ((Number)c.result.get("throughFrame")).longValue()==600':'now>0 && !c.result.containsKey("throughFrame")'});
      check(((Number)c.result.get("writtenFrames")).longValue()==1200);
      now=0;p=new SegmentDrainCheck();p.track.rate=rate;c=new PluginCall();p.drain(c);p.settle(c);
      check(c.result!=null&&((Number)c.result.get("playedFrames")).longValue()==1200&&now>0);
      now=0;p=new SegmentDrainCheck();c=target(900);p.drain(c);p.epoch++;p.settle(c);
      check(c.result==null&&"voice:stale_or_stalled_audio".equals(c.error));
      now=0;p=new SegmentDrainCheck();c=target(900);p.drain(c);p.paused=true;p.settle(c);
      check(c.result==null&&"voice:stale_or_stalled_audio".equals(c.error));
    }
    for(Object value:new Object[]{-1,1.5,"600",null,Double.NaN,Double.POSITIVE_INFINITY,1201,Long.MAX_VALUE}){
      now=0;SegmentDrainCheck p=new SegmentDrainCheck();PluginCall c=target(value);p.drain(c);
      if(c.error!=null)invalidRejected++;
      check(${mode==='after'?'"voice:invalid_drain_target".equals(c.error)&&p.output.pending==null':'c.error==null&&p.output.pending!=null'});
    }
    now=0;SegmentDrainCheck waiting=new SegmentDrainCheck();PluginCall boundary=target(900);waiting.drain(boundary);
    // A following append shares the output worker. Run anything already ahead of it.
    if(waiting.output.pending!=null)waiting.output.pending.run();long appendCanRunAt=now;
    check(${mode==='after'?'appendCanRunAt==0 && boundary.result==null':'appendCanRunAt>0 && boundary.result!=null'});
    now=0;SegmentDrainCheck disposed=new SegmentDrainCheck();PluginCall broken=target(900);broken.failResolve=true;disposed.drain(broken);
    boolean escaped=false;try{disposed.settle(broken);}catch(RuntimeException error){escaped=true;}check(!escaped&&broken.error!=null);
    now=0;SegmentDrainCheck stalled=new SegmentDrainCheck();stalled.track.stalled=true;PluginCall timeout=target(900);stalled.drain(timeout);stalled.settle(timeout);
    check(timeout.result==null&&"voice:stale_or_stalled_audio".equals(timeout.error)&&now>=15000);
    ${mode==='after'?`
    now=0;SegmentDrainCheck active=new SegmentDrainCheck();PluginCall first=target(1000),second=target(900);active.drain(first);active.drain(second);
    check("voice:drain_pending".equals(second.error)&&active.pendingDrainCall==first);active.settle(first);
    check(first.result!=null&&((Number)first.result.get("throughFrame")).longValue()==1000);
    now=0;active=new SegmentDrainCheck();PluginCall cancelled=target(900);active.drain(cancelled);active.cancelDrain("voice:stale_or_stalled_audio");active.checkDrainProgress(1200);
    check(active.pendingDrainCall==null&&cancelled.result==null&&cancelled.error!=null);
    now=0;active=new SegmentDrainCheck();PluginCall disposedCancel=target(900);active.drain(disposedCancel);disposedCancel.failReject=true;active.cancelDrain("voice:stale_or_stalled_audio");
    check(active.pendingDrainCall==null);
    `:''}
    System.out.println(checks+":"+invalidRejected);
  }
}`;
  const out=`${dir}/native-${mode}`;mkdirSync(out,{recursive:true});writeFileSync(`${out}/SegmentDrainCheck.java`,java);
  const home=process.env.JAVA_HOME||(existsSync('D:/Java/jdk-21')?'D:/Java/jdk-21':'');const bin=name=>home?join(home,'bin',`${name}.exe`):name;
  const compile=spawnSync(bin('javac'),['-d',out,`${out}/SegmentDrainCheck.java`],{encoding:'utf8'});assert.equal(compile.status,0,compile.stderr);
  const run=spawnSync(bin('java'),['-cp',out,'SegmentDrainCheck'],{encoding:'utf8'});assert.equal(run.status,0,run.stderr);
  const [checks,invalidRejected]=run.stdout.trim().split(':').map(Number);
  const report={mode,checks,invalidRejected,apiCalls:0,scope:'Actual production Java drain method with JVM clock/track/call/executor doubles; no Android runtime or audio'};
  writeFileSync(`${dir}/native-${mode}.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}
