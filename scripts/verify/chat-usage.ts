import {db} from '../../src/db';
import {sendMessage} from '../../src/lib/ai/deepseek';
import {gatewayChatStream} from '../../src/lib/ai/gateway';
import {appendSessionUsage,type ChatUsageEvent} from '../../src/lib/chat/usage';
import {sendRoleChatReply} from '../../src/lib/chat/send-service';
import {ChatReplyStream} from '../../src/lib/chat-stream';
import {useAuthStore} from '../../src/store/auth-store';
import {useChatStore} from '../../src/store/chat-store';
import {useSettingsStore} from '../../src/store/settings-store';
import {webApi} from '../../src/lib/web-api';
import {fakeCharacter} from './world-harness';
import {parseProviderResponse} from '../../src/lib/ai/provider-protocols';

const model='deepseek-flash',owner='usage-owner';
const params={apiKey:'isolated-key',systemPrompt:'你在发消息。',message:'你好',history:[],sessionModel:{provider:'deepseek',model}};
const json=(content:string,input:number,output:number)=>new Response(JSON.stringify({choices:[{message:{content},finish_reason:content?'stop':'length'}],usage:{prompt_tokens:input,completion_tokens:output}}),{headers:{'Content-Type':'application/json'}});
const sse=(content:string,input?:number,output?:number)=>new Response(`data: ${JSON.stringify({choices:[{delta:{content},finish_reason:content?'stop':'length'}],...(input!==undefined?{usage:{prompt_tokens:input,completion_tokens:output}}:{})})}\n\ndata: [DONE]\n\n`,{headers:{'Content-Type':'text/event-stream'}});

