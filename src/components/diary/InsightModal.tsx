import { useEffect, useMemo, useState } from 'react';
import { Modal } from '../ui/Modal';
import { useAuthStore } from '../../store/auth-store';
import { useDiaryStore } from '../../store/diary-store';
import { ipc } from '../../lib/ipc-client';
import { diaryRepo } from '../../db/diary-repo';

interface Props {
  open: boolean;
  onClose: () => void;
}

const INSIGHT_KEY = 'virtugene-diary-insight';

/** 缓存按用户隔离：不同账号的洞察互不串 */
function insightKey(): string {
  const uid = useAuthStore.getState().userId ?? 'anon';
  return `${INSIGHT_KEY}:${uid}`;
}

function loadCached(): { text: string; count: number; generatedAt: number } | null {
  try {
    const raw = localStorage.getItem(insightKey());
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** 「情绪周期洞察」：AI 从心情记录里找出真实存在的情绪规律 */
export function InsightModal({ open, onClose }: Props) {
  const apiKey = useAuthStore((s) => s.apiKey);
  const diaries = useDiaryStore((s) => s.diaries);

  const [data, setData] = useState(loadCached());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = async () => {
    if (!apiKey) { setError('未检测到 API Key，无法生成'); return; }
    setLoading(true);
    setError(null);
    try {
      const userId = useAuthStore.getState().userId ?? '';
      const all = await diaryRepo.getByUser(userId);
      const withMood = all.filter((d) => d.content.trim().length > 0);
      if (withMood.length < 5) {
        setError('至少写 5 篇日记后才能看出情绪规律');
        return;
      }
      const rows = withMood
        .slice()
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((d) => `${d.date} · 心情 ${d.mood ?? 3} · ${d.content.length} 字`);
      const r = await ipc.diary.assist({ apiKey, mode: 'insight', text: rows.join('\n') });
      if (r.error || !r.text) {
        setError('生成失败，请稍后重试');
      } else {
        const d = { text: r.text, count: withMood.length, generatedAt: Date.now() };
        setData(d);
        localStorage.setItem(insightKey(), JSON.stringify(d));
      }
    } catch {
      setError('生成失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      setError(null);
      if (!loadCached() && diaries.length > 0) void generate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  /** 星期标签：按 getDay() 的 0=周日…6=周六 映射中文 */
  const WEEKDAY_LABEL = ['日', '一', '二', '三', '四', '五', '六'];

  const weekdayStats = useMemo(() => {
    const byWeekday: Record<number, number[]> = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
    for (const d of diaries) {
      const [y, m, dd] = d.date.split('-').map(Number);
      const wd = new Date(y, m - 1, dd).getDay();
      byWeekday[wd].push(d.mood ?? 3);
    }
    // 周一到周日展示
    return [1, 2, 3, 4, 5, 6, 0].map((wd) => {
      const list = byWeekday[wd];
      const avg = list.length > 0 ? list.reduce((a, b) => a + b, 0) / list.length : null;
      return { wd, avg, count: list.length };
    });
  }, [diaries]);

  return (
    <Modal open={open} onClose={onClose} title="📊 情绪周期洞察" width="max-w-xl" closeOnBackdrop={false}>
      <div className="p-6 space-y-4">
        {/* 星期心情均值柱状（本地统计，无需 AI） */}
        <div className="rounded-xl border border-line bg-panel/60 px-4 py-3">
          <p className="text-[11px] tracking-[0.2em] text-gray-500 uppercase mb-2">星期心情均值</p>
          <div className="flex items-end justify-between h-20 gap-2">
            {weekdayStats.map(({ wd, avg, count }) => (
              <div key={wd} className="flex flex-col items-center gap-1 flex-1">
                <span className="text-[9px] text-gray-400 leading-none">{avg ? avg.toFixed(1) : '—'}</span>
                <div
                  className="w-full rounded-t transition-all"
                  style={{
                    height: avg ? `${Math.max(6, avg * 12)}px` : '4px',
                    backgroundColor: avg
                      ? avg >= 4 ? '#00CEC9' : avg >= 3 ? '#6C5CE7' : '#FB923C'
                      : 'rgba(161,161,170,0.2)',
                  }}
                />
                <span className="text-[9px] text-gray-500">周{WEEKDAY_LABEL[wd]}</span>
                {count > 0 && <span className="text-[8px] text-gray-600">{count}篇</span>}
              </div>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="py-8 text-center">
            <svg className="animate-spin w-6 h-6 mx-auto mb-3 text-gene-purple" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeDasharray="28" strokeDashoffset="20" />
            </svg>
            <p className="text-sm text-gray-500">正在分析你的情绪规律…</p>
          </div>
        ) : error ? (
          <div className="py-8 text-center">
            <p className="text-sm text-red-400 mb-3">{error}</p>
            <button onClick={() => void generate()} className="px-4 py-2 rounded-lg text-sm bg-gene-purple text-white hover:bg-[#5B4BD4] transition-colors">
              重试
            </button>
          </div>
        ) : data ? (
          <>
            <div className="rounded-xl border border-line bg-panel/60 px-4 py-3">
              <p className="text-[11px] tracking-[0.2em] text-gray-500 uppercase mb-2">AI 洞察</p>
              <p className="text-sm text-sub leading-relaxed whitespace-pre-wrap">{data.text}</p>
            </div>
            <div className="flex items-center justify-between text-[10px] text-gray-400">
              <span>基于 {data.count} 篇日记</span>
              <button onClick={() => void generate()} disabled={loading} className="text-life-cyan hover:underline disabled:opacity-40">
                ⟳ 重新分析
              </button>
            </div>
          </>
        ) : (
          <div className="py-8 text-center">
            <p className="text-sm text-gray-500 mb-3">写几篇日记后，AI 会帮你找出情绪规律</p>
            <button onClick={() => void generate()} className="px-4 py-2 rounded-lg text-sm bg-gene-purple text-white hover:bg-[#5B4BD4] transition-colors">
              ✨ 开始分析
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}
