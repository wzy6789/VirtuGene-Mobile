import { Suspense, useState } from 'react';
import type { Character } from '../../db';
import { useAuthStore } from '../../store/auth-store';
import { ChatAppearanceEditor } from '../chat/ChatAppearanceSettings';
import { lazyFeature } from '../ui/lazyFeature';
const CharacterEditor=lazyFeature(()=>import('./CharacterAddModal').then(m=>({default:m.CharacterAddModal})));

export function CharacterStyleWorkspace({character,userId,onClose}:{character:Character;userId:string;onClose:()=>void}) {
  const owner=useAuthStore(s=>s.userId),[speech,setSpeech]=useState(false);
  if(owner!==userId)return null;
  return <><ChatAppearanceEditor key={`${userId}:${character.id}`} character={character} userId={userId} onClose={onClose} workspace onEditStyle={!character.isPreset&&character.createdBy===userId?()=>setSpeech(true):undefined}/>
    {speech&&<Suspense fallback={<p role="status">正在打开角色设置…</p>}><CharacterEditor open editCharacter={character} onClose={()=>setSpeech(false)}/></Suspense>}</>;
}
