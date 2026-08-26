import { db, type User } from './index';

export const userRepo = {
  async findByUsername(username: string): Promise<User | undefined> {
    return db.users.where('username').equals(username).first();
  },

  async create(user: User): Promise<string> {
    return db.users.add(user);
  },

  async update(id: string, updates: Partial<User>): Promise<number> {
    return db.users.update(id, updates);
  },

  async deleteById(id: string): Promise<void> {
    await db.users.delete(id);
  },

  async count(): Promise<number> {
    return db.users.count();
  },
};
