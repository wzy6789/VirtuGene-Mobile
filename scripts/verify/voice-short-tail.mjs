import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const dir='.tmp-preview/voice-short-tail-20261016', frozen=process.argv.includes('--before');
const before=frozen&&!process.argv.includes('--require-fix');
const source=readFileSync(frozen?`${dir}/before/VoiceCallAudioPlugin.java`:'android/app/src/main/java/com/virtugene/app/plugins/VoiceCallAudioPlugin.java','utf8');
function method(marker){const start=source.indexOf(marker);if(start<0)return '';let i=source.indexOf('{',start),depth=1;for(let e=i+1;e<source.length;e++){if(source[e]==='{')depth++;if(source[e]==='}'&&!--depth)return source.slice(start,e+1);}throw Error(marker);}
const methods=['@PluginMethod public void drain(','private void checkDrainProgress(','private void cancelDrain(',
 'private void releaseShortSegment(','private void restoreShortSegmentBuffer('].map(method).join('\n');
const java=`import java.util.*;
public class ShortTailCheck {
 @interface PluginMethod {} static class Build {static class VERSION {static int SDK_INT=36;}}
 static class SystemClock {static long now;static long elapsedRealtime(){return now;}}
 static class JSObject extends HashMap<String,Object>{Object opt(String k){return get(k);}boolean has(String k){return containsKey(k);}}
 static class PluginCall {JSObject data=new JSObject(),result;String error;String getString(String k){return "turn";}JSObject getData(){return data;}void resolve(JSObject v){result=v;}void reject(String e){error=e;}}
 static class AudioTrack {int rate,threshold,buffer,minimum=1,sets,writes;long written,played;boolean fails,stalled;
  AudioTrack(int rate,int frames){this.rate=rate;threshold=rate/25;buffer=rate/10;written=frames;}
  int getSampleRate(){return rate;}int getStartThresholdInFrames(){if(fails)throw new IllegalStateException();return threshold;}
  int getBufferSizeInFrames(){if(fails)throw new IllegalStateException();return buffer;}
  int setStartThresholdInFrames(int n){if(fails)throw new IllegalStateException();if(n<=0)throw new AssertionError("zero threshold");sets++;return threshold=n;}
  int setBufferSizeInFrames(int n){if(fails)throw new IllegalStateException();if(n<=0)throw new AssertionError("zero buffer");sets++;return buffer=Math.max(minimum,n);}
  void tick(){int start=Build.VERSION.SDK_INT>=31?Math.min(threshold,buffer):buffer;if(!stalled&&written-played>=start)played=written;}
 }
 final Object lock=new Object();AudioTrack track;long epoch=1,writtenFrames;boolean running=true,paused;String playbackTurn="turn";
 PluginCall pendingDrainCall;Long pendingDrainTarget;long pendingDrainEpoch,pendingDrainStartedAt;int tailRestoreThreshold,tailRestoreBuffer;
 boolean owns(PluginCall c){return true;}long head(AudioTrack t){return t.played;}void putPlaybackObservation(JSObject o,AudioTrack t){}
 // Threshold-only fixture. Queued legacy fallback has its own actual-writer integration verifier.
 void queueStartupPadding(AudioTrack t,long target,int threshold){}
 ${methods}
 ${source.includes('private void restoreShortSegmentBuffer(')?'':'private void restoreShortSegmentBuffer(AudioTrack active) {}'}
 static int checks;static void check(boolean b,String m){checks++;if(!b)throw new AssertionError(m);}
 static ShortTailCheck fixture(int rate,int ms){ShortTailCheck h=new ShortTailCheck();h.track=new AudioTrack(rate,rate*ms/1000);h.writtenFrames=h.track.written;return h;}
 static PluginCall target(long n){PluginCall c=new PluginCall();c.data.put("throughFrame",n);return c;}
 static void settle(ShortTailCheck h,PluginCall c){for(int i=0;i<4&&c.result==null&&c.error==null;i++){SystemClock.now+=20;h.track.tick();h.checkDrainProgress(h.head(h.track));}}
 public static void main(String[]args){
 for(int round=0;round<30;round++)for(int sdk:new int[]{24,30,31,36})for(int rate:new int[]{8000,24000})for(int ms:new int[]{5,25}){
  Build.VERSION.SDK_INT=sdk;SystemClock.now=0;ShortTailCheck h=fixture(rate,ms);PluginCall c=target(h.writtenFrames);h.drain(c);
  check(c.result==null,"enqueue/drain request alone cannot certify playback");settle(h,c);
  check(${before?'c.result==null':'c.result!=null'},"complete short audio must not wait forever below startup threshold");
  if(c.result!=null)check(((Number)c.result.get("playedFrames")).longValue()==h.writtenFrames,"heard receipt requires exact native progress");
  check(h.track.written==rate*ms/1000&&h.track.writes==0,"no manufactured padding or lost tail frames");
  ${before?'':`h.restoreShortSegmentBuffer(h.track);check(h.track.threshold==rate/25&&h.track.buffer==rate/10,"next append restores original nonzero stream buffering");`}
 }
 ${before?'':`for(int sdk:new int[]{24,31}){
  Build.VERSION.SDK_INT=sdk;ShortTailCheck h=fixture(24000,25);h.track.stalled=true;PluginCall c=target(h.writtenFrames);h.drain(c);settle(h,c);
  check(c.result==null,"a lower threshold cannot fabricate hardware progress");h.cancelDrain("voice:stale_audio");h.track.stalled=false;h.track.tick();h.checkDrainProgress(h.head(h.track));
  check(c.result==null&&c.error!=null,"cancelled drain cannot certify delayed tail");
  h=fixture(24000,25);h.paused=true;c=target(h.writtenFrames);h.drain(c);check(c.result==null,"paused audio cannot be released");
  h=fixture(24000,25);h.track.fails=true;c=target(h.writtenFrames);h.drain(c);check(c.result==null&&c.error==null,"optional getter/setter failure cannot claim playback or crash drain");
 }
 Build.VERSION.SDK_INT=24;ShortTailCheck clamped=fixture(24000,5);clamped.track.minimum=240;PluginCall c=target(clamped.writtenFrames);clamped.drain(c);settle(clamped,c);
 check(c.result==null&&clamped.track.buffer==240,"threshold tuning alone cannot bypass a legacy minimum; separate queued fallback is not exercised here");
 Build.VERSION.SDK_INT=36;ShortTailCheck full=fixture(24000,200);c=target(full.writtenFrames);full.drain(c);check(full.track.sets==0,"normal complete segments retain startup threshold");
 for(int sdk:new int[]{24,31}){
  Build.VERSION.SDK_INT=sdk;ShortTailCheck h=fixture(24000,5);c=target(h.writtenFrames);h.drain(c);
  int reduced=sdk>=31?h.track.threshold:h.track.buffer;h.restoreShortSegmentBuffer(h.track);
  check((sdk>=31?h.track.threshold:h.track.buffer)==reduced,"next append before first progress cannot re-block the short segment");
  settle(h,c);check(c.result!=null,"short segment still starts with a racing next append");h.restoreShortSegmentBuffer(h.track);
  check(h.track.threshold==960&&h.track.buffer==2400,"restoration uses the original threshold and effective capacity");
  h=fixture(24000,25);c=target(h.writtenFrames-1);h.drain(c);check(h.track.sets==0,"partial drain cannot claim a completed supply boundary");
  h=fixture(24000,25);h.track.played=1;c=target(h.writtenFrames);h.drain(c);check(h.track.sets==0,"normal running track retains jitter buffering");
  h=fixture(24000,25);c=target(h.writtenFrames+1);h.drain(c);check(c.error!=null&&h.track.sets==0,"invalid drain cannot tune audio");
 }
 `}
 System.out.println(checks);
 }
}`;
const name=frozen&&!before?'regression-red':before?'before':'after',out=`${dir}/${name}`;mkdirSync(out,{recursive:true});writeFileSync(`${out}/ShortTailCheck.java`,java);
const compiled=spawnSync('javac',['-encoding','UTF-8','-d',out,`${out}/ShortTailCheck.java`],{encoding:'utf8'});writeFileSync(`${out}/compile.txt`,compiled.stdout+compiled.stderr);assert.equal(compiled.status,0,compiled.stderr);
const run=spawnSync('java',['-cp',out,'ShortTailCheck'],{encoding:'utf8'});writeFileSync(`${out}/run.txt`,run.stdout+run.stderr);
if(run.status!==0)writeFileSync(`${dir}/behavioral-red.txt`,run.stdout+run.stderr);
assert.equal(run.status,0,run.stderr);
const report={variant:name,checks:Number(run.stdout.trim()),roundsPerPrimary:30,apiCalls:0,microphone:false,androidRuntime:false,sourceHash:createHash('sha256').update(source).digest('hex'),
 scope:'Actual drain/threshold helpers with threshold-constrained JVM AudioTrack and padding delegation stubbed. Full queued fallback has separate voice-startup-padding coverage; no Android/physical sound.'};
writeFileSync(`${dir}/${name}.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
