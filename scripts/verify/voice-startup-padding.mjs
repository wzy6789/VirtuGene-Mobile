import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const dir='.tmp-preview/voice-startup-padding-20261016', before=process.argv.includes('--before');
const running=process.argv.includes('--running-tail'), resetOnEmpty=process.argv.includes('--reset-on-every-underrun');
const source=readFileSync(before?`${dir}/before/VoiceCallAudioPlugin.java`:'android/app/src/main/java/com/virtugene/app/plugins/VoiceCallAudioPlugin.java','utf8');
function method(marker){const start=source.indexOf(marker);if(start<0)return '';let i=source.indexOf('{',start),depth=1;for(let e=i+1;e<source.length;e++){if(source[e]==='{')depth++;if(source[e]==='}'&&!--depth)return source.slice(start,e+1);}throw Error(marker);}
const methods=['@PluginMethod public void drain(','private void checkDrainProgress(','private void cancelDrain(',
 'private void releaseShortSegment(','private void restoreShortSegmentBuffer(','private void queueStartupPadding(','private long head(','private JSObject stopOutput(', 'private void putPlaybackObservation('].map(method).join('\n');
const java=`package com.virtugene.app.plugins;
import java.util.*;import java.io.*;
public class PaddingCheck {
 @interface PluginMethod {} static class Build {static class VERSION {static int SDK_INT=30;}}
 static class SystemClock {static long now;static long elapsedRealtime(){return now;}}
 static class Thread {static Runnable step=()->{};static void sleep(long ms){SystemClock.now+=ms;step.run();}}
 static class JSObject extends HashMap<String,Object>{Object opt(String k){return get(k);}boolean has(String k){return containsKey(k);}}
 static class PluginCall {JSObject data=new JSObject(),result;String error;String getString(String k){return "turn";}JSObject getData(){return data;}void resolve(JSObject v){result=v;}void reject(String e){error=e;}}
 static class AudioTrack {
  static final int WRITE_NON_BLOCKING=1,STATE_INITIALIZED=1;
  int rate,threshold,buffer,minimum,writeLimit=64;long played;boolean started,released,stalled,setFails,setRejected;ByteArrayOutputStream data=new ByteArrayOutputStream();
  AudioTrack(int rate,byte[] voice,int min){this.rate=rate;threshold=rate/25;buffer=rate/10;minimum=min;data.writeBytes(voice);}
  int getSampleRate(){return rate;}int getStartThresholdInFrames(){return threshold;}int getBufferSizeInFrames(){return buffer;}
  int getUnderrunCount(){return 0;}
  int setStartThresholdInFrames(int n){return threshold=n;}int setBufferSizeInFrames(int n){if(setFails)throw new IllegalStateException();if(setRejected)return -3;return buffer=Math.max(minimum,n);}
  int getPlaybackHeadPosition(){return (int)played;}int getState(){return STATE_INITIALIZED;}
  int write(byte[] bytes,int offset,int length,int mode){
   if(released)throw new IllegalStateException();int n=Math.min(length,Math.min(writeLimit,(int)Math.max(0,buffer-(data.size()/2-played))*2));
   n-=n%2;if(n>0)data.write(bytes,offset,n);return n;
  }
  void tick(){if(released||stalled)return;${resetOnEmpty?'if(data.size()/2==played)started=false;':''}if(!started&&data.size()/2-played>= (Build.VERSION.SDK_INT>=31?Math.min(threshold,buffer):buffer))started=true;
   if(started)played=Math.min(data.size()/2,played+rate/200);}
  void pause(){}void flush(){}void release(){released=true;}
 }
 static class Executor {ArrayDeque<Runnable> work=new ArrayDeque<>();void execute(Runnable r){work.add(r);}void run(){while(!work.isEmpty())work.remove().run();}}
 static class Handler {void removeCallbacks(Runnable r){}}
 final Object lock=new Object();AudioTrack track;long epoch=1,writtenFrames;boolean running=true,paused;String playbackTurn="turn";
 final AudioStartupPadding startupPadding=new AudioStartupPadding();Executor output=new Executor();Handler main=new Handler();Runnable playbackTicker;
 int queuedBytes,tailRestoreThreshold,tailRestoreBuffer,outputCleanupFailures;boolean routeValid=true;
 long routeGeneration=7;
 PluginCall pendingDrainCall;Long pendingDrainTarget;long pendingDrainEpoch,pendingDrainStartedAt;
 boolean owns(PluginCall c){return true;}boolean verifyActiveRoute(){return routeValid;}
 ${methods}
 static int checks;static void check(boolean b,String m){checks++;if(!b)throw new AssertionError(m);}
 static byte[] voice(int frames,int seed){byte[] value=new byte[frames*2];for(int i=0;i<value.length;i++)value[i]=(byte)(1+(i*13+seed)%120);return value;}
 static PaddingCheck fixture(int rate,int ms,int minimum){PaddingCheck h=new PaddingCheck();h.track=new AudioTrack(rate,voice(rate*ms/1000,19),minimum);h.writtenFrames=rate*ms/1000;Thread.step=h.track::tick;SystemClock.now=0;return h;}
 static PluginCall target(long n){PluginCall c=new PluginCall();c.data.put("throughFrame",n);return c;}
 static void settle(PaddingCheck h,PluginCall c){h.output.run();for(int i=0;i<1000&&c.result==null&&c.error==null;i++){SystemClock.now+=5;h.track.tick();h.checkDrainProgress(h.head(h.track));}}
 public static void main(String[]args){
  for(int round=0;round<30;round++)for(int sdk:new int[]{24,30})for(int rate:new int[]{8000,24000})for(int ms:new int[]{5,25})for(int minimumMs:new int[]{40,100,300}){
   Build.VERSION.SDK_INT=sdk;PaddingCheck h=fixture(rate,ms,rate*minimumMs/1000);byte[] original=h.track.data.toByteArray();PluginCall c=target(h.writtenFrames);h.drain(c);
   check(c.result==null,"padding admission is not heard speech");settle(h,c);
   check(c.result!=null&&((Number)c.result.get("playedFrames")).longValue()==h.writtenFrames,"minimum-clamped complete short voice must reach genuine playback progress");
   byte[] actual=h.track.data.toByteArray();check(Arrays.equals(original,Arrays.copyOf(actual,original.length)),"every original PCM byte including its final sample is unchanged");
   boolean zero=true;for(int i=original.length;i<actual.length;i++)zero&=actual[i]==0;check(zero,"only silence is appended after voice EOF");
   int pads=h.startupPadding.frames();check(pads==rate*(minimumMs-ms)/1000&&h.writtenFrames==original.length/2,"silence is separately counted, never supplied speech");
   check(((Number)c.result.get("startupPaddingFrames")).longValue()==pads&&((Number)c.result.get("nativeQueuedFrames")).longValue()>=0,"actual queued padding is observable separately from voice frames");
   h.track.played=h.writtenFrames+pads/2;check(h.head(h.track)==h.writtenFrames,"silence playback never extends the heard voice position");
   h.track.played=h.writtenFrames+pads;byte[] next=voice(rate/20,31);h.track.data.writeBytes(next);h.writtenFrames+=next.length/2;
   check(h.head(h.track)==original.length/2,"a queued next segment is not heard while silence alone progressed");
   h.track.played+=next.length/2;check(h.head(h.track)==h.writtenFrames,"next segment maps back to voice-only frame identity");
   JSObject receipt=h.stopOutput();check(((Number)receipt.get("playedFrames")).longValue()==original.length/2+next.length/2&&h.startupPadding.frames()==0&&h.queuedBytes==0,"stop receipt maps actual progress then resets padding and queued work");
  }
  for(int mode=0;mode<4;mode++){
   PaddingCheck h=fixture(24000,5,2400);PluginCall c=target(h.writtenFrames);h.drain(c);
   if(mode==0)h.epoch++;if(mode==1)h.paused=true;if(mode==2)h.routeValid=false;if(mode==3)h.stopOutput();
   settle(h,c);check(c.result==null,"cancel, pause, route loss and stop cannot certify delayed silence work");
  }
  PaddingCheck large=fixture(24000,5,24000*4);PluginCall c=target(large.writtenFrames);large.drain(c);
  check(large.output.work.isEmpty()&&large.startupPadding.frames()==0,"fallback cannot allocate more than the existing three-second admission bound");
  for(boolean exception:new boolean[]{false,true}){
   PaddingCheck h=fixture(24000,5,2400);h.track.setFails=exception;h.track.setRejected=!exception;c=target(h.writtenFrames);h.drain(c);settle(h,c);
   check(c.result!=null&&h.startupPadding.frames()==2280,"a rejected optional resize still uses the actual readable effective buffer");
  }
  ${running?`for(int round=0;round<30;round++)for(int sdk:new int[]{24,30,31,36})for(int rate:new int[]{8000,24000})for(int tailMs:new int[]{5,25})for(int gap:new int[]{0,100,2000})for(int initialMs:new int[]{5,100}){
   Build.VERSION.SDK_INT=sdk;PaddingCheck h=fixture(rate,initialMs,rate/10);PluginCall first=target(h.writtenFrames);h.drain(first);settle(h,first);
   check(first.result!=null,"initial segment really drains before the running-tail test");
   while(h.track.played<h.track.data.size()/2)h.track.tick();
   for(int elapsed=0;elapsed<gap;elapsed+=5){SystemClock.now+=5;h.track.tick();}
   int originalPadding=h.startupPadding.frames();long priorVoice=h.writtenFrames;h.restoreShortSegmentBuffer(h.track);
   byte[] tail=voice(rate*tailMs/1000,round+11);int offset=0;
   while(offset<tail.length){int n=h.track.write(tail,offset,tail.length-offset,AudioTrack.WRITE_NON_BLOCKING);if(n<=0)throw new AssertionError("empty running track must admit short tail");offset+=n;h.writtenFrames+=n/2;}
   PluginCall last=target(h.writtenFrames);h.drain(last);settle(h,last);
   check(last.result!=null,"AOSP normal-mixer filling state is retained across underrun; short tails must drain without padding again");
   check(((Number)last.result.get("playedFrames")).longValue()==priorVoice+rate*tailMs/1000&&h.startupPadding.frames()==originalPadding,"only the actual next voice frames advance heard progress; no repeated padding");
   byte[] bytes=h.track.data.toByteArray();check(Arrays.equals(tail,Arrays.copyOfRange(bytes,bytes.length-tail.length,bytes.length)),"running tail retains every PCM byte and its last sample");
  }`:''}
  System.out.println(checks);
 }
}`;
const name=before?'before':'after',out=running?`.tmp-preview/voice-running-tail-20261016/${resetOnEmpty?'counterfactual':'after'}`:`${dir}/${name}`;mkdirSync(out,{recursive:true});writeFileSync(`${out}/PaddingCheck.java`,java);
const compiled=spawnSync('javac',['-encoding','UTF-8','-d',out,`${out}/PaddingCheck.java`,
 'android/app/src/main/java/com/virtugene/app/plugins/AudioStartupPadding.java','android/app/src/main/java/com/virtugene/app/plugins/AudioCleanup.java'],{encoding:'utf8'});
writeFileSync(`${out}/compile.txt`,compiled.stdout+compiled.stderr);assert.equal(compiled.status,0,compiled.stderr);
const run=spawnSync('java',['-cp',out,'com.virtugene.app.plugins.PaddingCheck'],{encoding:'utf8'});writeFileSync(`${out}/run.txt`,run.stdout+run.stderr);
const report={checks:run.status===0?Number(run.stdout.trim()):undefined,exitCode:run.status,roundsPerPrimary:30,primaryCases:720,apiCalls:0,microphone:false,androidRuntime:false,
 runningTailCases:running?2880:0,resetOnEveryUnderrun:resetOnEmpty,
 sourceHash:createHash('sha256').update(source).digest('hex'),helperHash:createHash('sha256').update(readFileSync('android/app/src/main/java/com/virtugene/app/plugins/AudioStartupPadding.java')).digest('hex'),
 scope:'Actual native drain/queued fallback/head/stop methods and frame mapper; constrained JVM output executor/AudioTrack/route double. No Android or physical sound.'};
writeFileSync(`${out}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));assert.equal(run.status,0,run.stderr);
