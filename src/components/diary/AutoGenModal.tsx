import { useEffect, useState } from 'react';
import { Modal } from '../ui/Modal';
import { FilterSelect } from '../ui/FilterSelect';
import { useDiaryStore } from '../../store/diary-store';
import { useAuthStore } from '../../store/auth-store';
import { useChatStore } from '../../store/chat-store';
import { generateTodayDiary } from '../../lib/diary-auto';
import { diaryRepo, todayStr } from '../../db/diary-repo';

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * AI 自动生成今天的日记：选择「关联角色」→ 基于 TA 的对话生成一篇日记初稿，
 * 供用户选择（采纳 / 编辑后再存 / 重新生成 / 丢弃）。
 * 只结合所选角色的对话，不合并其他角色。
 */
export function AutoGenModal({ open, onClose }: Props) {
  const getOrCreateForDate = useDiaryStore((s) => s.getOrCreateForDate);
  const updateDiary = useDiaryStore((s) => s.updateDiary);
  const characters = useChatStore((s) => s.characters);
  const apiKey = useAuthStore((s) => s.apiKey);

  const [characterId, setCharacterId] = useState('');
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [suggestedTags, setSuggestedTags] = useState<string[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [suggestedTitle, setSuggestedTitle] = useState('');
  const [title, setTitle] = useState('');
  /** true=整篇替换今天的日记；false=追加到今天的日记末尾 */
  const [replaceMode, setReplaceMode] = useState(false);
  /** 今天是否已有日记内容（影响默认写入方式与提示） */
  const [hasExisting, setHasExisting] = useState(false);

  const toggleTag = (t: string) => {
    setSelectedTags((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  };

  const generate = async () => {
    if (!apiKey) {
      setError('未检测到 API Key，无法生成');
      return;
    }
    if (!characterId) {
      setError('请先选择一个角色');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const userId = useAuthStore.getState().userId ?? '';
      const todayArr = await diaryRepo.getByDate(userId, todayStr());
      const today = todayArr[0];
      const existing = today && today.content.trim() ? today.content.trim() : '';
      setHasExisting(existing.length > 0);
      const r = await generateTodayDiary(apiKey, userId, characterId);
      if (r.error === 'no_character') {
        setError('请先选择一个角色');
      } else if (r.error) {
        setError('生成失败，请稍后重试');
      } else if (r.draft) {
        const t = r.draft;
        setDraft(t);
        setEditing(false);
        setSuggestedTags(r.tags ?? []);
        setSelectedTags(r.tags ?? []);
        setSuggestedTitle(r.title ?? '');
        setTitle(r.title ?? '');
        // 默认写入方式：AI 判断需要整篇重写时用「替换」，否则默认「追加」
        setReplaceMode(r.replace || !existing);
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
      setCharacterId('');
      setDraft('');
      setEditing(false);
      setError(null);
      setSuggestedTags([]);
      setSelectedTags([]);
      setSuggestedTitle('');
      setTitle('');
      setReplaceMode(false);
      setHasExisting(false);
    }
  }, [open]);

  const save = async (text: string) => {
    if (!text.trim()) return;
    setSaving(true);
    try {
      const userId = useAuthStore.getState().userId ?? '';
      const diary = await getOrCreateForDate(todayStr());
      if (diary) {
        const trimmed = text.trim();
        const newContent = replaceMode || !diary.content.trim() ? trimmed : diary.content.trim() + '\n\n' + trimmed;
        // 标题：用户手动改过 → 用用户输入；追加且今天已有标题 → 保留原标题；否则用 AI 建议或首行
        const typedTitle = title.trim();
        const userEditedTitle = typedTitle !== '' && typedTitle !== suggestedTitle.trim();
        const finalTitle = userEditedTitle
          ? typedTitle
          : !replaceMode && diary.title.trim()
            ? diary.title.trim()
            : (suggestedTitle.trim() || trimmed.split('\n')[0].slice(0, 24));
        const mergedTags = [...new Set([...(diary.tags ?? []), ...selectedTags])];
        await updateDiary(diary.id, { content: newContent, title: finalTitle, tags: mergedTags });
      }
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const selectedChar = characters.find((c) => c.id === characterId);

  return (
    <Modal open={open} onClose={onClose} title="🧠 自动生成今天的日记" width="max-w-xl" closeOnBackdrop={false}>
      <div className="p-6 space-y-4">
        {/* 角色选择 */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-sub shrink-0">结合角色</span>
          <FilterSelect
            value={characterId}
            onChange={(v) => { setCharacterId(v); setDraft(''); setError(null); }}
            options={[
              { value: '', label: '选择角色…' },
              ...characters.map((c) => ({ value: c.id, label: `${c.avatar} ${c.name}` })),
            ]}
            className="flex-1"
            buttonClassName="flex items-center gap-1.5 w-full px-3 py-2 rounded-lg bg-surface border border-line text-sm text-ink hover:border-gene-purple/40 transition-colors"
          />
        </div>

        {!draft && !loading && (
          <button
            onClick={() => void generate()}
            disabled={!characterId || !apiKey}
            className="w-full py-2.5 rounded-xl bg-gene-purple hover:bg-[#5B4BD4] disabled:opacity-40 text-sm font-medium text-white transition-colors"
          >
            ✨ 基于「{selectedChar?.name ?? '所选角色'}」的对话生成日记
          </button>
        )}

        {loading ? (
          <div className="py-8 text-center">
            <svg className="animate-spin w-6 h-6 mx-auto mb-3 text-gene-purple" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeDasharray="28" strokeDashoffset="20" />
            </svg>
            <p className="text-sm text-gray-500">正在回顾「{selectedChar?.name ?? ''}」的对话，起草日记…</p>
          </div>
        ) : error ? (
          <div className="py-6 text-center">
            <p className="text-sm text-red-400 mb-3">{error}</p>
            {characterId && (
              <button onClick={() => void generate()} className="px-4 py-2 rounded-lg text-sm bg-gene-purple text-white hover:bg-[#5B4BD4] transition-colors">
                重试
              </button>
            )}
          </div>
        ) : draft ? (
          <>
            <p className="text-xs text-gray-500">已根据与「{selectedChar?.name ?? ''}」的对话生成初稿，可以采纳、编辑或重新生成：</p>
            {editing ? (
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={10}
                className="w-full resize-none bg-surface border border-line-strong rounded-xl px-4 py-3 text-sm text-ink leading-relaxed outline-none focus:border-gene-purple transition-colors"
              />
            ) : (
              <div className="rounded-xl bg-surface border border-line px-4 py-3 text-sm text-ink leading-relaxed whitespace-pre-wrap max-h-64 overflow-y-auto">
                {draft}
              </div>
            )}
            {/* 标题（AI 建议，可改） */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-sub shrink-0">标题</span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={suggestedTitle || '日记标题…'}
                maxLength={30}
                className="flex-1 bg-surface border border-line rounded-lg px-3 py-2 text-sm text-ink outline-none focus:border-gene-purple transition-colors"
              />
            </div>
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
            {/* 写入方式：替换 / 追加 */}
            {hasExisting && (
              <div className="flex items-center gap-3 rounded-xl bg-surface border border-line px-3 py-2">
                <span className="text-[11px] text-gray-500 shrink-0">写入今天</span>
                <div className="flex rounded-lg border border-line overflow-hidden text-xs">
                  <button
                    onClick={() => setReplaceMode(true)}
                    className={`px-3 py-1.5 transition-colors ${replaceMode ? 'bg-gene-purple/15 text-gene-purple' : 'text-gray-500 hover:text-ink'}`}
                  >
                    整篇替换
                  </button>
                  <button
                    onClick={() => setReplaceMode(false)}
                    className={`px-3 py-1.5 transition-colors ${!replaceMode ? 'bg-gene-purple/15 text-gene-purple' : 'text-gray-500 hover:text-ink'}`}
                  >
                    追加到末尾
                  </button>
                </div>
                <span className="text-[11px] text-gray-400">{replaceMode ? '用这篇覆盖今天已有的日记' : '接到今天已有日记后面'}</span>
              </div>
            )}
            <div className="flex items-center justify-end gap-2 flex-wrap">
              <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-gray-400 hover:bg-surface transition-colors">丢弃</button>
              <button onClick={() => void generate()} disabled={loading} className="px-4 py-2 rounded-lg text-sm text-life-cyan hover:bg-life-cyan/10 transition-colors disabled:opacity-40">
                ⟳ 重新生成
              </button>
              <button
                onClick={() => setEditing((v) => !v)}
                className="px-4 py-2 rounded-lg text-sm text-gray-500 hover:bg-surface transition-colors"
              >
                {editing ? '收起编辑' : '✏️ 编辑后再存'}
              </button>
              <button
                onClick={() => void save(draft)}
                disabled={saving || !draft.trim()}
                className="px-4 py-2 rounded-lg text-sm bg-gene-purple hover:bg-[#5B4BD4] text-white shadow-[0_2px_12px_rgba(108,92,231,0.35)] transition-all disabled:opacity-40"
              >
                {saving ? '保存中…' : '✅ 采纳并写入今天的日记'}
              </button>
            </div>
          </>
        ) : null}
      </div>
    </Modal>
  );
}
