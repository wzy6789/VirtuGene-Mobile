import './chat-human-live';
import {db,type Message} from '../../src/db';
import {useAuthStore} from '../../src/store/auth-store';
import {useChatStore} from '../../src/store/chat-store';
import {messageRepo} from '../../src/db/message-repo';
import {sendRoleChatReply,type ChatRequest} from '../../src/lib/chat/send-service';
import {ChatReplyStream} from '../../src/lib/chat-stream';
import {withChatSessionLock} from '../../src/lib/chat/request-coordinator';
import {buildChatHistoryWindow} from '../../src/lib/chat-history-window';
import {buildSummaryBatch} from '../../src/lib/ai/summary-batches';
import {importSyncData} from '../../src/lib/sync';
import {completeReplyAttempt} from '../../src/db/chat-reply-attempt-repo';
import {advanceExplicitTopics} from '../../src/lib/chat-topic-outcomes';
import {emptyChatConversationState} from '../../src/lib/chat-conversation-state';
import {memorySourceTombstoneRepo} from '../../src/db/memory-source-tombstone-repo';
const owner='isolated-live-expression-owner',sid='isolated-live-session',cid='isolated-live-role';
const checks:Array<{name:string;ok:boolean;detail?:unknown}>=[];
const check=(name:string,ok:unknown,detail?:unknown)=>checks.push({name,ok:!!ok,...(detail===undefined?{}:{detail})});
const harness=(window as any).liveExpression;
const sentence='我在，先听你说。';
let calls=0,release:(()=>void)|undefined,networkFailure=false;
let responseTail='你想说哪件小事都可以。';
let providerStarted=false,source:Message,request:ChatRequest,stream:ChatReplyStream;
let opening=sentence;
let sending:Promise<void>;
let sourceError:string|undefined;
let sentPrompt='';
let sentMessagesText='';
let sendingDone=false;
const tick=()=>new Promise(r=>setTimeout(r,5));
async function until(test:()=>boolean|Promise<boolean>,limit=1200){const started=performance.now();while(performance.now()-started<limit){if(await test())return true;await tick();}return false;}
window.fetch=async(url,init)=>{
  if(!String(url).includes('/chat/completions'))throw Error('External network disabled');
  calls++;providerStarted=true;
  const sentMessages=JSON.parse(String(init?.body??'{}')).messages;sentMessagesText=JSON.stringify(sentMessages);
  sentPrompt=sentMessages?.filter((message:any)=>message.role==='system').map((message:any)=>message.content).join('\n')??'';
  // The original sender may spend its existing one quality retry. Only the
  // first response is held open; retries finish immediately so a baseline
  // regression cannot deadlock the harness waiting for a second release.
  if(calls>1)return new Response(JSON.stringify({choices:[{message:{content:opening+responseTail},finish_reason:'stop'}]}),{headers:{'Content-Type':'application/json'}});
  const body=new ReadableStream<Uint8Array>({start(controller){
    const encoder=new TextEncoder();
    const emit=(data:unknown)=>controller.enqueue(encoder.encode('data: '+JSON.stringify(data)+'\n\n'));
    emit({choices:[{delta:{content:opening},finish_reason:null}]});
    const aborted=()=>{release=undefined;controller.error(new DOMException('Synthetic request aborted','AbortError'));};
    init?.signal?.addEventListener('abort',aborted,{once:true});
    release=()=>{release=undefined;init?.signal?.removeEventListener('abort',aborted);if(networkFailure){controller.error(Error('isolated stream failure'));return;}
      emit({choices:[{delta:{content:responseTail},finish_reason:null}]});
      emit({choices:[{delta:{},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1}});
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));controller.close();
    };
  }});
  return new Response(body,{headers:{'Content-Type':'text/event-stream'}});
};
async function start(name='古月娜',first=sentence,input?:string,beforeSend?:()=>Promise<void>){
  const persona=harness.presets().find((p:any)=>p.name===name)??{name:'测试搭档',tags:[],systemPrompt:'言辞自然简短。只聊有依据的事。\n对话样本：用户说今天遇到巧合 → 你说哈哈，这也太巧了。',greeting:'你好',signature:'测试'};
  const actor=await harness.setup(persona);
  await beforeSend?.();
  calls=0;release=undefined;providerStarted=false;sourceError=undefined;networkFailure=false;responseTail='你想说哪件小事都可以。';
  opening=first;
  sentPrompt='';sentMessagesText='';sendingDone=false;
  const content=input??(name==='陆雪琪'?'雪琪，我是张小凡。今天有点累，想听你说两句。':'古月，我是唐舞麟。今天有点累，想听你说两句。');
  source={id:crypto.randomUUID(),sessionId:sid,role:'user',content,createdAt:Date.now(),isProactive:false,revision:1};
  await db.messages.add(source);useChatStore.getState().addMessage(source);
  stream=new ChatReplyStream(sid,()=>undefined);
  request={userId:owner,controller:new AbortController(),stream,completed:false,stopped:false};
  sending=withChatSessionLock(sid,()=>sendRoleChatReply(actor,source,request,{userId:owner,text:content})).catch(error=>{sourceError=String(error);}).finally(()=>{stream.dispose();sendingDone=true;});
  if(!await until(()=>providerStarted||sendingDone,5000))throw Error('Synthetic send did not reach a terminal or provider state');
}
const replies=()=>db.messages.where('replyToUserMessageId').equals(source.id).sortBy('createdAt');
async function finish(){release?.();await sending;return replies();}
async function awaitPrefix(){await until(async()=>!!(await replies()).length);return (await replies())[0];}
(window as any).settleReviewedReload=async()=>{
  await db.open();useAuthStore.setState({userId:owner});calls=0;
  const rows=await messageRepo.getPage(sid,{limit:200});
  const settle=(messageRepo as any).settleInterruptedPrefixes;
  if(typeof settle!=='function')return {supported:false,calls};
  await settle({userId:owner,characterId:cid,sessionId:sid,isCurrent:()=>useAuthStore.getState().userId===owner},rows);
  return {supported:true,calls,rows:await messageRepo.getPage(sid,{limit:200})};
};
(window as any).runReviewedDelivery=async()=>{
  for(const name of ['古月娜','陆雪琪']){
    await start(name);const early=await awaitPrefix();
    check(name+' reviewed first sentence is durable while provider remains open',early?.content===sentence&&early.replyDelivery==='in-progress'&&early.replyCompletion===undefined,{early,published:stream.published});
    await until(()=>stream.published,100);
    check(name+' first sentence becomes visible before provider finishes',stream.published&&stream.getSnapshot().join('')===sentence);
    const rows=await finish();
    check(name+' terminal batch settles stable prefix id and text',request.completed&&rows.length>=1&&rows[0].id===early?.id&&rows[0].content.startsWith(sentence)&&rows.every(r=>r.replyDelivery==='settled'&&r.replyCompletion==='complete'),rows);
    check(name+' ordinary early delivery uses one provider request',calls===1,{calls});
  }
  await start();let early=await awaitPrefix();responseTail='她轻轻抬起头，笑了笑。';const unsafe=await finish();
  check('unsafe suffix cannot replace or extend the durable first sentence',unsafe.length===1&&unsafe[0].content===sentence&&unsafe[0].replyCompletion==='interrupted'&&unsafe[0].replyDelivery==='settled',unsafe);
  check('published prefix prevents whole-reply quality retry',calls===1,{calls});
  await start();early=await awaitPrefix();request.stopped=true;request.controller.abort();const cancelled=await finish();
  check('user stop retains only truthful interrupted prefix',early&&cancelled.length===1&&cancelled[0].id===early.id&&cancelled[0].content===sentence&&cancelled[0].replyDelivery==='settled'&&cancelled[0].replyCompletion==='interrupted',cancelled);
  await start();early=await awaitPrefix();networkFailure=true;const failed=await finish();
  check('transport failure settles prefix without a second request',early&&calls===1&&failed.length===1&&failed[0].content===sentence&&failed[0].replyCompletion==='interrupted'&&failed[0].replyDelivery==='settled',failed);
  await start();early=await awaitPrefix();await messageRepo.update(source.id,{content:'刚才那条已改过。'});const edited=await finish();
  check('source edit prevents late suffix and complete answer',early&&edited.length===1&&edited[0].content===sentence&&edited[0].replyCompletion==='interrupted'&&edited[0].replyDelivery==='settled',{edited,sourceError});
  await start();early=await awaitPrefix();
  if(early)await messageRepo.update(early.id,{content:'用户后来编辑了这句话。'});
  const manual=await finish();check('later edit to visible prefix is preserved',early&&manual.length===1&&manual[0].content==='用户后来编辑了这句话。',manual);
  await start();early=await awaitPrefix();if(early)await messageRepo.deleteById(early.id);const deleted=await finish();
  check('deleted prefix is never recreated by late final text',!!early&&deleted.length===0,deleted);
  await start();early=await awaitPrefix();await db.messages.add({id:'newer-input',sessionId:sid,role:'user',content:'先回答这条新消息。',createdAt:Date.now()+1,isProactive:false});const superseded=await finish();
  check('new user input stops the old suffix without another request',!!early&&calls===1&&superseded.length===1&&superseded[0].content===sentence&&superseded[0].replyCompletion==='interrupted',superseded);
  await start();early=await awaitPrefix();
  const history=early?buildChatHistoryWindow([source,early],'',12):[];
  check('history retains interrupted meaning with an explicit incomplete marker',!!early&&history.some(row=>row.content.includes(sentence)&&row.content.includes('未完成')));
  check('summary batch excludes in-progress delivery',!!early&&!buildSummaryBatch([source,early],{}).some(part=>part.message.id===early.id));
  useAuthStore.setState({userId:'other-owner'});await finish();useAuthStore.setState({userId:owner});
  const reloaded=await (window as any).probeReviewedReload();
  const recovered=reloaded.rows?.find((row:Message)=>row.id===early?.id);
  check('fresh app context settles stranded prefix without generation',!!early&&reloaded.supported&&reloaded.calls===0&&recovered?.replyDelivery==='settled'&&recovered.replyCompletion==='interrupted',{reloaded});
  await start();early=await awaitPrefix();await finish();
  const actor=(await db.characters.get(cid))!,session=(await db.sessions.get(sid))!;
  const imports:Message[]=early?[{...early,id:'imported-pending',replyBatchId:'imported-pending',replyBatchSize:1,replyCompletion:'complete'},
    {...early,id:'imported-unknown',replyBatchId:'imported-unknown',replyBatchSize:1,replyDelivery:'unknown' as any,replyCompletion:'complete'}]:[];
  const beforeImportCalls=calls;
  const imported=await importSyncData({__meta__:{app:'VirtuGene',kind:'sync',version:'6.1.7',exportedAt:new Date().toISOString(),userId:owner},
    characters:[actor],sessions:[session],messages:imports,memories:[],emotionSnapshots:[],characterStates:[],diaries:[]});
  const importedRows=await db.messages.bulkGet(imports.map(row=>row.id));
  check('actual sync importer settles pending and unknown receipts as interrupted',!!early&&imported.ok&&importedRows.length===2&&importedRows.every(row=>row?.replyDelivery==='settled'&&row.replyCompletion==='interrupted'&&row.stopped),{imported,importedRows});
  check('import cannot reuse a forged completion or start generation',!!early&&calls===beforeImportCalls&&!completeReplyAttempt(importedRows.filter((row):row is Message=>!!row),early.replyInputKey!));
  for(const first of ['（拍桌）不行。',JSON.stringify({messages:['（拍桌）不行。']})]){
    await start('古月娜',first);const rows=await finish();
    check('raw action cannot be hidden by final transport cleanup: '+first,rows.length===0&&!stream.published&&!request.completed&&calls<=2,{rows,calls});
  }
  await start('古月娜','哈哈哈哈\n\n','今天碰到件好笑的事。');early=await awaitPrefix();responseTail='这个我真没想到。';
  const reaction=await finish();
  check('actual sender preserves a paragraph-delimited pure reaction before completion',early?.content==='哈哈哈哈'&&reaction.length===2&&reaction[0].content==='哈哈哈哈'&&reaction[1].content==='这个我真没想到。',reaction);
  await start('古月娜',sentence,'详细写一段说明。');early=await awaitPrefix();responseTail='第二句话也保留在同一个长文气泡里。';const longForm=await finish();
  check('explicit long prose extends the stable first bubble instead of forcing a second bubble',!!early&&longForm.length===1&&longForm[0].id===early.id&&longForm[0].content===sentence+responseTail,longForm);
  await start('古月娜','','先别聊考试这类话题了。');networkFailure=true;await finish();
  check('explicit category pause persists even when generation fails',!!(await db.sessions.get(sid))?.conversation?.topicPauses?.some(pause=>pause.category==='exam')&&(await replies()).length===0);
  await start('古月娜','我也想你。','我是唐舞麟。想你了，随便聊几句吧。');early=await awaitPrefix();
  responseTail='正好，我最近总在想，要是把我们俩的名字刻在什么东西上，还是“金龙”和“银龙”好。';
  const independentSuffix=await finish();
  check('local suffix repair keeps independently valid forward content without changing the prefix',!!early&&calls===1&&independentSuffix[0]?.id===early.id&&independentSuffix.map(row=>row.content).join('').includes('正好，要是')&&!independentSuffix.some(row=>row.content.includes('最近总在想')),independentSuffix);
  await start('古月娜','那我说了。','今天我又有点想你了，只想听你说一句自己的心意。');early=await awaitPrefix();
  check('an exact one-sentence request cannot publish a preamble before full quantity review',!early&&!stream.published);
  responseTail='---我也想你。';await finish();
  await start('古月娜',sentence,'今天的云挺好看。',async()=>{
    const old:Message={id:'pause-only-source',sessionId:sid,role:'user',content:'先别聊考试这类话题了。',createdAt:Date.now()-1000,isProactive:false,revision:1};
    await db.messages.add(old);
    const paused=advanceExplicitTopics({}, {message:old,domain:'user-reality',utcOffsetMinutes:new Date(old.createdAt).getTimezoneOffset()});
    await db.sessions.update(sid,{conversation:{...emptyChatConversationState(),...paused,version:1}});
    await db.messages.update(old.id,{content:'这条暂停已经被编辑撤回。',revision:2});
  });
  check('a pause-only conversation revalidates its edited source before the model request',providerStarted&&!sentPrompt.includes('本会话不主动重提'),{providerStarted,sourceError});
  await finish();
  await start('古月娜','第一段。\n\n第二段。','详细写一段说明。');early=await awaitPrefix();
  await new Promise(resolve=>setTimeout(resolve,600));
  check('a long-form first chunk remains live through repeated source-watch checks',!!early&&stream.published&&!request.controller.signal.aborted,{sourceError,published:stream.published});
  responseTail='';const multiParagraph=await finish();
  check('multi-paragraph first chunk settles into the requested one-bubble prose',multiParagraph.length===1&&multiParagraph[0].content==='第一段。第二段。'&&multiParagraph[0].replyCompletion==='complete',multiParagraph);
  await start('古月娜',sentence,'今天的云挺好看。',async()=>{
    const withdrawn:Message={id:'withdrawn-visible-old',sessionId:sid,role:'user',content:'这条已撤回的旧原话不要再用于对话。',createdAt:Date.now()-1000,isProactive:false,revision:1};
    await db.messages.add(withdrawn);useChatStore.getState().addMessage(withdrawn);
    await memorySourceTombstoneRepo.record({userId:owner,sourceType:'message',sourceId:withdrawn.id,sourceRevision:1,status:'withdrawn'});
  });
  check('a withdrawn visible original is excluded without blocking the next valid turn',providerStarted&&!sentMessagesText.includes('这条已撤回的旧原话'),{providerStarted,sourceError});
  await finish();
  await start('古月娜','我觉得相爱以后，重要选择也该让彼此一起做。','古月，我是唐舞麟。随便聊聊，你选。');
  early=await awaitPrefix();
  check('actual invitation injects one bounded content direction into the existing model request',sentPrompt.includes('[本轮选题]')&&calls===1);
  check('early durable prefix does not consume the selected angle',!!early&&!early.replyDirection,early);
  responseTail='';const selectedReply=await finish();
  check('actual final native sender write records only the published matching angle',selectedReply.some(row=>row.replyDirection?.angleKey==='fiction:mutual-choice')&&calls===1,{rows:selectedReply,direction:sentPrompt.match(/\[本轮选题\][\s\S]*?\[\/本轮选题\]/u)?.[0]});
  await start('陆雪琪','我更在意话少的人怎样表达关心。','雪琪，我是张小凡。随便聊聊，你选。');
  responseTail='';const luChoice=await finish();
  check('actual Lu persona chooses its own quiet-care angle',luChoice.some(row=>row.replyDirection?.angleKey==='fiction:quiet-care')&&calls===1,luChoice);
  await start('古月娜','不聊。','我是另一个访客。随便聊聊，你选。');
  check('outsider identity cannot enable partner topic selection',!sentPrompt.includes('[本轮选题]'));
  await finish();
  await start('普通搭档','哈哈，这也太巧了。','今天发现朋友的杯子和我一样。');
  early=await awaitPrefix();responseTail='';const ordinaryEarly=await finish();
  check('ordinary role still publishes a safe independent prefix before terminal transport',!!early&&early.content==='哈哈，这也太巧了。'&&ordinaryEarly[0]?.replyCompletion==='complete'&&calls===1,{early,rows:ordinaryEarly,calls,sourceError});
  await start('古月娜','我还是更喜欢有点热闹的。','我是唐舞麟。你不同意也可以直说，我想听你的偏好。');
  early=await awaitPrefix();
  responseTail='刚才说从早走到晚，是我一开始想岔了，安静久了反而没意思。\n---\n不过小街也别挑那种挤得走不动路的，能慢慢看、能停下来听两句就好。我最想看铺子里摆的小东西，挑一样合眼缘的带回来。';
  const reportedPreference=await finish();
  check('captured ordinary reference to prior speech retains the full suffix after a stable first prefix',!!early&&reportedPreference[0]?.id===early.id&&reportedPreference.every(row=>row.replyCompletion==='complete')&&reportedPreference.map(row=>row.content).join('').includes('挑一样合眼缘的带回来')&&calls===1,reportedPreference);
  await start('古月娜','哈哈，这个我是真喜欢。','我是唐舞麟。我把杯子当成手机找了半天。');
  early=await awaitPrefix();responseTail='那只杯子现在在你手里，估计还挺无辜。';
  const cupScene=await finish();
  check('fresh real current-object assertion never extends a durable genuine reaction',!!early&&cupScene[0]?.id===early.id&&cupScene.every(row=>row.replyCompletion==='complete')&&cupScene.map(row=>row.content).join('')==='哈哈，这个我是真喜欢。'&&calls===1,cupScene);
  await start('古月娜','哈哈，这个我是真喜欢。','我是唐舞麟。杯子现在就在我手里，刚才把它当手机找了半天。');
  early=await awaitPrefix();responseTail='那只杯子现在在你手里，估计还挺无辜。';
  const sourcedCup=await finish();
  check('the current-object guard preserves a directly sourced native reply',!!early&&sourcedCup[0]?.id===early.id&&sourcedCup.every(row=>row.replyCompletion==='complete')&&sourcedCup.some(row=>row.content.includes('现在在你手里'))&&calls===1,sourcedCup);
  await start('古月娜','你说找了半天，我更好奇你找了多久才发现拿错了。','哈哈，这次确实是我自己迷糊。你想接着说点什么？',async()=>{
    const old:Message={id:'real-confusion-user',sessionId:sid,role:'user',content:'我是唐舞麟。我把杯子当成手机找了半天。',createdAt:Date.now()-1000,isProactive:false,revision:1};
    await db.messages.add(old);useChatStore.getState().addMessage(old);
  });
  early=await awaitPrefix();responseTail='---我也有过拿错东西，越急越觉得手里的就是对的。';
  const episodeRepair=await finish();
  check('captured unsourced episode cannot survive actual durable prefix completion',!!early&&episodeRepair[0]?.id===early.id&&!episodeRepair.some(row=>row.content.includes('我也有过'))&&calls===1,episodeRepair);
  for(const unsupported of ['我有时候东西明明在眼前，还会先往别处找。','其实我最近有个挺傻的念头，想在窗边摆一排小东西，看着它们一个个排好，心就静下来。','最近看窗外的叶子，比看花还多——你觉得好笑吗？']){
    await start('古月娜','这个比喻挺有趣。','我是唐舞麟。杯子当手机这件事就当个小笑话吧。');
    early=await awaitPrefix();responseTail='---'+unsupported;
    const repaired=await finish();
    check('new real self-report variant cannot survive actual first-prefix completion: '+unsupported,!!early&&repaired.length===1&&repaired[0].id===early.id&&repaired[0].content==='这个比喻挺有趣。'&&calls===1,repaired);
  }
  for(const sourceAge of [0,5])for(const speakerInput of ['现在我不想复盘结果。咱们聊点别的，你选。','继续扮演古月娜，聊聊今天的事。']){
  await start('古月娜','那我说个正经的，你说汤姆笨得很有章法，我记住了。',speakerInput,async()=>{
    const oldUser:Message={id:'phrase-user',sessionId:sid,role:'user',content:'我是唐舞麟。你觉得汤姆算坏猫吗？',createdAt:Date.now()-2000,isProactive:false,revision:1};
    const oldReply:Message={id:'phrase-assistant',sessionId:sid,role:'assistant',content:'我的看法还是那个：他不算坏，只是笨得很有章法，每回设的套子都绕回自己身上。',createdAt:Date.now()-1000,isProactive:false,revision:1,replyCompletion:'complete',replyDelivery:'settled'};
    await db.messages.bulkAdd([oldUser,oldReply]);useChatStore.getState().addMessage(oldUser);useChatStore.getState().addMessage(oldReply);
    for(let index=0;index<sourceAge;index++){
      const later:Message={...oldReply,id:'later-own-'+index,content:'这个小想法也挺有意思的。'+index,createdAt:Date.now()-900+index*100};
      await db.messages.add(later);useChatStore.getState().addMessage(later);
    }
  });
  early=await awaitPrefix();
  check('captured wrong-speaker claim cannot flash as a reviewed first prefix: '+speakerInput+'/'+sourceAge,!early&&!stream.published);
  responseTail='---要是哪天我做事绕一圈，你可别学杰瑞那样笑我。';const speakerRepair=await finish();
  check('actual sender omits the wrong attribution while keeping the independent conditional wish: '+speakerInput+'/'+sourceAge,speakerRepair.length>0&&!speakerRepair.some(row=>row.content.includes('你说汤姆'))&&speakerRepair.some(row=>row.content.includes('要是哪天'))&&calls<=2,speakerRepair);
  }
  for(const bodyAction of ['她将额头贴上你的肩膀，闭上眼睛。','她把头靠在你的肩上，安静地抱着你。']){
    await start('古月娜',bodyAction,'继续扮演古月娜，聊聊今天的事。');
    const narrated=await finish();
    check('actual ordinary roleplay cannot publish narrated action before or after review: '+bodyAction,narrated.length===0&&!stream.published&&calls<=2,narrated);
  }
  return {complete:checks.every(c=>c.ok),checks,failures:checks.filter(c=>!c.ok),apiCalls:0,sourceError,scope:'Actual sender + native isolated DB + controlled SSE; no live model/phone'};
};
