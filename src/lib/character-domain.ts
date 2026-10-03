import type { Character } from '../db';

/** Assistants share the legacy conversation storage, but never the role simulation. */
export function isStoryCharacter(character: Pick<Character, 'agentProfile'>): boolean {
  return character.agentProfile !== 'secretary';
}
