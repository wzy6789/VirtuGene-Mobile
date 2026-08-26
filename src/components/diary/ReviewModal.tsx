import { useEffect, useState } from 'react';
import { Modal } from '../ui/Modal';
import { useAuthStore } from '../../store/auth-store';
import { useDiaryStore } from '../../store/diary-store';
import { ipc } from '../../lib/ipc-client';
import { diaryRepo, todayStr } from '../../db/diary-repo';

interface Props {
  open: boolean;
  onClose: () => void;
}

/** 「本周灵魂回顾」：把本周日记交给 AI 串成一篇回顾，可复制或存为今天的日记 */
export function ReviewModal({ open, onClose }: Props) {
  const apiKey = useAuthStore((s) => s.apiKey);
  const getOrCreateForDate = useDiaryStore((s) => s.getOrCreateForDate);
  const updateDiary = useDiaryStore((s) => s.updateDiary);

  const [loading, setLoading] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const run = async () => {
    if (!apiKey) {
      setError('未检测到 API Key，无法生成');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const userId = useAuthStore.getState().userId ?? '';
      // 本周（周一 ~ 今天）日记
      const now = new Date();
      const day = (now.getDay() + 6) % 7; // 周一 = 0
      const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day);
      const pad = (n: number) => String(n).padStart(2, '0');
      const mondayStr = `${monday.getFullYear()}-${pad(monday.getMonth() + 1)}-${pad(monday.getDate())}`;
      const today = todayStr();
      const diaries = (await diaryRepo.getByUser(userId)).filter(
        (d) => d.date >= mondayStr && d.date <= today && d.content.trim().length > 0,
      );
      if (diaries.length === 0) {
        setError('这周还没有日记，先去写几篇吧');
        return;
      }
      const joined = diaries.map((d) => `【${d.date}】\n${d.content}`).join('\n\n');
      const r = await ipc.diary.assist({ apiKey, mode: 'review', text: joined });
      if (r.error) {
        setError('生成失败，请稍后重试');
      } else if (r.text) {
        const t = r.text;
        setText(t);
      } else {
        setError('生成失败，请稍后重试');
      }
    } catch {
      setError('生成失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      setText('');
      setError(null);
      setCopied(false);
      void run();
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
      const title = diary.title.trim() ? diary.title : '本周灵魂回顾';
      await updateDiary(diary.id, { content, title });
    }
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="✨ 本周灵魂回顾" width="max-w-xl" closeOnBackdrop={false}>
      <div className="p-6 space-y-4">
        {loading ? (
          <div className="py-8 text-center">
            <svg className="animate-spin w-6 h-6 mx-auto mb-3 text-gene-purple" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeDasharray="28" strokeDashoffset="20" />
            </svg>
            <p className="text-sm text-gray-500">正在串起这一周的日记…</p>
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
