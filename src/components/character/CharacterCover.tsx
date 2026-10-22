import type { Character } from '../../db';
import { useState } from 'react';
import type { SoulRole } from '../../lib/soul-handoff';
import { Avatar } from '../ui/Avatar';
import { Icon } from '../ui/Icon';
import { characterSignature, characterSpaceStyle } from './character-space-model';
import { useAuthStore } from '../../store/auth-store';
import { useChatAtmosphere } from '../chat/useChatAtmosphere';

/** Keep the shared handoff anchor even when an uploaded portrait cannot load. */
export function CharacterPortrait({ character, className, soulRole }: { character: Character; className: string; soulRole: SoulRole }) {
  const [failedSource, setFailedSource] = useState<string>();
  const userId=useAuthStore(s=>s.userId)??'';
  const source=useChatAtmosphere(character,userId).config.roleVisual?.avatar?.image||character.avatar;
  const avatar = failedSource === source ? character.name.trim().slice(0, 1) || '人' : source;
  return <span className="vg-character-portrait-host" onErrorCapture={event => {
    if (event.target instanceof HTMLImageElement) setFailedSource(source);
  }}><Avatar avatar={avatar} size="lg" className={className} soulKey={`avatar:${character.id}`} soulRole={soulRole} /></span>;
}

export function CharacterCover({ character, compact = false, onOpen, onManage }: {
  character: Character; compact?: boolean; onOpen: () => void; onManage?: () => void;
}) {
  return <article className={`vg-character-cover${compact ? ' is-compact' : ''}`} style={characterSpaceStyle(character)}>
    <button type="button" className="vg-character-cover-open" onClick={onOpen} aria-label={`打开${character.name}的角色空间`}>
      <span className="vg-character-cover-copy">
        <span className="vg-character-cover-origin">{character.pinned ? '已置顶' : '最近聊过'}</span>
        <strong>{character.name}</strong>
        <span className="vg-character-cover-signature">{characterSignature(character)}</span>
        <span className="vg-character-cover-entry">角色空间 <Icon name="chevron" size={16} /></span>
      </span>
      <span className="vg-character-cover-portrait"><CharacterPortrait character={character} className="vg-character-portrait" soulRole="list" /></span>
    </button>
    {onManage && <button type="button" className="vg-character-cover-manage" aria-label={`管理${character.name}`} onClick={onManage}><Icon name="more" size={20} /></button>}
  </article>;
}
