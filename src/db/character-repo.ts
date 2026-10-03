import { db, type Character } from './index';
import { applySecretaryBinding, bindSecretary } from './secretary-binding';
import { isSecretaryAppearance, secretaryAvatar } from '../lib/secretary/appearance';

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
    return db.transaction('rw', db.characters, db.secretaryBindings, async () => {
      const row = character.agentProfile === 'secretary' && !character.isPreset
        ? applySecretaryBinding(character, await bindSecretary(character)) : character;
      return db.characters.add(row);
    });
  },

  async update(id: string, updates: Partial<Character>): Promise<number> {
    return db.transaction('rw', db.characters, db.secretaryBindings, async () => {
      const current = await db.characters.get(id);
      if (!current) return 0;
      if (updates.createdBy !== undefined && updates.createdBy !== current.createdBy) throw new Error('不能修改角色的账号归属。');
      if (updates.agentProfile !== undefined && updates.agentProfile !== current.agentProfile) throw new Error('不能修改角色的助理身份。');
      if (current.agentProfile !== 'secretary') return db.characters.update(id, updates);
      if (updates.published === true || updates.sourcePresetId !== undefined || updates.proactivity !== undefined && updates.proactivity !== 0) throw new Error('助理不能发布到角色库或启用角色主动聊天，请使用助理管理。');
      if (updates.isPreset === true) throw new Error('私人助理不能改为预设角色。');
      if (updates.secretaryAppearance !== undefined && !isSecretaryAppearance(updates.secretaryAppearance)) throw new Error('请选择男性或女性形象。');
      const binding = await bindSecretary(current);
      if (updates.secretaryPersonality !== undefined && updates.secretaryPersonality !== binding.personality) throw new Error('更换性格请先解雇，再聘用新的助理。');
      if (updates.secretaryEmploymentId !== undefined && updates.secretaryEmploymentId !== binding.employmentId || updates.secretaryStatus !== undefined && updates.secretaryStatus !== binding.status) throw new Error('请从助理管理页面办理解雇与聘用。');
      const changed = { ...binding, name: updates.name ?? binding.name, preferences: updates.secretaryPreferences ?? binding.preferences,
        appearance: updates.secretaryAppearance ?? binding.appearance,
        avatar: updates.secretaryAppearance !== undefined ? secretaryAvatar(binding.personality, updates.secretaryAppearance) : updates.avatar ?? binding.avatar,
        updatedAt: Math.max(Date.now(), (binding.updatedAt ?? 0) + 1) };
      await db.secretaryBindings.put(changed);
      const next = applySecretaryBinding({ ...current, ...updates }, changed);
      return db.characters.update(id, { ...next });
    });
  },

  async deleteById(id: string): Promise<void> {
    if ((await db.characters.get(id))?.agentProfile === 'secretary') throw new Error('请从助理管理办理解雇，聊天和办事记录会保留。');
    await db.characters.delete(id);
  },

  async getPublished(): Promise<Character[]> {
    const all = await db.characters.toArray();
    return all.filter((c) => c.published === true && c.agentProfile !== 'secretary');
  },

  async getByCreator(userId: string): Promise<Character[]> {
    return db.characters.where('createdBy').equals(userId).toArray();
  },

  async count(): Promise<number> {
    return db.characters.count();
  },
};
