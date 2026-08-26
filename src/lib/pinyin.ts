import { pinyin } from 'pinyin-pro';

function toPinyinArray(name: string): string[] {
  return pinyin(name, { toneType: 'none', type: 'array', nonZh: 'consecutive' });
}

/** 名字的首字母（A-Z），非字母（数字/符号/emoji）归入 '#' */
export function getInitial(name: string): string {
  const first = toPinyinArray(name)[0];
  if (!first) return '#';
  const c = first.charAt(0).toUpperCase();
  return /[A-Z]/.test(c) ? c : '#';
}

/** 用于同组内排序的全拼 key（去声调、小写、无分隔） */
export function getSortKey(name: string): string {
  return toPinyinArray(name).join('').toLowerCase();
}

export const INDEX_LETTERS = [
  'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M',
  'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', '#',
];
