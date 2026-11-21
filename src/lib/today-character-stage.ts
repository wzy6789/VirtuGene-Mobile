import type { Character } from '../db';
import { isStoryCharacter } from './character-domain';

export interface TodayStagePreview { content: string; createdAt: number }
export interface TodayStageEntry { character: Character; preview: TodayStagePreview }

/** Reuse already-loaded previews. Pinning is a list preference, never evidence of recency. */
export function selectTodayStageCharacters(
  characters: readonly Character[],
  previews: Readonly<Record<string, TodayStagePreview | null | undefined>>,
  owner: string | null,
): TodayStageEntry[] {
  if (!owner) return [];
  return characters.flatMap(character => {
    const preview = previews[character.id];
    return character.createdBy === owner && isStoryCharacter(character) && !character.chatListHidden
      && preview && Number.isFinite(preview.createdAt) && preview.createdAt > 0
      ? [{ character, preview }] : [];
  }).sort((a, b) => b.preview.createdAt - a.preview.createdAt || a.character.id.localeCompare(b.character.id)).slice(0, 3);
}

const preferenceKey = (owner: string) => `virtugene:today-stage:collapsed:${encodeURIComponent(owner)}`;

export function readTodayStageCollapsed(owner: string | null): boolean {
  if (!owner || typeof window === 'undefined') return false;
  try { return window.localStorage.getItem(preferenceKey(owner)) === '1'; } catch { return false; }
}

export function saveTodayStageCollapsed(owner: string | null, collapsed: boolean): void {
  if (!owner || typeof window === 'undefined') return;
  // A storage/quota restriction must never block opening the conversation.
  try { window.localStorage.setItem(preferenceKey(owner), collapsed ? '1' : '0'); } catch { /* This visit still works. */ }
}

export function todayStageExcerpt(content: string): string {
  const text = content.replace(/\s+/g, ' ').trim();
  const excerpt = Array.from(text);
  return excerpt.length > 100 ? `${excerpt.slice(0, 100).join('')}…` : text;
}
