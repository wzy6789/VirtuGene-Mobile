import type { CSSProperties } from 'react';
import type { Character } from '../../db';
import { getChatAtmosphereTheme, resolveCharacterAtmosphere } from '../../lib/chat-atmosphere';

/** Character colour is environmental light; readable copy keeps the app tokens. */
export function characterSpaceStyle(character: Character): CSSProperties {
  const { primary, secondary } = resolveCharacterAtmosphere(character);
  const theme = getChatAtmosphereTheme(primary);
  const companion = getChatAtmosphereTheme(secondary ?? primary);
  return {
    '--character-light': theme.light.glow,
    '--character-light-secondary': companion.light.glowSecondary,
    '--character-dark': theme.dark.glow,
    '--character-dark-secondary': companion.dark.glowSecondary,
  } as CSSProperties;
}

export interface CharacterPreviewEvidence { content: string; createdAt: number }

/** Only a real pin or conversation can promote a character into the featured rail. */
export function featuredCharacters(characters: Character[], previews: Record<string, CharacterPreviewEvidence | null>, owner: string): Character[] {
  return characters.filter(character => character.createdBy === owner && !character.isPreset &&
    (character.pinned || Number.isFinite(previews[character.id]?.createdAt)))
    .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) ||
      (previews[b.id]?.createdAt ?? 0) - (previews[a.id]?.createdAt ?? 0) || a.name.localeCompare(b.name))
    .slice(0, 2);
}

/** Safe authored text only: do not turn a system prompt into a public biography. */
export function characterSignature(character: Character): string {
  return character.signature?.trim() || character.tags?.filter(Boolean).slice(0, 3).join(' · ') || '打开角色空间';
}
