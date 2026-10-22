import Dexie from 'dexie';
import {db,type Message} from '../../src/db';
import {hasLivePrivateSummarySources} from '../../src/lib/chat-summary-evidence';
import {messageEvidenceKey} from '../../src/db/message-evidence-key';
const checkRows:Array<{name:string;ok:boolean;detail?:unknown}>=[];
const check=(name:string,ok:unknown,detail?:unknown)=>checkRows.push({name,ok:!!ok,...(detail===undefined?{}:{detail})});
const schema=Object.fromEntries(db.tables.map(table=>[table.name,[table.schema.primKey.src,...table.schema.indexes.map(index=>index.src)].join(',')]));
const hash=async(value:unknown)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))).map(n=>n.toString(16).padStart(2,'0')).join('');
const withoutProjection=(rows:Message[])=>rows.map(({sourceEvidenceKey,...rest})=>rest);
(window as any).runReplyDeliveryUpgrade=async()=>{
  const results=[];
  for(const size of [1000,10000,50000]){
    await db.delete();
    const legacy=new Dexie(db.name);legacy.version(45).stores(schema);await legacy.open();
    const rows:Message[]=Array.from({length:size},(_,i)=>({id:'upgrade-'+String(i).padStart(6,'0'),sessionId:'upgrade-session',role:i%2?'assistant':'user',content:'合成升级数据'+i,revision:1,createdAt:i,isProactive:false}));
    rows[1]={...rows[1],replyDelivery:'in-progress',replyCompletion:'complete'};
    rows[3]={...rows[3],interrupted:true,stopped:true};
    rows[5]={...rows[5],replyCompletion:'interrupted',replyDelivery:'settled'};
    rows[7]={...rows[7],replyDelivery:'unknown' as any,replyCompletion:'complete'};
    rows[11]={...rows[11],replyDelivery:'settled',replyCompletion:'unknown' as any};
    const beforeSha=await hash(withoutProjection(rows));
    for(const row of rows)row.sourceEvidenceKey=JSON.stringify([row.sessionId,row.revision??1,!row.failed,row.id]);
    await legacy.table('messages').bulkAdd(rows);legacy.close();
    const started=performance.now();await db.open();const upgradeMs=performance.now()-started;
    const current=await db.messages.orderBy('id').toArray();
    check(size+' upgrade retains every original field except derived source projection',current.length===size&&await hash(withoutProjection(current))===beforeSha,{size,upgradeMs});
    for(const i of [1,3,5,7,11]){
      const session={id:'upgrade-session',userId:'upgrade-owner',characterId:'upgrade-role',title:'升级',createdAt:1,updatedAt:1,unreadCount:0,
        summary:'旧摘要声称本轮已经全部回答。',summarySourceMessageIds:[rows[i].id],summarySourceMessageRevisions:{[rows[i].id]:1}};
      check(size+' old incomplete source no longer qualifies summary: '+i,!await hasLivePrivateSummarySources(session,'upgrade-owner','upgrade-role'));
    }
    check(size+' legacy ordinary speech remains indexed and usable',current[9].sourceEvidenceKey===messageEvidenceKey({id:current[9].id,sessionId:'upgrade-session',revision:1}));
    check(size+' existing account-role tombstone index remains',!!db.memorySourceTombstones.schema.indexes.find(index=>index.name==='[userId+characterId]'));
    results.push({messages:size,upgradeMs,sourceContentSha256:beforeSha});
  }
  return {complete:checkRows.every(row=>row.ok),checks:checkRows,failures:checkRows.filter(row=>!row.ok),results,apiCalls:0,scope:'Native isolated Dexie45→current migration; desktop measurements only'};
};
