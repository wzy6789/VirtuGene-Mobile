import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {liveQuery} from 'dexie';
import {db,type Character,type CharacterState,type RelationshipEvent,type RelationshipState} from '../../db';
import {useAuthStore} from '../../store/auth-store';
import {useUIStore} from '../../store/ui-store';
import {worldRepo} from '../../db/world-repo';
import {relationshipRepo} from '../../db/relationship-repo';
import {userRef,characterRef} from '../../lib/world/subjects';
import {describeFacets,pairTitle,recentReasons,reasonText} from '../../lib/world/relationships';
import {getRelationLevel} from '../../lib/affinity';
import {Avatar} from '../ui/Avatar';
import {Icon} from '../ui/Icon';
import {LoadingSkeleton} from '../ui/LoadingSkeleton';
import {RelationshipConstellation} from './RelationshipConstellation';
import {RelationshipDetail,type RelationSelection} from './RelationshipDetail';
import '../../styles/relations-paper.css';

interface RelationsSnapshot{worldId:string;characters:Character[];states:RelationshipState[];events:RelationshipEvent[];charStates:CharacterState[];memoryCounts:Record<string,number>;threadCounts:Record<string,number>}
export function MobileRelationsPage(){
 const owner=useAuthStore(s=>s.userId);
 return owner?<RelationsPage key={owner} userId={owner}/>:null;
}
function RelationsPage({userId}:{userId:string}){
 const [data,setData]=useState<RelationsSnapshot>();
 const [loading,setLoading]=useState(true),[failed,setFailed]=useState(false),[retry,setRetry]=useState(0);
 const [selected,setSelected]=useState<RelationSelection>();
 const returnTo=useRef<HTMLButtonElement|null>(null);
 useEffect(()=>{
  let alive=true;const current=()=>alive&&useAuthStore.getState().userId===userId;
  setLoading(true);setFailed(false);
  const subscription=liveQuery(async()=>{
   const world=await worldRepo.ensureDefaultWorld(userId);
   if(!current()||world.userId!==userId)throw Error('relationship:world-unavailable');
   return db.transaction('r',[db.worlds,db.characters,db.characterStates,db.relationshipStates,db.relationshipEvents,db.sharedMemories,db.continuityThreads],async()=>{
    const ownedWorld=await db.worlds.get(world.id);if(ownedWorld?.userId!==userId||!current())throw Error('relationship:world-unavailable');
    const [characters,states,events,charStates,memories]=await Promise.all([
     db.characters.where('createdBy').equals(userId).filter(c=>c.agentProfile!=='secretary').toArray(),
     relationshipRepo.listStatesByWorld(world.id,200,userId),relationshipRepo.listEventsByWorld(world.id,300,userId),
     db.characterStates.where('userId').equals(userId).toArray(),db.sharedMemories.where('worldId').equals(world.id).filter(m=>m.userId===userId).toArray(),
    ]);
    const ids=new Set(characters.map(c=>c.id));
    const threads=ids.size?await db.continuityThreads.where('characterId').anyOf([...ids]).filter(t=>t.userId===userId&&t.status==='open').toArray():[];
    const memoryCounts:Record<string,number>={},threadCounts:Record<string,number>={};
    // One world-index read for all counts, never a world scan per character.
    for(const memory of memories)for(const ref of new Set(memory.participants))if(ref.startsWith('c:')&&ids.has(ref.slice(2)))memoryCounts[ref.slice(2)]=(memoryCounts[ref.slice(2)]??0)+1;
    for(const thread of threads)threadCounts[thread.characterId]=(threadCounts[thread.characterId]??0)+1;
    if(!current())throw Error('relationship:scope-changed');
    return{worldId:world.id,characters,states,events,charStates,memoryCounts,threadCounts};
   });
  }).subscribe({next:next=>{if(current()){setData(next);setLoading(false);setFailed(false);}},error:()=>{if(current()){setData(undefined);setSelected(undefined);setLoading(false);setFailed(true);}}});
  return()=>{alive=false;subscription.unsubscribe();};
 },[userId,retry]);
 const names=useMemo(()=>new Map(data?.characters.map(c=>[c.id,c.name])??[]),[data?.characters]);
 const eventsOf=useMemo(()=>{const map=new Map<string,RelationshipEvent[]>();for(const e of data?.events??[]){const rows=map.get(e.pairKey)??[];rows.push(e);map.set(e.pairKey,rows);}return map;},[data?.events]);
 const stateOf=useMemo(()=>new Map(data?.states.map(s=>[s.pairKey,s])??[]),[data?.states]);
 const closeDetail=useCallback(()=>{setSelected(undefined);if(returnTo.current?.isConnected)returnTo.current.focus({preventScroll:true});},[]);
 const pick=(selection:RelationSelection,button:HTMLButtonElement)=>{returnTo.current=button;setSelected(selection);};
 const renderRow=(selection:RelationSelection,description:string,characters:Character[])=>{
  const title=pairTitle(selection,userId,id=>names.get(id)??'已移除的角色'),reason=recentReasons(eventsOf.get(selection.pairKey)??[],1)[0];
  return <li key={selection.pairKey} data-relation-key={selection.pairKey}><button type="button" aria-haspopup="dialog" onClick={event=>pick(selection,event.currentTarget)}>
   <span className="vg-relation-row-avatars" aria-hidden="true">{characters.map(c=><Avatar key={c.id} avatar={c.avatar} size="sm"/>)}</span>
   <span className="vg-relation-row-copy"><strong>{title}</strong><span>{description}</span><small>{reason?reasonText(reason):'还没有记录到变化'}</small></span><Icon name="chevron" size={20}/>
  </button></li>;
 };
 const pairs=data?.states.filter(s=>!s.subjects.includes(userRef(userId))&&s.subjects.every(ref=>ref.startsWith('c:')&&names.has(ref.slice(2))))??[];
 return <div className="vg-relations-page vg-light-paper h-full overflow-y-auto">
  <header className="vg-relations-header"><button type="button" aria-label="返回世界" onClick={()=>useUIStore.getState().setActiveView('chat')}><Icon name="back" size={22}/></button><h1>关系网络</h1></header>
  <p className="vg-relations-intro">现在是什么关系，以及为什么会变成这样。</p>
  {loading?<LoadingSkeleton label="正在读取你们的关系…" rows={3}/>:failed?<section className="vg-relations-empty"><h2>关系读取失败</h2><p role="alert">没能从本机读到关系记录，请重新读取。</p><button type="button" className="vg-button vg-button-secondary" onClick={()=>setRetry(n=>n+1)}>重新读取</button></section>:data&&<>
   <section className="vg-relations-section"><h2>你和他们</h2>{data.characters.length?<ul>{data.characters.map(c=>{
    const subjects=[userRef(userId),characterRef(c.id)],pairKey=[...subjects].sort().join('|'),state=stateOf.get(pairKey),cs=data.charStates.find(s=>s.characterId===c.id);
    const {level}=getRelationLevel(cs?.affinity??0),levelName=cs?.tierNames?.[level.name]||level.name;
    return renderRow({pairKey,subjectA:subjects[0],subjectB:subjects[1],stateId:state?.id},`${levelName} · ${level.desc}`,[c]);
   })}</ul>:<div className="vg-relations-empty"><p>你还没有角色。先去「角色」里认识一个吧。</p><button type="button" className="vg-button vg-button-secondary" onClick={()=>useUIStore.setState({activeView:'chat',mobileTab:'characters',worldTheaterOpen:false})}>去认识角色</button></div>}</section>
   <section className="vg-relations-section"><h2>他们之间</h2>{pairs.length?<ul>{pairs.map(state=>renderRow({pairKey:state.pairKey,subjectA:state.subjectA,subjectB:state.subjectB,stateId:state.id},describeFacets(state,2).map(f=>f.text).join(' · ')||'还没有记录到具体变化',data.characters.filter(c=>state.subjects.includes(characterRef(c.id)))))}</ul>:<p className="vg-relations-empty">角色之间还没有留下可以解释的变化。</p>}</section>
   {data.characters.length>0&&<details className="vg-relations-map"><summary><span><strong>关系示意图</strong><small>布局不代表亲密程度</small></span><Icon name="chevron" size={20}/></summary><RelationshipConstellation compact userId={userId} characters={data.characters} states={data.states} events={data.events}/></details>}
   <p className="vg-relations-note">这里只写真实发生过的变化，不显示内部数值。</p>
  </>}
  {selected&&data&&<RelationshipDetail key={selected.pairKey} userId={userId} worldId={data.worldId} selection={selected} memoryCounts={data.memoryCounts} threadCounts={data.threadCounts} onClose={closeDetail}/>}
 </div>;
}
