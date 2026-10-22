/** Job-local evidence, never prompt fields or persisted authorization caches. */
import {db} from '../../db';
type SourceValidator=()=>Promise<boolean>;
const guards=new WeakMap<object,SourceValidator[]>();
export class WorldSourceChangedError extends Error {
  constructor(){super('world:source-changed：参考资料来源已变化，请重新发送或重试。');this.name='WorldSourceChangedError';}
}
export function addWorldSourceGuards<T extends object>(context:T,...validators:SourceValidator[]):T{
  guards.set(context,[...(guards.get(context)??[]),...validators]);return context;
}
export function inheritWorldSourceGuards<T extends object>(context:T,...parents:object[]):T{
  const inherited=[...new Set(parents.flatMap(parent=>guards.get(parent)??[]))];
  if(inherited.length)guards.set(context,[...(guards.get(context)??[]),...inherited]);
  return context;
}
export function hasWorldSourceGuards(context:object|undefined){return !!context&&!!guards.get(context)?.length;}
export async function assertWorldSourcesLive(context:object|undefined){
  if(!context||!hasWorldSourceGuards(context))return;
  await db.transaction('r',db.tables,async()=>{
    for(const validate of guards.get(context)??[])if(!await validate())throw new WorldSourceChangedError();
  });
}
/** The guard and publication share native locks; there is no permission/read
 * gap before the asynchronous write. The callback performs local DB work only. */
export async function commitWorldSourceWrite<T>(context:object,write:()=>Promise<T>):Promise<T>{
  if(!hasWorldSourceGuards(context))return write();
  return db.transaction('rw',db.tables,async()=>{await assertWorldSourcesLive(context);return write();});
}
