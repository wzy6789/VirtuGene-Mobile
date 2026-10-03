import { db, type Character, type SecretaryBinding } from './index';
import { secretaryPersonality, withSecretaryPersonality } from '../lib/secretary/personality';
import { secretaryLook } from '../lib/secretary/appearance';

export function normalizeSecretaryBinding(binding: SecretaryBinding, character?: Character): SecretaryBinding {
  const employmentId = binding.employmentId ?? `legacy:${binding.characterId}`;
  const look = secretaryLook(binding.personality, binding.appearance ?? character?.secretaryAppearance, binding.avatar ?? character?.avatar);
  return { ...binding, ...look, employmentId, status: binding.status ?? 'active', revision: binding.revision ?? 1,
    updatedAt: binding.updatedAt ?? binding.selectedAt, name: binding.name ?? character?.name,
    preferences: binding.preferences ?? character?.secretaryPreferences,
    employments: binding.employments ?? [{ id: employmentId, name: character?.name ?? binding.name ?? '历史助理', personality: binding.personality, appearance: look.appearance, hiredAt: binding.selectedAt }] };
}

/** Call within a transaction containing characters and secretaryBindings. */
export async function bindSecretary(character: Character): Promise<SecretaryBinding> {
  const binding = await db.secretaryBindings.get(character.createdBy);
  if (binding) {
    if (binding.characterId !== character.id) throw new Error('每个用户只能拥有一个私人助理。请打开已有助理。');
    return normalizeSecretaryBinding(binding, character);
  }
  const existing = await db.characters.where('createdBy').equals(character.createdBy).filter(c => c.agentProfile === 'secretary' && !c.isPreset).first();
  if (existing && existing.id !== character.id) throw new Error('每个用户只能拥有一个私人助理。请打开已有助理。');
  const selected = normalizeSecretaryBinding({ userId: character.createdBy, characterId: character.id,
    personality: secretaryPersonality(character.secretaryPersonality), selectedAt: character.createdAt }, character);
  await db.secretaryBindings.add(selected);
  return selected;
}

export function applySecretaryBinding(character: Character, binding: SecretaryBinding): Character {
  binding = normalizeSecretaryBinding(binding, character);
  return { ...character, agentProfile: 'secretary', secretaryOwnerId: binding.userId,
    avatar: binding.avatar!, secretaryAppearance: binding.appearance,
    name: binding.name ?? character.name, secretaryPreferences: binding.preferences ?? character.secretaryPreferences,
    secretaryEmploymentId: binding.employmentId, secretaryStatus: binding.status,
    secretaryPersonality: binding.personality, proactivity: 0,
    systemPrompt: withSecretaryPersonality(character.systemPrompt, binding.personality, binding.preferences ?? character.secretaryPreferences) };
}
