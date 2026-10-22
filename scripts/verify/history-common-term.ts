import {db,type Message} from '../../src/db';
import {searchIndexedHistorySession} from '../../src/lib/chat-history-index';
const checks:Array<{name:string;ok:boolean;detail?:unknown}>=[];
const check=(name:string,ok:unknown,detail?:unknown)=>checks.push({name,ok:!!ok,...(detail===undefined?{}:{detail})});
const now=Date.UTC(2026,9,22),sessionId='common-term-session';
const id=(i:number)=>'common-'+String(i).padStart(6,'0');
async function fixture(size:number,tied=false,old=false){
  await db.delete();await db.open();
  const rows:Message[]=Array.from({length:size},(_,i)=>({id:id(i),sessionId,role:'user',content:'今天聊点轻松的。',createdAt:old?i+1:now-100000+(tied?0:i),revision:1}));
  await db.messages.bulkAdd(rows);return rows;
}
async function measured(terms:string[],exactQuery:string,excluded:Set<string>){
  let keys=0,bodies=0;const core=db.messageHistorySearch.core,query=core.query.bind(core),messages=db.messages.core,getMany=messages.getMany.bind(messages);
  core.query=async request=>{const result=await query(request);if(!request.values)keys+=result.result.length;return result;};
  messages.getMany=async request=>{const result=await getMany(request);bodies+=result.filter(Boolean).length;return result;};
  const start=performance.now();try{const hits=await searchIndexedHistorySession({sessionId,terms,exactQuery,excluded,preferAssistant:false,now,limit:6});return {hits,keys,bodies,ms:performance.now()-start};}
  finally{core.query=query;messages.getMany=getMany;}
}
(window as any).runCommonTerm=async()=>{
  const runs=[];
  for(const size of [1000,10000,50000]){
    await fixture(size);const excluded=new Set(Array.from({length:12},(_,i)=>id(size-i-1)));
    const run=await measured(['今天'],'今天的云很漂亮',excluded);runs.push({messages:size,keys:run.keys,bodies:run.bodies,ms:run.ms});
    check(size+' common term retains the exact six newest eligible originals',JSON.stringify(run.hits?.map(hit=>hit.row.id))===JSON.stringify(Array.from({length:6},(_,i)=>id(size-13-i))));
    check(size+' common-term posting reads do not scale with the entire history',run.keys<=100,{keys:run.keys,bodies:run.bodies});
    const shared=await measured(['今天','轻松'],'今天的云很漂亮',excluded);
    check(size+' overlapping common terms preserve exact ranking with bounded postings',shared.keys<=100&&JSON.stringify(shared.hits?.map(hit=>hit.row.id))===JSON.stringify(Array.from({length:6},(_,i)=>id(size-13-i))),{keys:shared.keys,bodies:shared.bodies});
    const currentId='excluded-current';await db.messages.add({id:currentId,sessionId,role:'user',content:'今天的云很漂亮',createdAt:now+1,revision:1});excluded.add(currentId);
    const self=await measured(['今天','轻松'],'今天的云很漂亮',excluded);
    check(size+' an excluded current input cannot force an archive-wide exact-match search',self.keys<=100&&JSON.stringify(self.hits?.map(hit=>hit.row.id))===JSON.stringify(Array.from({length:6},(_,i)=>id(size-13-i))),{keys:self.keys,bodies:self.bodies});
  }
  await fixture(1000,true);const ties=await measured(['今天'],'',new Set());
  check('equal timestamps preserve original primary-id tie ordering',JSON.stringify(ties.hits?.map(hit=>hit.row.id))===JSON.stringify(Array.from({length:6},(_,i)=>id(i))));
  await fixture(1000,false,true);const old=await measured(['今天'],'',new Set());
  check('mixed-width legacy timestamps retain the exact fallback ranking',JSON.stringify(old.hits?.map(hit=>hit.row.id))===JSON.stringify(Array.from({length:6},(_,i)=>id(999-i))));
  await fixture(1000);
  await db.messages.add({id:'rare-old',sessionId,role:'user',content:'今天需要讨论的难题',createdAt:now-864000000,revision:1});
  const rare=await measured(['今天','难题'],'今天需要讨论的难题',new Set());
  check('a rare old exact match still outranks recent common terms',rare.hits?.[0].row.id==='rare-old');
  await db.messages.update('rare-old',{content:'这是编辑后的不同内容。',revision:2});
  const edited=await measured(['今天','难题'],'今天需要讨论的难题',new Set());
  check('edited originals immediately stop matching with no cached authorization',!edited.hits?.some(hit=>hit.row.id==='rare-old'));
  await db.messages.update(id(999),{sessionId:'other-role-session'});
  const transferred=await measured(['今天'],'',new Set());
  check('a transferred source leaves its old session index immediately',transferred.hits?.[0].row.id===id(998));
  return {complete:checks.every(row=>row.ok),checks,failures:checks.filter(row=>!row.ok),runs,apiCalls:0};
};
