import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const dir = '.tmp-preview/voice-buffer-integration-20261016', before = process.argv.includes('--before');
const source = readFileSync(before ? `${dir}/before/VoiceCallAudioPlugin.java` : 'android/app/src/main/java/com/virtugene/app/plugins/VoiceCallAudioPlugin.java', 'utf8');
function method(marker) {
  const start = source.indexOf(marker); if (start < 0) return '';
  let cursor = source.indexOf('{', start), depth = 1;
  for (let i = cursor + 1; i < source.length; i++) { if (source[i] === '{') depth++; if (source[i] === '}' && !--depth) return source.slice(start, i + 1); }
  throw Error(marker);
}
const tune = method('@PluginMethod public void tunePlaybackBuffer(');
const java = `import java.util.*;
public class BufferTuningCheck {
 @interface PluginMethod {} static class Build { static class VERSION { static int SDK_INT=31; } }
 static class JSObject extends HashMap<String,Object>{Object opt(String k){return get(k);}}
 static class PluginCall {JSObject data=new JSObject(),result;String error;String getString(String k){return "turn";}JSObject getData(){return data;}void resolve(JSObject v){result=v;}void reject(String e){error=e;}}
 static class AudioTrack {
  int rate=24000, threshold=960, buffer=2400, sets;boolean fail;
  int getSampleRate(){return rate;}int getStartThresholdInFrames(){if(fail)throw new IllegalStateException();return threshold;}
  int getBufferSizeInFrames(){return buffer;}int setStartThresholdInFrames(int n){if(n<=0)throw new AssertionError("zero threshold");sets++;return threshold=Math.min(n,buffer);}
 }
 Object lock=new Object();boolean paused,owned=true,validRoute=true;AudioTrack track=new AudioTrack();String playbackTurn="turn";
 long writtenFrames,queuedBytes,played,routeGeneration=7;
 boolean owns(PluginCall c){return owned;}boolean verifyActiveRoute(){return validRoute;}long head(AudioTrack t){return played;}
 void putPlaybackObservation(JSObject o,AudioTrack t){o.put("routeGeneration",routeGeneration);o.put("sampleRate",t.rate);o.put("startThresholdFrames",t.threshold);}
 ${tune || 'void tunePlaybackBuffer(PluginCall c){c.resolve(new JSObject());}'}
 static int checks;static void check(boolean ok,String m){checks++;if(!ok)throw new AssertionError(m);}
 static PluginCall request(Object ms,Object route){PluginCall c=new PluginCall();c.data.put("targetMs",ms);c.data.put("routeGeneration",route);return c;}
 public static void main(String[]args){
  for(int round=0;round<30;round++){
   for(int sdk:new int[]{24,30,31,36})for(int rate:new int[]{8000,24000})for(int cap:new int[]{100,180})for(int target:new int[]{40,60,80,160}){
    Build.VERSION.SDK_INT=sdk;BufferTuningCheck h=new BufferTuningCheck();h.track.rate=rate;h.track.threshold=rate*40/1000;h.track.buffer=rate*cap/1000;
    PluginCall c=request(target,7);h.tunePlaybackBuffer(c);
    check(c.result!=null&&c.error==null,"valid current empty track tuning resolves");
    int expected=sdk>=31?rate*Math.min(target,cap)/1000:rate*40/1000;
    check(h.track.threshold==expected,"native tuning obeys requested bounded threshold and effective capacity");
    check(h.writtenFrames==0&&h.played==0,"tuning does not enqueue or certify sound");
   }
   Build.VERSION.SDK_INT=31;
   for(Object invalid:new Object[]{0,-1,39,161,60.5,"60",null,Double.NaN,Double.POSITIVE_INFINITY}){
    BufferTuningCheck h=new BufferTuningCheck();PluginCall c=request(invalid,7);h.tunePlaybackBuffer(c);check(c.error!=null&&h.track.sets==0,"invalid target cannot tune");
   }
   for(Object invalid:new Object[]{6,8,7.5,"7",null,Double.NaN}){
    BufferTuningCheck h=new BufferTuningCheck();PluginCall c=request(80,invalid);h.tunePlaybackBuffer(c);check(c.error!=null&&h.track.sets==0,"stale or malformed route cannot tune");
   }
   for(int mode=0;mode<6;mode++){
    BufferTuningCheck h=new BufferTuningCheck();if(mode==0)h.paused=true;if(mode==1)h.owned=false;if(mode==2)h.writtenFrames=1;if(mode==3)h.queuedBytes=1;if(mode==4)h.played=1;if(mode==5)h.validRoute=false;
    PluginCall c=request(80,7);h.tunePlaybackBuffer(c);check(c.error!=null&&h.track.sets==0,"lost authority or started track cannot tune");
   }
   BufferTuningCheck h=new BufferTuningCheck();h.track.threshold=4800;PluginCall c=request(80,7);h.tunePlaybackBuffer(c);
   check(c.result!=null&&h.track.threshold==4800,"unexpected OEM default is not lowered");
   h=new BufferTuningCheck();h.track.fail=true;c=request(80,7);h.tunePlaybackBuffer(c);check(c.result!=null&&h.track.sets==0,"unsupported getter retains platform setting");
  }
  System.out.println(checks);
 }
}`;
const name = before ? 'native-before' : 'native-after', out = `${dir}/${name}`;
mkdirSync(out, { recursive: true }); writeFileSync(`${out}/BufferTuningCheck.java`, java);
const compiled = spawnSync('javac', ['-encoding', 'UTF-8', '-d', out, `${out}/BufferTuningCheck.java`], { encoding: 'utf8' });
writeFileSync(`${out}/compile.txt`, compiled.stdout + compiled.stderr); assert.equal(compiled.status, 0, compiled.stderr);
const run = spawnSync('java', ['-cp', out, 'BufferTuningCheck'], { encoding: 'utf8' });
writeFileSync(`${out}/run.txt`, run.stdout + run.stderr);
const report = { checks: run.status === 0 ? Number(run.stdout.trim()) : undefined, exitCode: run.status,
  sourceHash: createHash('sha256').update(source).digest('hex'), androidRuntime: false, apiCalls: 0, microphone: false,
  scope: 'Actual native tunePlaybackBuffer method, constrained JVM AudioTrack/ownership/route doubles; no Android hardware.' };
writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report)); assert.equal(run.status, 0, run.stderr);
