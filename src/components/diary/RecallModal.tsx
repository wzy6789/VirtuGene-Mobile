import { useAiAvailability } from '../settings/useAiAvailability';
import { useEffect, useMemo, useState } from 'react';
import { DiaryToolModal, DiaryAiFeedback } from './DiaryToolModal';
import { FilterSelect } from '../ui/FilterSelect';
import { useAuthStore } from '../../store/auth-store';
import { useDiaryStore } from '../../store/diary-store';
import { ipc } from '../../lib/ipc-client';
import { sessionRepo } from '../../db/session-repo';
import { messageRepo } from '../../db/message-repo';
import { characterRepo } from '../../db/character-repo';
import { diaryRepo } from '../../db/diary-repo';

interface Props {
  open: boolean;
  onClose: () => void;
}

/** 收集指定日期的各角色对话（补记素材） */
async function collectConversationsForDate(userId: string, dateStr: string): Promise<{ character: string; text: string }[]> {
  const [sessions, chars] = await Promise.all([sessionRepo.getByUser(userId), characterRepo.getAll()]);
  const charName = (id: string) => chars.find((c) => c.id === id)?.name;
  const out: { character: string; text: string }[] = [];
  const dayStart = new Date(`${dateStr}T00:00:00`).getTime();
  const dayEnd = dayStart + 86400000;
  for (const s of sessions) {
    const msgs = await messageRepo.getBySession(s.id);
    const dayMsgs = msgs.filter((m) => m.createdAt >= dayStart && m.createdAt < dayEnd);
    if (dayMsgs.length > 0) {
      out.push({ character: (charName(s.characterId) ?? s.title) || 'TA', text: dayMsgs.map((m) => `${m.role === 'user' ? '我' : 'TA'}：${m.content}`).join('\n') });
    }
  }
  return out;
}

/** 「补记助手」：给没写日记的过去日期，基于当天与角色的对话补记一篇日记草稿 */
export function RecallModal({ open, onClose }: Props) {
  const apiKey = useAuthStore((s) => s.apiKey) ?? '';
  const hasAiAccess = useAiAvailability();
  const diaries = useDiaryStore((s) => s.diaries);
  const getOrCreateForDate = useDiaryStore((s) => s.getOrCreateForDate);
  const updateDiary = useDiaryStore((s) => s.updateDiary);

  /** 可选日期：过去 30 天且没有日记的日子（含已有日记的日期也列出，可追加） */
  const candidates = useMemo(() => {
    const hasDate = new Set(diaries.map((d) => d.date));
    const out: { value: string; label: string }[] = [];
    const base = new Date();
    for (let i = 1; i <= 30; i++) {
      const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      out.push({ value: key, label: `${key}${hasDate.has(key) ? '（已有，可补写）' : '（未写）'}` });
    }
    return out;
  }, [diaries]);

  const [date, setDate] = useState('');
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState('');
  const [suggestedTags, setSuggestedTags] = useState<string[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [suggestedTitle, setSuggestedTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const run = async () => {
    if (!hasAiAccess) { setError('请先在设置的 AI 连接中配置当前模型'); return; }
    if (!date) { setError('请先选择日期'); return; }
    setLoading(true);
    setError(null);
    try {
      const userId = useAuthStore.getState().userId ?? '';
      const convos = await collectConversationsForDate(userId, date);
      if (convos.length === 0) {
        setError('这一天没有和任何角色的聊天记录，无法补记');
        return;
      }
      const text = convos.map((c) => `【${c.character}】\n${c.text}`).join('\n\n');
      const r = await ipc.diary.assist({ apiKey, mode: 'recall', text });
      if (r.error || !r.text) {
        setError(r.error || 'server:error');
      } else {
        setDraft(r.text);
        setSuggestedTags(r.tags ?? []);
        setSelectedTags(r.tags ?? []);
        setSuggestedTitle(r.title ?? '');
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : 'server:error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      setDate(candidates[0]?.value ?? '');
      setDraft('');
      setError(null);
      setSuggestedTags([]);
      setSelectedTags([]);
      setSuggestedTitle('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const save = async () => {
    if (!draft.trim()) return;
    setSaving(true);
    try {
      const diary = await getOrCreateForDate(date);
      if (diary) {
        const trimmed = draft.trim();
        const newContent = diary.content.trim() ? diary.content.trim() + '\n\n' + trimmed : trimmed;
        const typedTitle = suggestedTitle.trim();
        const finalTitle = diary.title.trim()
          ? diary.title.trim()
          : (typedTitle || trimmed.split('\n')[0].slice(0, 24));
        const mergedTags = [...new Set([...(diary.tags ?? []), ...selectedTags])];
        await updateDiary(diary.id, { content: newContent, title: finalTitle, tags: mergedTags });
      }
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <DiaryToolModal open={open} onClose={onClose} title="补记助手">
      <div className="vg-diary-tool-content space-y-4">
        <p className="text-xs text-gray-500">根据当天与角色的聊天生成草稿。</p>

        {/* 日期选择 */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-sub shrink-0">补记日期</span>
          <FilterSelect
            value={date}
            onChange={(v) => { setDate(v); setDraft(''); setError(null); }}
            options={candidates}
            className="vg-diary-tool-filter flex-1 min-w-0"
            buttonClassName="flex items-center gap-1.5 w-full px-3 py-2 rounded-lg bg-surface border border-line text-sm text-ink hover:border-[color:var(--vg-accent)] transition-colors"
          />
          {hasAiAccess && <button
            onClick={() => void run()}
            disabled={!date || !hasAiAccess || loading}
            className="vg-button vg-button-primary"
          >
            {loading ? '生成中…' : '生成草稿'}
          </button>}
        </div>

        {error || (!hasAiAccess && !draft) ? (
          <DiaryAiFeedback error={error} onRetry={() => void run()} />
        ) : draft ? (
          <>
            <input
              value={suggestedTitle}
              onChange={(e) => setSuggestedTitle(e.target.value)}
              placeholder="标题（可选）"
              className="w-full bg-transparent border-b border-line focus:border-[color:var(--vg-accent)] outline-none text-base font-semibold text-ink placeholder:text-gray-400 pb-1.5 transition-colors"
            />
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={8}
              className="w-full resize-none bg-surface border border-line-strong rounded-xl px-4 py-3 text-sm text-ink leading-relaxed outline-none focus:border-[color:var(--vg-accent)] transition-colors"
            />
            {suggestedTags.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-xs text-gray-500">建议标签</span>
                {suggestedTags.map((t) => (
                  <button
                    key={t}
                    onClick={() =>
                      setSelectedTags((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]))
                    }
                    className={`px-2 py-0.5 rounded-full text-xs transition-all ${
                      selectedTags.includes(t)
                        ? 'vg-diary-choice-active'
                        : 'bg-surface text-gray-400 opacity-70 hover:opacity-100'
                    }`}
                  >
                    #{t}
                  </button>
                ))}
              </div>
            )}
            <div className="vg-diary-tool-actions">
              <button onClick={onClose} className="vg-button vg-button-ghost">丢弃</button>
              <button onClick={() => void run()} disabled={loading} className="vg-button vg-button-secondary">
                重新生成
              </button>
              <button
                onClick={() => void save()}
                disabled={saving || !draft.trim()}
                className="vg-button vg-button-primary"
              >
                {saving ? '保存中…' : '存入这一天'}
              </button>
            </div>
          </>
        ) : null}
      </div>
    </DiaryToolModal>
  );
}
