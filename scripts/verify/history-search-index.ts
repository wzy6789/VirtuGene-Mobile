import Dexie from 'dexie';
import {db} from '../../src/db/index';
import {recallHistoricalPrivateChat} from '../../src/lib/character-history-recall';
import {recallHistoricalPrivateChat as scan} from './history-search-legacy';
import {backfillHistorySearchIndex} from '../../src/lib/chat-history-index';
import {messageHistoryIdentity} from '../../src/db/message-history-index';
import {withChatSessionLock} from '../../src/lib/chat/request-coordinator';
import {buildProviderRequest} from '../../src/lib/ai/provider-protocols';
import {useSettingsStore} from '../../src/store/settings-store';
import {llmChatStream} from '../../src/lib/ai/llm';
import {gatewayChatStream} from '../../src/lib/ai/gateway';
import {revalidateCharacterMemoryContext} from '../../src/lib/character-memory';
import {withMemorySourceSnapshot} from '../../src/lib/memory-source-snapshot';
import {messageRepo} from '../../src/db/message-repo';
import {sessionRepo} from '../../src/db/session-repo';

Object.assign(window,{historyIndexChecks:async()=>{
  let checks=0;
  const check=(v:unknown,label:string)=>{if(!v)throw Error(label);checks++;};
  await db.delete();
  const legacy=new Dexie(db.name);
  legacy.version(36).stores(Object.fromEntries(db.tables.filter(t=>t.name!=='messageHistorySearch').map(t=>[t.name,
    [t.schema.primKey.src,...t.schema.indexes.filter(i=>!['historySearchReadyKey','[sessionId+role]','[characterId+userId+type]'].includes(i.name)).map(i=>i.src)].join(',')])));
  await legacy.open();
  const now=Date.now();
  const old={id:'old',sessionId:'s',role:'user',content:'上次桂花糕是买给奶奶的。',createdAt:now,revision:1};
  await legacy.table('messages').put(old);
  await legacy.table('sessions').put({id:'s',userId:'u',characterId:'c',title:'隔离',createdAt:now,updatedAt:now});
  legacy.close();
  const sourcePut=IDBObjectStore.prototype.put;
  let sourceRewrites=0;
  let projectionUpgradeWrites=0;
  IDBObjectStore.prototype.put=function(...args:any[]){if(this.name==='messages'){
    // v46 refreshes only the summary eligibility projection once. The idle
    // history backfill must still never rewrite any original message row.
    if(this.transaction.mode==='versionchange')projectionUpgradeWrites++;else sourceRewrites++;
  }return (sourcePut as any).apply(this,args);};
  await withChatSessionLock('migration',async()=>{
    await db.open();
    check(await db.messages.count()===1,'upgrade preserves old messages');
    check(await db.messageHistorySearch.count()===0,'upgrade does not block opening on full backfill');
    const hits=await recallHistoricalPrivateChat({userId:'u',characterId:'c',query:'桂花糕'});
    check(hits[0]?.messageId==='old','incomplete index retains exact old-history fallback');
  });
  await backfillHistorySearchIndex();
  IDBObjectStore.prototype.put=sourcePut;
  check(sourceRewrites===0,'backfill only writes derived store, never historical message rows');
  const jobA=backfillHistorySearchIndex(),jobB=backfillHistorySearchIndex();
  check(jobA===jobB,'foreground and scheduled maintenance share one in-flight backfill');
  await jobA;
  check(await db.messageHistorySearch.count()===1,'idle backfill creates missing posting');
  check((await db.messages.get('old'))?.content===old.content,'backfill preserves original text');
  check((await db.messages.get('old'))?.revision===1,'backfill preserves revision');
  check(await sessionRepo.isOwnedPrivateSession('s','u','c'),'indexed initial ownership accepts owned legacy private session');
  check(!await sessionRepo.isOwnedPrivateSession('s','other','c'),'indexed initial ownership rejects another account');
  check(!await sessionRepo.isOwnedPrivateSession('s','u','other'),'indexed initial ownership rejects another character');
  await db.sessions.update('s',{type:'group'});
  check(!await sessionRepo.isOwnedPrivateSession('s','u','c'),'indexed initial ownership immediately rejects group conversion');
  await db.sessions.update('s',{type:undefined});
  await db.messages.clear();
  check(await db.messageHistorySearch.count()===0,'clear removes derived postings atomically');
  const subjects=['桂花糕','海边散步','预算报告','猫咪看病','周五开会','咖啡约定','地铁迟到','生日礼物','蓝色雨伞','今天工作还好'];
  const rows=Array.from({length:300},(_,i)=>({id:`m-${i}`,sessionId:'s',role:i%3?'user':'assistant',
    content:`第${i}次谈起${subjects[i%subjects.length]}，${subjects[(i+3)%subjects.length]}。`+`budget report ${i%9}, hello WORLD。`,
    createdAt:now+i+10,revision:1,failed:i%17===0,secretaryDispatch:i%19===0?{taskId:'test',assistantName:'隔离',bodyOrigin:'composed'}:undefined}));
  await db.messages.bulkPut(rows as any);
  check(await db.messageHistorySearch.count()===rows.length,'bulk creation keeps one posting per message');
  check(await messageRepo.countUserBySession('s')===rows.filter(row=>row.role==='user').length,'indexed user count preserves failed/composed user semantics');
  await db.messages.put({id:'gram-illusion',sessionId:'s',role:'user',content:'ab--bc--cd',createdAt:now-100,revision:1});
  const queries=[...subjects,...subjects.map(s=>'你还记得'+s+'吗'),...subjects.map(s=>'你说过'+s),
    'budget','report','hello world','ＷＯＲＬＤ','周五 开会','（生日礼物）','第一句话我说了什么','不是周五，是周四','完全不在数据里的龙眼汤','abcd'];
  for(let i=0;i<queries.length;i++){
    const args={userId:'u',characterId:'c',currentSessionId:'s',query:queries[i],excludeMessageIds:i%2?['m-299','m-298']:[],limit:i%3+1};
    const before=await scan(args),after=await recallHistoricalPrivateChat(args);
    check(JSON.stringify(after)===JSON.stringify(before),'same recall/order/text '+queries[i]);
  }
  const target=rows[5];
  await db.messages.update(target.id,{content:'独一无二的紫藤花',revision:2});
  check((await recallHistoricalPrivateChat({userId:'u',characterId:'c',query:'紫藤花'})).some(h=>h.messageId===target.id),'edit is searchable immediately');
  check(!await db.messageHistorySearch.get(messageHistoryIdentity(target as any)),'edit removes old identity');
  await db.messages.update(target.id,{failed:true});
  check(!(await recallHistoricalPrivateChat({userId:'u',characterId:'c',query:'紫藤花'})).some(h=>h.messageId===target.id),'failed message cannot be recalled');
  await db.messages.put({...target,content:'独一无二的紫藤花',revision:3,historySearchReadyKey:'forged'} as any);
  check((await db.messages.get(target.id))?.historySearchReadyKey==='s','import cannot forge search coverage');
  check((await recallHistoricalPrivateChat({userId:'u',characterId:'c',query:'紫藤花'})).some(h=>h.messageId===target.id),'put recomputes index from original');
  await db.messages.update(target.id,{sessionId:'foreign'});
  check(!(await recallHistoricalPrivateChat({userId:'u',characterId:'c',query:'紫藤花'})).some(h=>h.messageId===target.id),'moving source removes old-session posting');
  await db.messages.update(target.id,{sessionId:'s'});
  try{await db.transaction('rw',db.messages,async()=>{await db.messages.update(target.id,{content:'回滚后不能出现的名字',revision:4});throw Error('rollback');});}catch{}
  check((await recallHistoricalPrivateChat({userId:'u',characterId:'c',query:'紫藤花'})).some(h=>h.messageId===target.id),'rollback restores source and posting together');
  check(!(await recallHistoricalPrivateChat({userId:'u',characterId:'c',query:'回滚后不能出现的名字'})).some(h=>h.messageId===target.id),'rollback leaves no phantom posting');
  check((await recallHistoricalPrivateChat({userId:'other',characterId:'c',query:'紫藤花'})).length===0,'account ownership still enforced');
  check((await recallHistoricalPrivateChat({userId:'u',characterId:'other',query:'紫藤花'})).length===0,'character ownership still enforced');
  await db.messages.delete(target.id);
  check(!(await recallHistoricalPrivateChat({userId:'u',characterId:'c',query:'紫藤花'})).some(h=>h.messageId===target.id),'deletion leaves no recalled source');
  check(await db.messageHistorySearch.count()===await db.messages.count(),'delete removes metadata atomically');
  await db.messages.bulkDelete(['m-0','m-1','m-2']);
  check(await db.messageHistorySearch.count()===await db.messages.count(),'bulk deletion removes postings');
  const ownedRows=await db.messages.bulkGet(['m-10','m-11']);
  const refs=ownedRows.map(row=>withMemorySourceSnapshot({source:'chat',id:row!.id,text:row!.content,at:row!.createdAt},'messages',row!));
  const sessionsCore=db.sessions.core,sessionsCursor=sessionsCore.openCursor;
  let transferred=false;
  try {
    sessionsCore.openCursor=async request=>{
      const cursor=await sessionsCursor.call(sessionsCore,request);
      if(cursor&&request.query.index.name==='[characterId+userId]') {
        const start=cursor.start.bind(cursor);
        cursor.start=async callback=>{
            await start(callback);
            // Commit the transfer between the first check's transaction and
            // the later snapshot/final ownership check, never inside a read tx.
            if(!transferred){transferred=true;setTimeout(()=>void db.sessions.update('s',{userId:'other'}),0);}
        };
      }
      return cursor;
    };
    const checked=await revalidateCharacterMemoryContext({userId:'u',characterId:'c'}, {references:refs,text:'',sections:{},provenance:[]} as any);
    check(transferred,'account transfer scheduled during indexed source validation');
    check((await db.sessions.get('s'))?.userId==='other','account transfer really commits before final ownership validation');
    check(checked.references.length===0,'fresh batch ownership rejects transfer after shared read');
  } finally {sessionsCore.openCursor=sessionsCursor;await db.sessions.update('s',{userId:'u'});}
  await db.messages.clear();
  const dense=Array.from({length:1500},(_,i)=>({id:'dense-'+i,sessionId:'s',role:'user',content:'共同的桂花糕约定，周五下午去买。',createdAt:now+i,revision:1}));
  dense[0].content='桂花糕是替外婆买的，周五下午去买。';
  await db.messages.bulkPut(dense as any);
  for(const query of ['共同的桂花糕约定','桂花糕','外婆','周五下午去买','共同的桂花糕约定周五下午去买']) {
    const args={userId:'u',characterId:'c',query,limit:3};
    check(JSON.stringify(await recallHistoricalPrivateChat(args))===JSON.stringify(await scan(args)),'dense and old exact-match rankings equal full scan: '+query);
  }
  const sourceMany=db.messages.core.getMany.bind(db.messages.core);
  let bodyRows=0;
  db.messages.core.getMany=async request=>{const rows=await sourceMany(request);bodyRows+=rows.filter(Boolean).length;return rows;};
  try {
    await recallHistoricalPrivateChat({userId:'u',characterId:'c',query:'共同的桂花糕约定',limit:3});
    check(bodyRows<100,'upper-bound ranking verifies only competitive phrase bodies');
  } finally {db.messages.core.getMany=sourceMany;}
  const nativePut=IDBObjectStore.prototype.put;
  let indexRewrites=0;
  IDBObjectStore.prototype.put=function(...args:any[]){if(this.name==='messageHistorySearch')indexRewrites++;return (nativePut as any).apply(this,args);};
  try {
    await db.messages.update('dense-1',{audio:'test-only-audio',showAudioTranscript:true} as any);
    check(indexRewrites===0,'audio/display metadata does not rewrite the search index');
  } finally {IDBObjectStore.prototype.put=nativePut;}
  await withChatSessionLock('partial-index-recall',async()=>{
    const built=await db.messageHistorySearch.where('sessionId').equals('s').primaryKeys();
    const removed=built.filter((_,i)=>i%2===0);
    await db.messageHistorySearch.bulkDelete(removed);
    const args={userId:'u',characterId:'c',query:'共同的桂花糕约定',limit:3};
    const expected=await scan(args);
    const core=db.messages.core,getMany=core.getMany.bind(core),query=core.query.bind(core);
    let bodies=0;
    core.getMany=request=>getMany(request).then(rows=>{bodies+=rows.filter(Boolean).length;return rows;});
    core.query=request=>query(request).then(result=>{if(request.values)bodies+=result.result.length;return result;});
    try {
      const actual=await recallHistoricalPrivateChat(args);
      check(JSON.stringify(actual)===JSON.stringify(expected),'partly built index merges missing originals without changing ranking');
      check(bodies<=removed.length+100,'partial upgrade never rescans completed message bodies');
    } finally {core.getMany=getMany;core.query=query;}
  });
  await backfillHistorySearchIndex();
  check(await db.messageHistorySearch.count()===await db.messages.count(),'partial coverage is fully repaired after foreground lookup');
  await db.messages.clear();
  await db.messages.bulkPut([
    {id:'tie-a',sessionId:'s',role:'user',content:'蓝莓',createdAt:now,revision:1},
    {id:'tie-b',sessionId:'s',role:'user',content:'草莓',createdAt:now,revision:1},
    {id:'tie-c',sessionId:'s',role:'user',content:'黑莓',createdAt:now,revision:1},
  ] as any);
  const tieArgs={userId:'u',characterId:'c',query:'草莓蓝莓黑莓',limit:2};
  check(JSON.stringify(await recallHistoricalPrivateChat(tieArgs))===JSON.stringify(await scan(tieArgs)),'equal-score timestamps preserve legacy primary-key tie order');
  check(useSettingsStore.getState().chatThinkingEnabled===true,'ordinary chat defaults to thinking with existing low reasoning effort');
  const base={provider:'deepseek' as const,model:'deepseek-flash',apiKey:'test-only',messages:[{role:'user',content:'你好'}]};
  for(const enabled of [false,true]){
    useSettingsStore.getState().setChatThinkingEnabled(enabled);
    const request=buildProviderRequest({...base,disableThinking:!useSettingsStore.getState().chatThinkingEnabled},'openai','https://example.invalid/v1',true);
    const body=JSON.parse(String(request.init.body));
    check(body.thinking.type===(enabled?'enabled':'disabled'),'actual DeepSeek request follows toggle');
    check(enabled?body.reasoning_effort==='low':!('reasoning_effort' in body),'disabled request carries no reasoning budget');
    check(body.stream===true&&body.model==='deepseek-flash','mode switch preserves model and streaming');
  }
  useSettingsStore.getState().setChatThinkingEnabled(false);
  const nativeFetch=window.fetch;
  const bodies:any[]=[];
  try {
    window.fetch=async(_url,init)=>{
      bodies.push(JSON.parse(String(init?.body)));
      return new Response('data: '+JSON.stringify({choices:[{delta:{content:'嗯，我在。'},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n',
        {headers:{'Content-Type':'text/event-stream'}});
    };
    const direct=await llmChatStream({...base,disableThinking:true,onDelta:()=>{}});
    check(direct.content==='嗯，我在。'&&bodies[0].thinking.type==='disabled','direct HTTP stream actually disables thinking');
    check(!('reasoning_effort' in bodies[0]),'direct HTTP stream drops reasoning budget');
    const gateway=await gatewayChatStream({apiKey:'test-only',systemPrompt:'隔离测试',message:'你好',history:[],disableThinking:true,onDelta:()=>{}},{baseUrl:'https://example.invalid'});
    check(gateway.content==='嗯，我在。'&&bodies[1].disableThinking===true,'gateway stream preserves disabled-thinking flag');
    const enabledDirect=await llmChatStream({...base,disableThinking:false,onDelta:()=>{}});
    check(enabledDirect.content==='嗯，我在。'&&bodies[2].thinking.type==='enabled'&&bodies[2].reasoning_effort==='low','direct stream enables thinking with low reasoning effort');
    const enabledGateway=await gatewayChatStream({apiKey:'test-only',systemPrompt:'隔离测试',message:'你好',history:[],disableThinking:false,onDelta:()=>{}},{baseUrl:'https://example.invalid'});
    check(enabledGateway.content==='嗯，我在。'&&bodies[3].disableThinking!==true,'gateway stream does not silently disable requested thinking');
  } finally { window.fetch=nativeFetch; }
  return {checks,complete:true,projectionUpgradeWrites,paidCalls:0,scope:'isolated real IndexedDB; actual recall compared with full-scan implementation; no model/network/microphone'};
}});
