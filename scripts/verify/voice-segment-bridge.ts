import assert from 'node:assert/strict';
import { NativeCallAudio, type NativeCallPlugin, type PlaybackReceipt } from '../../src/lib/voice-call/native-audio';
const before=process.argv.includes('--before');let checks=0;
const check=(value:unknown,label:string)=>{assert.ok(value,label);checks++;};
async function main(){
  const requested:(number|undefined)[]=[];let mismatch=false,late:((receipt:PlaybackReceipt)=>void)|undefined;
  const plugin:NativeCallPlugin={addListener:async()=>({remove:async()=>{}}),start:async()=>({routes:[],sampleRate:16000,echoCancellation:true,noiseSuppression:true,segmentDrain:true}),
    heartbeat:async()=>{},mute:async()=>{},resume:async()=>({routes:[]}),beginPlayback:async()=>{},appendPcm:async()=>({playedFrames:0,writtenFrames:4800}),
    drain:async options=>{requested.push(options.throughFrame);if(requested.length===4)return new Promise(resolve=>{late=resolve;});return {playedFrames:3200,writtenFrames:4800,complete:true,throughFrame:mismatch?99:options.throughFrame,sampleRate:8000};},
    stopPlayback:async()=>({playedFrames:0,writtenFrames:4800}),stop:async()=>{},getRoutes:async()=>({routes:[]}),setRoute:async()=>({routes:[]}),requestBluetooth:async()=>{},
  };
  const audio=new NativeCallAudio('target-bridge',plugin);await audio.start(()=>{});const signal=new AbortController();await audio.beginPlayback('turn',signal.signal);
  const result=await audio.drain('turn',signal.signal,3200);
  check(requested[0]===(before?undefined:3200)&&result.writtenFrames===4800,'native target uses hardware frame units and leaves future queued frames intact');
  mismatch=true;let invalidReply=false;try{await audio.drain('turn',signal.signal,3200);}catch(error){invalidReply=(error as Error).message==='voice:audio_playback_receipt';}
  check(invalidReply===!before,'wrong target echo cannot be accepted');
  mismatch=false;const calls=requested.length;let invalidArgument=false;try{await audio.drain('turn',signal.signal,-1);}catch(error){invalidArgument=(error as Error).message==='voice:audio_playback_receipt';}
  check(invalidArgument===!before&&requested.length===(before?calls+1:calls),'invalid JS target rejected before bridge transmission');
  // Use a separate instance so cancellation can be characterized independently of validation calls.
  let deferred!:(value:PlaybackReceipt)=>void;
  plugin.drain=async()=>new Promise(resolve=>{deferred=resolve;});
  const pending=audio.drain('turn',signal.signal,3200).catch(error=>error.name);signal.abort();
  check(await pending==='AbortError','cancellation wins over pending native drain');
  deferred({playedFrames:4800,writtenFrames:4800,throughFrame:3200,complete:true});await audio.close();
  console.log(JSON.stringify({before,checks,apiCalls:0,scope:'actual NativeCallAudio with isolated bridge double; not Android audio'}));
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
