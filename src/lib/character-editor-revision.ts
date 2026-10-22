import type { Character, StoryRelation } from '../db';

/** Only fields the editor can overwrite. Background voice assignment, unread
 * flags and other independent settings must not cause false conflicts. */
export function characterEditorRevision(character: Character): string {
  return JSON.stringify([
    character.name, character.avatar, character.systemPrompt, character.tags,
    character.signature, character.greeting, character.catchphrase, character.boundaries,
    character.published, character.learnedSpeechStyle, character.voiceSamples,
    character.secretaryPersonality, character.secretaryPreferences,
  ]);
}

export function characterRelationsRevision(links: StoryRelation[]): string {
  return JSON.stringify([links.map((link) => link.targetCharacterId), Object.fromEntries(links.map((link) => [link.targetCharacterId, {
    label: link.label, description: link.description ?? '',
  }]))]);
}
