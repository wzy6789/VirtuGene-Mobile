import { db } from './index';

export interface CharacterEditorDraftRow {
  id: string;
  userId: string;
  characterId: string;
  version: 1;
  revision: number;
  payload: string | null;
  updatedAt: number;
}

export const characterDraftKey = (userId: string, characterId?: string) => JSON.stringify([userId, characterId ?? null]);

export const characterEditorDraft = {
  async read(userId: string, characterId?: string): Promise<CharacterEditorDraftRow | undefined> {
    const row = await db.characterEditorDrafts.get(characterDraftKey(userId, characterId));
    if (row && (row.userId !== userId || row.characterId !== (characterId ?? '') || row.version !== 1)) throw Error('draft:invalid');
    return row;
  },
  async write(userId: string, characterId: string | undefined, payload: string | null, expectedRevision: number | null,
    isCurrent: () => boolean): Promise<CharacterEditorDraftRow> {
    if (!userId || (payload?.length ?? 0) > 8_000_000) throw Error('draft:unavailable');
    return db.transaction('rw', db.characterEditorDrafts, db.characters, async () => {
      if (!isCurrent()) throw Error('draft:context');
      if (characterId && payload !== null) {
        const character = await db.characters.get(characterId);
        if (!character || character.createdBy !== userId || character.isPreset) throw Error('draft:unavailable');
      }
      const id = characterDraftKey(userId, characterId);
      const existing = await this.read(userId, characterId);
      if ((existing?.revision ?? null) !== expectedRevision) throw Error('draft:conflict');
      const row: CharacterEditorDraftRow = { id, userId, characterId: characterId ?? '', version: 1,
        revision: (existing?.revision ?? 0) + 1, payload, updatedAt: Date.now() };
      if (!isCurrent()) throw Error('draft:context');
      await db.characterEditorDrafts.put(row);
      // A cleared row retains only a revision, preventing an older window from
      // silently resurrecting discarded or successfully committed contents.
      return row;
    });
  },
};
