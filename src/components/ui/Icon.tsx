import type { CSSProperties } from 'react';

type BaseIconName = 'inbox' | 'diary' | 'moment' | 'todo' | 'calendar' | 'search' | 'edit' | 'spark' | 'profile' | 'settings' | 'check' | 'chevron' | 'shield' | 'back' | 'close' | 'arrow' | 'plus' | 'send' | 'heart' | 'clock' | 'trash' | 'more' | 'moon' | 'globe' | 'bell' | 'lock' | 'download' | 'upload' | 'refresh' | 'stop' | 'play' | 'pause' | 'image' | 'mic' | 'folder' | 'flag' | 'warning' | 'eye' | 'volume' | 'copy' | 'connection' | 'database' | 'info';

export type IconName = BaseIconName | 'gear';
const paths: Record<IconName, string> = {
  gear: 'M12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6 M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z',
  connection: 'M8 3v5 M16 3v5 M5 8h14v2a7 7 0 0 1-14 0Z M12 17v5',
  database: 'M21 7a9 4 0 1 1-18 0 9 4 0 1 1 18 0 M3 7v10a9 4 0 0 0 18 0V7 M3 12a9 4 0 0 0 18 0',
  info: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M12 11v6 M12 7h.01',
  back: 'M15 5l-7 7 7 7',
  close: 'm6 6 12 12M18 6 6 18',
  arrow: 'M6 18 18 6M6 6h12v12',
  plus: 'M12 5v14M5 12h14',
  send: 'm22 2-7 20-4-9-9-4Z M22 2 11 13',
  heart: 'M20.8 4.6a5.5 5.5 0 0 0-7.8 0l-1 1-1-1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z',
  clock: 'M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0 M12 7v5l3 2',
  trash: 'M3 6h18 M9 6V3h6v3 M5 6l1 15h12l1-15 M10 10v7 M14 10v7',
  more: 'M5 12h.01 M12 12h.01 M19 12h.01',
  moon: 'M20 15a8.5 8.5 0 0 1-11-11 8.5 8.5 0 1 0 11 11Z',
  globe: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M3 12h18 M12 3q-8 9 0 18 M12 3q8 9 0 18',
  bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9 M10 21h4',
  lock: 'M5 10h14v11H5z M8 10V6a4 4 0 0 1 8 0v4',
  download: 'M12 3v12 M7 10l5 5 5-5 M4 16v5h16v-5',
  upload: 'M12 16V4 M7 9l5-5 5 5 M4 16v5h16v-5',
  refresh: 'M20 8a8 8 0 1 0 0 8 M20 3v5h-5',
  stop: 'M6 6h12v12H6z',
  play: 'm7 4 14 8-14 8Z',
  pause: 'M8 5v14 M16 5v14',
  image: 'M3 3h18v18H3z M3 17l6-6 5 5 3-3 4 4 M9 7h.01',
  mic: 'M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0Z M5 11v1a7 7 0 0 0 14 0v-1 M12 19v3 M8 22h8',
  folder: 'M3 5h7l2 3h9v13H3Z',
  flag: 'M5 21V3 M5 3h14l-3 5 3 5H5',
  warning: 'M12 3 2 21h20Z M12 9v5 M12 17h.01',
  eye: 'M2 12q10-16 20 0-10 16-20 0Z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  volume: 'M3 9h4l5-4v14l-5-4H3Z M16 8q5 4 0 8',
  copy: 'M8 8h13v13H8z M16 8V3H3v13h5',
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

export function Icon({ name, size = 18, className, style }: { name: IconName; size?: number; className?: string; style?: CSSProperties }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className} style={style}><path d={paths[name]} /></svg>;
}
