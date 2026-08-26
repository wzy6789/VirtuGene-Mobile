import { useEffect, useRef, useState } from 'react';
import { Modal } from '../ui/Modal';
import { generateTodayDiary } from '../../lib/diary-auto';
import { useAuthStore } from '../../store/auth-store';

interface Props {
  open: boolean;
  onClose: () => void;
  /** 关联角色 id：有则结合 TA 的对话 */
  characterId?: string;
  /** 关联角色名（用于提示与上下文标注） */
  characterName?: string;
  /** 今天日记里已写的内容：据此整理/融合成完整日记 */
  diaryContent?: string;
  /** 归档日补写：只允许追加，即使 AI 建议替换也显示为追加 */
  appendOnly?: boolean;
  /** 把（修改后的）初稿写入日记；replace=true 表示直接替换为一段完整文章；tags 为选中的标签；title 为建议标题 */
  onInsert: (text: string, replace?: boolean, tags?: string[], title?: string) => void;
}

/**
 * 「AI 生成日记草稿」：
 * - 关联角色 + 有片段 → 融合「片段 + TA 的对话」成一篇文章
 * - 只有关联角色 → 基于 TA 的对话生成
 * - 只有片段 → 整理成一篇完整日记
 * 生成时同时给出内容相关标签建议，可勾选后随日记保存。
 */
export function ExtractModal({ open, onClose, characterId, characterName, diaryContent, appendOnly, onInsert }: Props) {
  const apiKey = useAuthStore((s) => s.apiKey);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [suggestedTags, setSuggestedTags] = useState<string[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [suggestedTitle, setSuggestedTitle] = useState('');
  const replaceRef = useRef(false);

  const toggleTag = (t: string) => {
    setSelectedTags((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  };

  const run = async () => {
    if (!apiKey) {
      setError('未检测到 API Key，无法生成');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const userId = useAuthStore.getState().userId ?? '';
      const r = await generateTodayDiary(apiKey, userId, characterId, diaryContent, characterName);
      replaceRef.current = r.replace;
      if (r.error === 'no_content') {
        setError('先在日记里写几句，或在上方「关联角色」选择一个角色，再生成');
      } else if (r.error) {
        setError('生成失败，请稍后重试');
      } else if (r.draft) {
        const t = r.draft;
        setDraft(t);
        setSuggestedTags(r.tags ?? []);
        setSelectedTags(r.tags ?? []);
        setSuggestedTitle(r.title ?? '');
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
      setDraft('');
      setError(null);
      setSuggestedTags([]);
      setSelectedTags([]);
      void run();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Modal open={open} onClose={onClose} title="✨ AI 生成日记草稿" width="max-w-xl" closeOnBackdrop={false}>
      <div className="p-6 space-y-4">
        {loading ? (
          <div className="py-8 text-center">
            <svg className="animate-spin w-6 h-6 mx-auto mb-3 text-gene-purple" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeDasharray="28" strokeDashoffset="20" />
            </svg>
            <p className="text-sm text-gray-500">正在回顾今天的对话，起草日记…</p>
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
            <p className="text-xs text-gray-500">已生成一篇日记草稿，可以修改：</p>
            {/* 标题建议 */}
            <input
              value={suggestedTitle}
              onChange={(e) => setSuggestedTitle(e.target.value)}
              placeholder="标题（可选）"
              className="w-full bg-transparent border-b border-line focus:border-gene-purple outline-none text-base font-semibold text-ink placeholder:text-gray-400 pb-1.5 transition-colors"
            />
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={9}
              className="w-full resize-none bg-surface border border-line-strong rounded-xl px-4 py-3 text-sm text-ink leading-relaxed outline-none focus:border-gene-purple transition-colors"
            />

            {/* 建议标签 */}
            {suggestedTags.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[11px] text-gray-500">建议标签</span>
                {suggestedTags.map((t) => (
                  <button
                    key={t}
                    onClick={() => toggleTag(t)}
                    className={`px-2 py-0.5 rounded-full text-[11px] transition-all ${
                      selectedTags.includes(t)
                        ? 'bg-gene-purple/20 text-gene-purple shadow-[0_0_6px_rgba(108,92,231,0.25)]'
                        : 'bg-surface text-gray-400 opacity-70 hover:opacity-100'
                    }`}
                  >
                    #{t}
                  </button>
                ))}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-gray-400 hover:bg-surface transition-colors">丢弃</button>
              <button onClick={() => void run()} disabled={loading} className="px-4 py-2 rounded-lg text-sm text-life-cyan hover:bg-life-cyan/10 transition-colors disabled:opacity-40">
                ⟳ 重新生成
              </button>
              <button
                onClick={() => onInsert(draft, replaceRef.current, selectedTags, suggestedTitle.trim() || undefined)}
                disabled={!draft.trim()}
                className="px-4 py-2 rounded-lg text-sm bg-gene-purple hover:bg-[#5B4BD4] text-white transition-all disabled:opacity-40"
              >
                {appendOnly ? '✅ 追加到日记末尾' : replaceRef.current ? '✅ 替换为这篇日记' : '✅ 插入到日记'}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
