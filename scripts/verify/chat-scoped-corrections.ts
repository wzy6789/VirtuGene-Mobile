import './chat-human-live';
import {db} from '../../src/db';
import {messageRepo} from '../../src/db/message-repo';
import {readValidatedConversation,updateConversationIfCurrent} from '../../src/db/chat-topic-state-repo';
import {contradictsSimpleMemory} from '../../src/lib/memory-correction';
import {updateChatConversationState} from '../../src/lib/chat-conversation-state';
import {renderExplicitTopics} from '../../src/lib/chat-topic-outcomes';
import {memoryRepo} from '../../src/db/memory-repo';
const api=globalThis as any,sessionId='isolated-live-session',calls:any[]=[];
window.fetch=async(url,init)=>{
 if(!String(url).includes('/chat/completions'))throw Error('Unexpected external request');
 const body=JSON.parse(String(init?.body));calls.push({body,state:(await db.sessions.get(sessionId))?.conversation});
 return new Response(JSON.stringify({choices:[{message:{content:'嗯。'},finish_reason:'stop'}]}),{headers:{'Content-Type':'application/json'}});
};
api.runScopedCorrections=async()=>{
 const checks:Array<{name:string;ok:boolean;detail?:unknown}>=[],rows:any[]=[];
 const check=(name:string,ok:unknown,detail?:unknown)=>checks.push({name,ok:!!ok,...(detail===undefined?{}:{detail})});
 const setup=async()=>{calls.length=0;await api.liveExpression.setup({name:'林舟',tags:[],systemPrompt:'你是林舟，认真接话。\n判断习惯：先听清具体范围。\n对话样本：用户说你好 → 你说来啦。',greeting:'你好。',signature:''},.5);};
 const turn=async(input:string)=>{calls.length=0;let result;try{result=await api.liveExpression.turn(input);}catch(error){result={failed:true,error:String(error)};}const session=(await db.sessions.get(sessionId))!;const row={input,result,state:session.conversation,calls:structuredClone(calls)};rows.push(row);return row;};
 const fact=(state:any,kind:string,period:string)=>state?.topics?.find((topic:any)=>topic.kind===kind&&topic.slots.period?.value===period);
 await setup();
 let row=await turn('我晚上不喝咖啡，白天还是会喝。');
 check('actual sender persists two independently scoped drink statements',row.state?.topics?.filter((topic:any)=>topic.kind==='preference').length===2,row.state);
 check('night restriction has explicit object and stance',fact(row.state,'preference','晚上')?.slots.object?.value==='咖啡'&&fact(row.state,'preference','晚上')?.slots.stance?.value==='不喝');
 check('elliptic daytime continuation retains same object without negation',fact(row.state,'preference','白天')?.slots.object?.value==='咖啡'&&fact(row.state,'preference','白天')?.slots.stance?.value==='喝');
 check('scoped facts are committed before actual provider request',calls[0]?.state?.topics?.filter((topic:any)=>topic.kind==='preference').length===2);
 const sourceSession=(await db.sessions.get(sessionId))!,sourcePrincipal={sessionId,userId:sourceSession.userId,characterId:sourceSession.characterId};
 const forged=structuredClone(row.state) as any;
 if(forged?.topics?.length){
  const night=fact(forged,'preference','晚上'),day=fact(forged,'preference','白天');
  if(night&&day){night.slots.stance=structuredClone(day.slots.stance);
   check('native commit rejects a day stance spliced into a night claim from the same original',!await updateConversationIfCurrent(sourcePrincipal,row.state!.version??0,forged));
  }
 }
 row=await turn('晚上现在也喝咖啡了。');
 check('explicit night correction changes only matching scope',fact(row.state,'preference','晚上')?.slots.stance?.value==='喝'&&fact(row.state,'preference','白天')?.slots.stance?.value==='喝');
 check('night original remains historical, not current',fact(row.state,'preference','晚上')?.slotHistory?.some((slot:any)=>slot.field==='stance'&&slot.value==='不喝'));
 row=await turn('我晚上不喝咖啡。');
 check('second correction returns night restriction without changing daytime',fact(row.state,'preference','晚上')?.slots.stance?.value==='不喝'&&fact(row.state,'preference','白天')?.slots.stance?.value==='喝');
 const nightSource=(await db.messages.where('sessionId').equals(sessionId).toArray()).find(source=>source.role==='user'&&source.content===row.input)!;
 row=await turn('今晚想做点什么？');
 const system=String(calls[0]?.body.messages[0].content);
 check('implicit suggestion receives existing scoped constraints',system.includes('[当前事项与结论]')&&system.includes('晚上')&&system.includes('白天')&&system.includes('不喝')&&system.includes('咖啡'));
 await messageRepo.deleteById(nightSource.id);
 const session=(await db.sessions.get(sessionId))!,principal={sessionId,userId:session.userId,characterId:session.characterId};
 const validated=await readValidatedConversation(principal);
 check('deleted current restriction is not revived from older history',!fact(validated?.conversation,'preference','晚上'),validated);
 check('unrelated daytime preference survives source deletion',fact(validated?.conversation,'preference','白天')?.slots.stance?.value==='喝');
 await setup();row=await turn('我以前住北京，现在住上海。');
 check('past and current residences have separate explicit periods',fact(row.state,'residence','以前')?.slots.place?.value==='北京'&&fact(row.state,'residence','现在')?.slots.place?.value==='上海',row.state);
 row=await turn('我现在住深圳。');
 check('new current residence does not erase past residence',fact(row.state,'residence','现在')?.slots.place?.value==='深圳'&&fact(row.state,'residence','以前')?.slots.place?.value==='北京');
 check('previous current residence is historical rather than another current answer',fact(row.state,'residence','现在')?.slotHistory?.some((slot:any)=>slot.field==='place'&&slot.value==='上海'));
 row=await turn('我目前住深圳。');
 check('explicit same-place reconfirmation with current-period alias commits',!row.result.failed&&fact(row.state,'residence','目前')?.slots.place?.value==='深圳',row);
 row=await turn('我以前住哪里，现在呢？');
 const residencePrompt=String(calls[0]?.body.messages[0].content);
 check('historical inquiry projects past and current distinctly',residencePrompt.includes('北京')&&residencePrompt.includes('深圳')&&residencePrompt.includes('以前')&&residencePrompt.includes('现在'));
 const currentSource=(await db.messages.where('sessionId').equals(sessionId).toArray()).find(source=>source.role==='user'&&source.content==='我目前住深圳。')!;
 await messageRepo.update(currentSource.id,{content:'我没说过现在住深圳。'});
 const current=(await db.sessions.get(sessionId))!,afterEdit=await readValidatedConversation({sessionId,userId:current.userId,characterId:current.characterId});
 check('edited current residence source invalidates current record',!afterEdit?.conversation?.topics?.some(topic=>topic.kind==='residence'&&topic.label==='居住地·当前'));
 check('past residence survives unrelated source edit',fact(afterEdit?.conversation,'residence','以前')?.slots.place?.value==='北京',afterEdit);
 let counter=0;
 const derive=(text:string,domain:any='user-reality',previous:any=undefined)=>updateChatConversationState(previous,text,'',undefined,++counter,'',{message:{id:'scoped-'+counter,sessionId:'pure-scoped',role:'user',content:text,createdAt:counter,revision:1},domain});
 for(const text of ['朋友晚上不喝咖啡，白天会喝。','如果我晚上不喝咖啡，白天会喝。','“我晚上不喝咖啡”是一个例句。','我晚上不喝咖啡吗？','我晚上不喝咖啡？','我以前住北京吗？','我以前住哪儿？','我可能现在住上海。','我以前住北京的朋友现在住上海。']){
  const next=derive(text);check('no inferred user fact from report/question/hypothesis:'+text,!next.topics?.some(topic=>['preference','residence'].includes(topic.kind)),next);
 }
 let isolated=derive('我晚上不喝咖啡。');isolated=derive('我晚上喝咖啡。','story',isolated);
 check('story preferences do not overwrite reality',isolated.topics?.filter(topic=>topic.kind==='preference').length===2&&isolated.topics.every(topic=>topic.domain==='story'?topic.slots.stance?.value==='喝':topic.slots.stance?.value==='不喝'));
 const mixed=derive('我晚上不喝咖啡，白天还是会喝。');
 const plan=derive('周四15点面试。'),mixedChange=derive('我晚上不喝咖啡，改到周五。','user-reality',plan);
 check('new preference in same message cannot steal original event correction focus',mixedChange.topics?.some(topic=>topic.kind==='plan'&&topic.slots.date?.value==='周五'&&topic.slots.time?.value==='15点')&&mixedChange.topics?.some(topic=>topic.kind==='preference'&&topic.slots.stance?.value==='不喝'),mixedChange);
 let drinks=derive('我晚上喝咖啡。');drinks=derive('我晚上喝茶。','user-reality',drinks);
 const ambiguous=derive('晚上不喝了。','user-reality',drinks);
 check('omitted object among two same-scope drinks is explicit ambiguity',!!ambiguous.ambiguousTopic&&ambiguous.topics?.filter(topic=>topic.kind==='preference').every(topic=>topic.slots.stance.value==='喝'));
 let distinct=derive('我晚上喝咖啡。');distinct=derive('我白天喝茶。','user-reality',distinct);distinct=derive('我晚上不喝了。','user-reality',distinct);
 check('single matching period resolves object without changing other period',fact(distinct,'preference','晚上')?.slots.object?.value==='咖啡'&&fact(distinct,'preference','晚上')?.slots.stance?.value==='不喝'&&fact(distinct,'preference','白天')?.slots.object?.value==='茶'&&!distinct.ambiguousTopic);
 for(const budget of [40,180,500,1200])check('projection remains bounded '+budget,renderExplicitTopics(mixed,'今晚做什么？','user-reality',budget).length<=budget);
 const pairs:Array<[string,string,boolean]>=[
  ['我晚上喝咖啡','我晚上不喝咖啡',true],['我晚上喝咖啡','我白天不喝咖啡',false],['我喝咖啡','我晚上不喝咖啡',false],
  ['我以前住北京','我现在住上海',false],['我现在住北京','我现在住上海',true],['我住北京','我现在住上海',true],
  ['我现在住上海','我以前住北京',false],['朋友现在住北京','我现在住上海',false],['我现在住北京','如果我现在住上海',false],
  ['我喜欢咖啡','我不喜欢咖啡',true],['我晚上喝咖啡','我晚上不喝茶',false],['我现在住北京','我现在住上海吗？',false],
  ['我住北京吗','我现在住上海',false],['我住北京的朋友','我现在住上海',false],['我住北京还是上海','我现在住深圳',false],
 ];
 for(const [before,after,expected]of pairs)check('retirement requires same subject/property/scope:'+before+' -> '+after,contradictsSimpleMemory(before,after)===expected);
 await setup();
 const memorySession=(await db.sessions.get(sessionId))!;
 const memory=(id:string,content:string,createdAt:number)=>({id,content,createdAt,userId:memorySession.userId,characterId:memorySession.characterId,type:'manual' as const,memoryKind:'fact' as const});
 for(const item of [memory('night-old','我晚上喝咖啡',1),memory('day-old','我白天喝咖啡',1),memory('night-new','我晚上不喝咖啡',2)])await memoryRepo.create(item);
 await memoryRepo.supersedeLikelyCorrections(memorySession.characterId,memorySession.userId,memory('night-new','我晚上不喝咖啡',2));
 const retired=await db.memories.get('night-old');
 check('actual repository retires only contradicted scoped memory',retired?.status==='superseded'&&retired?.supersededBy==='night-new'&&(await db.memories.get('day-old'))?.status!=='superseded');
 check('retirement preserves original body rather than deleting history',retired?.content==='我晚上喝咖啡');
 for(const item of [memory('past-city','我以前住北京',3),memory('current-city-old','我现在住上海',3),memory('current-city-new','我现在住深圳',4)])await memoryRepo.create(item);
 await memoryRepo.supersedeLikelyCorrections(memorySession.characterId,memorySession.userId,memory('current-city-new','我现在住深圳',4));
 check('actual repository preserves past residence while superseding current one',(await db.memories.get('past-city'))?.status!=='superseded'&&(await db.memories.get('current-city-old'))?.status==='superseded');
 await setup();await turn('周四15点面试。');row=await turn('我晚上不喝咖啡，改到周五。');
 check('actual mixed preference/event correction preserves event time and commits both claims',!row.result.failed&&row.state?.topics?.some(topic=>topic.kind==='plan'&&topic.slots.date?.value==='周五'&&topic.slots.time?.value==='15点')&&fact(row.state,'preference','晚上')?.slots.stance?.value==='不喝',row);
 check('all stored accepted slots retain source bounds',rows.every(row=>(row.state?.topics??[]).every((topic:any)=>topic.source.length<=6&&topic.scope==='session')));
 return {complete:checks.every(check=>check.ok),checks,failures:checks.filter(check=>!check.ok),rows,apiCalls:0};
};

