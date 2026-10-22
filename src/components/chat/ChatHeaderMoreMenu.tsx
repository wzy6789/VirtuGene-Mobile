import { Suspense, useEffect, useRef, useState } from 'react';
import { lazyFeature } from '../ui/lazyFeature';
import { useAuthStore } from '../../store/auth-store';
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
import { FeedbackNotice } from '../ui/FeedbackNotice';
import { ChatAppearanceSettings } from './ChatAppearanceSettings';

const VoiceCallHistory = lazyFeature(() => import('./VoiceCallHistory').then(module => ({ default: module.VoiceCallHistory })));

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
  const [playing, setPlaying] = useState(false);
  const [voiceError, setVoiceError] = useState('');
  const [dialectBusy, setDialectBusy] = useState(false);
  const [dialectFeedback, setDialectFeedback] = useState('');
  const dialectLock = useRef(false);
  const mounted = useRef(true);
  const generation = useRef(0);
  const previewActive = useRef(false);
  const media = useRef<HTMLAudioElement | null>(null);
  const mediaUrl = useRef<string | null>(null);
  const utterance = useRef<SpeechSynthesisUtterance | null>(null);
  const owner = useAuthStore(s => s.userId);
  const cleanupPreview = () => {
    generation.current++;
    previewActive.current = false;
    if (media.current) {
      media.current.onended = media.current.onerror = null;
      media.current.pause();
      media.current.removeAttribute('src');
      media.current.load();
      media.current = null;
    }
    if (mediaUrl.current) URL.revokeObjectURL(mediaUrl.current);
    mediaUrl.current = null;
    if (utterance.current) {
      utterance.current.onend = utterance.current.onerror = null;
      utterance.current = null;
      window.speechSynthesis?.cancel();
    }
  };
  useEffect(() => {
    mounted.current = true;
    const stop = () => {
      cleanupPreview();
      setDemoBusy(false);
      setPlaying(false);
    };
    const visibility = () => { if (document.hidden) stop(); };
    document.addEventListener('visibilitychange', visibility);
    const unsubscribe = useAuthStore.subscribe((state, previous) => {
      if (state.userId !== previous.userId) stop();
    });
    return () => {
      mounted.current = false;
      cleanupPreview();
      document.removeEventListener('visibilitychange', visibility);
      unsubscribe();
    };
  }, []);

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
    if (!character || roleGender !== 'female' || dialectLock.current) return;
    dialectLock.current = true;
    setDialectBusy(true);
    setDialectFeedback('');
    const base = { rate: character.voice?.rate ?? '+0%', pitch: character.voice?.pitch ?? '+0Hz' };
    try {
    if (d === 'none') {
      await useChatStore.getState().setCharacterVoice(character.id, { ...DEFAULT_VOICE, ...base });
    } else {
      const dv = DIALECT_VOICES.find((x) => x.voice === (d === 'liaoning' ? 'zh-CN-liaoning-XiaobeiNeural' : 'zh-CN-shaanxi-XiaoniNeural'));
      if (dv) await useChatStore.getState().setCharacterVoice(character.id, { voice: dv.voice, band: dv.band, ...base });
    }
    } catch {
      if (mounted.current && useAuthStore.getState().userId === owner) setDialectFeedback('方言未保存，请再试一次。');
    } finally {
      dialectLock.current = false;
      if (mounted.current && useAuthStore.getState().userId === owner) setDialectBusy(false);
    }
  };

  /** 试听（按角色性别选音色；引擎跟随「朗读引擎」设置：MiMo → Edge → 系统） */
  const preview = async () => {
    if (previewActive.current) {
      cleanupPreview();
      setDemoBusy(false);
      setPlaying(false);
      return;
    }
    const ticket = ++generation.current;
    previewActive.current = true;
    const current = () => mounted.current && ticket === generation.current && owner === useAuthStore.getState().userId;
    const finish = (error = '') => {
      if (!current()) return;
      cleanupPreview();
      setDemoBusy(false);
      setPlaying(false);
      setVoiceError(error);
    };
    const text = '你好，我是你的数字灵魂，很高兴认识你。';
    const previewVoice = roleGender === 'male' ? DEFAULT_MALE_VOICE : DEFAULT_VOICE;
    setDemoBusy(true);
    setVoiceError('');
    try {
      let audio: ArrayBuffer | null = null;
      if (ttsEngine === 'mimo') {
        try {
          audio = await mimoTTSSynthesize(text, { voice: mapEdgeVoiceToMimo(previewVoice.voice) });
        } catch {
          audio = null;
        }
      }
      if (!current()) return;
      if (!audio) {
        audio = await edgeTTSSynthesize(text, { voice: previewVoice.voice, rate: '+0%', pitch: '+0Hz' });
      }
      if (!current()) return;
      if (audio.byteLength > 0) {
        const url = URL.createObjectURL(new Blob([audio], { type: 'audio/mpeg' }));
        const a = new Audio(url);
        mediaUrl.current = url;
        media.current = a;
        a.onended = () => finish();
        a.onerror = () => finish('试听播放失败，请再试一次。');
        await a.play();
        if (!current()) return;
        setDemoBusy(false);
        setPlaying(true);
        return;
      }
    } catch {
      /* 落入系统语音兜底 */
    }
    if (!current()) return;
    // A rejected play promise also needs its object URL released before fallback.
    cleanupPreview();
    const fallbackTicket = generation.current;
    previewActive.current = true;
    if ('speechSynthesis' in window) {
      const u = new SpeechSynthesisUtterance(text);
      const v = window.speechSynthesis.getVoices().filter((x) => x.lang.toLowerCase().startsWith('zh'))[0];
      if (v) u.voice = v;
      utterance.current = u;
      const done = (error = '') => {
        if (!mounted.current || generation.current !== fallbackTicket) return;
        cleanupPreview();
        setDemoBusy(false);
        setPlaying(false);
        setVoiceError(error);
      };
      u.onend = () => done();
      u.onerror = () => done('系统语音暂时无法试听，请再试一次。');
      try {
        window.speechSynthesis.speak(u);
        setDemoBusy(false);
        setPlaying(true);
      } catch { done('系统语音暂时无法试听，请再试一次。'); }
    } else {
      previewActive.current = false;
      setDemoBusy(false);
      setVoiceError('当前设备暂时无法试听，请稍后再试。');
    }
  };

  return (
    <div className="vg-settings-design vg-chat-voice-preferences">
      {character && <div className="vg-settings-profile"><Avatar avatar={character.avatar} size="lg" /><div><strong>{character.name}</strong><small>角色声线与聊天配色单独保存；阅读偏好影响所有角色</small></div></div>}
      {character && <ChatAppearanceSettings character={character}/>}
      <OrbColorPicker />
      <SettingsGroup title="当前角色" scope={character?.name ?? '当前角色'}>
        <div className="vg-preference-row"><span className="vg-preference-copy"><strong>角色声线</strong><small>{roleGender ? roleGender === 'male' ? '标准男声' : '标准女声，可选择方言' : '进入聊天生成声线后可调整方言'}</small></span></div>
        {roleGender === 'female' && <details><summary className="vg-preference-row">角色方言<span className="vg-preference-value ml-auto">{dialectBusy ? '正在保存…' : currentDialect === 'none' ? '标准音色' : currentDialect === 'liaoning' ? '东北话' : '陕西话'}</span></summary><SettingsChoices disabled={dialectBusy} label="角色方言" value={currentDialect} onChange={value => { void setDialect(value); }} options={[{ value: 'none', title: '标准音色' }, { value: 'liaoning', title: '东北话' }, { value: 'shaanxi', title: '陕西话' }]} /></details>}
        {dialectFeedback && <FeedbackNotice tone="error" message={dialectFeedback} />}
        {roleGender === 'male' && <p className="vg-settings-intro px-4">现有方言音色仅支持女声。</p>}
        <button type="button" onClick={() => void preview()} className="vg-chat-voice-preview"><Icon name="volume" size={18}/><span>{demoBusy ? '取消准备试听' : playing ? '停止试听' : `试听${roleGender === 'male' ? '男声' : '女声'}默认音色`}</span></button>
        {voiceError && <FeedbackNotice tone="error" message={voiceError} />}
      </SettingsGroup>
      <VoicePreferences />
      <SettingsGroup title="当前会话模型" scope="本会话">
        <div className="vg-preference-row"><span className="vg-preference-copy"><strong>{modelLabel || '默认模型'}</strong></span></div>
        {cost && cost.calls > 0 ? <p className="vg-settings-intro px-4">{cost.calls} 次请求 · {(cost.inputTokens / 1000).toFixed(1)}K 输入 / {(cost.outputTokens / 1000).toFixed(1)}K 输出 · {cost.incomplete||!cost.perAttemptAccounting?'已知部分约':'约'} ¥{cost.cost.toFixed(3)}{cost.unknownUsageCalls?` · ${cost.unknownUsageCalls} 次未返回用量`:cost.incomplete||!cost.perAttemptAccounting?' · 统计可能不完整':''}</p> : <p className="vg-settings-intro px-4">暂无消耗记录</p>}
      </SettingsGroup>
      <details className="vg-settings-form vg-chat-reading"><summary><Icon name="moon" size={20}/><span><strong>全局外观与阅读</strong><small>调整应用深浅色、字号与动效</small></span><Icon name="chevron" size={16}/></summary><AppearanceSettings includeOrbColor={false} /></details>
    </div>
  );
}

