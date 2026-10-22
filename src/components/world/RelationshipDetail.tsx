import {useCallback,useEffect,useState} from 'react';
import {liveQuery} from 'dexie';
import {db,type Character,type CharacterState,type RelationshipEvent,type RelationshipState,type WorldEvent} from '../../db';
import {useAuthStore} from '../../store/auth-store';
import {useUIStore} from '../../store/ui-store';
import {describeFacets,pairTitle,recentReasons,reasonText} from '../../lib/world/relationships';
import {getRelationLevel} from '../../lib/affinity';
import {Modal} from '../ui/Modal';
import {Avatar} from '../ui/Avatar';
import {LoadingSkeleton} from '../ui/LoadingSkeleton';
import {TimelineRecordDialog} from './TimelineRecordDialog';
import {ContinuityThreadsModal} from '../character/ContinuityThreadsModal';

export interface RelationSelection{pairKey:string;subjectA:string;subjectB:string;stateId?:string}
interface Detail{available:boolean;characters:Character[];state?:RelationshipState;charState?:CharacterState;events:RelationshipEvent[];sources:WorldEvent[]}
function relationStamp(value:number){
 const date=new Date(value);
 return Number.isFinite(date.getTime())?{iso:date.toISOString(),label:date.toLocaleString('zh-CN')}:{iso:undefined,label:'时间未记录'};
}
export function RelationshipDetail({userId,worldId,selection,memoryCounts,threadCounts,onClose}:{userId:string;worldId:string;selection:RelationSelection;memoryCounts:Record<string,number>;threadCounts:Record<string,number>;onClose():void}){
 const owner=useAuthStore(s=>s.userId);
 const [data,setData]=useState<Detail>(),[loading,setLoading]=useState(true),[failed,setFailed]=useState(false),[retry,setRetry]=useState(0);
 const [sourceId,setSourceId]=useState<string>(),[threadId,setThreadId]=useState<string>();
 useEffect(()=>{
  let alive=true;const current=()=>alive&&useAuthStore.getState().userId===userId;
  const subscription=liveQuery(()=>db.transaction('r',[db.worlds,db.characters,db.characterStates,db.relationshipStates,db.relationshipEvents,db.worldEvents],async()=>{
   const unavailable:Detail={available:false,characters:[],events:[],sources:[]};
   const world=await db.worlds.get(worldId);if(world?.userId!==userId||!current())return unavailable;
   const ids=[selection.subjectA,selection.subjectB].filter(ref=>ref.startsWith('c:')).map(ref=>ref.slice(2));
   const characters=(await db.characters.bulkGet(ids)).filter((c):c is Character=>!!c&&c.createdBy===userId&&c.agentProfile!=='secretary');
   if(characters.length!==ids.length)return unavailable;
   const state=selection.stateId?await db.relationshipStates.get(selection.stateId):undefined;
   if(selection.stateId&&(!state||state.userId!==userId||state.worldId!==worldId||state.pairKey!==selection.pairKey))return unavailable;
   const rows=await db.relationshipEvents.where('[worldId+pairKey]').equals([worldId,selection.pairKey]).toArray();
   const events=recentReasons(rows.filter(e=>e.userId===userId&&e.worldId===worldId),50);
   const sources=(await db.worldEvents.bulkGet([...new Set(events.flatMap(e=>e.sourceEventId?[e.sourceEventId]:[]))])).filter((e):e is WorldEvent=>!!e&&e.userId===userId&&e.worldId===worldId&&e.visibility==='world');
   const charState=selection.subjectA.startsWith('u:')||selection.subjectB.startsWith('u:')?await db.characterStates.get([ids[0],userId]):undefined;
   if(!current())return unavailable;
   return{available:true,characters,state,charState,events,sources};
  })).subscribe({next:value=>{if(current()){setData(value);setLoading(false);setFailed(false);}},error:()=>{if(current()){setData(undefined);setLoading(false);setFailed(true);}}});
  return()=>{alive=false;subscription.unsubscribe();};
 },[userId,worldId,selection,retry]);
 const sources=new Map(data?.sources.map(e=>[e.id,e])??[]);
 useEffect(()=>{if(sourceId&&!sources.has(sourceId))setSourceId(undefined);},[sourceId,data?.sources]);
 const sourceRead=useCallback(()=>{},[]);
 if(owner!==userId)return null;
 const title=data?.available?pairTitle(selection,userId,id=>data.characters.find(c=>c.id===id)?.name??'已移除的角色'):'';
 const facets=describeFacets(data?.state,4),level=data?.charState&&getRelationLevel(data.charState.affinity).level;
 const threadCharacter=data?.characters.find(c=>c.id===threadId);
 return <>
  <Modal open onClose={onClose} title="关系详情" mobileFullHeight panelClassName="vg-light-paper vg-relation-detail" canSnapshotOnExit={()=>false}>
   <div className="vg-relation-detail-body">{loading?<LoadingSkeleton label="正在读取当前关系" rows={3}/>:failed?<div role="alert"><p>关系暂时没有读到，请重新读取。</p><button type="button" className="vg-button vg-button-secondary" onClick={()=>setRetry(n=>n+1)}>重新读取</button></div>:!data?.available?<p role="alert">这条关系已不可用，可能角色已移除或当前世界权限已变化。旧内容不再展示。</p>:<>
    <div className="vg-relation-detail-identities" aria-hidden="true">{data.characters.map(c=><Avatar key={c.id} avatar={c.avatar} size="md"/>)}</div>
    <h3>{title}</h3>{level&&<p className="vg-relation-level">{data.charState?.tierNames?.[level.name]||level.name} · {level.desc}</p>}
    <section><h4>现在的关系</h4>{facets.length?<dl className="vg-relation-facets">{facets.map(f=><div key={f.facet}><dt>{f.label}</dt><dd>{f.text}</dd></div>)}</dl>:<p className="vg-relation-sub">还没有记录到具体变化。</p>}</section>
    <section><h4>为什么会变成这样</h4>{data.events.length?<ol className="vg-relation-reasons">{data.events.map(event=>{
     const source=event.sourceEventId?sources.get(event.sourceEventId):undefined,stamp=relationStamp(event.createdAt);
     return <li key={event.id} className="vg-relation-reason"><p>{reasonText(event)}</p><time dateTime={stamp.iso}>{stamp.label}</time>{source?<button type="button" className="vg-button vg-button-ghost" onClick={()=>setSourceId(source.id)}>查看来源</button>:<span className="vg-relation-sub">{event.sourceEventId?'来源已不可用':'这条记录没有关联的原文来源'}</span>}</li>;
    })}</ol>:<p className="vg-relation-sub">还没有记录到变化。已有等阶与状态仍按当前资料展示。</p>}{data.events.length===50&&<p className="vg-relation-sub">这里展示最近 50 条有原因的变化。</p>}</section>
    <section><h4>共同留下的事</h4>{data.characters.map(c=><div key={c.id} className="vg-relation-record-links"><p>{c.name} · {memoryCounts[c.id]??0} 条共同经历 · {threadCounts[c.id]??0} 件未完成</p><button type="button" className="vg-button vg-button-secondary" onClick={()=>setThreadId(c.id)}>查看未完成事项</button></div>)}<button type="button" className="vg-button vg-button-secondary" onClick={()=>{onClose();useUIStore.getState().setActiveView('memory');}}>打开记忆馆</button></section>
   </>}</div>
  </Modal>
  {sourceId&&sources.has(sourceId)&&<TimelineRecordDialog userId={userId} worldId={worldId} record={{kind:'event',id:sourceId,revision:sources.get(sourceId)?.updatedAt}} onRead={sourceRead} onClose={()=>setSourceId(undefined)} surface="light-paper"/>}
  {threadCharacter&&data?.available&&<ContinuityThreadsModal open userId={userId} character={threadCharacter} onClose={()=>setThreadId(undefined)}/>}
 </>;
}
