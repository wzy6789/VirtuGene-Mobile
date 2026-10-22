import Dexie from 'dexie';
import {db,type Message} from '../../src/db';
import {messageRepo} from '../../src/db/message-repo';
import {recallHistoricalPrivateChat} from '../../src/lib/character-history-recall';
import {useChatStore} from '../../src/store/chat-store';
async function run(){
 let checks=0;const check=(value:unknown,label:string)=>{if(!value)throw Error(label);checks++;};
 await db.delete();const schema=Object.fromEntries(db.tables.map(table=>[table.name,[table.schema.primKey.src,...table.schema.indexes.map(index=>index.src)].join(',')]));
 schema.messages='id,sessionId,[sessionId+createdAt]';
 const legacy=new Dexie(db.name);legacy.version(33).stores(schema);await legacy.open();
 const at=Date.now()-10000,rows=Array.from({length:850},(_,i)=>({id:'tie-'+String(i).padStart(4,'0'),sessionId:'ties',role:'user',content:i===0?'北港旧约定码：周五下午三点':'普通闲聊'+i,createdAt:at,isProactive:false,revision:1})) as Message[];
 await legacy.table('messages').bulkPut(rows);await legacy.table('sessions').put({id:'ties',characterId:'actor',userId:'owner',title:'导入历史',createdAt:at,updatedAt:at,unreadCount:0});legacy.close();
 const upgradeStart=performance.now();await db.open();const upgradeMs=performance.now()-upgradeStart;
 await db.messages.delete('already-absent-source');
 await db.messages.bulkDelete(['already-absent-source','also-absent-source']);
 check(await db.messages.count()===rows.length,'repeated deletion of missing sources is an idempotent no-op');
 const hits=await recallHistoricalPrivateChat({userId:'owner',characterId:'actor',query:'还记得北港旧约定码吗？'});
 check(hits.some(hit=>hit.messageId==='tie-0000'),'oldest source survives more than 400 equal-timestamp imported messages');
 const upgradedRows=await db.messages.bulkGet(rows.map(row=>row.id));
 check(upgradedRows.length===rows.length&&rows.every((source,i)=>Object.entries(source).every(([key,value])=>JSON.stringify((upgradedRows[i] as any)?.[key])===JSON.stringify(value))),'index upgrade preserves every original field and revision');
 check(rows.every((source,i)=>upgradedRows[i]?.sourceEvidenceKey===JSON.stringify([source.sessionId,source.revision,true,source.id])),'upgrade adds the expected source identity projection without altering originals');
 check(db.messages.schema.indexes.some(index=>index.name==='[sessionId+createdAt+id]'),'migration creates the tuple cursor index');
 const seen:string[]=[];let beforeMessage:Pick<Message,'id'|'createdAt'>|undefined;
 for(let page=0;page<10;page++){const part=await messageRepo.getPage('ties',{limit:200,beforeMessage});if(!part.length)break;seen.push(...part.map(row=>row.id));beforeMessage=part[0];}
 check(seen.length===850&&new Set(seen).size===850,'tuple pages include every tied row exactly once');
 check((await messageRepo.getPage('ties',{before:at})).length===0,'legacy numeric before remains strictly time-exclusive');
 check((await messageRepo.getPage('other-session',{beforeMessage:rows[400]})).length===0,'cursor does not cross a session boundary');
 const boundary=rows[450];await db.messages.delete(boundary.id);
 check((await messageRepo.getPage('ties',{limit:10,beforeMessage:boundary})).every(row=>row.id<boundary.id),'deleted boundary row remains a usable value cursor');await db.messages.put(boundary);
 useChatStore.setState({currentSessionId:'ties',messages:await messageRepo.getPage('ties',{limit:200}),hasMoreMessages:true});
 for(let i=0;i<10&&useChatStore.getState().hasMoreMessages;i++)await useChatStore.getState().loadEarlierMessages();
 const visible=useChatStore.getState().messages;
 check(visible.length===850&&new Set(visible.map(row=>row.id)).size===850,'actual chat-store earlier loading preserves all tied originals');
 check(visible[0].id==='tie-0000'&&visible[849].id==='tie-0849','UI retains stable index order without inferring historical causality from ties');
 const latestPage=await messageRepo.getPage('ties',{limit:200});
 useChatStore.setState({currentSessionId:'ties',messages:latestPage,hasMoreMessages:true});
 await Promise.all([useChatStore.getState().loadEarlierMessages(),useChatStore.getState().loadEarlierMessages()]);
 check(useChatStore.getState().messages.length===400&&new Set(useChatStore.getState().messages.map(row=>row.id)).size===400,'concurrent earlier-page requests do not duplicate original messages');
 let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;}),originalPage=messageRepo.getPage;
 try {
  messageRepo.getPage=async(sessionId,opts)=>{await gate;return originalPage(sessionId,opts);};
  useChatStore.setState({currentSessionId:'ties',messages:latestPage,hasMoreMessages:true});
  const loading=useChatStore.getState().loadEarlierMessages();
  useChatStore.setState({currentSessionId:'different-active-session',messages:[],hasMoreMessages:false});release();await loading;
  check(useChatStore.getState().currentSessionId==='different-active-session'&&useChatStore.getState().messages.length===0,'a completed old page cannot overwrite another active chat');
 } finally {messageRepo.getPage=originalPage;}
 await db.sessions.put({id:'ranked-session',characterId:'ranking-actor',userId:'benchmark',title:'排序验证',createdAt:at,updatedAt:at,unreadCount:0});
 await db.messages.bulkPut([{id:'strong-old-source',sessionId:'ranked-session',role:'user',content:'北港散步约定',createdAt:at-86400000,isProactive:false},{id:'weak-new-source',sessionId:'ranked-session',role:'user',content:'北港',createdAt:at,isProactive:false}] as Message[]);
 const ranked=await recallHistoricalPrivateChat({userId:'benchmark',characterId:'ranking-actor',query:'北港散步约定',limit:1});
 check(ranked.length===1&&ranked[0].messageId==='strong-old-source','bounded candidates preserve a stronger older source over a weak newer mention');
 const samples=[];
 for(const size of [1000,10000,50000]){
  const sessionId='bench-'+size,characterId=sessionId;
  await db.sessions.put({id:sessionId,characterId,userId:'benchmark',title:'压力测试',createdAt:at,updatedAt:at,unreadCount:0});
  const payload=Array.from({length:size},(_,i)=>({id:sessionId+'-'+String(i).padStart(6,'0'),sessionId,role:'user',content:'普通散步规划 '+i+'：'+'路上聊聊近况。'.repeat(8),createdAt:at,isProactive:false,revision:1})) as Message[];
  await db.messages.bulkPut(payload);
  const heapBefore=(performance as any).memory?.usedJSHeapSize??null,start=performance.now();
  const result=await recallHistoricalPrivateChat({userId:'benchmark',characterId,query:'普通散步规划',limit:3});
  const elapsedMs=performance.now()-start,heapAfter=(performance as any).memory?.usedJSHeapSize??null;
  check(result.length===3&&result.every(hit=>hit.sessionId===sessionId),'dense matches keep only the requested result capacity: '+size);
  samples.push({messages:size,sameTimestamp:true,elapsedMs,heapBefore,heapAfter,returned:result.length});
 }
 return {checks,upgradeFrom:33,upgradeTo:db.verno,upgradeMs,samples,platform:'desktop Chrome isolated IndexedDB; heap before/after is not a peak or Android result',modelCalls:0};
}
(window as any).historyPaginationChecks={run};
