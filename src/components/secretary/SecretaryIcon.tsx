import type { CSSProperties } from 'react';

export type SecretaryIconName = 'inbox' | 'diary' | 'moment' | 'todo' | 'calendar' | 'search' | 'edit' | 'spark' | 'profile' | 'settings' | 'check' | 'chevron' | 'shield';

const paths: Record<SecretaryIconName, string> = {
  inbox: 'M4 4h16v16H4z M4 13h5l2 3h2l2-3h5',
  diary: 'M6 3h13v18H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z M4 17h15 M9 7h6 M9 11h4',
  moment: 'M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-2 2V11.5A8.5 8.5 0 0 1 10.5 3H13 M17 2v8 M13 6h8',
  todo: 'M14 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-8 M8 10l4 4L22 4',
  calendar: 'M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z M7 3v4 M17 3v4 M3 11h18 M8 15h3 M8 18h6',
  search: 'M20 20l-5-5 M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0z',
  edit: 'M14 4l6 6 M4 20l4-1 13-13a2.1 2.1 0 0 0-3-3L5 16z M13 20h8',
  spark: 'M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z',
  profile: 'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0z M4 21v-2a8 8 0 0 1 16 0v2',
  settings: 'M4 6h16 M4 12h16 M4 18h16 M8 3v6 M16 9v6 M10 15v6',
  check: 'M5 12l4 4L19 6',
  chevron: 'M9 5l7 7-7 7',
  shield: 'M12 3l8 3v6c0 5-8 9-8 9s-8-4-8-9V6z M8 12l3 3 5-6',
};

export function SecretaryIcon({ name, size = 18, className, style }: { name: SecretaryIconName; size?: number; className?: string; style?: CSSProperties }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" className={className} style={style}><path d={paths[name]} /></svg>;
}
