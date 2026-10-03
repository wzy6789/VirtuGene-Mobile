import { useEffect, useRef, useState } from 'react';
import { useAuthStore } from '../../store/auth-store';
import { useEmotionStore } from '../../store/emotion-store';
import { useSettingsStore } from '../../store/settings-store';
import { useChatStore } from '../../store/chat-store';
import { diaryRepo, todayStr } from '../../db/diary-repo';
import { DIARY_MOODS } from '../../lib/diary-utils';
import { edgeTTSSynthesize } from '../../lib/edge-tts';
import { mimoTTSSynthesize, mapEdgeVoiceToMimo } from '../../lib/mimo-tts';
import { DEFAULT_VOICE, DEFAULT_MALE_VOICE, DIALECT_VOICES } from '../../lib/voice-map';
import type { Character } from '../../db/index';
import { Modal } from '../ui/Modal';
import { Avatar } from '../ui/Avatar';
import { VoicePreferences } from '../settings/VoicePreferences';
import { AppearanceSettings } from '../settings/AppearanceSettings';
import { SettingsChoices, SettingsGroup } from '../settings/SettingsUI';

/** 心情选择网格（「更多」菜单的子视图） */
function MoodGrid({ onPick, onBack }: { onPick: (mood: number) => void; onBack: () => void }) {
  return (
    <div className="vg-chat-mood-picker px-4 py-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm text-sub">今天的心情</span>
        <button onClick={onBack} className="vg-menu-back text-xs text-sub hover:text-ink transition-colors">
          ‹ 返回
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {DIARY_MOODS.map((m) => (
          <button
            key={m.value}
            onClick={() => onPick(m.value)}
            title={m.label}
            aria-label={m.label}
            className="vg-mood-choice rounded-2xl border border-line bg-surface flex flex-col items-center justify-center gap-1 text-lg transition-colors active:bg-surface-strong"
          >
            <span aria-hidden="true">{m.emoji}</span><span className="text-xs text-sub">{m.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** 语音设置（参考电脑端设置面板「角色语音」）：总开关 + 语速 + 方言（用户手动选） + 试听 */
function TtsSettings({
  character,
  modelLabel,
  cost,
}: {
  character?: Character;
  modelLabel?: string;
  cost?: { calls: number; inputTokens: number; outputTokens: number; cost: number };
}) {
  const ttsEngine = useSettingsStore((s) => s.ttsEngine);
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

  /** 试听（按角色性别选音色；引擎跟随「朗读引擎」设置：MiMo → Edge → 系统） */
  const preview = async () => {
    if (demoBusy) return;
    const text = '你好，我是你的数字灵魂，很高兴认识你。';
    const previewVoice = roleGender === 'male' ? DEFAULT_MALE_VOICE : DEFAULT_VOICE;
    setDemoBusy(true);
    try {
      let audio: ArrayBuffer | null = null;
      if (ttsEngine === 'mimo') {
        try {
          audio = await mimoTTSSynthesize(text, { voice: mapEdgeVoiceToMimo(previewVoice.voice) });
        } catch {
          audio = null;
        }
      }
      if (!audio) {
        audio = await edgeTTSSynthesize(text, { voice: previewVoice.voice, rate: '+0%', pitch: '+0Hz' });
      }
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
    <div className="vg-settings-design vg-chat-voice-preferences">
      {character && <div className="vg-settings-profile"><Avatar avatar={character.avatar} size="lg" /><div><strong>{character.name}</strong><small>角色声线单独设置，聊天偏好影响所有角色</small></div></div>}
      <SettingsGroup title="当前角色" scope={character?.name ?? '当前角色'}>
        <div className="vg-preference-row"><span className="vg-preference-copy"><strong>角色声线</strong><small>{roleGender ? roleGender === 'male' ? '标准男声' : '标准女声，可选择方言' : '进入聊天生成声线后可调整方言'}</small></span></div>
        {roleGender === 'female' && <details><summary className="vg-preference-row">角色方言<span className="vg-preference-value ml-auto">{currentDialect === 'none' ? '标准音色' : currentDialect === 'liaoning' ? '东北话' : '陕西话'}</span></summary><SettingsChoices label="角色方言" value={currentDialect} onChange={value => { void setDialect(value); }} options={[{ value: 'none', title: '标准音色' }, { value: 'liaoning', title: '东北话' }, { value: 'shaanxi', title: '陕西话' }]} /></details>}
        {roleGender === 'male' && <p className="vg-settings-intro px-4">现有方言音色仅支持女声。</p>}
        <button type="button" onClick={() => void preview()} disabled={demoBusy} className="w-full text-sm text-life-cyan border-t border-line">{demoBusy ? '合成中…' : `试听${roleGender === 'male' ? '男声' : '女声'}默认音色`}</button>
      </SettingsGroup>
      <VoicePreferences />
      <SettingsGroup title="当前会话模型" scope="本会话">
        <div className="vg-preference-row"><span className="vg-preference-copy"><strong>{modelLabel || '默认模型'}</strong><small>本会话沿用首次选定的模型。全局默认值不会修改它。</small></span></div>
        {cost && cost.calls > 0 ? <p className="vg-settings-intro px-4">{cost.calls} 次对话 · {(cost.inputTokens / 1000).toFixed(1)}K 输入 / {(cost.outputTokens / 1000).toFixed(1)}K 输出 · 约 ¥{cost.cost.toFixed(3)}</p> : <p className="vg-settings-intro px-4">暂无消耗记录</p>}
      </SettingsGroup>
      <details className="vg-settings-form"><summary className="py-3 text-sm">外观与阅读</summary><AppearanceSettings /></details>
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
        aria-label="聊天更多操作"
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`relative w-8 h-8 flex items-center justify-center rounded-lg text-lg transition-colors ${
          open ? 'bg-gene-purple/15 text-gene-purple' : 'text-gray-400 hover:bg-surface hover:text-ink'
        }`}
      >
        <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></svg>
        {currentSnapshot && (
          <span className={`absolute top-0.5 right-0.5 w-2 h-2 rounded-full border border-app ${dotClass}`} />
        )}
        {done && <span className="absolute -top-1 -left-1 text-[9px] text-life-cyan animate-fade-in">✓</span>}
      </button>
      {open && (
        <Modal key={view} open onClose={() => setOpen(false)} onBack={view === 'settings' ? () => setView('main') : undefined} panelClassName="vg-settings-panel" mobileFullHeight={view === 'settings'} title={view === 'main' ? '聊天与偏好' : view === 'mood' ? '心情打卡' : '聊天设置'}>
          <div className="vg-chat-more-content">
            {view === 'main' ? (
              <div className="vg-settings-design vg-chat-more-actions space-y-2">
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
                  聊天设置
                </button>
              </div>
            ) : view === 'mood' ? (
              <MoodGrid onBack={() => setView('main')} onPick={(m) => void checkIn(m)} />
            ) : (
              <TtsSettings character={character} modelLabel={modelLabel} cost={cost} />
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
