// Offline regression for the exact thinking-mode failure. Saved model output
// is input evidence here, never a newly generated or accepted conversation.
import './chat-human-live';
import {db} from '../../src/db';
import {chooseConversationAction,buildHumanConversationSections} from '../../src/lib/chat-humanizer';

const api=window as any,harness=api.liveExpression;
const owner='isolated-live-expression-owner',actor='isolated-live-role',sessionId='isolated-live-session';
const original='古月，我是唐舞麟。今天的锻造总算忙完了，刚闲下来就想你了。你呢，有没有什么想和我说的？';
const unsupported='舞麟，累不累？先歇一会儿吧。我这边没什么大事，就是院子里那株花今天开得特别好，颜色我很喜欢，想指给你看看。';
const challenge='古月，我想听你的心里话，不用特意找件新鲜事逗我开心。那株花如果只是你想象的，就直说。能这样和你聊会儿，我已经很高兴了。';
const history=[{role:'user',content:original},{role:'assistant',content:unsupported}];
const positive=[challenge,'你刚才说的是真的，还是你想象的？','那件事如果只是你编的，就直说。','你说你去了书店，这是真的还是编的？','你上一条说的那次旅行，有真实来源吗？','你刚才说的真有依据？','我想听你的看法。你刚才说的是真的吗？'];
const negative=['如果你想象那株花开了，会是什么样？','帮我写一句“那件事如果只是你编的，就直说”。','朋友问你刚才说的是真的还是编的。','“你刚才说的是真的吗？”这句话怎么翻译？','如果朋友说那件事是编的，你怎么安慰她？','你觉得这朵花好看吗？','我有点难过，陪我说会儿话。','我听到有人问你刚才说的是真的还是编的。','请翻译：你刚才说的是真的吗？','你刚才说的是真的，我核对过了。'];
const rows:any[]=[];let calls:any[]=[];
window.fetch=async(url,init)=>{
 if(!String(url).includes('/chat/completions'))throw Error('Unexpected transport');
 const body=JSON.parse(String(init?.body));calls.push(body);
 // Deliberately fixed, not evidence of improved generation.
 return Response.json({choices:[{message:{content:'我想你了。'},finish_reason:'stop'}]});
};
api.runReplySourceQuestion=async()=>{
 const checks:Array<{name:string;ok:boolean}>=[];
 const check=(name:string,value:unknown)=>checks.push({name,ok:!!value});
 const context=(text:string,character?:any,options?:any)=>buildHumanConversationSections(text,history,character,options).map(s=>s.text).join('\n');
 for(const text of positive){
  const full=context(text);rows.push({input:text,action:chooseConversationAction(text,history),context:full});
  check('source challenge receives evidence reconciliation: '+text,full.includes('[本轮经历核对]'));
  check('source challenge outranks mood and chat invitation: '+text,chooseConversationAction(text,history)==='answer-directly');
  check('source challenge does not receive a competing mood instruction: '+text,!full.includes('表达线索仅作参考')&&!full.includes('情绪表达线索'));
  check('source question is not reframed as an unchallenged opinion invitation: '+text,!full.includes('不是质疑你的主见'));
 }
 for(const text of negative)check('quoted, third-party, creative and ordinary turns stay outside source challenge: '+text,!context(text).includes('[本轮经历核对]'));
 const known=context(positive[1],{name:'测试角色',tags:[],systemPrompt:'背景：周六在书店签售。\n对话样本：用户说花 → 你说我院子的花开了。'},{lifeHints:['周六在书店签售，下午三点结束。']});
 const block=known.split('[本轮经历核对]')[1]?.split('[/本轮经历核对]')[0]??'';
 check('independent authored and life evidence remain available',block.includes('周六在书店签售')&&block.includes('下午三点结束'));
 check('voice examples are excluded from factual evidence',!block.includes('我院子的花开了'));
 check('challenge is not an automatic denial or admission of fabrication',block.includes('缺少记载不等于从未发生')&&block.includes('先前随口生成的自述不能证明'));
 const native:any[]=[];
 for(const name of ['古月娜','陆雪琪']){
  const preset=harness.presets(true).find((p:any)=>p.name===name);
  await harness.setup({...preset,createdBy:owner,isPreset:false,isCustom:true},.5);
  await harness.restoreSavedTurns([{input:name==='古月娜'?original:'我是张小凡。今天终于闲下来了，你有没有什么想和我说的？',replies:[unsupported]}]);
  const before=await db.messages.where('sessionId').equals(sessionId).sortBy('createdAt');
  calls=[];const result=await harness.turn(challenge);
  const main=calls.filter(c=>c.messages.at(-1)?.content===challenge);
  const body=main[0],system=body?.messages.find((m:any)=>m.role==='system')?.content??'';
  const after=await db.messages.where('sessionId').equals(sessionId).sortBy('createdAt');
  check(name+' production request contains one evidence block',(system.match(/\[本轮经历核对\]/gu)??[]).length===1);
  check(name+' only one main request and no quality retry',main.length===1&&!result.failed);
  check(name+' original assistant claim remains verbatim, not silently rewritten',body?.messages.some((m:any)=>m.role==='assistant'&&m.content===unsupported));
  check(name+' source messages retain their stored content and versions',before.every(row=>{const found=after.find(m=>m.id===row.id);return JSON.stringify(row)===JSON.stringify(found);}));
  check(name+' thinking remains enabled',body?.thinking?.type==='enabled');
  check(name+' current user input remains exact',body?.messages.at(-1)?.content===challenge);
  native.push({name,result,mainRequests:main,priorMessages:before,allMessages:after});
 }
 return {scope:'Offline prompt routing/source preservation only; fixed transport does not validate real-model truthfulness.',checks,failures:checks.filter(c=>!c.ok),complete:checks.every(c=>c.ok),rows,native,paidCalls:0,realModelImprovementVerified:false,initialUnsupportedSelfDisclosureStillOpen:true};
};
