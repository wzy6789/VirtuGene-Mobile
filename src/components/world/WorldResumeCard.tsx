import type { Character, ContinuityThread, WorldScene } from '../../db';
import { Icon } from '../ui/Icon';
import type {Ref} from 'react';
import {Avatar} from '../ui/Avatar';
import {useChatAtmosphere} from '../chat/useChatAtmosphere';
import {worldSceneThumbnail} from './world-scene-art';
import {WorldCompactText} from './WorldCompactText';
import '../../styles/conversation-continuity.css';
import '../../styles/world-entry.css';
import '../../styles/world-home-content.css';
import '../../styles/world-scene-refinement.css';

function Participant({character,userId}:{character:Character;userId:string}){
  const visual=useChatAtmosphere(character,userId).config.roleVisual;
  return <span className="vg-world-cast-person"><Avatar avatar={visual?.avatar?.image||character.avatar} size="sm"/><small>{character.name}</small></span>;
}
export function WorldResumeCard({ scene, characters, threads, busy, issue, excerpt, onContinue, onFree, onThread, onCreate, titleRef, onContinueIntent, compact = false, starfield = false }: {
  scene?: WorldScene; characters: Character[]; threads: ContinuityThread[]; busy: boolean;
  issue?: string; excerpt?:string; onContinue(): void; onFree(): void; onThread?:(thread:ContinuityThread)=>void; onCreate?:()=>void; titleRef?:Ref<HTMLSpanElement>; onContinueIntent?:()=>void; compact?:boolean; starfield?:boolean;
}) {
  const participants = scene?.state.participants.length
    ? scene.state.participants.filter(participant => participant.leftAt === undefined && scene.characterIds.includes(participant.characterId)).map(participant => participant.characterId)
    : scene?.characterIds ?? [];
  const cast = participants.map(id => characters.find(character => character.id === id && character.createdBy === scene?.userId)).filter((character):character is Character=>!!character);
  const pending = threads.filter(thread => thread.userId === scene?.userId && thread.status === 'open'
    && scene.characterIds.includes(thread.characterId) && (!thread.sourceSceneId || thread.sourceSceneId === scene.id)).slice(0, 3);
  if (starfield && scene) {
    const art = worldSceneThumbnail(scene);
    const status = scene.status === 'finished' ? '已保存' : scene.status === 'paused' ? '已暂停' : scene.status === 'active' ? '进行中' : '未开始';
    return <>
      <article className="vg-starfield-feature vg-starfield-resume-brief" data-glass-role="content" aria-label="继续上次那一幕">
        <div className="vg-starfield-feature-art" aria-hidden="true"><img key={art.src} src={art.src} width={art.width} height={art.height} alt="" decoding="async" onError={event => { event.currentTarget.style.visibility = 'hidden'; }}/></div>
        <div className="vg-starfield-feature-heading">
          <h2><span ref={titleRef}>{scene.title}</span></h2>
          <span className="vg-starfield-status" data-status={scene.status}>{status}</span>
          {(scene.place || scene.timeLabel) && <p className="vg-starfield-feature-place">{[scene.place, scene.timeLabel].filter(Boolean).join(' · ')}</p>}
        </div>
        {issue && <p role="alert" className="vg-continuity-error">{issue}</p>}
        <div className="vg-starfield-resume-actions">
          <button type="button" className="vg-starfield-primary" disabled={busy} aria-busy={busy} onPointerEnter={onContinueIntent} onPointerDown={onContinueIntent} onFocus={onContinueIntent} onClick={onContinue}><span>{busy ? '正在打开…' : scene.status === 'finished' ? '回看这一幕' : scene.status === 'draft' ? '进入场景' : '继续这一幕'}</span></button>
          <button type="button" className="vg-starfield-resume-free" disabled={busy} onClick={onFree}>自由空间</button>
        </div>
        {pending.length > 0 && <div className="vg-starfield-feature-links"><button type="button" onClick={() => onThread?.(pending[0])} disabled={!onThread}><Icon name="clock" size={16}/><span>{pending[0].title}</span></button></div>}
      </article>
    </>;
  }
  return <><section className={`vg-world-resume vg-world-resume-content${compact ? ' is-compact vg-scene-glass' : ''}`} data-glass-role="reading" aria-label="继续上次那一幕">
    {compact&&scene&&<div className="vg-world-resume-art" aria-hidden="true"><img src={worldSceneThumbnail(scene).src} alt="" decoding="async"/></div>}
    {!scene && <p className="vg-continuity-eyebrow">从此刻开始</p>}
    <WorldCompactText as="h2" className="vg-world-resume-name" text={scene?.title || '留一段属于你们的时间'} label="场景名称" titleRef={titleRef}/>
    {scene && <div className="vg-world-resume-place"><Icon name="globe" size={16}/><WorldCompactText text={[scene.place || '地点未设定',scene.timeLabel].filter(Boolean).join(' · ')} label="地点与时间" /></div>}
    {cast.length > 0 && <div className="vg-world-cast" aria-label={`在场：${cast.map(c=>c.name).join('、')}`}>{cast.slice(0,4).map(character=><Participant key={character.id} character={character} userId={scene!.userId}/>)}{cast.length>4&&<span>等 {cast.length} 位角色</span>}</div>}
    {!compact&&excerpt&&<p className="vg-world-cover-excerpt">{excerpt}</p>}
    {issue && <p role="alert" className="vg-continuity-error">{issue}</p>}
    <div className="vg-world-resume-actions">
      {scene && <button type="button" className="vg-button vg-button-primary" disabled={busy} aria-busy={busy} onPointerEnter={onContinueIntent} onPointerDown={onContinueIntent} onFocus={onContinueIntent} onClick={onContinue}>{busy ? '读取中…' : '继续这一幕'}</button>}
      {!scene&&onCreate&&<button type="button" className="vg-button vg-button-primary" onClick={onCreate}>创建世界<Icon name="plus" size={16}/></button>}
      {!compact&&<button type="button" className={`vg-button ${scene||onCreate?'vg-button-secondary':'vg-button-primary'}`} disabled={busy} onClick={onFree}>自由空间</button>}
    </div>
  </section>{!compact&&pending.length>0&&<button type="button" className="vg-world-open-thread" onClick={()=>onThread?.(pending[0])} disabled={!onThread}><span>未完成</span><strong>{pending[0].title}</strong></button>}</>;
}
