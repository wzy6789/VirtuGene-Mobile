import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import type { Character, MemoryItem } from '../../db';
import { memoryRepo } from '../../db/memory-repo';
import { memoryKindLabel } from '../../lib/memory-engine';
import { Icon } from '../ui/Icon';
import { animateVisual } from '../../lib/ui-visual-motion';

function pickFragments(pool:MemoryItem[],previous:MemoryItem[]=[]):MemoryItem[] {
  const shuffled=[...pool];
  for(let i=shuffled.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[shuffled[i],shuffled[j]]=[shuffled[j],shuffled[i]];}
  const next=shuffled.slice(0,3);
  if(next.length&&previous.length===next.length&&next.every(row=>previous.some(old=>old.id===row.id))){
    const different=pool.find(row=>!previous.some(old=>old.id===row.id));
    if(different)next[next.length-1]=different;
    else if(next.length>1&&next.every((row,i)=>row.id===previous[i].id))next.push(next.shift()!);
  }
  return next;
}

/** A few owned, active records; never fabricate fragments for an empty archive. */
export function RoleMemoryPreview({character,userId,refresh,onArchive,onStory}:{character:Character;userId:string;refresh:boolean;onArchive:()=>void;onStory:()=>void}) {
  const [rows,setRows]=useState<MemoryItem[]|null>(null);
  const [failed,setFailed]=useState(false);
  const [attempt,setAttempt]=useState(0);
  const [pool,setPool]=useState<MemoryItem[]>([]);
  const [layout,setLayout]=useState([0,0,0]);
  const glassId=useId().replace(/:/g,'');
  const listRef=useRef<HTMLUListElement>(null);
  const motion=useRef<()=>void>(()=>{});
  useEffect(()=>()=>motion.current(),[]);
  useEffect(()=>{
    let alive=true;setRows(null);setPool([]);setFailed(false);
    memoryRepo.getRecentActiveByCharacter(character.id,userId,Number.MAX_SAFE_INTEGER).then(list=>{
      if(alive){setPool(list);setRows(pickFragments(list));setLayout(Array.from({length:3},()=>Math.random()));}
    }).catch(()=>{if(alive){setRows([]);setFailed(true);}});
    return()=>{alive=false;};
  },[character.id,userId,refresh,attempt]);
  const changeBatch=()=>{
    setRows(previous=>pickFragments(pool,previous??[]));setLayout(Array.from({length:3},()=>Math.random()));
    motion.current();motion.current=animateVisual(listRef.current,[{opacity:.35,transform:'translateY(5px)'},{opacity:1,transform:'none'}],200);
  };
  return <div className="vg-role-memory">
    <div className="vg-role-memory-heading"><h3>记忆碎片</h3><button className="vg-role-memory-refresh" onClick={changeBatch} disabled={pool.length<2||rows===null}><Icon name="refresh" size={16}/>换一批</button></div>
    {failed ? <div className="vg-role-memory-empty" role="alert"><p>暂时没有读取到记忆。</p><button className="vg-button vg-button-ghost" onClick={()=>setAttempt(n=>n+1)}>重试</button></div> : rows===null ? <p className="vg-role-memory-empty" role="status">正在拾起记忆…</p> : rows.length ? <ul ref={listRef} className="vg-role-memory-list" aria-label="记忆碎片">{rows.map((row,index)=><li key={row.id} data-fragment={index} style={{'--fragment-offset':`${Math.round((layout[index]??0)*14)}px`,'--fragment-tilt':`${((layout[index]??0)-.5)*5}deg`} as CSSProperties}>
      <svg className="vg-memory-glass" aria-hidden="true" viewBox="0 0 100 100" preserveAspectRatio="none">
        <defs><linearGradient id={`${glassId}-${index}`} x1="0" y1="0" x2="1" y2="1"><stop stopColor="var(--fragment-light)"/><stop offset=".42" stopColor="var(--bg-panel)"/><stop offset="1" stopColor="var(--fragment-depth)"/></linearGradient></defs>
        <polygon points={['8,1 84,5 99,28 92,81 69,99 5,91 1,34','1,21 29,1 91,9 99,73 78,99 14,92 4,60','14,1 95,17 99,58 84,99 3,88 1,33'][index]} fill={`url(#${glassId}-${index})`} stroke="var(--fragment-edge)" strokeWidth="1" vectorEffect="non-scaling-stroke"/>
        <path d={['M8 1 14 15 6 28M92 81 82 77 77 88 69 99','M29 1 30 12 15 22 4 21M99 73 88 70 89 84 78 99','M14 1 17 13 7 25 1 33M95 17 84 22 90 33 99 58'][index]} fill="none" stroke="var(--fragment-edge)" strokeWidth=".7" vectorEffect="non-scaling-stroke" opacity=".6"/>
      </svg>
      <div><span>{row.pinned?'重点记忆':memoryKindLabel(row.memoryKind)}</span><time dateTime={new Date(row.createdAt).toISOString()}>{new Date(row.createdAt).toLocaleDateString('zh-CN',{month:'numeric',day:'numeric'})}</time></div><p>{row.content}</p><span className="vg-role-memory-fragment-number" aria-hidden="true">0{index+1}</span></li>)}</ul> : <p className="vg-role-memory-empty">还没有留下记忆。聊过的偏好、约定与经历，会慢慢留在这里。</p>}
    <div className="vg-role-memory-links">
      <button onClick={onArchive}><Icon name="diary" size={18}/><span><strong>查看记忆档案</strong><small>完整记录、来源与管理</small></span><Icon name="chevron" size={16}/></button>
      <button onClick={onStory}><Icon name="clock" size={18}/><span><strong>我们的故事</strong><small>沿时间回看相识与共同经历</small></span><Icon name="chevron" size={16}/></button>
    </div>
  </div>;
}
