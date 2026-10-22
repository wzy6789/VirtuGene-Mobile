import { useId, useMemo, useState, type ReactNode } from 'react';
import type { Character, WorldScene } from '../../db';
import { Icon } from '../ui/Icon';
import { Avatar } from '../ui/Avatar';
import { worldSceneArt } from './world-scene-art';
import '../../styles/world-entry.css';
import '../../styles/world-scene-directory.css';

const statusLabels:Record<WorldScene['status'],string>={draft:'未开始',active:'进行中',paused:'已暂停',finished:'已保存'};
const filters=[['all','全部'],['active','进行中'],['paused','暂停'],['finished','已保存']] as const;
/** Content is the navigation: real titles, places and participants, with decorative scene covers. */
export function WorldConstellation({scenes,characters=[],currentSceneId,onOpenScene,onOpenStage,onCreate,children,archives}:{
  scenes:WorldScene[];characters?:Character[];currentSceneId?:string|null;
  onOpenScene:(sceneId:string)=>void;onOpenStage:()=>void;onCreate:()=>void;children?:ReactNode;archives?:ReactNode;
}) {
  const [filter,setFilter]=useState<typeof filters[number][0]>('all');
  const [query,setQuery]=useState('');
  const listId=useId();
  const castById=useMemo(()=>new Map(characters.map(character=>[character.id,character])),[characters]);
  const filtered=useMemo(()=>{
    const keyword=query.trim().toLocaleLowerCase();
    return scenes.filter(scene=>(filter==='all'||scene.status===filter)&&(!keyword||[scene.title,scene.place,scene.timeLabel].join(' ').toLocaleLowerCase().includes(keyword)));
  },[scenes,filter,query]);
  return <section className="vg-world-constellation" aria-label="共同世界的场景" data-starfield-overview>
    <header className="vg-starfield-heading"><h2>共同世界</h2><button type="button" className="vg-starfield-add" onClick={onCreate} aria-label="开启新场景"><Icon name="plus" size={20}/></button></header>
    {children&&<div className="vg-starfield-context">{children}</div>}
    <div className="vg-starfield-tools"><label className="vg-starfield-search"><Icon name="search" size={18}/><input type="search" aria-label="搜索场景" value={query} placeholder="搜索场景" onChange={event=>setQuery(event.target.value)}/>{query&&<button type="button" aria-label="清除场景搜索" onClick={()=>setQuery('')}><Icon name="close" size={16}/></button>}</label></div>
    {scenes.length>0&&<div className="vg-starfield-filters" role="group" aria-label="场景状态筛选">{filters.map(([value,label])=><button type="button" key={value} aria-pressed={value===filter} aria-controls={listId} onClick={()=>setFilter(value)}>{label}</button>)}</div>}
    <div id={listId} className="vg-world-scene-directory" data-starfield-list>
      {filtered.map(scene=>{
        const art=worldSceneArt(scene);
        const cast=scene.characterIds.map(id=>castById.get(id)).filter((character):character is Character=>!!character&&(character.isPreset||character.createdBy===scene.userId)).slice(0,3);
        return <button type="button" key={scene.id} className="vg-world-scene-card" data-scene-row={scene.id} aria-label={`查看场景：${scene.title}`} aria-pressed={scene.id===currentSceneId} onClick={()=>onOpenScene(scene.id)}>
          <img className="vg-world-scene-cover" src={art.src} width={88} height={110} alt="" loading="lazy" decoding="async"/>
          <span className="vg-world-scene-copy"><strong>{scene.title}</strong><span className="vg-world-scene-place">{[scene.place,scene.timeLabel].filter(Boolean).join(' · ')}</span><span className="vg-world-scene-foot"><span>{statusLabels[scene.status]}</span><span className="vg-world-scene-cast" aria-label={`参与：${cast.map(character=>character.name).join('、')}`}>{cast.map(character=><Avatar key={character.id} avatar={character.avatar} size="sm" loading="eager" fallback={character.name.slice(0,1)} className="vg-world-scene-avatar"/>)}</span></span>{cast.length>0&&<span className="vg-world-scene-names">{cast.map(character=>character.name).join(' · ')}</span>}</span>
        </button>;
      })}
      {!filtered.length&&<p className="vg-world-scene-empty" role="status">{scenes.length?'没有匹配场景':'还没有共同场景'}</p>}
    </div>
    <div className="vg-world-scene-footer"><button type="button" data-starfield-directory onClick={onOpenStage}>全部场景</button></div>
    {archives&&<section className="vg-starfield-archives"><h3>世界档案</h3>{archives}</section>}
  </section>;
}
