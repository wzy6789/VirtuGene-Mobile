import {db,type ContinuityThread,type Message,type Character} from '../../src/db';
import {continuityRepo} from '../../src/db/continuity-repo';
import {captureContinuityChatEvidence} from '../../src/lib/continuity-sources';
import {useAuthStore} from '../../src/store/auth-store';
import {useChatStore} from '../../src/store/chat-store';
import {useSettingsStore} from '../../src/store/settings-store';
import {useEmotionStore} from '../../src/store/emotion-store';
import {ipc} from '../../src/lib/ipc-client';
import {consolidateContext} from '../../src/lib/ai/context-consolidator';
import {captureChatAuxiliary,validateChatAuxiliary,commitChatAuxiliary} from '../../src/db/chat-auxiliary-guard';
const owner='identity-owner',actor='identity-actor',sessionId='identity-session';
const dates=[Date.UTC(2030,0,7),Date.UTC(2030,0,8)];
const checks:Array<{name:string;ok:boolean;detail?:unknown}>=[],rows:any[]=[];
const check=(name:string,ok:unknown,detail?:unknown)=>checks.push({name,ok:!!ok,...(detail===undefined?{}:{detail})});
let calls=0;
window.fetch=async()=>{throw Error('No real network in identity fixture');};
async function seed(){
 await db.delete();await db.open();
 useAuthStore.getState().login(owner,'隔离事项身份','synthetic-not-a-credential','');
 useSettingsStore.setState({ttsEnabled:false,aiVoiceMode:false});
 const character:Character={id:actor,name:'林舟',avatar:'🌙',systemPrompt:'仅用于本地隔离验收。',tags:[],isPreset:false,isCustom:true,published:false,createdBy:owner,createdAt:1,proactivity:0,signature:'',greeting:'你好。'};
 await db.characters.put(character);await db.sessions.put({id:sessionId,userId:owner,characterId:actor,title:'事项身份',type:'private',createdAt:1,updatedAt:1});
 const messages=['1月7日有一场数学考试。','知道了。','1月8日还有另一场数学考试。','知道了。','1月8日那场数学考试已经考完了。'].map((content,index):Message=>({id:'identity-message-'+index,sessionId,role:index%2?'assistant':'user',content,revision:1,createdAt:10+index,isProactive:false}));
 await db.messages.bulkPut(messages);useChatStore.setState({characters:[character],selectedCharacterId:actor,currentSessionId:sessionId,messages});useEmotionStore.getState().clearCurrent();return messages;
}
const input=(source:Message,overrides:Record<string,unknown>={})=>({characterId:actor,userId:owner,kind:'plan' as const,title:'数学考试',dueAt:dates[0],detail:source.content,origin:'ai' as const,sourceMessageIds:[source.id],sourceEvidence:captureContinuityChatEvidence([source],[source.id]),...overrides});
async function independent(){const messages=await seed();const threads=messages.filter((_,i)=>i===0||i===2).map((source,index):ContinuityThread=>({id:'identity-exam-'+index,characterId:actor,userId:owner,kind:'plan',title:'数学考试',detail:source.content,dueAt:dates[index],status:'open',origin:'ai',createdAt:100+index,updatedAt:100+index,sourceMessageIds:[source.id],sourceEvidence:captureContinuityChatEvidence([source],[source.id])}));await db.continuityThreads.bulkPut(threads);return {messages,threads};}
(window as any).runThreadIdentity=async()=>{
 let sources=await seed();await continuityRepo.createMany([input(sources[0]),input(sources[2],{dueAt:dates[1]})]);
 let actual=await db.continuityThreads.toArray();check('two same-title dated exams retain independent IDs',actual.length===2&&new Set(actual.map(row=>row.dueAt)).size===2,actual);
 sources=await seed();await continuityRepo.create({...input(sources[0]),origin:'user'});
 const manualBefore=(await db.continuityThreads.toArray())[0];
 await continuityRepo.createMany([input(sources[2],{dueAt:dates[1]})]);
 actual=await db.continuityThreads.toArray();check('manual same-title occurrence cannot suppress a distinct later AI occurrence',actual.length===2&&actual.some(row=>row.dueAt===dates[1])&&JSON.stringify(actual.find(row=>row.id===manualBefore.id))===JSON.stringify(manualBefore),actual);
 sources=await seed();await continuityRepo.createMany([input(sources[0],{kind:'plan',title:'下周数学考试'}),input(sources[2],{kind:'conflict',title:'下周数学考试分歧'})]);
 actual=await db.continuityThreads.toArray();check('similar wording cannot merge different kinds',actual.length===2,actual);
 sources=await seed();await continuityRepo.createMany([input(sources[0],{dueAt:undefined}),input(sources[2],{dueAt:undefined})]);
 actual=await db.continuityThreads.toArray();check('disjoint unknown-date evidence is not identity proof',actual.length===2,actual);
 let fixture=await independent();
 const reschedule:Message={id:'identity-reschedule',sessionId,role:'user',content:'第二场数学考试改到2030年1月9日。',revision:1,createdAt:30,isProactive:false};await db.messages.put(reschedule);
 await continuityRepo.createMany([input(reschedule,{targetId:fixture.threads[1].id,expectedThread:fixture.threads[1],dueAt:Date.UTC(2030,0,9),detail:'只调整第二场。'}) as any]);
 const changed=await db.continuityThreads.get(fixture.threads[1].id),untouched=await db.continuityThreads.get(fixture.threads[0].id);
 check('selected ID updates only the second same-title event',changed?.dueAt===Date.UTC(2030,0,9)&&changed.detail==='只调整第二场。'&&JSON.stringify(untouched)===JSON.stringify(fixture.threads[0]),{changed,untouched});
 fixture=await independent();await continuityRepo.createMany([input(fixture.messages[4],{targetId:'not-an-observed-id',expectedThread:fixture.threads[0],detail:'不能回退到标题猜测。'}) as any]);
 check('unknown target ID never falls back to title or creation',JSON.stringify((await db.continuityThreads.toArray()).sort((a,b)=>a.id.localeCompare(b.id)))===JSON.stringify(fixture.threads),await db.continuityThreads.toArray());
 fixture=await independent();await db.continuityThreads.update(fixture.threads[1].id,{updatedAt:999,detail:'用户后来改过。'});
 await continuityRepo.createMany([input(fixture.messages[4],{targetId:fixture.threads[1].id,expectedThread:fixture.threads[1],detail:'旧模型不得覆盖。'}) as any]);
 check('stale exact target snapshot cannot overwrite later user edit',(await db.continuityThreads.get(fixture.threads[1].id))?.detail==='用户后来改过。');
 fixture=await independent();
 const foreign={...fixture.threads[0],id:'foreign-identity',userId:'other-owner',characterId:'other-role'};await db.continuityThreads.put(foreign);
 await continuityRepo.createMany([input(fixture.messages[4],{targetId:foreign.id,expectedThread:foreign,detail:'不能跨归属。'}) as any]);
 check('an explicit ID cannot cross user or character boundaries',JSON.stringify(await db.continuityThreads.get(foreign.id))===JSON.stringify(foreign)&&await db.continuityThreads.count()===3);
 const beforeMixed=JSON.stringify(await db.continuityThreads.toArray());
 await continuityRepo.createMany([input(fixture.messages[4]),input(fixture.messages[4],{characterId:'other-role',userId:'other-owner'})]);
 check('mixed-principal batch is rejected atomically',JSON.stringify(await db.continuityThreads.toArray())===beforeMixed);
 fixture=await independent();
 let captured:any;ipc.context.settle=async request=>{calls++;captured=request;return {dimensions:{valence:5,arousal:5,intimacy:5,engagement:5,expressiveness:5,stability:5},dominantEmotion:'平静',summary:'本地验收',threads:[{action:'complete',kind:'plan',title:'数学考试',targetId:fixture.threads[1].id,evidence:[4]}]};};
 await useEmotionStore.getState().settle(actor,sessionId,'林舟');
 actual=await db.continuityThreads.toArray();
 check('actual background request carries both distinct IDs and dates',Array.isArray(captured?.continuity)&&captured.continuity.length===2&&captured.continuity.every((row:any)=>fixture.threads.some(thread=>thread.id===row.id&&thread.dueAt===row.dueAt)),captured);
 check('actual settlement completes selected exam and preserves other one',actual.find(row=>row.id===fixture.threads[1].id)?.status==='done'&&actual.find(row=>row.id===fixture.threads[0].id)?.status==='open',actual);
 rows.push({scenario:'actual-id-completion',captured,threads:actual});
 fixture=await independent();ipc.context.settle=async()=>{calls++;return {dimensions:{valence:5,arousal:5,intimacy:5,engagement:5,expressiveness:5,stability:5},threads:[{action:'complete',kind:'plan',title:'数学考试',targetId:'unobserved-identifier',evidence:[4]}]};};
 await useEmotionStore.getState().settle(actor,sessionId,'林舟');
 check('actual unobserved model ID never completes a title match',(await db.continuityThreads.toArray()).every(thread=>thread.status==='open'));
 fixture=await independent();await db.messages.update(fixture.messages[4].id,{content:'数学考试已经考完了。',revision:2});
 ipc.context.settle=async()=>{calls++;return {dimensions:{valence:5,arousal:5,intimacy:5,engagement:5,expressiveness:5,stability:5},threads:[{action:'complete',kind:'plan',title:'数学考试',targetId:fixture.threads[1].id,evidence:[4]}]};};
 await useEmotionStore.getState().settle(actor,sessionId,'林舟');
 check('model ID alone cannot choose between two dates after ambiguous user completion',(await db.continuityThreads.toArray()).every(thread=>thread.status==='open'));
 fixture=await independent();let releases!:(result:any)=>void,entered!:()=>void;
 const gate=new Promise<any>(resolve=>{releases=resolve}),started=new Promise<void>(resolve=>{entered=resolve});
 ipc.context.settle=async request=>{calls++;captured=request;entered();return gate;};
 const pending=useEmotionStore.getState().settle(actor,sessionId,'林舟');await started;
 await continuityRepo.update(fixture.threads[1].id,{detail:'等待期间修改第二场。'});
 releases({dimensions:{valence:5,arousal:5,intimacy:5,engagement:5,expressiveness:5,stability:5},threads:[{action:'complete',kind:'plan',title:'数学考试',targetId:fixture.threads[1].id,evidence:[4]}]});await pending;
 check('actual late settlement leaves modified selected event open',(await db.continuityThreads.get(fixture.threads[1].id))?.status==='open'&&(await db.continuityThreads.get(fixture.threads[1].id))?.detail==='等待期间修改第二场。');
 check('one model call per requested background analysis, no identity retry',calls===4,calls);
 const providerCalls:any[]=[];
 window.fetch=async(_url,init)=>{providerCalls.push(JSON.parse(String(init?.body)));return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({valence:5,arousal:5,intimacy:5,engagement:5,expressiveness:5,stability:5,threads:[{action:'complete',kind:'plan',title:'数学考试',targetId:fixture.threads[1].id,evidence:[4]}]})},finish_reason:'stop'}]}),{headers:{'Content-Type':'application/json'}});};
 const parsed=await consolidateContext({apiKey:'synthetic-not-a-key',characterName:'林舟',history:fixture.messages.map(({role,content})=>({role,content})),continuity:fixture.threads});
 const system=String(providerCalls[0]?.messages?.[0]?.content);
 check('actual provider protocol carries exact IDs and readable dates',providerCalls.length===1&&system.includes(fixture.threads[0].id)&&system.includes(fixture.threads[1].id)&&system.includes('2030-01-08'),providerCalls);
 check('actual provider parser preserves selected targetId',parsed.threads?.[0]?.targetId===fixture.threads[1].id,parsed);
 return {complete:checks.every(check=>check.ok),checks,failures:checks.filter(check=>!check.ok),rows,localModelStubs:calls,apiCalls:0};
};

