import { useAiAvailability } from '../settings/useAiAvailability';
import { useEffect, useMemo, useState } from 'react';
import { DiaryToolModal, DiaryAiFeedback } from './DiaryToolModal';
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
  const apiKey = useAuthStore((s) => s.apiKey) ?? '';
  const hasAiAccess = useAiAvailability();
  const diaries = useDiaryStore((s) => s.diaries);

  const [data, setData] = useState(loadCached());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = async () => {
    if (!hasAiAccess) { setError('请先在设置的 AI 连接中配置当前模型'); return; }
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
        setError(r.error || 'server:error');
      } else {
        const d = { text: r.text, count: withMood.length, generatedAt: Date.now() };
        setData(d);
        localStorage.setItem(insightKey(), JSON.stringify(d));
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : 'server:error');
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
    <DiaryToolModal open={open} onClose={onClose} title="情绪周期洞察">
      <div className="vg-diary-tool-content space-y-4">
        {/* 星期心情均值柱状（本地统计，无需 AI） */}
        <div className="vg-diary-tool-reading rounded-xl px-4 py-3">
          <p className="text-sm font-medium text-sub mb-3">星期心情均值</p>
          <dl className="vg-diary-weekday-chart" aria-label="星期心情均值，满分5分">
            {weekdayStats.map(({ wd, avg, count }) => (
              <div key={wd} className="vg-diary-weekday-row vg-diary-tool-caption text-sub">
                <dt>周{WEEKDAY_LABEL[wd]}</dt>
                <dd className="vg-diary-weekday-track" aria-hidden="true">
                  <span style={{
                    width: avg ? `${avg * 20}%` : '4%',
                    backgroundColor: avg ? avg >= 4 ? '#00CEC9' : avg >= 3 ? '#6C5CE7' : '#FB923C' : 'var(--text-secondary)',
                  }} />
                </dd>
                <dd className="tabular-nums"><span className="sr-only">均值 </span>{avg ? avg.toFixed(1) : '—'}</dd>
                <dd className="tabular-nums">{count}篇</dd>
              </div>
            ))}
          </dl>
        </div>

        {loading ? (
          <div className="py-8 text-center">
            <svg className="animate-spin w-6 h-6 mx-auto mb-3 text-[color:var(--vg-accent)]" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeDasharray="28" strokeDashoffset="20" />
            </svg>
            <p className="text-sm text-gray-500">正在分析你的情绪规律…</p>
          </div>
        ) : error || (!hasAiAccess && !data) ? (
          <DiaryAiFeedback error={error} onRetry={() => void generate()} />
        ) : data ? (
          <>
            <div className="vg-diary-tool-reading rounded-xl px-4 py-3">
              <p className="text-sm font-medium text-sub mb-2">AI 洞察</p>
              <p className="text-sm text-sub leading-relaxed whitespace-pre-wrap">{data.text}</p>
            </div>
            <div className="flex items-center justify-between flex-wrap gap-2 vg-diary-tool-caption text-sub">
              <span>基于 {data.count} 篇日记</span>
              <button onClick={() => void generate()} disabled={loading} className="vg-button vg-button-ghost">
                重新分析
              </button>
            </div>
          </>
        ) : (
          <div className="py-8 text-center">
            <p className="text-sm text-gray-500 mb-3">暂无可分析的日记</p>
            <button onClick={() => void generate()} className="vg-button vg-button-primary">
              开始分析
            </button>
          </div>
        )}
      </div>
    </DiaryToolModal>
  );
}
