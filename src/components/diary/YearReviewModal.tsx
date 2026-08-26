import { useEffect, useMemo, useState } from 'react';
import { Modal } from '../ui/Modal';
import { FilterSelect } from '../ui/FilterSelect';
import { useAuthStore } from '../../store/auth-store';
import { useDiaryStore } from '../../store/diary-store';
import { ipc } from '../../lib/ipc-client';
import { diaryRepo, todayStr } from '../../db/diary-repo';

interface Props {
  open: boolean;
  onClose: () => void;
}

/** 年度统计：篇数 / 总字数 / 心情分布 / 高频标签 */
function summarizeYear(diaries: { date: string; content: string; mood: number; tags: string[] }[]) {
  const words = diaries.reduce((s, d) => s + d.content.length, 0);
  const moodDist = [0, 0, 0, 0, 0];
  for (const d of diaries) moodDist[Math.max(0, Math.min(4, (d.mood ?? 3) - 1))] += 1;
  const tagCount = new Map<string, number>();
  for (const d of diaries) for (const t of d.tags ?? []) tagCount.set(t, (tagCount.get(t) ?? 0) + 1);
  const topTags = [...tagCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([t]) => t);
  return { count: diaries.length, words, moodDist, topTags };
}

/** 「年度灵魂回顾」：选年份 → 年度统计 + AI 串成一篇回顾，可复制或存为今天的日记 */
export function YearReviewModal({ open, onClose }: Props) {
  const apiKey = useAuthStore((s) => s.apiKey);
  const diaries = useDiaryStore((s) => s.diaries);
  const getOrCreateForDate = useDiaryStore((s) => s.getOrCreateForDate);
  const updateDiary = useDiaryStore((s) => s.updateDiary);

  const years = useMemo(() => {
    const s = new Set<string>();
    for (const d of diaries) s.add(d.date.slice(0, 4));
    return [...s].sort().reverse();
  }, [diaries]);

  const [year, setYear] = useState('');
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [stats, setStats] = useState<ReturnType<typeof summarizeYear> | null>(null);

  const run = async (targetYear?: string) => {
    const y = targetYear ?? year;
    if (!apiKey) { setError('未检测到 API Key，无法生成'); return; }
    if (!y) { setError('请先选择年份'); return; }
    setLoading(true);
    setError(null);
    try {
      const userId = useAuthStore.getState().userId ?? '';
      const all = await diaryRepo.getByUser(userId);
      const yearDiaries = all
        .filter((d) => d.date.startsWith(y) && d.content.trim().length > 0)
        .map((d) => ({ date: d.date, content: d.content, mood: d.mood ?? 3, tags: d.tags ?? [] }));
      if (yearDiaries.length === 0) {
        setError(`${y} 年还没有日记，先去写几篇吧`);
        return;
      }
      const s = summarizeYear(yearDiaries);
      setStats(s);
      const joined = yearDiaries
        .slice()
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((d) => `【${d.date}】\n${d.content}`)
        .join('\n\n');
      const statsText =
        `- 共 ${s.count} 篇，约 ${s.words} 字\n` +
        `- 心情分布：很差 ${s.moodDist[0]}、低落 ${s.moodDist[1]}、一般 ${s.moodDist[2]}、开心 ${s.moodDist[3]}、很棒 ${s.moodDist[4]}\n` +
        (s.topTags.length > 0 ? `- 高频标签：${s.topTags.map((t) => '#' + t).join(' ')}\n` : '') +
        `- 正文：\n${joined}`;
      const r = await ipc.diary.assist({ apiKey, mode: 'annual', text: statsText });
      if (r.error || !r.text) {
        setError('生成失败，请稍后重试');
      } else {
        setText(r.text);
      }
    } catch {
      setError('生成失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      const first = years[0] ?? '';
      setYear(first);
      setText('');
      setError(null);
      setCopied(false);
      setStats(null);
      void run(first);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const copy = async () => {
    await ipc.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const saveToToday = async () => {
    const diary = await getOrCreateForDate(todayStr());
    if (diary) {
      const content = diary.content.trim() ? diary.content.trim() + '\n\n' + text : text;
      const title = diary.title.trim() ? diary.title : `${year} 年度回顾`;
      await updateDiary(diary.id, { content, title });
    }
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="✨ 年度灵魂回顾" width="max-w-xl" closeOnBackdrop={false}>
      <div className="p-6 space-y-4">
        {/* 年份选择 */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-sub shrink-0">年份</span>
          <FilterSelect
            value={year}
            onChange={(v) => { setYear(v); void run(v); }}
            options={years.map((y) => ({ value: y, label: `${y} 年` }))}
            className="flex-1"
            buttonClassName="flex items-center gap-1.5 w-full px-3 py-2 rounded-lg bg-surface border border-line text-sm text-ink hover:border-gene-purple/40 transition-colors"
          />
          {stats && (
            <span className="text-[11px] text-gray-500 shrink-0">{stats.count} 篇 · {stats.words} 字</span>
          )}
        </div>

        {loading ? (
          <div className="py-8 text-center">
            <svg className="animate-spin w-6 h-6 mx-auto mb-3 text-gene-purple" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeDasharray="28" strokeDashoffset="20" />
            </svg>
            <p className="text-sm text-gray-500">正在回看 {year} 年的日记…</p>
          </div>
        ) : error ? (
          <div className="py-8 text-center">
            <p className="text-sm text-red-400 mb-3">{error}</p>
            <button onClick={() => void run()} className="px-4 py-2 rounded-lg text-sm bg-gene-purple text-white hover:bg-[#5B4BD4] transition-colors">
              重试
            </button>
          </div>
        ) : (
          <>
            {/* 年度统计 */}
            {stats && (
              <div className="grid grid-cols-5 gap-1.5">
                {stats.moodDist.map((n, i) => (
                  <div key={i} className="rounded-lg bg-surface border border-line px-2 py-1.5 text-center">
                    <div className="text-sm font-bold text-ink tabular-nums">{n}</div>
                    <div className="text-[10px] text-gray-500">{['很差', '低落', '一般', '开心', '很棒'][i]}</div>
                  </div>
                ))}
              </div>
            )}
            {stats && stats.topTags.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[11px] text-gray-500">年度高频</span>
                {stats.topTags.map((t) => (
                  <span key={t} className="px-2 py-0.5 rounded-full bg-gene-purple/10 text-gene-purple text-[11px]">#{t}</span>
                ))}
              </div>
            )}
            <div className="rounded-xl bg-surface border border-line px-4 py-3 text-sm text-ink leading-relaxed whitespace-pre-wrap max-h-80 overflow-y-auto">
              {text}
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-gray-400 hover:bg-surface transition-colors">关闭</button>
              <button onClick={() => void copy()} className="px-4 py-2 rounded-lg text-sm text-life-cyan hover:bg-life-cyan/10 transition-colors">
                {copied ? '✅ 已复制' : '📋 复制'}
              </button>
              <button
                onClick={() => void saveToToday()}
                className="px-4 py-2 rounded-lg text-sm bg-gene-purple hover:bg-[#5B4BD4] text-white transition-all"
              >
                💾 存为今天的日记
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
