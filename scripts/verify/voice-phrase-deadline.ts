import { SpokenSentenceBuffer } from '../../src/lib/voice-call/utterance';
import assert from 'node:assert/strict';
let checks=0;
const check=(value:unknown,label:string)=>{assert.ok(value,label);checks++;};
for(let round=0;round<30;round++){
  let now=0;
  const buffer=new SpokenSentenceBuffer(()=>now);
  const due=()=>typeof buffer.flushDue==='function'?buffer.flushDue():[];
  const text='我都看完了接下来我们一起处理';
  check(buffer.push(text).length===0,'a short clause retains its ordinary initial grace period');
  now=449;check(due().length===0,'deadline is not guessed early');
  now=450;const first=due();check(first.join('')==='我都看完了','a safe short unpunctuated clause becomes speakable by the controlled deadline');
  check(first.join('')+buffer.push('',true).join('')===text,'all remaining words survive the timed boundary');
  for(const unsafe of [
    '不是完成了然后就能直接提交',
    '只有结束了然后才能继续操作',
    '如果看完了接下来我们一起处理',
    '只要准备好了接下来就能直接提交',
    '并不是准备好了接下来就可以发布了',
    '不要以为理解了然后就能跳过核验',
    '不能说看完了然后就直接答应',
    '我不觉得弄清楚了然后就能保证成功',
    '我可以帮你完成接下来我们不能保证最终结果',
    '我都看完了接下来我们',
    '实际读数是1234567890.1234567890然后再核对',
    '请打开https://example.test/verylongpath?amount=12.34然后再核对说明',
    '我都看完了不过还不能确定最终结论',
    '这个没有明确完整谓语边界的长句仍需保留其后续限定',
    'pneumonoultramicroscopicsilicovolcanoconiosis'.repeat(3),
    '（我都看完了接下来我们一起处理）',
  ]){
    now=0;const b=new SpokenSentenceBuffer(()=>now);const initial=b.push(unsafe);now=2000;
    const ready=typeof b.flushDue==='function'?b.flushDue():[];
    check(initial.length===0&&ready.length===0,'deadline cannot authorize unsafe tokens, qualifications, hidden directions or missing right context');
    check(b.push('',true).join('')===(unsafe.startsWith('（')?'':unsafe),'retained conditions and qualifications survive finalization intact');
  }
  now=0;const reset=new SpokenSentenceBuffer(()=>now);reset.push(text);reset.reset();now=1000;
  check((typeof reset.flushDue==='function'?reset.flushDue():[]).length===0,'reset revokes a pending timed phrase');
}
console.log(JSON.stringify({checks,roundsPerScenario:30,apiCalls:0,microphone:false,scope:'Actual spoken sentence buffer with an injected monotonic clock; no model-generated quality or sound claim.'}));
