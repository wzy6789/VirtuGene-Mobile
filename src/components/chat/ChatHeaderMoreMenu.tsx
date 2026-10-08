import { useState } from 'react';
import { useSettingsStore } from '../../store/settings-store';
import { useChatStore } from '../../store/chat-store';
import { edgeTTSSynthesize } from '../../lib/edge-tts';
import { mimoTTSSynthesize, mapEdgeVoiceToMimo } from '../../lib/mimo-tts';
import { DEFAULT_VOICE, DEFAULT_MALE_VOICE, DIALECT_VOICES } from '../../lib/voice-map';
import type { Character,Session } from '../../db/index';
import { Modal } from '../ui/Modal';
import { Avatar } from '../ui/Avatar';
import { VoicePreferences } from '../settings/VoicePreferences';
import { AppearanceSettings } from '../settings/AppearanceSettings';
import { SettingsChoices, SettingsGroup } from '../settings/SettingsUI';
import { Icon } from '../ui/Icon';
import { OrbColorPicker } from '../settings/OrbColorPicker';

/** 语音设置（参考电脑端设置面板「角色语音」）：总开关 + 语速 + 方言（用户手动选） + 试听 */
function TtsSettings({
  character,
  modelLabel,
  cost,
}: {
  character?: Character;
  modelLabel?: string;
  cost?: Session['cost'];
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
      <OrbColorPicker />
      <SettingsGroup title="当前角色" scope={character?.name ?? '当前角色'}>
        <div className="vg-preference-row"><span className="vg-preference-copy"><strong>角色声线</strong><small>{roleGender ? roleGender === 'male' ? '标准男声' : '标准女声，可选择方言' : '进入聊天生成声线后可调整方言'}</small></span></div>
        {roleGender === 'female' && <details><summary className="vg-preference-row">角色方言<span className="vg-preference-value ml-auto">{currentDialect === 'none' ? '标准音色' : currentDialect === 'liaoning' ? '东北话' : '陕西话'}</span></summary><SettingsChoices label="角色方言" value={currentDialect} onChange={value => { void setDialect(value); }} options={[{ value: 'none', title: '标准音色' }, { value: 'liaoning', title: '东北话' }, { value: 'shaanxi', title: '陕西话' }]} /></details>}
        {roleGender === 'male' && <p className="vg-settings-intro px-4">现有方言音色仅支持女声。</p>}
        <button type="button" onClick={() => void preview()} disabled={demoBusy} className="w-full text-sm text-life-cyan border-t border-line">{demoBusy ? '合成中…' : `试听${roleGender === 'male' ? '男声' : '女声'}默认音色`}</button>
      </SettingsGroup>
      <VoicePreferences />
      <SettingsGroup title="当前会话模型" scope="本会话">
        <div className="vg-preference-row"><span className="vg-preference-copy"><strong>{modelLabel || '默认模型'}</strong><small>本会话沿用首次选定的模型。全局默认值不会修改它。</small></span></div>
        {cost && cost.calls > 0 ? <p className="vg-settings-intro px-4">{cost.calls} 次请求 · {(cost.inputTokens / 1000).toFixed(1)}K 输入 / {(cost.outputTokens / 1000).toFixed(1)}K 输出 · {cost.incomplete||!cost.perAttemptAccounting?'已知部分约':'约'} ¥{cost.cost.toFixed(3)}{cost.unknownUsageCalls?` · ${cost.unknownUsageCalls} 次未返回用量`:cost.incomplete||!cost.perAttemptAccounting?' · 统计可能不完整':''}</p> : <p className="vg-settings-intro px-4">暂无消耗记录</p>}
      </SettingsGroup>
      <details className="vg-settings-form"><summary className="py-3 text-sm">外观与阅读</summary><AppearanceSettings includeOrbColor={false} /></details>
    </div>
  );
}

/** Direct chat settings entry; emotion and memory belong to the role orb. */
export function ChatHeaderMoreMenu({character,modelLabel,cost}:{
  character?:Character;
  modelLabel?:string;
  cost?:Session['cost'];
}){
  const [open,setOpen]=useState(false);
  return <div className="relative">
    <button type="button" title="聊天设置" aria-label="聊天设置" aria-haspopup="dialog" aria-expanded={open} onClick={()=>setOpen(true)} className="flex h-11 w-11 items-center justify-center rounded-xl text-sub hover:bg-surface">
      <Icon name="gear" size={21}/>
    </button>
    {open && <Modal open onClose={()=>setOpen(false)} panelClassName="vg-settings-panel" mobileFullHeight title="聊天设置">
      <div className="vg-chat-more-content"><TtsSettings character={character} modelLabel={modelLabel} cost={cost}/></div>
    </Modal>}
  </div>;
}