async function run() {
  let checks=0,calls=0;
  const ok=(condition:unknown,label:string)=>{if(!condition)throw Error(label);checks++;console.log('ok '+label);};
  useAuthStore.getState().login(owner,'usage fixture','isolated-key','');
  useSettingsStore.setState({defaultModel:{provider:'deepseek',model},aiVoiceMode:false,ttsEnabled:false});
  for(const usage of [{},{prompt_tokens:12},{prompt_tokens:-1,completion_tokens:2}])ok(!parseProviderResponse({choices:[{message:{content:'test'}}],usage},'openai').usage,'malformed or partial provider usage remains unknown instead of zero');
  ok(parseProviderResponse({choices:[{message:{content:'test'}}],usage:{prompt_tokens:0,completion_tokens:0}},'openai').usage?.inputTokens===0,'an explicit valid zero remains a real known count');
  let events:ChatUsageEvent[]=[];
  window.fetch=async()=>++calls===1?json('',11,7):json('来啦。',17,5);
  const recovered=await sendMessage({...params,onUsage:event=>events.push(event)});
  ok(calls===2&&events.length===2&&recovered.usageEvents?.length===2,'empty JSON recovery retains both provider usage events exactly once');
  ok(events.reduce((sum,e)=>sum+(e.usage?.inputTokens??0),0)===28&&events.reduce((sum,e)=>sum+(e.usage?.outputTokens??0),0)===12,'recovery accounts for consumed empty reasoning output rather than only visible text');
  calls=0;events=[];
  window.fetch=async()=>++calls===1?sse('',100,300):sse('这次有正文。',22,8);
  await sendMessage({...params,onDelta:()=>undefined,onUsage:event=>events.push(event)});
  ok(calls===2&&events.length===2&&events[0].usage?.outputTokens===300,'empty SSE reports usage before its recovery error without a second unknown event');
  calls=0;
  window.fetch=async()=>{calls++;return json('来啦。',4,3);};
  await sendMessage({...params,onUsage:()=>{throw Error('observer fixture');}});
  ok(calls===1,'usage observer failure never retries a completed paid request');
  calls=0;events=[];
  window.fetch=async()=>{calls++;throw new TypeError('synthetic network failure');};
  const failed=await webApi.chat.send({...params,onUsage:event=>events.push(event)});
  ok(!!failed.error&&calls===2&&events.length===2&&events.every(event=>!event.usage),'network failure and recovery retain two unknown attempts without invented zero usage');
  calls=0;
  window.fetch=async()=>{calls++;return new Response('{}',{status:401});};
  const denied=await webApi.chat.send(params);
  ok(denied.error==='auth:invalid_key'&&calls===1&&denied.usageEvents?.length===0,'credential rejection does not fabricate consumed tokens or a recovery call');
  calls=0;events=[];
  window.fetch=async()=>++calls===1?new Response('',{status:404}):new Response(JSON.stringify({content:'兼容回复',usage:{inputTokens:54,outputTokens:6},modelId:model}));
  await gatewayChatStream({...params,onDelta:()=>undefined,onUsage:event=>events.push(event)},{baseUrl:'https://isolated.invalid'});
  ok(calls===2&&events.length===1&&events[0].usage?.inputTokens===54,'gateway endpoint discovery is not counted as a second model request');
  events=[];
  window.fetch=async()=>sse('',55,3);
  await gatewayChatStream({...params,onDelta:()=>undefined,onUsage:event=>events.push(event)},{baseUrl:'https://isolated.invalid'}).catch(()=>undefined);
  ok(events.length===1&&events[0].usage?.inputTokens===55,'gateway empty SSE preserves its actual usage before throwing');

  await db.delete();await db.open();
  await db.sessions.add({id:'ledger',userId:owner,characterId:'role',title:'fixture',createdAt:1,updatedAt:1});
  const ledger=await appendSessionUsage('ledger',owner,[{modelId:model,usage:{inputTokens:11,outputTokens:7}},{modelId:model,usage:{inputTokens:17,outputTokens:5}}],()=>true);
  ok(ledger?.calls===2&&ledger.inputTokens===28&&ledger.outputTokens===12,'real session ledger sums every recovery attempt');
  await Promise.all([appendSessionUsage('ledger',owner,[{modelId:model,usage:{inputTokens:3,outputTokens:2}}],()=>true),appendSessionUsage('ledger',owner,[{modelId:model,usage:{inputTokens:5,outputTokens:4}}],()=>true)]);
  const concurrent=(await db.sessions.get('ledger'))!.cost!;
  ok(concurrent.calls===4&&concurrent.inputTokens===36&&concurrent.outputTokens===18,'transactional accumulation does not lose concurrent metadata updates');
  await appendSessionUsage('ledger',owner,[{modelId:model}],()=>true);
  const unknown=(await db.sessions.get('ledger'))!.cost!;
  ok(unknown.calls===5&&unknown.unknownUsageCalls===1&&unknown.incomplete&&unknown.inputTokens===36,'unknown usage is explicitly marked and does not masquerade as a known zero');
  await appendSessionUsage('ledger','other',[{modelId:model,usage:{inputTokens:999,outputTokens:999}}],()=>true);
  await appendSessionUsage('ledger',owner,[{modelId:model,usage:{inputTokens:999,outputTokens:999}}],()=>false);
  ok((await db.sessions.get('ledger'))!.cost!.calls===5,'different owner and switched account reject late usage writes');
  let guardCalls=0;
  await appendSessionUsage('ledger',owner,[{modelId:model,usage:{inputTokens:999,outputTokens:999}}],()=>++guardCalls<3);
  ok((await db.sessions.get('ledger'))!.cost!.calls===5,'account is rechecked immediately before committing inside the transaction');
  await db.sessions.add({id:'legacy-ledger',userId:owner,characterId:'role',title:'old fixture',createdAt:1,updatedAt:1,cost:{calls:3,inputTokens:40,outputTokens:20,cost:.1}});
  const legacy=await appendSessionUsage('legacy-ledger',owner,[{modelId:model,usage:{inputTokens:2,outputTokens:1}}],()=>true);
  ok(legacy?.calls===4&&legacy.inputTokens===42&&legacy.perAttemptAccounting&&legacy.incomplete,'legacy totals remain intact and honestly incomplete rather than pretending to reconstruct missing retries');

  webApi.context.summarize=async()=>({error:'server:error'});
  webApi.context.settle=async()=>({error:'server:error'});
  webApi.memory.extract=async()=>({memories:[]});
  const role=fakeCharacter('private-role','测试人物',owner,{isPreset:true,systemPrompt:'你是一个有自己想法的人。\n对话样本：用户说你好 → 你说来啦。\n对话样本：用户说我爱你 → 你说我也喜欢你。'});
  await db.characters.add(role);
  await db.sessions.add({id:'private',userId:owner,characterId:role.id,title:'private',createdAt:1,updatedAt:1,modelAsked:true,model:{provider:'deepseek',model}});
  useChatStore.setState({characters:[role],currentSessionId:'private',selectedCharacterId:role.id,messages:[]});
  calls=0;
  const browserSend=webApi.chat.send;
  // A buffered compatible/native response may be reviewed before publication.
  // Real SSE is intentionally never secretly replaced after visible text.
  webApi.chat.send=async p=>sendMessage({...p,onDelta:undefined});
  window.fetch=async()=>++calls===1?json('首先，我们梳理需求；其次，我们制定计划。',10,4):json('来啦。',20,6);
  const user={id:'private-user',sessionId:'private',role:'user' as const,content:'你好',createdAt:Date.now(),isProactive:false};
  await db.messages.add(user);
  const stream=new ChatReplyStream('private',()=>undefined);
  try {await sendRoleChatReply(role,user,{userId:owner,controller:new AbortController(),stream,completed:false,stopped:false},{userId:owner,text:user.content});}finally{stream.dispose();}
  const privateCost=(await db.sessions.get('private'))!.cost!;
  ok(calls===2&&privateCost.calls===2&&privateCost.inputTokens===30&&privateCost.outputTokens===10,'actual private quality retry counts both drafts once rather than selected draft only');
  ok((await db.messages.where('sessionId').equals('private').toArray()).filter(row=>row.role==='assistant').every(row=>!row.content.includes('首先')),'accounting rejected draft does not publish it as conversation history');
  webApi.chat.send=browserSend;
  calls=0;
  window.fetch=async()=>++calls===1?sse('',100,300):sse('这次有正文。',22,8);
  const streamUser={...user,id:'private-recovery',content:'再聊两句',createdAt:Date.now()};
  await db.messages.add(streamUser);
  const recoveryStream=new ChatReplyStream('private',()=>undefined);
  try {await sendRoleChatReply(role,streamUser,{userId:owner,controller:new AbortController(),stream:recoveryStream,completed:false,stopped:false},{userId:owner,text:streamUser.content});}finally{recoveryStream.dispose();}
  const streamCost=(await db.sessions.get('private'))!.cost!;
  ok(calls===2&&streamCost.calls===4&&streamCost.inputTokens===152&&streamCost.outputTokens===318,'actual streamed private recovery persists empty reasoning and final reply usage once each');
  const originalSend=browserSend;
  try {
    webApi.chat.send=async()=>({error:'server:error',usageEvents:[{modelId:model,usage:{inputTokens:7,outputTokens:2}}]});
    const failureUser={...user,id:'private-failed',content:'你好呀',createdAt:Date.now()};
    await db.messages.add(failureUser);
    const failureStream=new ChatReplyStream('private',()=>undefined);
    try {await sendRoleChatReply(role,failureUser,{userId:owner,controller:new AbortController(),stream:failureStream,completed:false,stopped:false},{userId:owner,text:failureUser.content});}finally{failureStream.dispose();}
    const failureCost=(await db.sessions.get('private'))!.cost!;
    ok(failureCost.calls===5&&failureCost.inputTokens===159&&(await db.messages.get(failureUser.id))?.failed,'failed delivery still persists known usage returned by a callback-free bridge');
  } finally {webApi.chat.send=originalSend;}
  await db.sessions.add({id:'listening-private',userId:owner,characterId:role.id,title:'listening',createdAt:1,updatedAt:1,modelAsked:true,model:{provider:'deepseek',model}});
  useChatStore.setState({currentSessionId:'listening-private',messages:[]});
  const inputs=['今天讲了半天没被听懂。我只是吐槽，不想要建议。','还有，他又把我说的话听反了。','现在帮我写一句回复，短一点，我想告诉他先听我说完。'];
  const answers=['话都没听清就下结论，这点我也不赞成。','连意思都反了，那确实还没听明白。','先听我说完，再说你的看法。'];
  const prompts:string[]=[];
  calls=0;
  window.fetch=async()=>sse(answers[calls++],12,3);
  webApi.chat.send=async p=>{prompts.push(p.systemPrompt);return browserSend(p);};
  try {
    for (const [index,content] of inputs.entries()) {
      const row={...user,id:`listening-user-${index}`,sessionId:'listening-private',content,createdAt:Date.now()};
      await db.messages.add(row);
      const listeningStream=new ChatReplyStream(row.sessionId,()=>undefined);
      try {await sendRoleChatReply(role,row,{userId:owner,controller:new AbortController(),stream:listeningStream,completed:false,stopped:false},{userId:owner,text:content});}finally{listeningStream.dispose();}
      const state=(await db.sessions.get(row.sessionId))!.conversation!;
      ok(index<2?state.topicAdvice==='listen':!state.topicAdvice, 'actual private DB preserves listening through continuation and releases it for a concrete task');
      ok(state.preferences.adviceStyle==='mixed'&&state.preferences.brevity==='balanced','actual writing recipient and output length never pollute persistent user preferences');
    }
    ok(prompts.slice(0,2).every(prompt=>prompt.includes('用户这件事想先说出来'))&&!prompts[2].includes('用户这件事想先说出来'),'production transport receives effective listening tail only while applicable');
    ok(prompts.every(prompt=>!prompt.includes('我也喜欢你'))&&(await db.characters.get(role.id))!.systemPrompt.includes('我也喜欢你'),'actual private requests keep unrelated source examples out while preserving the stored original persona');
    const listeningSession=(await db.sessions.get('listening-private'))!;
    ok(calls===3&&listeningSession.cost?.calls===3&&listeningSession.cost.inputTokens===36,'three-turn listening requires exactly one provider request per turn');
    const saved=await db.messages.where('sessionId').equals('listening-private').toArray();
    ok(saved.filter(message=>message.role==='assistant').length===3&&saved.some(message=>message.content===answers[2]),'three-turn acceptance verifies persisted replies rather than state labels alone');
  } finally {webApi.chat.send=originalSend;}
  return {checks};
}
(window as any).chatUsageTest={run};
