import assert from 'node:assert/strict';
import { SpeechDeadlineQueue, type SpeechDeadlineScheduler } from '../../src/lib/voice-call/speech-deadline';
let checks=0;
const check=(value:unknown,label:string)=>{assert.ok(value,label);checks++;};
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
const pending=()=>{let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done;});return {promise,resolve};};
class Clock implements SpeechDeadlineScheduler {
  value=0;id=0;tasks=new Map<number,{at:number,callback:()=>void}>();all:(()=>void)[]=[];
  now(){return this.value;}
  set(callback:()=>void,delay:number){const id=++this.id;this.tasks.set(id,{at:this.value+delay,callback});this.all.push(callback);return id;}
  clear(handle:unknown){this.tasks.delete(handle as number);}
  async advance(to:number){
    while(true){const next=[...this.tasks].filter(([,task])=>task.at<=to).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;
      this.value=next[1].at;this.tasks.delete(next[0]);next[1].callback();await flush();}
    this.value=to;await flush();
  }
}
const text='我都看完了接下来我们一起处理';
async function main(){
 for(let round=0;round<30;round++){
  {
   const clock=new Clock(),abort=new AbortController(),parts:string[]=[];
   const q=new SpeechDeadlineQueue({signal:abort.signal,scheduler:clock,onSentence:async part=>{parts.push(part);},onFailure:error=>{throw error;}});
   await q.push(text);await clock.advance(449);check(parts.length===0,'ordinary initial grace period is retained');
   await clock.advance(450);check(parts[0]==='我都看完了','a timer emits safe text even when no new delta arrives');
   await q.push('',true);check(parts.join('')===text&&clock.tasks.size===0,'final text is complete and timers are released');
  }
  {
   const clock=new Clock(),abort=new AbortController(),parts:string[]=[];
   const q=new SpeechDeadlineQueue({signal:abort.signal,scheduler:clock,onSentence:async part=>{parts.push(part);},onFailure:()=>{}});
   await q.push(text);await clock.advance(449);await q.push('吧');await clock.advance(450);
   check(parts[0]==='我都看完了','later deltas do not postpone the existing deadline');await q.push('',true);
   check(parts.join('')===text+'吧','deadline rescheduling never loses later characters');
  }
  {
   const clock=new Clock(),abort=new AbortController(),parts:string[]=[];let failures=0;
   const q=new SpeechDeadlineQueue({signal:abort.signal,scheduler:clock,onSentence:async part=>{parts.push(part);},onFailure:()=>{failures++;}});
   await q.push(text);abort.abort();for(const callback of clock.all)callback();await flush();
   check(!parts.length&&clock.tasks.size===0&&failures===0,'cancelled and already-cleared timer callbacks cannot emit or report a fresh failure');
   await assert.rejects(q.push('迟到文字'),{name:'AbortError'});checks++;
  }
  {
   const clock=new Clock(),abort=new AbortController(),hold=pending(),started:string[]=[],accepted:string[]=[];
   const q=new SpeechDeadlineQueue({signal:abort.signal,scheduler:clock,onSentence:async part=>{started.push(part);if(started.length===1)await hold.promise;accepted.push(part);},onFailure:()=>{}});
   await q.push(text);await clock.advance(450);let settled=false;
   const later=q.push('。后面的句子。').then(()=>{settled=true;});await flush();
   check(started.length===1&&!settled,'a later delta cannot overtake an in-flight timed review');hold.resolve();await later;await q.push('',true);
   check(accepted.join('')===text+'。后面的句子。'&&accepted.length===3,'timed and ordinary clauses retain exact speech order');
  }
  {
   const clock=new Clock(),abort=new AbortController();let failures=0,reviewed=0;
   const q=new SpeechDeadlineQueue({signal:abort.signal,scheduler:clock,onSentence:async()=>{reviewed++;throw Error('voice:source_withdrawn');},onFailure:()=>{failures++;abort.abort();}});
   await q.push(text);await clock.advance(450);
   check(failures===1&&reviewed===1&&clock.tasks.size===0&&abort.signal.aborted,'timer review failure cancels upstream once and does not await another delta');
   await assert.rejects(q.push('',true),/source_withdrawn/);checks++;
  }
  {
   const clock=new Clock(),abort=new AbortController(),hold=pending();let reviewed=0,accepted=0;
   const q=new SpeechDeadlineQueue({signal:abort.signal,scheduler:clock,onSentence:async()=>{reviewed++;await hold.promise;if(abort.signal.aborted)throw new DOMException('Aborted','AbortError');accepted++;},onFailure:()=>{}});
   await q.push(text);await clock.advance(450);const later=q.push('。迟到句子。').then(()=>false,error=>error.name==='AbortError');
   abort.abort();check(await later,'cancellation releases a blocked producer without waiting for review');hold.resolve();await flush();
   check(reviewed===1&&accepted===0&&clock.tasks.size===0,'late review completion cannot start another sentence');
  }
  {
   const clock=new Clock(),abort=new AbortController(),parts:string[]=[];
   const q=new SpeechDeadlineQueue({signal:abort.signal,scheduler:clock,onSentence:async part=>{parts.push(part);},onFailure:()=>{}});
   await q.push(text);await q.push('',true);for(const callback of clock.all)callback();await clock.advance(1000);
   check(parts.length===1&&parts[0]===text&&clock.tasks.size===0,'early final keeps a single whole phrase and disables late callbacks');
  }
  {
   const clock=new Clock(),abort=new AbortController(),parts:string[]=[];
   const q=new SpeechDeadlineQueue({signal:abort.signal,scheduler:clock,onSentence:async part=>{parts.push(part);},onFailure:()=>{}});
   const whole='这份资料我已经认真看完了接下来我们把细节核对清楚然后再一起整理资料';
   await q.push(whole);check(parts.length===1,'ordinary complete phrase does not wait for the timer');
   await clock.advance(699);check(parts.length===1,'later short clauses retain the longer delivery budget');
   await clock.advance(700);check(parts.length===2,'later safe clauses use a finite 700ms budget');await q.push('',true);
   check(parts.join('')===whole,'multiple timed stages preserve complete text');
  }
 }
 console.log(JSON.stringify({checks,roundsPerScenario:30,apiCalls:0,microphone:false,scope:'Actual deadline queue and sentence buffer, injected monotonic timers and delayed review; no provider/audio.'}));
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
