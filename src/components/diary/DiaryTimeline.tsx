import { useMemo, useState } from 'react';
import type { Diary } from '../../db/index';
import { moodEmoji, moodColor, formatDateFull } from '../../lib/diary-utils';
import { HighlightText } from '../../lib/diary-highlight';
import { DiarySharingBadge } from './DiarySharing';
import { Icon } from '../ui/Icon';

interface Props {
  entries: Diary[];
  onEdit: (diary: Diary) => void;
  /** 搜索关键词（空格分隔），用于高亮 */
  highlight?: string;
}

/** 时间线：按年月分组折叠 + 搜索高亮 + 首图缩略图 */
export function DiaryTimeline({ entries, onEdit, highlight }: Props) {
  const terms = useMemo(() => (highlight ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean), [highlight]);
  // 折叠状态：默认最近 2 个月展开，其余折叠
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    const now = new Date();
    const ym = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const cur = ym(now);
    const prev = ym(new Date(now.getFullYear(), now.getMonth() - 1, 1));
    return new Set(entries.filter((e) => e.date.slice(0, 7) !== cur && e.date.slice(0, 7) !== prev).map((e) => e.date.slice(0, 7)));
  });

  const groups = useMemo(() => {
    const map = new Map<string, Diary[]>();
    for (const d of entries) {
      const key = d.date.slice(0, 7); // YYYY-MM
      (map.get(key) ?? map.set(key, []).get(key)!).push(d);
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [entries]);

  if (entries.length === 0) {
    return (
      <div className="py-16 text-center text-sub">
        <Icon name="diary" size={32} className="mx-auto mb-3" />
        <p className="text-sm">没有找到日记</p>
        <p className="text-xs text-sub mt-1">换个筛选条件，或点右上角写一篇</p>
      </div>
    );
  }

  const toggle = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="space-y-5">
      {groups.map(([key, list]) => {
        const isCollapsed = collapsed.has(key);
        const [y, m] = key.split('-');
        return (
          <div key={key}>
            <button
              onClick={() => toggle(key)}
              aria-expanded={!isCollapsed}
              className="w-full flex items-center gap-2 px-1 py-1.5 text-left group"
            >
              <span className="text-sm font-semibold text-ink group-hover:text-gene-purple transition-colors">
                {y}年{Number(m)}月
              </span>
              <span className="text-xs text-sub">{list.length} 篇</span>
              <Icon name="chevron" size={16} className={isCollapsed ? 'text-sub' : 'text-sub rotate-90'} />
              <span className="flex-1 h-px bg-line" />
            </button>
            {!isCollapsed && (
              <div className="space-y-3 mt-1">
                {list.map((d) => (
                  <button
                    key={d.id}
                    onClick={() => onEdit(d)}
                    className="vg-diary-card w-full text-left rounded-xl border border-line p-4 hover:border-gene-purple/40 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-2 mb-1.5 flex-wrap">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <span className="text-lg">{moodEmoji(d.mood)}</span>
                        <span className="vg-diary-entry-title text-sm font-semibold text-ink">
                          <HighlightText text={d.title || '无标题'} terms={terms} />
                        </span>
                        <DiarySharingBadge diary={d} />
                        {d.images && d.images.length > 0 && (
                          <span className="text-xs text-sub shrink-0 inline-flex items-center gap-1"><Icon name="image" size={14} />{d.images.length}</span>
                        )}
                      </div>
                      <span className="text-xs text-sub shrink-0">{formatDateFull(d.date)}</span>
                    </div>
                    {d.images && d.images.length > 0 && (
                      <div className="flex gap-1.5 mb-2">
                        {d.images.slice(0, 3).map((img, i) => (
                          <img key={i} src={img} alt="" className="w-14 h-14 rounded-lg object-cover border border-line" />
                        ))}
                      </div>
                    )}
                    <p className="text-sm text-sub leading-relaxed line-clamp-3 whitespace-pre-wrap">
                      <HighlightText text={d.content || '（空）'} terms={terms} />
                    </p>
                      {(d.tags ?? []).length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {(d.tags ?? []).map((t) => (
                            <span key={t} className="px-2 py-0.5 rounded-full bg-gene-purple/10 text-[color:var(--vg-accent)] text-xs">#{t}</span>
                          ))}
                        </div>
                      )}
                      <div className="mt-2 h-1 w-16 rounded-full" style={{ backgroundColor: moodColor(d.mood), opacity: 0.5 }} />
                    </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
