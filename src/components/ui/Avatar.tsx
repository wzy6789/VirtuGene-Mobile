interface AvatarProps {
  avatar: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZES = {
  sm: 'w-8 h-8 text-lg',
  md: 'w-10 h-10 text-2xl',
  lg: 'w-14 h-14 text-3xl',
};

export function Avatar({ avatar, size = 'md', className = '' }: AvatarProps) {
  const cls = `${SIZES[size]} rounded-lg shrink-0 overflow-hidden ${className}`;
  if (avatar.startsWith('data:')) {
    return <img src={avatar} alt="" className={`${cls} object-cover`} />;
  }
  return (
    <span className={`${cls} flex items-center justify-center bg-surface`}>
      {avatar}
    </span>
  );
}
