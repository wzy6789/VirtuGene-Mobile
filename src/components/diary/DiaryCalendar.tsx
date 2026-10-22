import { useMemo, useState } from 'react';
import type { Diary } from '../../db/index';
import { moodColor } from '../../lib/diary-utils';
import { todayStr } from '../../db/diary-repo';
import { FilterSelect } from '../ui/FilterSelect';
import { Icon } from '../ui/Icon';

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
    <div className="vg-diary-card rounded-xl border border-line p-4">
      {/* 头部 */}
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <div className="flex w-full items-center gap-2">
          <button aria-label="上个月" onClick={prevMonth} className="vg-diary-icon rounded-lg text-sub hover:bg-surface hover:text-ink transition-colors flex items-center justify-center"><Icon name="back" size={20} /></button>
          <span className="min-w-0 flex-1 text-base font-semibold text-ink text-center">{year}年{month + 1}月</span>
          <button aria-label="下个月" onClick={nextMonth} className="vg-diary-icon rounded-lg text-sub hover:bg-surface hover:text-ink transition-colors flex items-center justify-center"><Icon name="chevron" size={20} /></button>
        </div>
        <div className="flex w-full items-center justify-between gap-2 flex-wrap">
          <FilterSelect
            value={String(year)}
            onChange={(v) => setYear(Number(v))}
            options={Array.from({ length: 8 }, (_, i) => now.getFullYear() - 3 + i).map((y) => ({ value: String(y), label: `${y}年` }))}
          />
          <button onClick={() => { setYear(now.getFullYear()); setMonth(now.getMonth()); }} className="px-2 py-1 rounded-lg text-xs text-[color:var(--vg-cyan)] hover:bg-life-cyan/10 transition-colors">
            回到本月
          </button>
        </div>
      </div>

      {/* 星期头 */}
      <div className="grid grid-cols-7 mb-1">
        {WEEKDAYS.map((w) => (
          <div key={w} className="text-center text-xs text-sub py-1">{w}</div>
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
              aria-label={`${date}，${has?.length ?? 0}篇日记，${totalLen}字`}
              aria-pressed={isSelected}
              onClick={() => onSelectDate(isSelected ? null : date)}
              className={`relative aspect-square rounded-lg flex flex-col items-center justify-center text-sm transition-all ${
                isSelected ? 'ring-1 ring-gene-purple/50 shadow-[0_0_10px_rgba(108,92,231,0.2)]' : 'hover:bg-surface'
              } ${isToday ? 'text-[color:var(--vg-accent)] font-bold' : 'text-ink'}`}
              style={{ color: isToday ? 'color-mix(in srgb,var(--vg-accent) 70%,var(--text))' : undefined, backgroundColor: heat > 0 ? `color-mix(in srgb,var(--vg-action) ${heat > 0.38 ? 80 + heat * 20 : heat * 100}%,var(--bg-panel))` : undefined }}
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
        <span className="text-xs text-sub">心情图例</span>
        {[1, 2, 3, 4, 5].map((m) => (
          <span key={m} className="flex items-center gap-1 text-xs text-sub">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: moodColor(m) }} />{['很差', '低落', '一般', '开心', '很棒'][m - 1]}
          </span>
        ))}
        <span className="w-px h-4 bg-line mx-1" />
        <span className="flex items-center gap-1 text-xs text-sub">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: 'rgba(108,92,231,0.25)' }} />少
        </span>
        <span className="flex items-center gap-1 text-xs text-sub">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: 'rgba(108,92,231,0.85)' }} />多
        </span>
        <span className="text-xs text-sub ml-1">底色深浅 = 当天写了多少字</span>
      </div>
    </div>
  );
}
