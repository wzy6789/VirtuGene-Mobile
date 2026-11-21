import { useMemo, useState } from 'react';
import { DiaryToolModal } from './DiaryToolModal';
import { useDiaryStore } from '../../store/diary-store';
import { ipc } from '../../lib/ipc-client';
import { moodEmoji } from '../../lib/diary-utils';
import { Icon } from '../ui/Icon';

interface Props {
  open: boolean;
  onClose: () => void;
}

/** 「日记人生年表」：按月聚合日记成大事记时间轴，可复制/导出 */
export function YearTableModal({ open, onClose }: Props) {
  const diaries = useDiaryStore((s) => s.diaries);
  const [copied, setCopied] = useState(false);

  /** 按月分组（旧→新） */
  const months = useMemo(() => {
    const map = new Map<string, typeof diaries>();
    for (const d of diaries) {
      const key = d.date.slice(0, 7); // YYYY-MM
      (map.get(key) ?? map.set(key, []).get(key)!).push(d);
    }
    return [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, list]) => ({
        key,
        count: list.length,
        // 取该月代表性内容：标题优先，其次最长一段
        sample: list
          .slice()
          .sort((a, b) => b.content.length - a.content.length)
          .map((d) => ({ title: d.title, content: d.content }))[0],
        moods: list.map((d) => d.mood ?? 3),
      }));
  }, [diaries]);

  const total = diaries.length;
  const totalLen = diaries.reduce((s, d) => s + d.content.length, 0);

  const text = useMemo(() => {
    const lines: string[] = ['VirtuGene 日记人生年表', ''];
    for (const m of months) {
      const [y, mm] = m.key.split('-');
      lines.push(`## ${y}年${Number(mm)}月（${m.count} 篇）`, '');
      if (m.sample) {
        const s = m.sample;
        lines.push(`- ${s.title ? `《${s.title}》` : ''} ${s.content.replace(/\n+/g, ' ').slice(0, 60)}`);
      }
      lines.push('');
    }
    lines.push(`共 ${total} 篇，约 ${totalLen} 字`, '');
    return lines.join('\n');
  }, [months, total, totalLen]);

  const copy = async () => {
    await ipc.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <DiaryToolModal open={open} onClose={onClose} title="日记人生年表">
      <div className="vg-diary-tool-content space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2 text-sm text-sub">
          <span>共 {total} 篇 · 约 {totalLen} 字</span>
          <button onClick={() => void copy()} className="vg-button vg-button-ghost">
            {copied ? '已复制' : '复制年表'}
          </button>
        </div>

        {months.length === 0 ? (
          <div className="py-10 text-center text-gray-500">
            <Icon name="diary" size={30} className="mx-auto mb-2" />
            <p className="text-sm">还没有日记</p>
          </div>
        ) : (
          <div className="relative max-h-[60vh] overflow-y-auto pl-6">
            {/* 时间轴竖线 */}
            <div className="absolute left-[5px] top-1 bottom-1 w-px bg-gradient-to-b from-gene-purple/40 via-life-cyan/30 to-transparent" />
            <div className="space-y-5">
              {months.map((m) => {
                const [y, mm] = m.key.split('-');
                const avgMood = m.moods.length > 0 ? Math.round(m.moods.reduce((a, b) => a + b, 0) / m.moods.length) : 3;
                return (
                  <div key={m.key} className="relative">
                    <span className="absolute -left-6 top-1 w-2.5 h-2.5 rounded-full bg-gene-purple ring-2 ring-gene-purple/25" />
                    <div className="flex items-center flex-wrap gap-2 mb-1">
                      <span className="text-sm font-semibold text-ink">{y}年{Number(mm)}月</span>
                      <span className="vg-diary-tool-caption text-sub">{m.count} 篇</span>
                      <span className="vg-diary-tool-caption text-sub" aria-label={`月均心情 ${avgMood} 分`}>{moodEmoji(avgMood)}</span>
                    </div>
                    {m.sample && (
                      <p className="text-sm text-sub leading-relaxed break-words">
                        {m.sample.title ? `《${m.sample.title}》 ` : ''}{m.sample.content.replace(/\n+/g, ' ').slice(0, 80)}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </DiaryToolModal>
  );
}
