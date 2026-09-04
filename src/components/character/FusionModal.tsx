import { useState } from 'react';
import { useChatStore } from '../../store/chat-store';
import { fuseSouls, type FusionResult } from '../../lib/ai/fusion';
import type { Character } from '../../db/index';

/**
 * 基因融合 · 灵魂杂交：选两个角色，让 AI 融合出新的数字灵魂。
 * 融合结果可预览/改名/微调后再创建。
 */
export function FusionModal({ onClose }: { onClose: () => void }) {
  const characters = useChatStore((s) => s.characters);
  const createCharacter = useChatStore((s) => s.createCharacter);
  const [aId, setAId] = useState('');
  const [bId, setBId] = useState('');
  const [fusing, setFusing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<FusionResult | null>(null);
  const [name, setName] = useState('');
  const [signature, setSignature] = useState('');
  const [greeting, setGreeting] = useState('');
  const [prompt, setPrompt] = useState('');
  const [tagsText, setTagsText] = useState('');
  const [creating, setCreating] = useState(false);

  const a = characters.find((c) => c.id === aId);
  const b = characters.find((c) => c.id === bId);

  const handleFuse = async () => {
    if (!a || !b || a.id === b.id) return;
    setFusing(true);
    setError(null);
    const r = await fuseSouls(
      { name: a.name, systemPrompt: a.systemPrompt, tags: a.tags },
      { name: b.name, systemPrompt: b.systemPrompt, tags: b.tags },
    );
    setFusing(false);
    if (r.data) {
      setResult(r.data);
      setName(r.data.name ?? '');
      setSignature(r.data.signature);
      setGreeting(r.data.greeting);
      setPrompt(r.data.systemPrompt);
      setTagsText(r.data.tags.join('、'));
    } else {
      setError(r.error === 'fusion:invalid' ? '融合结果不完整，请重试' : '基因融合失败，请重试');
    }
  };

  const handleCreate = async () => {
    const finalName = name.trim();
    if (finalName.length < 2) {
      setError('请为新灵魂取一个名字（至少 2 个字）');
      return;
    }
    if (!prompt.trim()) {
      setError('基因序列为空，请检查');
      return;
    }
    setCreating(true);
    try {
      const char: Character = await createCharacter({
        name: finalName,
        avatar: '✨',
        systemPrompt: prompt.trim(),
        tags: tagsText.split(/[、,，\s]+/).filter(Boolean).slice(0, 5),
        signature: signature.trim(),
        greeting: greeting.trim(),
        isPreset: false,
        isCustom: true,
        published: false,
        createdBy: '',
      });
      // 融合成功 → 关闭并让上层选中新灵魂
      onClose();
      useChatStore.getState().selectCharacter(char.id);
    } catch {
      setError('创建失败，请重试');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[95] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg glass-card rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[88vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-line flex items-center justify-between shrink-0">
          <span className="text-sm font-medium text-ink">🧬 基因融合 · 灵魂杂交</span>
          <button onClick={onClose} className="text-gray-400 hover:text-ink text-lg leading-none">×</button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {/* 选择两个角色 */}
          {!result ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: '基因 A', val: aId, set: setAId, src: a },
                  { label: '基因 B', val: bId, set: setBId, src: b },
                ].map(({ label, val, set, src }) => (
                  <div key={label}>
                    <p className="text-xs text-gray-500 mb-1.5">{label}</p>
                    <select
                      value={val}
                      onChange={(e) => set(e.target.value)}
                      className="w-full bg-panel border border-line-strong rounded-lg px-2.5 py-2 text-xs text-ink outline-none focus:border-gene-purple"
                    >
                      <option value="">选择角色…</option>
                      {characters
                        .filter((c) => (label === '基因 A' ? c.id !== bId : c.id !== aId))
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                    </select>
                    {src && <p className="text-[10px] text-gray-500 mt-1 line-clamp-2">{src.signature}</p>}
                  </div>
                ))}
              </div>
              <button
                onClick={() => void handleFuse()}
                disabled={fusing || !a || !b || a.id === b.id}
                className="w-full py-2.5 rounded-xl bg-gradient-to-r from-gene-purple to-life-cyan text-white text-sm font-medium hover:opacity-90 transition-all disabled:opacity-30 flex items-center justify-center gap-2"
              >
                {fusing ? (
                  <>
                    <svg className="animate-spin w-4 h-4" viewBox="0 0 16 16" fill="none">
                      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeDasharray="28" strokeDashoffset="20" />
                    </svg>
                    正在融合基因序列…
                  </>
                ) : (
                  '🔀 融合两颗灵魂'
                )}
              </button>
              {error && <p className="text-xs text-red-400 text-center">{error}</p>}
            </>
          ) : (
            /* 融合结果预览：可改名/微调后再创建 */
            <>
              <p className="text-xs text-gray-500 leading-relaxed">
                融合完成——「{a?.name}」与「{b?.name}」的基因孵化出了新的灵魂。给它起个名字，也可以微调基因序列：
              </p>
              <div>
                <p className="text-xs text-gray-500 mb-1.5">名字</p>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="新灵魂的名字"
                  className="w-full bg-panel border border-line-strong rounded-lg px-3 py-2 text-sm text-ink placeholder-gray-500 outline-none focus:border-gene-purple"
                />
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1.5">一句话签名</p>
                <input
                  value={signature}
                  onChange={(e) => setSignature(e.target.value)}
                  className="w-full bg-panel border border-line-strong rounded-lg px-3 py-2 text-sm text-ink outline-none focus:border-gene-purple"
                />
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1.5">开场白</p>
                <input
                  value={greeting}
                  onChange={(e) => setGreeting(e.target.value)}
                  className="w-full bg-panel border border-line-strong rounded-lg px-3 py-2 text-sm text-ink outline-none focus:border-gene-purple"
                />
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1.5">标签（顿号分隔）</p>
                <input
                  value={tagsText}
                  onChange={(e) => setTagsText(e.target.value)}
                  className="w-full bg-panel border border-line-strong rounded-lg px-3 py-2 text-sm text-ink outline-none focus:border-gene-purple"
                />
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1.5">基因序列（System Prompt，可微调）</p>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  rows={8}
                  className="w-full bg-panel border border-line-strong rounded-lg px-3 py-2 text-xs text-ink outline-none focus:border-gene-purple resize-none leading-relaxed"
                />
              </div>
              {error && <p className="text-xs text-red-400 text-center">{error}</p>}
              <button
                onClick={() => void handleCreate()}
                disabled={creating}
                className="w-full py-2.5 rounded-xl bg-gene-purple text-white text-sm font-medium hover:bg-[#5B4BD4] transition-all disabled:opacity-30 flex items-center justify-center gap-2"
              >
                {creating ? '正在孵化…' : '✨ 孵化这个数字灵魂'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
