// Isolated actual settlement store + native database. Adversarial output is a
// local replacement, never a paid model or evidence of model improvement.
import './chat-human-live';
import {db} from '../../src/db';
import {webApi} from '../../src/lib/web-api';
import {useEmotionStore} from '../../src/store/emotion-store';
import {useCharacterStateStore} from '../../src/store/character-state-store';
import {consolidateContext} from '../../src/lib/ai/context-consolidator';
import {continuityRepo} from '../../src/db/continuity-repo';
const api=window as any,harness=api.liveExpression;
const owner='isolated-live-expression-owner',actor='isolated-live-role',sessionId='isolated-live-session';
const dimensions={valence:5,arousal:5,intimacy:5,engagement:5,expressiveness:5,stability:5};
const turns=[
 {input:'古月，我是唐舞麟。今天的锻造忙完了，刚闲下来就想你了。你有没有什么想和我说的？',replies:['院子里那株花今天开得特别好。']},
 {input:'那株花如果只是你想象的，就直说。能这样和你聊会儿，我已经很高兴了。',replies:['花是真的，只是还没开。']},
 {input:'周六14点去博物馆，坐地铁。我晚上不喝咖啡。',replies:['好。']},
];
api.runSettlementSourceKinds=async()=>{
 const checks:Array<{name:string;ok:boolean}>=[],rows:any[]=[];const check=(name:string,value:unknown)=>checks.push({name,ok:!!value});
 const scenarios=[
  {name:'assistant-only',evidence:[1],accepted:false},
  {name:'mixed-user-assistant',evidence:[2,1],accepted:false},
  {name:'mixed-assistant-user',evidence:[1,2],accepted:false},
  {name:'two-user-sources',evidence:[0,4],accepted:true},
  {name:'one-user-source',evidence:[4],accepted:true},
  {name:'empty',evidence:[],accepted:false},
  {name:'out-of-range',evidence:[4,999],accepted:false},
  {name:'fractional',evidence:[4,1.5],accepted:false},
 ];
 const badMemory='古月娜院子里的花今天开了。',badTitle='去院子看花';
 for(const scenario of scenarios){
  const preset=harness.presets(true).find((p:any)=>p.name==='古月娜');
  await harness.setup({...preset,createdBy:owner,isPreset:false,isCustom:true},.5);
  await harness.restoreSavedTurns(turns);
  useEmotionStore.getState().clearCurrent();useCharacterStateStore.setState({affinityByCharacter:{}});
  const priorMessages=await db.messages.where('sessionId').equals(sessionId).sortBy('createdAt');
  const content=scenario.accepted?'用户晚上不喝咖啡。':badMemory;
  const title=scenario.accepted?'周六博物馆':badTitle;
  let count=0,request:any;
  const save=webApi.context.settle;
  webApi.context.settle=async(params:any)=>{count++;request=params;return {dimensions,dominantEmotion:'平静',summary:'本地替身状态',memories:[{content,evidence:scenario.evidence},{content:'用户周六14点去博物馆，坐地铁。',evidence:[4]}],threads:[{action:'create',kind:'plan',title,detail:content,evidence:scenario.evidence}]};};
  try{await useEmotionStore.getState().settle(actor,sessionId,'古月娜');}finally{webApi.context.settle=save;}
  const memories=await db.memories.where('characterId').equals(actor).toArray(),threads=await db.continuityThreads.where('characterId').equals(actor).toArray();
  const sourceKinds=request?.history.map((m:any)=>m.role)??[];
  check(scenario.name+' selected original user/assistant roles preserved',JSON.stringify(sourceKinds)===JSON.stringify(['user','assistant','user','assistant','user','assistant']));
  check(scenario.name+' one existing settlement call only',count===1);
  check(scenario.name+' candidate memory is accepted only with wholly valid user evidence',memories.some(m=>m.content===content)===scenario.accepted);
  check(scenario.name+' candidate thread is accepted only with wholly valid user evidence',threads.some(t=>t.title===title)===scenario.accepted);
  check(scenario.name+' independent valid user fact survives',memories.some(m=>m.content==='用户周六14点去博物馆，坐地铁。'&&m.sourceMessageIds?.every(id=>priorMessages.find(row=>row.id===id)?.role==='user')));
  const after=await db.messages.where('sessionId').equals(sessionId).sortBy('createdAt');
  check(scenario.name+' originals are not rewritten or removed',JSON.stringify(after)===JSON.stringify(priorMessages));
  rows.push({scenario,request,memories,threads,sourceKinds,priorMessages});
 }
 for(const evidence of [[1,4],[4]]){
  const preset=harness.presets(true).find((p:any)=>p.name==='古月娜');
  await harness.setup({...preset,createdBy:owner,isPreset:false,isCustom:true},.5);
  await harness.restoreSavedTurns([...turns.slice(0,2),{input:'把博物馆标记为已完成。',replies:['好。']}]);
  useEmotionStore.getState().clearCurrent();
  await continuityRepo.create({userId:owner,characterId:actor,kind:'plan',title:'博物馆',origin:'user'});
  const prior=(await db.continuityThreads.where('[userId+characterId+title]').equals([owner,actor,'博物馆']).first())!,threadId=prior.id,save=webApi.context.settle;
  webApi.context.settle=async()=>({dimensions,dominantEmotion:'平静',summary:'本地替身',threads:[{action:'complete',targetId:threadId,kind:'plan',title:'博物馆',evidence}]});
  try{await useEmotionStore.getState().settle(actor,sessionId,'古月娜');}finally{webApi.context.settle=save;}
  const after=(await db.continuityThreads.get(threadId))!;
  check('completion rejects mixed evidence and permits explicit user completion '+JSON.stringify(evidence),after.status===(evidence.length===1?'done':'open'));
  check('completion retains the original item identity '+JSON.stringify(evidence),after.id===prior.id&&after.title===prior.title);
  rows.push({completionEvidence:evidence,prior,after});
 }
 // Exercise the real local client prompt/parse, with fixed transport.
 const oldFetch=window.fetch;let wire:any,rawEvidence:unknown[]=[];
 window.fetch=async(_url,init)=>{wire=JSON.parse(String(init?.body));return Response.json({choices:[{message:{content:JSON.stringify({...dimensions,memories:[{content:'测试候选',evidence:rawEvidence}],threads:[{action:'create',kind:'plan',title:'测试候选',evidence:rawEvidence}],dominantEmotion:'平静',userEmotion:'平静',summary:'本地替身'})},finish_reason:'stop'}]});};
 let parsed;
 const parserRows:any[]=[];
 try{for(const [candidate,expected]of [[[],[]],[[1],[]],[[4,1],[]],[[4,999],[]],[[4,1.5],[]],[[4,'1'],[]],[[4,null],[]],[[4,true],[]],[[4,false],[]],[[4,4],[4]],[[0,4],[0,4]]] as Array<[unknown[],number[]]>){
  rawEvidence=candidate;
  parsed=await consolidateContext({apiKey:'synthetic-not-a-credential',characterName:'古月娜',history:turns.flatMap(t=>[{role:'user',content:t.input},...t.replies.map(content=>({role:'assistant',content}))])});
  check('real parser retains whole valid evidence or rejects it: '+JSON.stringify(candidate),JSON.stringify(parsed.memories?.[0]?.evidence)===JSON.stringify(expected)&&JSON.stringify(parsed.threads?.[0]?.evidence)===JSON.stringify(expected));parserRows.push({candidate,expected,parsed});
 }}finally{window.fetch=oldFetch;}
 const system=wire?.messages.find((m:any)=>m.role==='system')?.content??'';
 check('settlement request still parses its existing emotion output',!!parsed.dimensions&&!parsed.error);
 check('settlement no longer asks for character autobiography as user memory',!system.includes('以及 AI 角色明确说出的近况或承诺'));
 check('settlement requires user-only evidence for memories and matters',system.includes('只能引用用户原话')&&system.includes('角色自己的近况'));
 return {complete:checks.every(c=>c.ok),checks,failures:checks.filter(c=>!c.ok),rows,wire,parsed,parserRows,paidCalls:0,scope:'Actual native settlement; synthetic six-message Gu/Tang exchange and adversarial replacement output. Not genuine semantic/model acceptance.'};
};
