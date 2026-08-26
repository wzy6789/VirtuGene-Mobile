/** 日记心情 1-5 */
export const DIARY_MOODS: { value: number; emoji: string; label: string }[] = [
  { value: 1, emoji: '😞', label: '很差' },
  { value: 2, emoji: '😔', label: '低落' },
  { value: 3, emoji: '😐', label: '一般' },
  { value: 4, emoji: '😊', label: '开心' },
  { value: 5, emoji: '🤩', label: '很棒' },
];

export function moodEmoji(mood: number): string {
  return DIARY_MOODS.find((m) => m.value === mood)?.emoji ?? '😐';
}

export function moodColor(mood: number): string {
  switch (mood) {
    case 1: return '#F87171';
    case 2: return '#FB923C';
    case 3: return '#A1A1AA';
    case 4: return '#00CEC9';
    case 5: return '#6C5CE7';
    default: return '#A1A1AA';
  }
}

/** 'YYYY-MM-DD' → '8月17日' */
export function formatDateCN(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return `${m}月${d}日`;
}

export function formatDateFull(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  if (dateStr === todayStr) return '今天';
  const yest = new Date(today.getTime() - 86400000);
  const yestStr = `${yest.getFullYear()}-${String(yest.getMonth() + 1).padStart(2, '0')}-${String(yest.getDate()).padStart(2, '0')}`;
  if (dateStr === yestStr) return '昨天';
  return `${y}年${m}月${d}日`;
}

/** 正式日记抬头：'2026年8月17日 星期一' */
export function formatDiaryHeader(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
  const dow = new Date(y, m - 1, d).getDay();
  return `${y}年${m}月${d}日 星期${weekdays[dow]}`;
}

/** 天气选项（正式日记格式） */
export const DIARY_WEATHERS: { value: string; label: string }[] = [
  { value: '☀️', label: '晴' },
  { value: '⛅', label: '多云' },
  { value: '☁️', label: '阴' },
  { value: '🌧️', label: '雨' },
  { value: '❄️', label: '雪' },
  { value: '🍃', label: '风' },
];

/**
 * 把 text 中命中 terms（忽略大小写）的部分拆成片段数组，
 * 供渲染层用 <mark> 高亮。未命中返回 [text]。
 */
export function splitByTerms(text: string, terms: string[]): { text: string; hit: boolean }[] {
  if (!text || terms.length === 0) return text ? [{ text, hit: false }] : [];
  const lower = text.toLowerCase();
  const parts: { text: string; hit: boolean }[] = [];
  let pos = 0;
  while (pos < text.length) {
    let best: { start: number; len: number } | null = null;
    for (const t of terms) {
      if (!t) continue;
      const idx = lower.indexOf(t, pos);
      if (idx >= 0 && (!best || idx < best.start || (idx === best.start && t.length > best.len))) {
        best = { start: idx, len: t.length };
      }
    }
    if (!best) {
      parts.push({ text: text.slice(pos), hit: false });
      break;
    }
    if (best.start > pos) parts.push({ text: text.slice(pos, best.start), hit: false });
    parts.push({ text: text.slice(best.start, best.start + best.len), hit: true });
    pos = best.start + best.len;
  }
  return parts;
}
