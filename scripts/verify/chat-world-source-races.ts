import {db,type Message,type Character} from '../../src/db';
import {continuityRepo} from '../../src/db/continuity-repo';
import {messageRepo} from '../../src/db/message-repo';
import {memorySourceTombstoneRepo} from '../../src/db/memory-source-tombstone-repo';
import {captureContinuityChatEvidence} from '../../src/lib/continuity-sources';
import {worldRepo} from '../../src/db/world-repo';
import {worldSceneRepo} from '../../src/db/world-scene-repo';
import {runWorldTurn,retryWorldTurn} from '../../src/lib/world/world-turn';
import {worldTurnRepo} from '../../src/db/world-turn-repo';
import {sharedMemoryRepo} from '../../src/db/shared-memory-repo';
import {worldEventRepo} from '../../src/db/world-event-repo';
import {knowledgeRepo} from '../../src/db/knowledge-repo';
import {findRelevantHistory} from '../../src/lib/world/world-recall';
import * as worldRecall from '../../src/lib/world/world-recall';
import {buildWorldContext,renderCharacterContext} from '../../src/lib/world/world-context';
import {useAuthStore} from '../../src/store/auth-store';
import {worldChat,type WorldLlmCaller} from '../../src/lib/world/world-ai-client';

const owner='world-source-owner',actor='world-source-actor',sessionId='world-source-private';
const title='海盐灯塔约定',oldText='周六14点在海盐灯塔见，识别码SALT52。';
type Check={name:string;ok:boolean;detail?:unknown};
const checks:Check[]=[],scenarios:any[]=[];
const check=(name:string,ok:unknown,detail?:unknown)=>checks.push({name,ok:!!ok,...(detail===undefined?{}:{detail})});
let network=0,calls=0;
window.fetch=async()=>{network++;throw Error('World source fixture prohibits external calls');};
async function seed(){
 await db.delete();await db.open();
 useAuthStore.getState().login(owner,'合成世界验收','isolated-placeholder','');
 const character:Character={id:actor,name:'澄月',avatar:'🌙',systemPrompt:'聊天自然简短，仅使用真实已知线索。',createdBy:owner,createdAt:1,tags:[],isPreset:false,isCustom:true,published:false,proactivity:0,signature:'',greeting:'你好'};
 await db.characters.add(character);
 await db.sessions.add({id:sessionId,userId:owner,characterId:actor,type:'private',title:'合成私聊',createdAt:1,updatedAt:1});
 const source:Message={id:'world-source-original',sessionId,role:'user',content:oldText,revision:1,createdAt:2,isProactive:false};
 await db.messages.add(source);
 const world=await worldRepo.ensureDefaultWorld(owner);
 await continuityRepo.createMany([{userId:owner,characterId:actor,kind:'plan',title,detail:oldText,origin:'ai',sourceMessageIds:[source.id],sourceEvidence:captureContinuityChatEvidence([source],[source.id])}]);
 const sceneId=await worldSceneRepo.createScene({userId:owner,worldId:world.id,title:'站台',place:'站台',timeLabel:'下午',mood:'平静',characterIds:[actor]});
 await db.worldScenes.update(sceneId,{status:'active'});
 return {world,sceneId,source,character};
}
(window as any).runWorldSourceRaces=async()=>{
 checks.length=0;scenarios.length=0;calls=0;network=0;
 for(const phase of ['none','plain-none','retry-none','settlement-none','director','actor','plain-director','plain-actor','retry-director','retry-actor','settlement'] as const)for(const mutation of phase.endsWith('none')?['none'] as const:['edit','delete','suppress'] as const){
  const fixture=await seed();const seen:any[]=[],events:any[]=[];let mutated=false,localCalls=0;
  const beforeContext=await buildWorldContext({userId:owner,worldId:fixture.world.id,scene:(await db.worldScenes.get(fixture.sceneId))!,characters:[fixture.character],userText:'海盐灯塔安排'});
  const beforeActorText=renderCharacterContext(beforeContext,actor,'海盐灯塔安排');
  const call:WorldLlmCaller=async request=>{
   calls++;localCalls++;const system=String(request.messages.find(m=>m.role==='system')?.content??'');
   const stage=system.includes('共同生活"的导演')?'director':system.includes('共同生活的记录者')?'settlement':system.includes('一致性')&&system.includes('rewrites')?'guard':system.includes('只输出 JSON')&&system.includes('addressedCharacters')?'interpreter':'actor';
   seen.push({stage,messages:request.messages});
   if(stage===phase.replace(/^(?:plain|retry)-/u,'')&&!mutated){
    mutated=true;
    if(mutation==='edit')await messageRepo.update(fixture.source.id,{content:'更正：之前的安排取消了。'});
    if(mutation==='delete')await messageRepo.deleteById(fixture.source.id);
    if(mutation==='suppress')await memorySourceTombstoneRepo.record({userId:owner,characterId:actor,sourceType:'memory',sourceId:'withdrawal',status:'withdrawn',suppressedMessageIds:[fixture.source.id]});
   }
   // Identify calls using protocol fields rather than their timing.
   if(system.includes('共同生活"的导演'))return {content:JSON.stringify({speakers:[{character:'澄月',intent:'回应这条约定',mode:'dialogue'}],sequential:false,worldChanges:[],shouldSettle:phase.startsWith('settlement'),suggestions:[],...(phase.startsWith('settlement')?{trace:'回忆痕迹：'+oldText}:{})})};
   if(system.includes('addressedCharacters'))return {content:JSON.stringify({intent:phase.startsWith('plain-')?'freeform':'recall',...(phase.startsWith('plain-')?{}:{recallTarget:title}),addressedCharacters:['澄月'],requiresCharacterResponse:true,requiresNarration:false})};
   if(system.includes('rewrites'))return {content:'{"ok":true,"issues":[],"rewrites":[]}'};
   if(stage==='settlement')return{content:JSON.stringify({worldEvents:[{type:'interaction',title:'当前合成轮次事件',summary:'仅用于事务验证',participants:['澄月','用户']}],worldFactChanges:[{category:'rule',content:'本次合成规则'}]})};
   return {content:JSON.stringify({dialogue:'我记得，'+oldText})};
  };
  const text=phase.startsWith('plain-')?'澄月，聊聊海盐灯塔安排。':'澄月，你还记得海盐灯塔约定吗？';
  let retryId:string|undefined;
  if(phase.startsWith('retry-')){
    const turn=await worldTurnRepo.create({userId:owner,worldId:fixture.world.id,sceneId:fixture.sceneId,input:text,origin:'text',characterIds:[actor]});
    const entry=await worldSceneRepo.appendEntry(fixture.sceneId,{kind:'user_input',content:text});
    await worldTurnRepo.patch(turn.id,{userEntryId:entry.id,entryIds:[entry.id],action:{intent:'recall',raw:text,recallTarget:title,by:'rule',requiresCharacterResponse:true,requiresNarration:false}});
    await worldTurnRepo.markFailed(turn.id,'responding','合成旧失败，不是模型失败');retryId=turn.id;
  }
  const result=(retryId?await retryWorldTurn({turnId:retryId,characters:[fixture.character],call,onEvent:event=>events.push(event)}):await runWorldTurn({userId:owner,worldId:fixture.world.id,sceneId:fixture.sceneId,characters:[fixture.character],text,autoRounds:0,call,onEvent:event=>events.push(event)}))!;
  const entries=await worldSceneRepo.listRecentEntries(fixture.sceneId,100),generated=entries.filter(entry=>['dialogue','action','narration'].includes(entry.kind));
  const actorRequests=seen.filter(row=>row.stage==='actor');
  check(phase+'-'+mutation+'-fixture-has-live-selected-source',beforeActorText.includes(oldText)&&(phase.endsWith('director')||seen.some(row=>JSON.stringify(row.messages).includes(oldText))),seen.map(row=>row.stage));
  if(phase.endsWith('none')){
   check(phase+'-normal-world-recall-completes-with-real-dialogue',result.status==='completed'&&generated.some(row=>row.content.includes('SALT52')),{result,entries});
   check(phase+'-normal-world-recall-no-unnecessary-model-retry',actorRequests.length===1,{localCalls,stages:seen.map(row=>row.stage)});
  }else{
   check(phase+'-'+mutation+'-actual-mutation-happened',mutated,{seen:seen.map(row=>row.stage),source:await db.messages.get(fixture.source.id)});
   if(phase==='settlement'){
    check(phase+'-'+mutation+'-no-stale-trace-after-withdrawal',!entries.some(row=>row.meta?.trace===true&&row.content.includes('SALT52')),{result,entries});
    check(phase+'-'+mutation+'-no-derived-event-after-withdrawal',!(await db.worldEvents.toArray()).some(row=>row.sourceType==='turn'&&row.sourceId.startsWith(result.turnId)),result);
   }else check(phase+'-'+mutation+'-no-stale-generated-rows',generated.length===0,{result,generated});
   check(phase+'-'+mutation+'-user-input-is-preserved',entries.filter(row=>row.kind==='user_input').length===1,entries);
   check(phase+'-'+mutation+'-turn-reports-source-change',result.status==='failed'&&/来源|source/u.test(result.error??''),result);
   if(phase.endsWith('director'))check(phase+'-'+mutation+'-no-next-actor-call',actorRequests.length===0,seen.map(row=>row.stage));
  }
  scenarios.push({phase,mutation,result,events,seen,entries,localCalls});
 }
 {
  const fixture=await seed(),memoryId=await sharedMemoryRepo.create({userId:owner,worldId:fixture.world.id,title:'蓝湾纸船',summary:'一起折了纸船。',participants:['u:'+owner,'c:'+actor],sourceType:'manual',sourceId:'blue-bay',visibility:'selected',visibleTo:[actor]});
  const event=(sourceId:string,visibility:'private'|'selected')=>worldEventRepo.create({userId:owner,worldId:fixture.world.id,type:'shared_memory',title:'蓝湾纸船',summary:'共同记忆的授权链接',participants:['u:'+owner,'c:'+actor],sourceType:'shared_memory',sourceId,visibility,...(visibility==='selected'?{visibleTo:[actor]}:{}),memoryIds:[memoryId]});
  const authorized=await event('blue-allowed','selected'),privateLink=await event('blue-private','private');
  await knowledgeRepo.grantForEvent({userId:owner,worldId:fixture.world.id,characterId:actor,eventId:authorized,knowledgeLevel:'full',canMention:true});
  const hits=await findRelevantHistory({userId:owner,worldId:fixture.world.id,query:'蓝湾纸船',characterId:actor,limit:10}),memoryHit=hits.find(hit=>hit.kind==='memory'&&hit.id===memoryId);
  check('shared-memory-alternative-link-fixture-selected',!!memoryHit,{hits,authorized,privateLink});
  const selectedValidator=Reflect.get(worldRecall,'worldHistoryHitsStillLive') as typeof worldRecall.worldHistoryHitsStillLive|undefined;
  check('shared-memory-one-allowed-link-is-sufficient',!!memoryHit&&!!selectedValidator&&await selectedValidator({userId:owner,worldId:fixture.world.id,audienceCharacterIds:[actor]},[memoryHit]),hits);
  await knowledgeRepo.upsert({userId:owner,worldId:fixture.world.id,characterId:actor,eventId:authorized,canMention:false});
  check('shared-memory-withdraw-last-allowed-link-is-rejected',!!memoryHit&&!!selectedValidator&&!await selectedValidator({userId:owner,worldId:fixture.world.id,audienceCharacterIds:[actor]},[memoryHit]),hits);
 }
 let simulatedHttpCalls=0;
 for(const mode of ['unguarded','live','edit','suppress'] as const){
  const fixture=await seed();
  const context=await buildWorldContext({userId:owner,worldId:fixture.world.id,scene:(await db.worldScenes.get(fixture.sceneId))!,characters:[fixture.character],userText:title});
  const visible:Array<{accumulated:string;delta:string}>=[];
  let secondPull!:()=>void,release!:()=>void;
  const readingSecond=new Promise<void>(resolve=>{secondPull=resolve;}),mayFinish=new Promise<void>(resolve=>{release=resolve;});
  const encoder=new TextEncoder();let pulls=0;
  const frame=(text:string)=>encoder.encode('data: '+JSON.stringify({choices:[{delta:{content:text}}]})+'\n\n');
  window.fetch=async()=>{simulatedHttpCalls++;return new Response(new ReadableStream({async pull(controller){
   if(pulls++===0){controller.enqueue(frame('你好'));return;}
   secondPull();await mayFinish;controller.enqueue(frame('呀'));controller.enqueue(encoder.encode('data: [DONE]\n\n'));controller.close();
  }},{highWaterMark:0}),{status:200,headers:{'Content-Type':'text/event-stream'}});};
  const pending=worldChat({...(mode==='unguarded'?{}:{sourceContext:context}),model:{provider:'deepseek',id:'isolated-stream-model'},messages:[{role:'user',content:'合成传输测试'}],onDelta:(accumulated,delta)=>visible.push({accumulated,delta})}).then(result=>({result,error:undefined}),error=>({result:undefined,error:String(error?.message??error)}));
  await readingSecond;
  check('stream-'+mode+'-early-publication-boundary',mode==='unguarded'?visible.length>0:visible.length===0,visible);
  if(mode==='edit')await messageRepo.update(fixture.source.id,{content:'原文已修改。'});
  if(mode==='suppress')await memorySourceTombstoneRepo.record({userId:owner,characterId:actor,sourceType:'memory',sourceId:'stream-withdrawal',status:'withdrawn',suppressedMessageIds:[fixture.source.id]});
  release();const settled=await pending;
  if(mode==='edit'||mode==='suppress')check('stream-'+mode+'-never-releases-stale-partial',!!settled.error&&/source/u.test(settled.error)&&visible.length===0,{settled,visible});
  else{
   check('stream-'+mode+'-complete-content-preserved',settled.result?.content==='你好呀'&&visible.at(-1)?.accumulated==='你好呀',{settled,visible});
   check('stream-'+mode+'-delta-contract-preserves-all-text',visible.map(row=>row.delta).join('')==='你好呀',visible);
  }
  scenarios.push({scenario:'actual-SSE-'+mode,settled,visible});
 }
 window.fetch=async()=>{network++;throw Error('External calls prohibited');};
 check('zero-external-network-calls',network===0,network);
 const result={complete:checks.every(row=>row.ok),checks,failures:checks.filter(row=>!row.ok),scenarios,localModelStubs:calls,simulatedHttpCalls,apiCalls:0,networkAttempts:network,model:'未确认',reasoning:'未确认',scope:'Actual runWorldTurn / director / actor / native isolated IndexedDB. Only transport replaced locally, no paid calls or private data.'};
 await db.delete();return result;
};

