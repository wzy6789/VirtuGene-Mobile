import { db, type Character } from './index';

export const characterRepo = {
  async getAll(): Promise<Character[]> {
    return db.characters.toArray();
  },

  async getPresets(): Promise<Character[]> {
    const all = await db.characters.toArray();
    return all.filter((c) => c.isPreset === true);
  },

  async getById(id: string): Promise<Character | undefined> {
    return db.characters.get(id);
  },

  async create(character: Character): Promise<string> {
    return db.characters.add(character);
  },

  async update(id: string, updates: Partial<Character>): Promise<number> {
    return db.characters.update(id, updates);
  },

  async deleteById(id: string): Promise<void> {
    await db.characters.delete(id);
  },

  async getPublished(): Promise<Character[]> {
    const all = await db.characters.toArray();
    return all.filter((c) => c.published === true);
  },

  async getByCreator(userId: string): Promise<Character[]> {
    return db.characters.where('createdBy').equals(userId).toArray();
  },

  async count(): Promise<number> {
    return db.characters.count();
  },
};