/** Direct chat settings entry; emotion and memory belong to the role orb. */
export function ChatHeaderMoreMenu({character,sessionId,modelLabel,cost,onVoiceCall,callLabel,callDisabled=false}:{
  character?:Character;
  sessionId?:string;
  modelLabel?:string;
  cost?:Session['cost'];
  onVoiceCall?:()=>void;
  callLabel?:string;
  callDisabled?:boolean;
}){
  const [open,setOpen]=useState(false);
  const [historyOpen,setHistoryOpen]=useState(false);
  const owner = useAuthStore(s => s.userId);
  return <div className="relative shrink-0">
    <button type="button" title="聊天设置" aria-label="聊天设置" aria-haspopup="dialog" aria-expanded={open} onClick={()=>setOpen(true)} className="flex h-11 w-11 items-center justify-center rounded-xl text-sub hover:bg-surface">
      <Icon name="gear" size={21}/>
    </button>
    {open && <Modal open onClose={()=>setOpen(false)} canSnapshotOnExit={()=>useAuthStore.getState().userId===owner} panelClassName="vg-settings-panel" mobileFullHeight title="聊天设置">
      <div className="vg-chat-more-content">
        {character && onVoiceCall && <div className="vg-settings-design"><SettingsGroup title="聊天操作" scope="本会话">
          <button type="button" disabled={callDisabled} aria-label={callLabel ?? `与${character.name}语音通话`} className="vg-preference-row w-full text-left disabled:opacity-40" onClick={()=>{
            if(callDisabled || useAuthStore.getState().userId!==owner)return;
            setOpen(false);onVoiceCall();
          }}><Icon name="phone" size={20}/><span className="vg-preference-copy"><strong>语音通话</strong><small>{callLabel?.startsWith('返回') ? callLabel : `和${character.name}聊一会儿`}</small></span><Icon name="chevron" size={16}/></button>
          {sessionId && owner && <button type="button" aria-label="本会话通话记录" className="vg-preference-row w-full text-left" onClick={() => {
            const current = useChatStore.getState();
            if (useAuthStore.getState().userId !== owner || current.currentSessionId !== sessionId || current.selectedCharacterId !== character.id) return;
            setOpen(false); setHistoryOpen(true);
          }}><Icon name="clock" size={20}/><span className="vg-preference-copy"><strong>通话记录</strong><small>查看本会话的交流原文与摘要</small></span><Icon name="chevron" size={16}/></button>}
        </SettingsGroup></div>}
        <TtsSettings key={`${owner}:${character?.id ?? 'none'}`} character={character} modelLabel={modelLabel} cost={cost}/>
      </div>
    </Modal>}
    {historyOpen && character && sessionId && owner && <Suspense fallback={<p role="status">正在打开通话记录…</p>}><VoiceCallHistory sessionId={sessionId} userId={owner} name={character.name} onClose={() => setHistoryOpen(false)}/></Suspense>}
  </div>;
}
