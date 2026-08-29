import { useEffect, useRef, useState } from 'react';
import { useAuthStore } from '../../store/auth-store';
import { useEmotionStore } from '../../store/emotion-store';
import { useSettingsStore } from '../../store/settings-store';
import { useChatStore } from '../../store/chat-store';
import { diaryRepo, todayStr } from '../../db/diary-repo';
import { DIARY_MOODS } from '../../lib/diary-utils';
import { edgeTTSSynthesize } from '../../lib/edge-tts';
import { DEFAULT_VOICE, DEFAULT_MALE_VOICE, DIALECT_VOICES } from '../../lib/voice-map';
import type { Character } from '../../db/index';

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

/** 语音设置（参考电脑端设置面板「角色语音」）：总开关 + 语速 + 方言（用户手动选） + 试听 */
function TtsSettings({
  onBack,
  character,
  modelLabel,
  cost,
}: {
  onBack: () => void;
  character?: Character;
  modelLabel?: string;
  cost?: { calls: number; inputTokens: number; outputTokens: number; cost: number };
}) {
  const ttsEnabled = useSettingsStore((s) => s.ttsEnabled);
  const setTtsEnabled = useSettingsStore((s) => s.setTtsEnabled);
  const ttsSpeed = useSettingsStore((s) => s.ttsSpeed);
  const setTtsSpeed = useSettingsStore((s) => s.setTtsSpeed);
  const [demoBusy, setDemoBusy] = useState(false);

  /** 角色性别（由 AI 分配时判定的 band 决定） */
  const roleGender: 'male' | 'female' | undefined = character?.voice?.band
    ? character.voice.band.startsWith('male')
      ? 'male'
      : 'female'
    : undefined;
  const currentDialect = character?.voice?.voice === 'zh-CN-liaoning-XiaobeiNeural'
    ? 'liaoning'
    : character?.voice?.voice === 'zh-CN-shaanxi-XiaoniNeural'
      ? 'shaanxi'
      : 'none';

  /** 切换角色方言（仅女性角色）：无 = 该性别标准音色；东北/陕西 = 对应方言女声 */
  const setDialect = async (d: 'none' | 'liaoning' | 'shaanxi') => {
    if (!character || roleGender !== 'female') return;
    const base = { rate: character.voice?.rate ?? '+0%', pitch: character.voice?.pitch ?? '+0Hz' };
    if (d === 'none') {
      await useChatStore.getState().setCharacterVoice(character.id, { ...DEFAULT_VOICE, ...base });
      return;
    }
    const dv = DIALECT_VOICES.find((x) => x.voice === (d === 'liaoning' ? 'zh-CN-liaoning-XiaobeiNeural' : 'zh-CN-shaanxi-XiaoniNeural'));
    if (dv) await useChatStore.getState().setCharacterVoice(character.id, { voice: dv.voice, band: dv.band, ...base });
  };

  /** 试听（按角色性别选 Edge 音色：男→云扬，女→晓晓；Edge 失败 → 系统语音兜底） */
  const preview = async () => {
    if (demoBusy) return;
    const text = '你好，我是你的数字灵魂，很高兴认识你。';
    const previewVoice = roleGender === 'male' ? DEFAULT_MALE_VOICE : DEFAULT_VOICE;
    setDemoBusy(true);
    try {
      const audio = await edgeTTSSynthesize(text, { voice: previewVoice.voice, rate: '+0%', pitch: '+0Hz' });
      if (audio.byteLength > 0) {
        const url = URL.createObjectURL(new Blob([audio], { type: 'audio/mpeg' }));
        const a = new Audio(url);
        a.onended = () => URL.revokeObjectURL(url);
        void a.play();
        return;
      }
    } catch {
      /* 落入系统语音兜底 */
    } finally {
      setDemoBusy(false);
    }
    if ('speechSynthesis' in window) {
      const u = new SpeechSynthesisUtterance(text);
      const v = window.speechSynthesis.getVoices().filter((x) => x.lang.toLowerCase().startsWith('zh'))[0];
      if (v) u.voice = v;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    }
  };

  return (
    <div className="px-3 py-2.5 space-y-3 w-[248px]">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-gray-400">语音设置</span>
        <button onClick={onBack} className="text-[10px] text-gray-400 hover:text-ink transition-colors">
          ‹ 返回
        </button>
      </div>

      {/* 当前模型 + 本角色消耗统计 */}
      <div className="rounded-lg bg-panel/60 border border-line px-3 py-2 space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-xs text-ink">对话模型</span>
          <span className="text-[11px] text-gene-purple truncate max-w-[55%]">{modelLabel || '默认'}</span>
        </div>
        {cost && cost.calls > 0 ? (
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-gray-500">本角色已消耗</span>
            <span className="text-[10px] text-gray-500">
              {cost.calls} 次 · {(cost.inputTokens / 1000).toFixed(1)}K 入 / {(cost.outputTokens / 1000).toFixed(1)}K 出 · 约 ¥{cost.cost.toFixed(3)}
            </span>
          </div>
        ) : (
          <p className="text-[10px] text-gray-400">暂无消耗记录</p>
        )}
      </div>

      {/* 语音总开关 */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-ink">角色语音</span>
        <button
          onClick={() => setTtsEnabled(!ttsEnabled)}
          title={ttsEnabled ? '已开启' : '已关闭'}
          className={`relative w-11 h-6 rounded-full transition-colors ${ttsEnabled ? 'bg-gene-purple' : 'bg-gray-300'}`}
        >
          <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${ttsEnabled ? 'left-[22px]' : 'left-0.5'}`} />
        </button>
      </div>
      <p className="text-[10px] text-gray-500 leading-relaxed">
        关闭后消息不再显示 🔊，点击也不会发声。语音由 AI 按角色形象挑选声线（先判男女再选性格），仅在你点击时合成。
      </p>

      {/* 朗读语速 */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-ink">朗读语速</span>
        <div className="flex rounded-lg border border-line overflow-hidden">
          {[[0.8, '慢'], [1.0, '标准'], [1.2, '快']].map(([v, l]) => (
            <button
              key={v}
              onClick={() => setTtsSpeed(Number(v))}
              className={`px-3 py-1.5 text-xs transition-colors ${ttsSpeed === Number(v) ? 'bg-gene-purple/15 text-gene-purple' : 'text-gray-500 hover:text-ink'}`}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      {/* 角色方言（用户手动选择；AI 不自动分配方言） */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs text-ink">角色方言</span>
          {roleGender === 'female' && currentDialect !== 'none' && (
            <span className="text-[10px] text-life-cyan">当前角色使用中</span>
          )}
        </div>
        {roleGender === 'female' ? (
          <div className="flex rounded-lg border border-line overflow-hidden">
            {[['none', '无'], ['liaoning', '东北话'], ['shaanxi', '陕西话']].map(([k, l]) => (
              <button
                key={k}
                onClick={() => void setDialect(k as 'none' | 'liaoning' | 'shaanxi')}
                className={`flex-1 px-3 py-1.5 text-xs transition-colors ${currentDialect === k ? 'bg-gene-purple/15 text-gene-purple' : 'text-gray-500 hover:text-ink'}`}
              >
                {l}
              </button>
            ))}
          </div>
        ) : (
          <p className="text-[10px] text-gray-500 leading-relaxed">
            {roleGender === 'male'
              ? '方言音色目前仅有女声（东北话/陕西话），男角色不可设置'
              : '进入聊天生成声线后，可在此设置角色方言'}
          </p>
        )}
      </div>

      {/* 试听（按角色性别） */}
      <button
        onClick={() => void preview()}
        disabled={demoBusy}
        className="w-full px-4 py-2 rounded-lg text-xs text-ink bg-surface border border-line-strong hover:border-life-cyan/50 transition-colors disabled:opacity-40"
      >
        {demoBusy ? '合成中…' : `试听${roleGender === 'male' ? '男声' : '女声'}默认音色`}
      </button>
      <p className="text-[10px] text-gray-500">默认音色为 Edge 微软声线（男声云扬 / 女声晓晓），失败才用系统语音兜底。云端识别 Key 在「我的 → 设置 → 语音」配置。</p>
    </div>
  );
}

/**
 * 聊天页顶部「⋯」更多菜单（仅手机端）：收纳 情绪图谱 + 心情打卡 + 语音设置，
 * 让聊天头部只保留角色名，微信式简洁。情绪有数据时按钮右上角显示状态小点。
 */
export function ChatHeaderMoreMenu({
  character,
  modelLabel,
  cost,
}: {
  character?: Character;
  modelLabel?: string;
  cost?: { calls: number; inputTokens: number; outputTokens: number; cost: number };
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<'main' | 'mood' | 'settings'>('main');
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
          <div className="absolute right-0 top-full mt-1 z-50 min-w-[170px] glass-card rounded-xl shadow-xl animate-fade-in overflow-hidden">
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
                <div className="h-px bg-line my-1" />
                <button
                  onClick={() => setView('settings')}
                  className="w-full flex items-center gap-2.5 px-4 py-3 text-sm text-sub hover:bg-surface transition-colors"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400 shrink-0">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                  </svg>
                  设置
                </button>
              </div>
            ) : view === 'mood' ? (
              <MoodGrid onBack={() => setView('main')} onPick={(m) => void checkIn(m)} />
            ) : (
              <TtsSettings onBack={() => setView('main')} character={character} modelLabel={modelLabel} cost={cost} />
            )}
          </div>
        </>
      )}
    </div>
  );
}
