import { useMemo, useState } from 'react';
import type { Diary } from '../../db/index';
import { moodColor } from '../../lib/diary-utils';
import { todayStr } from '../../db/diary-repo';
import { FilterSelect } from '../ui/FilterSelect';

interface Props {
  diaries: Diary[];
  selectedDate: string | null;
  onSelectDate: (date: string | null) => void;
}

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];

export function DiaryCalendar({ diaries, selectedDate, onSelectDate }: Props) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth()); // 0-11

  const byDate = useMemo(() => {
    const map: Record<string, Diary[]> = {};
    for (const d of diaries) {
      (map[d.date] ??= []).push(d);
    }
    return map;
  }, [diaries]);

  const cells = useMemo(() => {
    const first = new Date(year, month, 1);
    const startWeekday = (first.getDay() + 6) % 7; // 周一为一周开始
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const list: (string | null)[] = Array(startWeekday).fill(null);
    for (let d = 1; d <= daysInMonth; d++) {
      list.push(`${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
    }
    return list;
  }, [year, month]);

  const today = todayStr();
  const prevMonth = () => {
    if (month === 0) { setYear(year - 1); setMonth(11); } else { setMonth(month - 1); }
  };
  const nextMonth = () => {
    if (month === 11) { setYear(year + 1); setMonth(0); } else { setMonth(month + 1); }
  };

  return (
    <div className="rounded-xl border border-line bg-panel/60 p-4">
      {/* 头部 */}
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <button onClick={prevMonth} className="w-7 h-7 rounded-lg text-gray-400 hover:bg-surface hover:text-ink transition-colors">‹</button>
          <span className="text-sm font-semibold text-ink w-24 sm:w-28 text-center">{year}年{month + 1}月</span>
          <button onClick={nextMonth} className="w-7 h-7 rounded-lg text-gray-400 hover:bg-surface hover:text-ink transition-colors">›</button>
        </div>
        <div className="flex items-center gap-1">
          <FilterSelect
            value={String(year)}
            onChange={(v) => setYear(Number(v))}
            options={Array.from({ length: 8 }, (_, i) => now.getFullYear() - 3 + i).map((y) => ({ value: String(y), label: `${y}年` }))}
          />
          <button onClick={() => { setYear(now.getFullYear()); setMonth(now.getMonth()); }} className="px-2 py-1 rounded-lg text-xs text-life-cyan hover:bg-life-cyan/10 transition-colors">
            回到本月
          </button>
        </div>
      </div>

      {/* 星期头 */}
      <div className="grid grid-cols-7 mb-1">
        {WEEKDAYS.map((w) => (
          <div key={w} className="text-center text-[10px] text-gray-500 py-1">{w}</div>
        ))}
      </div>

      {/* 日期格 */}
      <div className="grid grid-cols-7 gap-1">
        {cells.map((date, i) => {
          if (!date) return <div key={`e-${i}`} />;
          const day = Number(date.slice(8));
          const has = byDate[date];
          const isSelected = selectedDate === date;
          const isToday = date === today;
          const mood = has && has.length > 0 ? Math.round(has.reduce((s, d) => s + (d.mood ?? 3), 0) / has.length) : null;
          // 写作热力：按总字数分档（无字 → 无热度，越厚越亮）
          const totalLen = has ? has.reduce((s, d) => s + (d.content ?? '').length, 0) : 0;
          const heat = totalLen <= 0 ? 0 : totalLen < 100 ? 0.18 : totalLen < 300 ? 0.38 : totalLen < 800 ? 0.62 : 0.85;
          return (
            <button
              key={date}
              onClick={() => onSelectDate(isSelected ? null : date)}
              className={`relative aspect-square rounded-lg flex flex-col items-center justify-center text-sm transition-all ${
                isSelected ? 'ring-1 ring-gene-purple/50 shadow-[0_0_10px_rgba(108,92,231,0.2)]' : 'hover:bg-surface'
              } ${isToday ? 'text-gene-purple font-bold' : 'text-ink'}`}
              style={{ backgroundColor: heat > 0 ? `rgba(108,92,231,${heat})` : undefined }}
            >
              <span className={heat > 0.38 ? 'text-white' : undefined}>{day}</span>
              {mood != null && (
                <span
                  className="absolute bottom-1 w-2 h-2 rounded-full"
                  style={{ backgroundColor: moodColor(mood), boxShadow: `0 0 6px ${moodColor(mood)}88` }}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* 图例 */}
      <div className="flex items-center gap-3 flex-wrap mt-3 pt-2 border-t border-line">
        <span className="text-[10px] text-gray-500">心情图例</span>
        {[1, 2, 3, 4, 5].map((m) => (
          <span key={m} className="flex items-center gap-1 text-[10px] text-gray-500">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: moodColor(m) }} />{['很差', '低落', '一般', '开心', '很棒'][m - 1]}
          </span>
        ))}
        <span className="w-px h-4 bg-line mx-1" />
        <span className="flex items-center gap-1 text-[10px] text-gray-500">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: 'rgba(108,92,231,0.25)' }} />少
        </span>
        <span className="flex items-center gap-1 text-[10px] text-gray-500">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: 'rgba(108,92,231,0.85)' }} />多
        </span>
        <span className="text-[10px] text-gray-400 ml-1">底色深浅 = 当天写了多少字</span>
      </div>
    </div>
  );
}
