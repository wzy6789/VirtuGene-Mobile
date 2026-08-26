import { useEffect, useState } from 'react';
import { useChatStore } from '../../store/chat-store';
import { useAuthStore } from '../../store/auth-store';
import { characterRepo } from '../../db/character-repo';
import type { Character } from '../../db/index';

interface OnboardingModalProps {
  open: boolean;
  onClose: () => void;
}

function pickRecommended(presets: Character[]): Character | undefined {
  if (presets.length === 0) return undefined;
  const eligible = presets.filter((c) => {
    const p = c.proactivity ?? 0.5;
    return p >= 0.4 && p <= 0.8;
  });
  const gentle = eligible.filter((c) =>
    c.tags.some((t) => /温柔|开朗|温暖|治愈|元气|活泼|浪漫|好奇/.test(t)),
  );
  const pool = gentle.length > 0 ? gentle : eligible.length > 0 ? eligible : presets;
  return pool[Math.floor(Math.random() * pool.length)];
}

export function OnboardingModal({ open, onClose }: OnboardingModalProps) {
  const [recommended, setRecommended] = useState<Character | null>(null);
  const [starting, setStarting] = useState(false);
  const userId = useAuthStore((s) => s.userId) ?? '';
  const characters = useChatStore((s) => s.characters);
  const createCharacter = useChatStore((s) => s.createCharacter);
  const selectCharacter = useChatStore((s) => s.selectCharacter);

  useEffect(() => {
    if (!open) return;
    // 已有自有角色则只欢迎不推荐
    if (characters.length > 0) {
      setRecommended(null);
      return;
    }
    characterRepo.getPresets().then((presets) => setRecommended(pickRecommended(presets) ?? null));
  }, [open, characters.length]);

  const startChat = async () => {
    if (recommended) {
      setStarting(true);
      const mine = await characterRepo.getByCreator(userId);
      const existing = mine.find((c) => c.sourcePresetId === recommended.id);
      if (existing) {
        await selectCharacter(existing.id);
      } else {
        await createCharacter({
          name: recommended.name,
          avatar: recommended.avatar,
          systemPrompt: recommended.systemPrompt,
          tags: recommended.tags,
          signature: recommended.signature,
          greeting: recommended.greeting,
          sourcePresetId: recommended.id,
          isPreset: false,
          isCustom: false,
          published: false,
          createdBy: userId,
          proactivity: recommended.proactivity,
        });
      }
      setStarting(false);
    }
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="dna-bg glass-card w-[380px] rounded-3xl border-gene-purple/30 p-8 animate-fade-in relative overflow-hidden">
        {/* 顶部品牌光带 */}
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-life-cyan/70 to-transparent" />
        {/* DNA 光晕装饰 */}
        <div className="absolute -top-16 -right-16 w-48 h-48 rounded-full bg-gene-purple/20 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-16 -left-16 w-48 h-48 rounded-full bg-life-cyan/15 blur-3xl pointer-events-none" />

        <div className="relative">
          {/* Logo + 口号 */}
          <div className="flex flex-col items-center text-center mb-6">
            <span className="text-4xl mb-3">🧬</span>
            <h1 className="text-xl font-bold text-ink tracking-wide">
              Unlock Your Digital Soul
            </h1>
            <p className="text-sm text-gray-500 mt-2">解锁你的数字灵魂</p>
          </div>

          <p className="text-center text-xs text-gray-400 leading-relaxed mb-6">
            这里住着有灵魂的角色，
            <br />
            和 Ta 像微信一样聊天吧。
          </p>

          {/* 推荐角色 */}
          {recommended && (
            <div className="rounded-2xl border border-line bg-surface/60 p-4 mb-5 flex items-center gap-3">
              {recommended.avatar.startsWith('data:') ? (
                <div className="relative shrink-0">
                  <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-gene-purple to-life-cyan opacity-40 blur-[3px]" />
                  <img
                    src={recommended.avatar}
                    alt={recommended.name}
                    className="relative w-12 h-12 rounded-xl object-cover ring-1 ring-gene-purple/20"
                  />
                </div>
              ) : (
                <div className="relative shrink-0">
                  <div className="absolute inset-0 rounded-xl bg-gene-purple/30 blur-[3px]" />
                  <div className="relative w-12 h-12 rounded-xl bg-gradient-to-br from-[#2A2A48] to-[#0A0A14] flex items-center justify-center text-2xl ring-1 ring-gene-purple/30">
                    {recommended.avatar}
                  </div>
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-ink">{recommended.name}</span>
                </div>
                {recommended.signature && (
                  <p className="text-[11px] text-gray-500 line-clamp-1 mt-0.5">
                    {recommended.signature}
                  </p>
                )}
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {recommended.tags.slice(0, 3).map((tag) => (
                    <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded bg-surface text-gray-400">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* 按钮 */}
          <div className="space-y-2">
            <button
              onClick={startChat}
              disabled={starting}
              className="w-full py-2.5 rounded-xl bg-gradient-to-r from-gene-purple to-life-cyan hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium text-white transition-all"
            >
              {starting ? '正在唤醒…' : '开始聊天'}
            </button>
            <button
              onClick={onClose}
              className="w-full py-2 text-xs text-gray-500 hover:text-sub transition-colors"
            >
              稍后再说
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