const sha=async(value:unknown)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))).map(x=>x.toString(16).padStart(2,'0')).join('');
api.prepareScopedStock=async(scoped:boolean)=>{
 await api.liveExpression.setup({name:'林舟',tags:[],systemPrompt:'你是林舟，认真接话。\n判断习惯：先听清具体范围。\n对话样本：用户说你好 → 你说来啦。',greeting:'你好。',signature:''},.5);
 await api.liveExpression.turn(scoped?'我晚上不喝咖啡，白天还是会喝。':'周四15点面试。');
 const session=(await db.sessions.get(sessionId))!;
 await db.messages.bulkAdd(Array.from({length:512},(_,i)=>({id:'scoped-stock-message-'+i,sessionId,role:i%2?'assistant' as const:'user' as const,content:'合成无关聊天内容'+i,revision:1,createdAt:100+i,isProactive:false})));
 await db.memorySourceTombstones.bulkAdd(Array.from({length:8105},(_,i)=>({id:'scoped-stock-withdrawal-'+i,userId:session.userId,characterId:i<2?session.characterId:'unrelated-scoped-role-'+i%5,sourceType:'memory' as const,sourceId:'unrelated-scoped-record-'+i,status:'withdrawn' as const,suppressedMessageIds:['unrelated-scoped-message-'+i],updatedAt:1})));
 await db.diaries.bulkAdd(Array.from({length:40},(_,i)=>({id:'scoped-stock-diary-'+i,userId:session.userId,date:new Date(Date.UTC(2026,8,1+i)).toISOString().slice(0,10),title:'私密合成资料'+i,content:'PRIVATE_SCOPED_FIXTURE_DO_NOT_INJECT_'+i,visibility:'private' as const,createdAt:1,updatedAt:1})));
 const tables:Record<string,unknown[]>={};for(const table of db.tables)tables[table.name]=await table.toArray();
 const data={tables};return {data,fixtureSha256:await sha(data),scoped,clock:Date.now()+30000};
};
api.runScopedStock=async(prepared:any)=>{
 const samples=[];
 // Freeze the injected clock before either revision runs. Do not normalize
 // or remove differing clock text from captured model messages afterwards.
 const nativeDate=Date;
 globalThis.Date=new Proxy(nativeDate,{construct(target,args){return Reflect.construct(target,args.length?args:[prepared.clock]);},get(target,key,receiver){return key==='now'?()=>prepared.clock:Reflect.get(target,key,receiver);}});
 try{
 for(let n=0;n<3;n++){
  await db.delete();await db.open();await db.transaction('rw',db.tables,async()=>{for(const table of db.tables){const rows=prepared.data.tables[table.name];if(rows?.length)await table.bulkPut(rows);}});
  const actual:Record<string,unknown[]>={};for(const table of db.tables)actual[table.name]=await table.toArray();
  const fixtureSha256=await sha({tables:actual});if(fixtureSha256!==prepared.fixtureSha256)throw Error('Stock fixture import differs');
  await api.liveExpression.resume();
  const reads:Record<string,{calls:number;bodies:number;keys:number}>={},restore:Array<()=>void>=[];
  let stage='before-provider';
  for(const table of db.tables){const core=(table as any).core;for(const method of ['get','getMany','query','openCursor']){
   const original=core[method];core[method]=function(request:any){const row=reads[stage+':'+table.name+'.'+method]??={calls:0,bodies:0,keys:0};row.calls++;
    return original.call(this,request).then((result:any)=>{if(method==='get')row.bodies+=result?1:0;else if(method==='getMany')row.bodies+=result.filter(Boolean).length;else if(method==='query')request.values?row.bodies+=result.result.length:row.keys+=result.result.length;else if(result){const start=result.start;result.start=function(callback:any){return start.call(this,()=>{request.values?row.bodies++:row.keys++;callback();});};}return result;});
   };restore.push(()=>{core[method]=original;});
  }}
  calls.length=0;let firstRequestMs:number|undefined;const messages:unknown[]=[];const started=performance.now();
  const savedFetch=window.fetch;
  window.fetch=async(url,init)=>{if(!String(url).includes('/chat/completions'))throw Error('Unexpected external request');firstRequestMs??=performance.now()-started;messages.push(JSON.parse(String(init?.body)).messages);stage='after-provider';return new Response(JSON.stringify({choices:[{message:{content:'嗯。'},finish_reason:'stop'}]}),{headers:{'Content-Type':'application/json'}});};
  try{const result=await api.liveExpression.turn(prepared.scoped?'今晚想做点什么？':'刚才面试是几点？');samples.push({fixtureSha256,firstRequestMs,wholeMs:performance.now()-started,failed:result.failed,replies:result.replies,messages,messagesSha256:await sha(messages),reads});}
  finally{window.fetch=savedFetch;for(const stop of restore)stop();}
 }
 return {samples,apiCalls:0,clock:prepared.clock};
 }finally{globalThis.Date=nativeDate;}
};
