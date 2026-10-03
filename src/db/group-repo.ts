import { db, type Group } from './index';

export const groupRepo = {
  create: (g: Group) => db.transaction('rw', db.groups, db.characters, async () => {
    await assertGroupMembers(g.characterIds);
    return db.groups.add(g);
  }),
  getById: (id: string) => db.groups.get(id),
  getByUser: (userId: string) => db.groups.where('userId').equals(userId).toArray(),
  update: (id: string, patch: Partial<Group>) => db.transaction('rw', db.groups, db.characters, async () => {
    if (patch.characterIds) await assertGroupMembers(patch.characterIds);
    return db.groups.update(id, patch);
  }),
  deleteById: (id: string) => db.groups.delete(id),
};

async function assertGroupMembers(ids: string[]) {
  const members = await db.characters.bulkGet(ids);
  if (members.some(c => c?.agentProfile === 'secretary')) throw new Error('生活助理只在你的私人工作台办事，不能加入角色群聊。');
}