const fixtureHash=async(value:unknown)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))).map(value=>value.toString(16).padStart(2,'0')).join('');
(window as any).prepareIdentityStock=async()=>{
 await independent();
 await db.continuityThreads.bulkPut(Array.from({length:50000},(_,i)=>({id:'identity-closed-'+i,characterId:actor,userId:owner,kind:'plan' as const,title:'无关旧事项'+i,status:'done' as const,origin:'user' as const,createdAt:1,updatedAt:1})));
 await db.memorySourceTombstones.bulkPut(Array.from({length:8105},(_,i)=>({id:'identity-withdrawal-'+i,userId:owner,characterId:i<2?actor:'unrelated-identity-role-'+i%5,sourceType:'memory' as const,sourceId:'unrelated-identity-record-'+i,status:'withdrawn' as const,suppressedMessageIds:['unrelated-identity-message-'+i],updatedAt:1})));
 const tables:Record<string,unknown[]>={};for(const table of db.tables)tables[table.name]=await table.toArray();
 const data={tables};return {data,sha256:await fixtureHash(data)};
};
(window as any).runIdentityStock=async(prepared:any)=>{
 const samples=[];
 for(let index=0;index<3;index++){
  await db.delete();await db.open();await db.transaction('rw',db.tables,async()=>{for(const table of db.tables){const rows=prepared.data.tables[table.name];if(rows?.length)await table.bulkPut(rows);}});
  const actual:Record<string,unknown[]>={};for(const table of db.tables)actual[table.name]=await table.toArray();
  if(await fixtureHash({tables:actual})!==prepared.sha256)throw Error('Identity stock import differs');
  const reads:Record<string,{calls:number;bodies:number;keys:number}>={},restore:Array<()=>void>=[];
  for(const table of db.tables){const core=(table as any).core;for(const method of ['get','getMany','query','openCursor']){
   const original=core[method];core[method]=function(request:any){const row=reads[table.name+'.'+method]??={calls:0,bodies:0,keys:0};row.calls++;
    return original.call(this,request).then((result:any)=>{if(method==='get')row.bodies+=result?1:0;else if(method==='getMany')row.bodies+=result.filter(Boolean).length;else if(method==='query')request.values?row.bodies+=result.result.length:row.keys+=result.result.length;else if(result){const start=result.start;result.start=function(callback:any){return start.call(this,()=>{request.values?row.bodies++:row.keys++;callback();});};}return result;});
   };restore.push(()=>{core[method]=original;});
  }}
  const started=performance.now();
  try{
   const snapshot=await captureChatAuxiliary(owner,actor,sessionId,'settlement',()=>true);if(!snapshot)throw Error('No valid stock snapshot');
   const capturedMs=performance.now()-started,valid=await validateChatAuxiliary(snapshot,()=>true);
   const written=await commitChatAuxiliary(snapshot,()=>true,async()=>true);
   samples.push({capturedMs,wholeGuardMs:performance.now()-started,valid,written:!!written,originalMessagesSha256:await fixtureHash(snapshot.messages),inventory: snapshot.continuity?.map(thread=>({id:thread.id,dueAt:thread.dueAt})),reads});
  }finally{for(const restoreCore of restore)restoreCore();}
 }
 return {samples,apiCalls:0};
};
