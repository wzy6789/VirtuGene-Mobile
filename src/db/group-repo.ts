import { db, type Group } from './index';

export const groupRepo = {
  create: (g: Group) => db.groups.add(g),
  getById: (id: string) => db.groups.get(id),
  getByUser: (userId: string) => db.groups.where('userId').equals(userId).toArray(),
  update: (id: string, patch: Partial<Group>) => db.groups.update(id, patch),
  deleteById: (id: string) => db.groups.delete(id),
};
