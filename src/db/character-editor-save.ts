import { db } from './index';

/** One editor commit includes inverse relations and imported-memory provenance.
 * Keep unrelated message, world, diary and media stores outside the write lock.
 * Store refresh, selection and model work belong after this promise resolves. */
export function commitCharacterEditor<T>(write: () => Promise<T>): Promise<T> {
  return db.transaction('rw', [
    db.characters, db.secretaryBindings, db.characterStates, db.characterEditorDrafts,
    db.memories, db.sessions, db.memorySourceTombstones,
    db.memoryClaims, db.memoryEvidence, db.memoryKnowledge,
  ], write);
}
