import type { Character, ContinuityThread, WorldScene } from '../../db';
import { Icon } from '../ui/Icon';
import type {Ref} from 'react';
import {Avatar} from '../ui/Avatar';
import {useChatAtmosphere} from '../chat/useChatAtmosphere';
import '../../styles/conversation-continuity.css';
import '../../styles/world-entry.css';
import '../../styles/world-home-content.css';

function Participant({character,userId}:{character:Character;userId:string}){
  const visual=useChatAtmosphere(character,userId).config.roleVisual;
  return <span className="vg-world-cast-person"><Avatar avatar={visual?.avatar?.image||character.avatar} size="sm"/><small>{character.name}</small></span>;
}
export function WorldResumeCard({ scene, characters, threads, busy, issue, excerpt, onContinue, onFree, onThread, onCreate, titleRef, onContinueIntent, compact = false }: {
  scene?: WorldScene; characters: Character[]; threads: ContinuityThread[]; busy: boolean;
  issue?: string; excerpt?:string; onContinue(): void; onFree(): void; onThread?:(thread:ContinuityThread)=>void; onCreate?:()=>void; titleRef?:Ref<HTMLSpanElement>; onContinueIntent?:()=>void; compact?:boolean;
}) {
  const participants = scene?.state.participants.length
    ? scene.state.participants.filter(participant => participant.leftAt === undefined && scene.characterIds.includes(participant.characterId)).map(participant => participant.characterId)
    : scene?.characterIds ?? [];
  const cast = participants.map(id => characters.find(character => character.id === id && character.createdBy === scene?.userId)).filter((character):character is Character=>!!character);
  const pending = threads.filter(thread => thread.userId === scene?.userId && thread.status === 'open'
    && scene.characterIds.includes(thread.characterId) && (!thread.sourceSceneId || thread.sourceSceneId === scene.id)).slice(0, 3);
  return <><section className={`vg-world-resume vg-world-resume-content${compact ? ' is-compact vg-scene-glass' : ''}`} aria-label="继续上次那一幕">

    <p className="vg-continuity-eyebrow">{scene ? '继续这一幕' : '从此刻开始'}</p>
    <h2><span ref={titleRef}>{scene?.title || '留一段属于你们的时间'}</span></h2>
    {scene && <p className="vg-world-resume-place"><Icon name="globe" size={16}/>{scene.place || '地点未设定'}{scene.timeLabel && ` · ${scene.timeLabel}`}</p>}
    {cast.length > 0 && <div className="vg-world-cast" aria-label={`在场：${cast.map(c=>c.name).join('、')}`}>{cast.slice(0,4).map(character=><Participant key={character.id} character={character} userId={scene!.userId}/>)}{cast.length>4&&<span>等 {cast.length} 位角色</span>}</div>}
    {!compact&&excerpt&&<p className="vg-world-cover-excerpt">{excerpt}</p>}
    {issue && <p role="alert" className="vg-continuity-error">{issue}</p>}
    <div className="vg-world-resume-actions">
      {scene && <button type="button" className="vg-button vg-button-primary" disabled={busy} aria-busy={busy} onPointerEnter={onContinueIntent} onPointerDown={onContinueIntent} onFocus={onContinueIntent} onClick={onContinue}>{busy ? '读取中…' : '继续这一幕'}</button>}
      {!scene&&onCreate&&<button type="button" className="vg-button vg-button-primary" onClick={onCreate}>创建世界<Icon name="plus" size={16}/></button>}
      {!compact&&<button type="button" className={`vg-button ${scene||onCreate?'vg-button-secondary':'vg-button-primary'}`} disabled={busy} onClick={onFree}>自由空间</button>}
    </div>
    {!scene && <p className="vg-continuity-note">自由输入，先说你想说的话；没有旧场景时从新的此刻开始。</p>}
  </section>{!compact&&pending.length>0&&<button type="button" className="vg-world-open-thread" onClick={()=>onThread?.(pending[0])} disabled={!onThread}><span>未完成</span><strong>{pending[0].title}</strong></button>}</>;
}
