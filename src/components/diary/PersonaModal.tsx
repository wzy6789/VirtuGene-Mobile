import { useEffect, useState } from 'react';
import { Modal } from '../ui/Modal';
import { useAuthStore } from '../../store/auth-store';
import { useDiaryStore } from '../../store/diary-store';
import { ipc } from '../../lib/ipc-client';
import { diaryRepo } from '../../db/diary-repo';

export interface DiaryPersona {
  keywords: string[];
  topics: string[];
  emotion: string;
  summary: string;
  /** 基于的日记篇数 */
  count: number;
  /** 生成时间戳 */
  generatedAt: number;
}

const PERSONA_KEY = 'virtugene-diary-persona';

/** 缓存按用户隔离：不同账号的画像互不串 */
function personaKey(): string {
  const uid = useAuthStore.getState().userId ?? 'anon';
  return `${PERSONA_KEY}:${uid}`;
}

function loadCached(): DiaryPersona | null {
  try {
    const raw = localStorage.getItem(personaKey());
    return raw ? (JSON.parse(raw) as DiaryPersona) : null;
  } catch {
    return null;
  }
}

interface Props {
  open: boolean;
  onClose: () => void;
}

/** 「数字人格画像」：AI 从全部日记提炼性格关键词 / 高频话题 / 情绪倾向，以 DNA 基因图谱展示 */
export function PersonaModal({ open, onClose }: Props) {
  const apiKey = useAuthStore((s) => s.apiKey);
  const diaries = useDiaryStore((s) => s.diaries);

  const [persona, setPersona] = useState<DiaryPersona | null>(loadCached);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = async () => {
    if (!apiKey) { setError('未检测到 API Key，无法生成'); return; }
    setLoading(true);
    setError(null);
    try {
      const userId = useAuthStore.getState().userId ?? '';
      const all = await diaryRepo.getByUser(userId);
      const withContent = all.filter((d) => d.content.trim().length > 0);
      if (withContent.length === 0) {
        setError('还没有写过日记，先去写几篇吧');
        return;
      }
      // 全部日记拼接可能很长，取最近 60 篇并截断总长，避免超 token
      const joined = withContent
        .slice()
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 60)
        .map((d) => `【${d.date}】${d.title ? `《${d.title}》` : ''}\n${d.content.slice(0, 300)}`)
        .join('\n\n')
        .slice(0, 20000);
      const r = await ipc.diary.assist({ apiKey, mode: 'persona', text: joined });
      if (r.error || !r.persona) {
        setError('生成失败，请稍后重试');
      } else {
        const p: DiaryPersona = {
          ...r.persona,
          count: withContent.length,
          generatedAt: Date.now(),
        };
        setPersona(p);
        localStorage.setItem(personaKey(), JSON.stringify(p));
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
      // 首次打开且没有缓存 → 自动生成
      if (!loadCached() && diaries.length > 0) void generate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const g = persona?.generatedAt;
  const generatedText = g
    ? new Date(g).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })
    : '';

  return (
    <Modal open={open} onClose={onClose} title="🧬 数字人格画像" width="max-w-xl" closeOnBackdrop={false}>
      <div className="p-6 space-y-4">
        {loading ? (
          <div className="py-10 text-center">
            <svg className="animate-spin w-6 h-6 mx-auto mb-3 text-gene-purple" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeDasharray="28" strokeDashoffset="20" />
            </svg>
            <p className="text-sm text-gray-500">正在通读你的日记，解析基因序列…</p>
          </div>
        ) : error ? (
          <div className="py-8 text-center">
            <p className="text-sm text-red-400 mb-3">{error}</p>
            <button onClick={() => void generate()} className="px-4 py-2 rounded-lg text-sm bg-gene-purple text-white hover:bg-[#5B4BD4] transition-colors">
              重试
            </button>
          </div>
        ) : persona ? (
          <>
            {/* DNA 双螺旋基因图谱（性格关键词） */}
            <div className="relative rounded-xl border border-gene-purple/25 bg-gradient-to-br from-gene-purple/10 via-transparent to-life-cyan/10 p-4 overflow-hidden">
              <div className="absolute -top-10 -right-10 w-28 h-28 rounded-full bg-gene-purple/15 blur-2xl pointer-events-none" />
              <p className="text-[11px] tracking-[0.2em] text-gray-500 uppercase mb-3">你的性格基因序列</p>
              <div className="flex flex-wrap justify-center gap-2.5 py-2">
                {persona.keywords.map((k, i) => (
                  <span
                    key={k}
                    className={`relative px-3.5 py-1.5 rounded-full text-sm font-medium ${
                      i % 2 === 0
                        ? 'bg-gene-purple/15 text-gene-purple ring-1 ring-gene-purple/30'
                        : 'bg-life-cyan/15 text-life-cyan ring-1 ring-life-cyan/30'
                    }`}
                    style={{ animationDelay: `${i * 120}ms` }}
                  >
                    {k}
                  </span>
                ))}
              </div>
              {/* DNA 双螺旋装饰 */}
              <svg viewBox="0 0 300 24" className="w-full h-5 mt-2 opacity-40" preserveAspectRatio="none">
                {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
                  const x = (i / 7) * 300;
                  const y1 = 4 + Math.sin(i) * 6;
                  const y2 = 20 - Math.sin(i) * 6;
                  return (
                    <g key={i}>
                      <circle cx={x} cy={y1} r="2.2" fill="#6C5CE7" />
                      <circle cx={x} cy={y2} r="2.2" fill="#00CEC9" />
                      <line x1={x} y1={y1} x2={x} y2={y2} stroke="rgba(108,92,231,0.5)" strokeWidth="1" />
                    </g>
                  );
                })}
              </svg>
            </div>

            {/* 反复出现的话题 */}
            <div className="rounded-xl border border-line bg-panel/60 px-4 py-3">
              <p className="text-[11px] tracking-[0.2em] text-gray-500 uppercase mb-2">反复出现的话题</p>
              <div className="space-y-1.5">
                {persona.topics.map((t, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm text-sub">
                    <span className="shrink-0 w-4 h-4 rounded-full bg-gene-purple/15 text-gene-purple flex items-center justify-center text-[9px]">
                      {i + 1}
                    </span>
                    {t}
                  </div>
                ))}
              </div>
            </div>

            {/* 情绪倾向 */}
            <div className="rounded-xl border border-line bg-panel/60 px-4 py-3">
              <p className="text-[11px] tracking-[0.2em] text-gray-500 uppercase mb-1.5">情绪倾向</p>
              <p className="text-sm text-sub leading-relaxed">{persona.emotion}</p>
            </div>

            {/* 温柔总结 */}
            <div className="rounded-xl border border-life-cyan/25 bg-life-cyan/5 px-4 py-3">
              <p className="text-sm text-ink leading-relaxed">“{persona.summary}”</p>
            </div>

            <div className="flex items-center justify-between text-[10px] text-gray-400">
              <span>基于 {persona.count} 篇日记 · 生成于 {generatedText}</span>
              <button onClick={() => void generate()} disabled={loading} className="text-life-cyan hover:underline disabled:opacity-40">
                ⟳ 重新生成
              </button>
            </div>
          </>
        ) : (
          <div className="py-8 text-center">
            <p className="text-sm text-gray-500 mb-3">写几篇日记后，AI 会为你解析出专属的数字人格画像</p>
            <button onClick={() => void generate()} className="px-4 py-2 rounded-lg text-sm bg-gene-purple text-white hover:bg-[#5B4BD4] transition-colors">
              ✨ 生成画像
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}
