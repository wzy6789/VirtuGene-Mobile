import Dexie from 'dexie';
import {db,type Diary} from '../../src/db';
import {diaryRepo} from '../../src/db/diary-repo';
import {importSyncData} from '../../src/lib/sync';
import {useAuthStore} from '../../src/store/auth-store';
const checks:Array<{name:string;ok:boolean;detail?:unknown}>=[];
const check=(name:string,ok:unknown,detail?:unknown)=>checks.push({name,ok:!!ok,...(detail===undefined?{}:{detail})});
const owner='diary-scope-owner',a='scope-role-a',b='scope-role-b';
const hash=async(value:unknown)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))).map(n=>n.toString(16).padStart(2,'0')).join('');
const raw=(rows:any[])=>rows.map(({readScopeKeys,...row})=>row);
async function visible(role:string,user=owner){
  let bodies=0;const core=db.diaries.core,query=core.query.bind(core),cursor=core.openCursor.bind(core);
  core.query=async request=>{const result=await query(request);if(request.values)bodies+=result.result.length;return result;};
  core.openCursor=async request=>{const result=await cursor(request);if(result&&request.values){const start=result.start.bind(result);result.start=callback=>start(()=>{bodies++;callback();});}return result;};
  try{const rows=await diaryRepo.listVisibleFor(role,user,Number.MAX_SAFE_INTEGER);return {rows,bodies};}
  finally{core.query=query;core.openCursor=cursor;}
}
(window as any).runDiaryReadScope=async()=>{
  await db.delete();
  const schema=Object.fromEntries(db.tables.map(table=>[table.name,[table.schema.primKey.src,...table.schema.indexes.filter(index=>index.name!=='readScopeKeys').map(index=>index.src)].join(',')]));
  const legacy=new Dexie(db.name);legacy.version(46).stores(schema);await legacy.open();
  const base={userId:owner,date:'2026-10-20',title:'合成日记',content:'隔离夹具，无真实隐私。',createdAt:1,updatedAt:1,mood:3,tags:[]};
  const rows:Diary[]=Array.from({length:10000},(_,i)=>({...base,id:'private-'+String(i).padStart(6,'0'),visibility:'private'}));
  rows.push({...base,id:'selected-grant',visibility:'selected',visibleTo:[a]},
    {...base,id:'world-grant',visibility:'world',characterId:a},
    {...base,id:'foreign-grant',userId:'other-owner',visibility:'selected',visibleTo:[a]},
    {...base,id:'legacy-unset',characterId:a});
  (rows[0] as any).readScopeKeys=[[owner,a]];
  const before=await hash(raw(rows).sort((left,right)=>left.id.localeCompare(right.id)));
  await legacy.table('diaries').bulkAdd(rows);legacy.close();
  const started=performance.now();await db.open();const upgradeMs=performance.now()-started;
  const restored=await db.diaries.toArray();
  check('scope migration preserves all diary fields except the derived projection',restored.length===rows.length&&await hash(raw(restored).sort((left,right)=>left.id.localeCompare(right.id)))===before,{rows:rows.length,upgradeMs});
  const initial=await visible(a);
  check('only explicit selected or linked-world grants are returned',JSON.stringify(initial.rows.map(row=>row.id).sort())===JSON.stringify(['selected-grant','world-grant']));
  check('two grants do not load ten thousand unrelated private bodies',initial.bodies<=2,{bodies:initial.bodies});
  const empty=await visible(b);check('zero matching grants read zero unrelated diary bodies',empty.rows.length===0&&empty.bodies===0,{bodies:empty.bodies});
  await db.diaries.update('selected-grant',{visibleTo:[b]});
  check('changed grants are visible immediately to both roles',(await visible(a)).rows.length===1&&(await visible(b)).rows[0]?.id==='selected-grant');
  await db.diaries.update('world-grant',{visibility:'private'});
  check('revoking linked-world sharing removes the old indexed grant',(await visible(a)).rows.length===0);
  await db.diaries.update('selected-grant',{userId:'other-owner'});
  check('account transfer updates both native index scopes',(await visible(b)).rows.length===0&&(await visible(b,'other-owner')).rows[0]?.id==='selected-grant');
  try{await db.transaction('rw',db.diaries,async()=>{await db.diaries.update('selected-grant',{userId:owner});throw Error('rollback');});}catch{}
  check('rollback restores authorization and its derived keys together',(await visible(b)).rows.length===0&&(await visible(b,'other-owner')).rows.length===1);
  await db.diaries.update('private-000000',{readScopeKeys:[[owner,a]]} as any);
  check('direct imported projection data cannot grant private access',(await visible(a)).rows.length===0);
  await db.diaries.update('selected-grant',{'visibleTo.0':a} as any);
  check('nested grant updates rebuild the actual selected scope',(await visible(b,'other-owner')).rows.length===0&&(await visible(a,'other-owner')).rows.length===2);
  await db.diaries.update('selected-grant',{deletedAt:10});
  check('soft deletion removes indexed access immediately',(await visible(a,'other-owner')).rows.length===1);
  await db.diaries.update('selected-grant',{deletedAt:undefined});
  check('restoring a diary restores only its still-current explicit grant',(await visible(a,'other-owner')).rows.length===2&&(await visible(b,'other-owner')).rows.length===0);
  const foreign=(await db.diaries.get('foreign-grant'))!;
  await new Promise<void>((resolve,reject)=>{const transaction=db.backendDB().transaction('diaries','readwrite');transaction.objectStore('diaries').put({...foreign,readScopeKeys:[[owner,a]]});transaction.oncomplete=()=>resolve();transaction.onabort=()=>reject(transaction.error);});
  check('a corrupt derived owner key never overrides the actual diary account',(await visible(a)).rows.length===0);
  useAuthStore.setState({userId:owner,apiKey:undefined});
  const imported=await importSyncData({__meta__:{app:'VirtuGene',kind:'sync',version:'6.1.7',exportedAt:new Date().toISOString(),userId:owner},characters:[],sessions:[],messages:[],memories:[],emotionSnapshots:[],characterStates:[],
    diaries:[{...base,id:'forged-import',visibility:'private',readScopeKeys:[[owner,a]]}]});
  const importedRow=await db.diaries.get('forged-import');
  check('actual sync import rebuilds private scopes rather than adopting forged grants',imported.ok&&importedRow?.content===base.content&&importedRow.readScopeKeys?.length===0&&!(await visible(a)).rows.some(row=>row.id==='forged-import'));
  check('existing tombstone account-role index survives the migration',db.memorySourceTombstones.schema.indexes.some(index=>index.name==='[userId+characterId]'));
  return {complete:checks.every(row=>row.ok),checks,failures:checks.filter(row=>!row.ok),initialBodies:initial.bodies,emptyBodies:empty.bodies,upgradeMs,apiCalls:0,deviceTested:false};
};
