import { useEffect, useRef, useState } from 'react';
import { useAuthStore } from '../../store/auth-store';
import { useEmotionStore } from '../../store/emotion-store';
import { diaryRepo, todayStr } from '../../db/diary-repo';
import { DIARY_MOODS } from '../../lib/diary-utils';

/** 心情选择网格（「更多」菜单的子视图） */
function MoodGrid({ onPick, onBack }: { onPick: (mood: number) => void; onBack: () => void }) {
  return (
    <div className="px-3 py-2.5 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-gray-400">今天的心情</span>
        <button onClick={onBack} className="text-[10px] text-gray-400 hover:text-ink transition-colors">
          ‹ 返回
        </button>
      </div>
      <div className="flex items-center gap-1.5">
        {DIARY_MOODS.map((m) => (
          <button
            key={m.value}
            onClick={() => onPick(m.value)}
            title={m.label}
            className="w-8 h-8 rounded-full flex items-center justify-center text-lg hover:bg-surface transition-all hover:scale-110"
          >
            {m.emoji}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * 聊天页顶部「⋯」更多菜单（仅手机端）：收纳 情绪图谱 + 心情打卡，
 * 让聊天头部只保留角色名，微信式简洁。情绪有数据时按钮右上角显示状态小点。
 */
export function ChatHeaderMoreMenu() {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<'main' | 'mood'>('main');
  const [done, setDone] = useState(false);
  const doneTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentSnapshot = useEmotionStore((s) => s.currentSnapshot);

  useEffect(
    () => () => {
      if (doneTimer.current) clearTimeout(doneTimer.current);
    },
    [],
  );

  const checkIn = async (mood: number) => {
    const userId = useAuthStore.getState().userId ?? '';
    const today = todayStr();
    try {
      const list = await diaryRepo.getByDate(userId, today);
      if (list.length > 0) {
        await diaryRepo.update(list[0].id, { mood });
      } else {
        await diaryRepo.create({ userId, date: today, title: '', content: '', mood, tags: ['心情打卡'] });
      }
      setOpen(false);
      setView('main');
      setDone(true);
      if (doneTimer.current) clearTimeout(doneTimer.current);
      doneTimer.current = setTimeout(() => setDone(false), 1800);
    } catch {
      /* ignore */
    }
  };

  const valence = currentSnapshot?.dimensions.valence;
  const dotClass =
    valence == null
      ? ''
      : valence >= 7.5
        ? 'bg-life-cyan'
        : valence >= 5
          ? 'bg-amber-400'
          : valence >= 2.5
            ? 'bg-orange-400'
            : 'bg-red-400';

  return (
    <div className="relative">
      <button
        onClick={() => {
          setOpen((v) => !v);
          setView('main');
        }}
        title="更多"
        className={`relative w-8 h-8 flex items-center justify-center rounded-lg text-lg transition-colors ${
          open ? 'bg-gene-purple/15 text-gene-purple' : 'text-gray-400 hover:bg-surface hover:text-ink'
        }`}
      >
        ⋯
        {currentSnapshot && (
          <span className={`absolute top-0.5 right-0.5 w-2 h-2 rounded-full border border-app ${dotClass}`} />
        )}
        {done && <span className="absolute -top-1 -left-1 text-[9px] text-life-cyan animate-fade-in">✓</span>}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-50 min-w-[150px] glass-card rounded-xl shadow-xl animate-fade-in overflow-hidden">
            {view === 'main' ? (
              <div className="py-1.5">
                <button
                  onClick={() => {
                    setOpen(false);
                    useEmotionStore.getState().togglePanel();
                  }}
                  className="w-full flex items-center gap-2.5 px-4 py-3 text-sm text-sub hover:bg-surface transition-colors"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-gene-purple/70 shrink-0">
                    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                  </svg>
                  情绪图谱
                </button>
                <button
                  onClick={() => setView('mood')}
                  className="w-full flex items-center gap-2.5 px-4 py-3 text-sm text-sub hover:bg-surface transition-colors"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-life-cyan/80 shrink-0">
                    <circle cx="12" cy="12" r="10" />
                    <path d="M8 14s1.5 2 4 2 4-2 4-2" />
                    <path d="M9 9h.01M15 9h.01" />
                  </svg>
                  心情打卡
                </button>
              </div>
            ) : (
              <MoodGrid onBack={() => setView('main')} onPick={(m) => void checkIn(m)} />
            )}
          </div>
        </>
      )}
    </div>
  );
}
