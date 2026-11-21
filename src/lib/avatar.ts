import { secretaryAvatarImage } from './secretary/appearance';
import { presetAvatarImage } from './preset-avatar';

/** Resolve bundled assistant portraits and existing uploaded / remote avatars. */
export function avatarImageSrc(avatar?: string): string | undefined {
  const value = avatar?.trim() ?? '';
  return presetAvatarImage(value) ?? secretaryAvatarImage(value) ?? (/^(data:image\/|https?:\/\/|blob:)/i.test(value) ? value : undefined);
}
