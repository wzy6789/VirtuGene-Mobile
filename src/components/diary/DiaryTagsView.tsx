import { useMemo } from 'react';
import type { Diary } from '../../db/index';
import { DiaryTimeline } from './DiaryTimeline';

interface Props {
  entries: Diary[];
  onEdit: (diary: Diary) => void;
  tagFilter: string | null;
  onTagClick: (tag: string | null) => void;
  highlight?: string;
}

export function DiaryTagsView({ entries, onEdit, tagFilter, onTagClick, highlight }: Props) {
  const grouped = useMemo(() => {
    const map = new Map<string, Diary[]>();
    for (const d of entries) {
      const tags = (d.tags ?? []).length > 0 ? d.tags : ['未分类'];
      for (const t of tags) {
        (map.get(t) ?? map.set(t, []).get(t)!).push(d);
      }
    }
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [entries]);

  if (entries.length === 0) {
    return (
      <div className="py-16 text-center text-gray-500">
        <p className="text-3xl mb-2">🏷️</p>
        <p className="text-sm">没有带标签的日记</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {grouped.map(([tag, list]) => (
        <div key={tag}>
          <button
            onClick={() => onTagClick(tagFilter === tag ? null : tag)}
            className={`text-xs px-2.5 py-1 rounded-full mb-2 transition-colors ${
              tagFilter === tag ? 'bg-gene-purple/20 text-gene-purple' : 'bg-surface text-gray-500 hover:text-ink'
            }`}
          >
            #{tag} <span className="opacity-60">({list.length})</span>
          </button>
          <DiaryTimeline entries={list} onEdit={onEdit} highlight={highlight} />
        </div>
      ))}
    </div>
  );
}
