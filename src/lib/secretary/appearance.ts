import type { SecretaryPersonality } from './personality';
import professionalMale from '../../assets/secretary/professional-male.webp';
import professionalFemale from '../../assets/secretary/professional-female.webp';
import balancedMale from '../../assets/secretary/balanced-male.webp';
import balancedFemale from '../../assets/secretary/balanced-female.webp';
import gentleMale from '../../assets/secretary/gentle-male.webp';
import gentleFemale from '../../assets/secretary/gentle-female.webp';
import energeticMale from '../../assets/secretary/energetic-male.webp';
import energeticFemale from '../../assets/secretary/energetic-female.webp';
import playfulMale from '../../assets/secretary/playful-male.webp';
import playfulFemale from '../../assets/secretary/playful-female.webp';

export type SecretaryAppearance = 'male' | 'female';
export const DEFAULT_SECRETARY_APPEARANCE: SecretaryAppearance = 'female';
const portraits: Record<SecretaryPersonality, Record<SecretaryAppearance, string>> = {
  professional: { male: professionalMale, female: professionalFemale },
  balanced: { male: balancedMale, female: balancedFemale },
  gentle: { male: gentleMale, female: gentleFemale },
  energetic: { male: energeticMale, female: energeticFemale },
  playful: { male: playfulMale, female: playfulFemale },
};

export function isSecretaryAppearance(value: unknown): value is SecretaryAppearance {
  return value === 'male' || value === 'female';
}

/** Store a stable identity, so backups survive asset hash changes between app versions. */
export function secretaryAvatar(personality: SecretaryPersonality, appearance: SecretaryAppearance): string {
  return `secretary-avatar:${personality}:${appearance}`;
}

export function parseSecretaryAvatar(avatar: string): { personality: SecretaryPersonality; appearance: SecretaryAppearance } | undefined {
  const [, personality, appearance] = avatar.split(':');
  if (avatar.startsWith('secretary-avatar:') && Object.prototype.hasOwnProperty.call(portraits, personality) && isSecretaryAppearance(appearance)
    && avatar === secretaryAvatar(personality as SecretaryPersonality, appearance)) return { personality: personality as SecretaryPersonality, appearance };
}

export function secretaryAvatarImage(avatar: string): string | undefined {
  const selected = parseSecretaryAvatar(avatar);
  return selected ? portraits[selected.personality][selected.appearance] : undefined;
}

export function secretaryLook(personality: SecretaryPersonality, appearance?: SecretaryAppearance, avatar?: string): { appearance: SecretaryAppearance; avatar: string } {
  const parsed = avatar ? parseSecretaryAvatar(avatar) : undefined;
  const selected = appearance ?? parsed?.appearance ?? DEFAULT_SECRETARY_APPEARANCE;
  return { appearance: selected, avatar: !avatar || avatar === '🗂️' || parsed ? secretaryAvatar(personality, selected) : avatar };
}
