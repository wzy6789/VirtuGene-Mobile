import {db,type Message} from '../../src/db';
import {ReviewedReplyPrefix} from '../../src/lib/chat/reviewed-prefix';
import {inspectChatOutput} from '../../src/lib/chat-output-quality';
import {completeReplyAttempt} from '../../src/db/chat-reply-attempt-repo';
import {completeReplyBatch} from '../../src/lib/chat-topic-replies';
const checks:Array<{name:string;ok:boolean;detail?:unknown}>=[];
const check=(name:string,ok:unknown,detail?:unknown)=>checks.push({name,ok:!!ok,...(detail===undefined?{}:{detail})});
const owner='prefix-owner',sessionId='prefix-session',characterId='prefix-role';
const waitUntil=async(test:()=>boolean)=>{for(let i=0;i<100&&!test();i++)await new Promise(r=>setTimeout(r,5));if(!test())throw Error('Prototype did not reach expected state');};
let sequence=0;
async function fixture(){
  await db.delete();await db.open();
  await db.sessions.add({id:sessionId,userId:owner,characterId,title:'原型隔离',createdAt:1,updatedAt:1,unreadCount:0});
  const user:Message={id:'user',sessionId,role:'user',content:'我想聊聊今天的小事。',createdAt:2,isProactive:false,revision:1};
  await db.messages.add(user);
  const signal=new AbortController(),visible:string[]=[],events:string[]=[];
  const id='prefix-'+(++sequence);
  let commitCount=0,commitHook:(()=>void)|undefined;
  const isCurrent=()=>!signal.signal.aborted;
  async function validate(){
    const [current,scope]=await Promise.all([db.messages.get(user.id),db.sessions.get(sessionId)]);
    if(!isCurrent()||scope?.userId!==owner||scope.characterId!==characterId||current?.content!==user.content||(current?.revision??1)!==1)throw Error('chat:source_changed');
    events.push('validated');
  }
  const prefix=new ReviewedReplyPrefix({signal:signal.signal,validate,
    review:raw=>{const result=inspectChatOutput(raw,{mode:'private',userMessage:user.content});return result.check.ok?result.content:undefined;},
    commit:async(text,live)=>db.transaction('rw',db.sessions,db.messages,async()=>{
      await validate();if(!live())throw Error('chat:cancelled');
      const message:Message={id,sessionId,role:'assistant',content:text,createdAt:3,isProactive:false,revision:1,
        replyToUserMessageId:user.id,replyInputKey:'isolated-key',replyDelivery:'in-progress',replyBatchId:id,replyBatchIndex:0};
      await db.messages.add(message);commitHook?.();
      if(!live())throw Error('chat:cancelled');
      commitCount++;events.push('durable');
    }),
    publish:text=>{events.push('visible');visible.push(text);},
  });
  return {prefix,visible,signal,events,user,id,commitCount:()=>commitCount,setHook:(hook:()=>void)=>{commitHook=hook;}};
}
(window as any).runReviewedPrefix=async()=>{
  let f=await fixture();f.prefix.push('我在');await new Promise(r=>setTimeout(r,0));check('partial words never publish or persist',f.visible.length===0&&await db.messages.count()===1);
  f.prefix.push('我在。后半句还没来');await waitUntil(()=>f.visible.length===1);
  const saved=await db.messages.get(f.id);
  check('reviewed sentence is durable before its display callback',f.events.indexOf('durable')<f.events.indexOf('visible')&&saved?.content==='我在。',f.events);
  check('in-progress receipt carries no completion claim',saved?.replyDelivery==='in-progress'&&saved.replyCompletion===undefined);
  check('in-progress receipt is not reusable as complete attempt',!completeReplyAttempt([{...saved!,replyCompletion:'complete'}],'isolated-key'));
  check('in-progress receipt is not answered evidence',!completeReplyBatch(f.user,[{...saved!,replyCompletion:'complete'}]));
  f.prefix.push('我在。后半句还没来，之后完整了。');f.prefix.push('我在。后半句还没来，之后完整了。');
  const finished=await f.prefix.finish('我在。后半句还没来，之后完整了。');
  check('one prefix commit despite repeated deltas',f.commitCount()===1);
  check('terminal result retains the exact published prefix',finished.kind==='ready'&&finished.text.startsWith(f.visible[0]),finished);
  check('repeated finish returns same terminal decision',JSON.stringify(await f.prefix.finish('换一稿。'))===JSON.stringify(finished));
  f=await fixture();f.prefix.push('我想说“今天');await new Promise(r=>setTimeout(r,0));check('unclosed quotation remains buffered',!f.visible.length&&await db.messages.count()===1);
  f=await fixture();f.prefix.push('哈哈哈哈');await new Promise(r=>setTimeout(r,0));check('reaction without a boundary remains buffered',!f.visible.length);
  f.prefix.push('哈哈哈哈\n\n');await f.prefix.awaitFirstDecision();
  check('closed paragraph preserves a standalone reaction without adding punctuation',f.visible.length===1&&f.visible[0]==='哈哈哈哈'&&(await db.messages.get(f.id))?.content==='哈哈哈哈');
  f=await fixture();f.prefix.push('（拍桌）不行。');const blocked=await f.prefix.finish();check('raw stage direction never reaches DB or display',blocked.kind==='blocked'&&!f.visible.length&&await db.messages.count()===1,blocked);
  f=await fixture();f.prefix.push('我在。');await waitUntil(()=>f.visible.length===1);const tail=await f.prefix.finish('我在。她笑了笑：“别难过。”');
  check('unsafe suffix preserves only the verified prefix',tail.kind==='partial'&&tail.text==='我在。'&&f.visible.length===1,tail);
  f=await fixture();f.prefix.push('我在。');await waitUntil(()=>f.visible.length===1);const replaced=await f.prefix.finish('好啦，换一版。');
  check('final draft cannot rewrite already displayed prefix',replaced.kind==='partial'&&replaced.reason==='changed-prefix',replaced);
  f=await fixture();f.prefix.push('我在。');await waitUntil(()=>f.visible.length===1);f.prefix.push('重写先前的正文。');let rewritten=false;try{await f.prefix.finish();}catch{rewritten=true;}
  check('transport rewrite is rejected without a second publication',rewritten&&f.visible.length===1&&f.visible[0]==='我在。');
  f=await fixture();f.signal.abort();f.prefix.push('我在。');check('cancellation before review creates no write',(await f.prefix.finish()).kind==='blocked'&&await db.messages.count()===1);
  f=await fixture();f.setHook(()=>f.signal.abort());f.prefix.push('我在。');let rollback=false;try{await f.prefix.finish();}catch{rollback=true;}
  check('cancellation inside native write rolls back prefix',rollback&&!f.visible.length&&await db.messages.count()===1);
  f=await fixture();await db.messages.update(f.user.id,{content:'这条原话已经变更。',revision:2});f.prefix.push('我在。');let changed=false;try{await f.prefix.finish();}catch{changed=true;}
  check('changed source blocks durable prefix',changed&&!f.visible.length&&await db.messages.count()===1);
  f=await fixture();f.prefix.push('我在。');await waitUntil(()=>f.visible.length===1);f.signal.abort();const stopped=await f.prefix.finish('我在。剩余话。');
  check('cancellation after first display keeps truthful partial result',stopped.kind==='partial'&&stopped.reason==='cancelled'&&stopped.text==='我在。',stopped);
  return {complete:checks.every(c=>c.ok),checks,failures:checks.filter(c=>!c.ok),apiCalls:0,scope:'Isolated first-prefix prototype and real IndexedDB transactions; not yet sender/import/crash integration'};
};
