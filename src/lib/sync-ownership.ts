import type {IndexableType} from 'dexie';
import {db} from '../db';

type Row=Record<string,any>;
const privateRoleTables=new Set(['sessions','memories','continuityThreads','characterStates','emotionSnapshots','characterLifeEvents','secretaryTasks','voiceCalls']);
const keyOf=(row:Row,path:string|string[])=>Array.isArray(path)?path.map(part=>row[part]):row[path];
const recordLabels:Record<string,string>={characters:'角色',sessions:'会话',messages:'聊天消息',memories:'记忆',continuityThreads:'当前事项',characterStates:'角色状态',emotionSnapshots:'情绪记录',voiceCalls:'通话记录',secretaryTasks:'助理事项',worldSceneEntries:'场景记录',角色:'角色'};
const conflict=(table:string):never=>{throw Error('备份中的'+(recordLabels[table]??'资料')+'与本机记录归属冲突。导入已取消，原数据保留。');};

/** Read only the incoming primary keys, in bounded batches. The enclosing
 * import writer transaction keeps these ownership checks and writes atomic. */
async function selectedRows(tableName:string,keys:IndexableType[]):Promise<Row[]>{
 const unique=[...new Map(keys.map(key=>[JSON.stringify(key),key])).values()],rows:Row[]=[];
 for(let offset=0;offset<unique.length;offset+=256)rows.push(...await db.table(tableName).where(':id').anyOf(unique.slice(offset,offset+256)).toArray());
 return rows;
}

export async function assertSyncOwnership(ownerId:string,input:object):Promise<void>{
 const tables=new Map(db.tables.map(table=>[table.name,table]));
 const incoming=new Map<string,Row[]>();
 // Tombstones are merged under owner-derived keys by their repository; their
 // imported id is never used as a write target. Do not trust it as identity.
 for(const [name,value]of Object.entries(input))if(name!=='sourceTombstones'&&tables.has(name)&&Array.isArray(value))incoming.set(name,value);
 const existingByTable=new Map<string,Row[]>();
 for(const [name,rows]of incoming){
  const path=tables.get(name)!.schema.primKey.keyPath;
  if(!path)continue;
  const byKey=new Map<string,Row>();
  for(const row of rows){
   const key=keyOf(row,path);if(key===undefined)continue; // An auto-generated key cannot overwrite an existing row.
   const encoded=JSON.stringify(key);if(byKey.has(encoded))conflict(name);
   byKey.set(encoded,row);
  }
  const existing=await selectedRows(name,[...byKey.values()].map(row=>keyOf(row,path)));
  existingByTable.set(name,existing);
  for(const current of existing){
   const next=byKey.get(JSON.stringify(keyOf(current,path)))!;
   if(name==='characters'){
    if(current.isPreset&&next.isPreset)continue; // Preserve local built-in presets, as the importer already does.
    if(!!current.isPreset!==!!next.isPreset||current.createdBy!==next.createdBy)conflict(name);
   }else if(next.userId===ownerId&&current.userId!==ownerId)conflict(name);
   if(privateRoleTables.has(name)&&current.characterId!==next.characterId)conflict(name);
   if(name==='sessions'&&(current.type??'private')!==(next.type??'private'))conflict(name);
   if((name==='messages'||name==='emotionSnapshots'||name==='secretaryTasks'||name==='voiceCalls')&&current.sessionId!==next.sessionId)conflict(name);
   if(name==='messages'&&current.role!==next.role)conflict(name);
   if(name==='worldSceneEntries'&&current.sceneId!==next.sceneId)conflict(name);
  }
 }
 // Rows without userId inherit ownership from their original parent, never
 // from an incoming header that happens to reuse that parent's id.
 for(const [name,parentTable,parentField]of [['messages','sessions','sessionId'],['emotionSnapshots','sessions','sessionId'],['worldSceneEntries','worldScenes','sceneId']] as const){
  const current=existingByTable.get(name)??[];
  // Parent ids are in the incoming packet (the importer already filters its
  // children that way), so reuse the fresh rows held by this same transaction.
  const parents=existingByTable.get(parentTable)??[];
  const byId=new Map(parents.map(row=>[row.id,row]));
  if(current.some(row=>byId.get(row[parentField])?.userId!==ownerId))conflict(name);
  if(name==='emotionSnapshots'){
   const nextParents=new Map((incoming.get(parentTable)??[]).map(row=>[row.id,row]));
   for(const row of incoming.get(name)??[]){const parent=nextParents.get(row[parentField])??byId.get(row[parentField]);if(!parent||parent.userId!==ownerId||(parent.type??'private')!=='group'&&parent.characterId!==row.characterId)conflict(name);}
  }
 }
 // Private role data must still belong to an owned copy (or a legacy built-in
 // preset). Sharing a name or public preset does not share private records.
 const roleIds=[...new Set([...incoming].flatMap(([name,rows])=>privateRoleTables.has(name)?rows.filter(row=>name!=='sessions'||row.type!=='group').map(row=>row.characterId).filter(Boolean):[]))];
 const actors=await selectedRows('characters',roleIds);
 const byActor=new Map((incoming.get('characters')??[]).map(row=>[row.id,row]));
 for(const actor of actors)byActor.set(actor.id,actor);
 if(roleIds.some(id=>{const actor=byActor.get(id);return !actor||!actor.isPreset&&actor.createdBy!==ownerId;}))conflict('角色');
}