const sha=async(value:unknown)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))).map(x=>x.toString(16).padStart(2,'0')).join('');
(window as any).prepareWorldSourceStock=async()=>{
 const fixture=await seed();
 await db.messages.bulkAdd(Array.from({length:512},(_,i):Message=>({id:'stock-world-message-'+i,sessionId,role:i%2?'assistant':'user',content:'合成无关历史'+i,revision:1,createdAt:100+i,isProactive:false})));
 await db.memorySourceTombstones.bulkAdd(Array.from({length:8105},(_,i)=>({id:'stock-world-withdrawal-'+i,userId:owner,characterId:i<2?actor:'unrelated-character-'+i%5,sourceType:'memory' as const,sourceId:'unrelated-record-'+i,status:'withdrawn' as const,suppressedMessageIds:['unrelated-message-'+i],updatedAt:1})));
 await db.diaries.bulkAdd(Array.from({length:40},(_,i)=>({id:'stock-world-diary-'+i,userId:owner,date:new Date(Date.UTC(2026,8,1+i)).toISOString().slice(0,10),title:'私密合成材料'+i,content:'PRIVATE_WORLD_FIXTURE_DO_NOT_INJECT_'+i,visibility:'private' as const,createdAt:1,updatedAt:1})));
 const tables:Record<string,unknown[]>={};for(const table of db.tables)tables[table.name]=await table.toArray();
 const data={tables};return{data,fixtureSha256:await sha(data),worldId:fixture.world.id,sceneId:fixture.sceneId,character:fixture.character};
};
(window as any).runWorldSourceStock=async(prepared:any)=>{
 const samples:any[]=[];
 for(let sample=0;sample<3;sample++){
  await db.delete();await db.open();
  await db.transaction('rw',db.tables,async()=>{for(const table of db.tables){const rows=prepared.data.tables[table.name];if(rows?.length)try{await table.bulkPut(rows);}catch(error){const failure=error as any;throw Error('native import '+table.name+': '+failure.name+' '+failure.message+' '+JSON.stringify(failure.failures?.map((row:any)=>({name:row.name,message:row.message}))));}}});
  const actual:Record<string,unknown[]>={};for(const table of db.tables)actual[table.name]=await table.toArray();
  const fixtureSha256=await sha({tables:actual});
  useAuthStore.getState().login(owner,'合成世界验收','isolated-placeholder','');
  const reads:Record<string,{calls:number;bodies:number;keys:number;requestedKeys:number;cursorVisits:number}>= {},restore:Array<()=>void>=[];
  let stage='before-first-request';
  for(const table of db.tables){
   const core=(table as any).core;
   for(const method of ['get','getMany','query','openCursor']){
    const original=core[method];core[method]=function(request:any){
      const key=stage+':'+table.name+'.'+method,row=reads[key]??={calls:0,bodies:0,keys:0,requestedKeys:0,cursorVisits:0};row.calls++;
      row.requestedKeys+=request.keys?.length??(method==='get'?1:0);
      return original.call(this,request).then((result:any)=>{
       if(method==='get')row.bodies+=result?1:0;
       else if(method==='getMany')row.bodies+=result.filter(Boolean).length;
       else if(method==='query')request.values?row.bodies+=result.result.length:row.keys+=result.result.length;
       else if(result){const start=result.start;result.start=function(callback:any){return start.call(this,()=>{row.cursorVisits++;request.values?row.bodies++:row.keys++;callback();});};}
       return result;
      });
    };restore.push(()=>{core[method]=original;});
   }
  }
  const started=performance.now(),requests:any[]=[];let firstVisibleMs:number|undefined;
  const call:WorldLlmCaller=async request=>{
   const system=String(request.messages.find(m=>m.role==='system')?.content??'');
   const name=system.includes('共同生活"的导演')?'director':system.includes('addressedCharacters')?'interpreter':system.includes('rewrites')?'guard':'actor';
   requests.push({stage:name,atMs:performance.now()-started,messages:request.messages});stage='after-'+name;
   await new Promise(resolve=>setTimeout(resolve,30));
   if(name==='interpreter')return{content:JSON.stringify({intent:'recall',recallTarget:title,addressedCharacters:['澄月'],requiresNarration:false,requiresCharacterResponse:true})};
   if(name==='director')return{content:JSON.stringify({speakers:[{character:'澄月',intent:'回应这条约定',mode:'dialogue'}],sequential:false,worldChanges:[],shouldSettle:false,suggestions:[]})};
   if(name==='guard')return{content:'{"ok":true,"issues":[],"rewrites":[]}'};
   return{content:JSON.stringify({dialogue:'我记得，'+oldText})};
  };
  let result:any;
  try{result=await runWorldTurn({userId:owner,worldId:prepared.worldId,sceneId:prepared.sceneId,characters:[prepared.character],text:'澄月，你还记得海盐灯塔约定吗？',autoRounds:0,call,onEvent:event=>{if(event.type==='entry'&&event.entry.kind==='dialogue'&&firstVisibleMs===undefined)firstVisibleMs=performance.now()-started;}});}
  finally{restore.forEach(fn=>fn());}
  const totalMs=performance.now()-started,entries=await worldSceneRepo.listRecentEntries(prepared.sceneId,20);
  samples.push({fixtureSha256,result,firstVisibleMs,totalMs,requests,reads,entries,complete:fixtureSha256===prepared.fixtureSha256&&result.status==='completed'&&requests.length===3&&entries.filter(row=>row.kind==='dialogue').length===1&&!JSON.stringify(requests).includes('PRIVATE_WORLD_FIXTURE_DO_NOT_INJECT')});
 }
 await db.delete();return{complete:samples.every(row=>row.complete),samples,simulatedModelWaitMs:30,apiCalls:0};
};
