import { avatarImageSrc } from '../../lib/avatar';
import { useCallback } from 'react';
import { registerSoulElement, type SoulRole } from '../../lib/soul-handoff';

interface AvatarProps {
  avatar: string;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
  soulKey?: string;
  soulRole?: SoulRole;
}

const SIZES = {
  xs: 'w-5 h-5 text-xs',
  sm: 'w-8 h-8 text-lg',
  md: 'w-10 h-10 text-2xl',
  lg: 'w-14 h-14 text-3xl',
};

/**
 * 圆形头像（微信/QQ 式）：图片按 object-cover 居中裁剪成圆，
 * 比整图拉伸更清晰、更接近真实头像效果。
 */
export function Avatar({ avatar, size = 'md', className = '', soulKey, soulRole }: AvatarProps) {
  const ref = useCallback((node: HTMLElement | null) => {
    if (node && soulKey && soulRole) return registerSoulElement(node,soulKey,soulRole);
  },[soulKey,soulRole,avatar]);
  const cls = `${SIZES[size]} rounded-full shrink-0 overflow-hidden ${className}`;
  // 空字符串也要有东西可看：旧账号/演示账号可能没有头像，直接渲染会留下一个空圆圈。
  const glyph = avatar.trim() || '🧬';
  const image = avatarImageSrc(glyph);
  if (image) {
    return (
      <img
        ref={ref} data-soul-key={soulKey} data-soul-role={soulRole}
        src={image}
        alt=""
        className={`${cls} object-cover`}
        style={{ imageRendering: 'auto' }}
        loading="lazy"
      />
    );
  }
  return (
    <span ref={ref} data-soul-key={soulKey} data-soul-role={soulRole} className={`${cls} flex items-center justify-center bg-surface`}>
      {glyph}
    </span>
  );
}
