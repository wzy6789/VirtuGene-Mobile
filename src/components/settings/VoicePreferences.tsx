import { useSettingsStore } from '../../store/settings-store';
import { SettingsChoices, SettingsGroup, SettingsSwitch } from './SettingsUI';

export function VoicePreferences() {
  const s = useSettingsStore();
  return <>
    <SettingsGroup title="声音与回复" scope="所有聊天"><SettingsSwitch title="消息朗读" label="角色语音" detail="显示播放入口，点按后听到角色回复" checked={s.ttsEnabled} onChange={s.setTtsEnabled} /><SettingsSwitch title="以语音消息回复" label="AI 语音消息" detail="生成语音气泡，点按播放，可展开文字" checked={s.aiVoiceMode} onChange={s.setAiVoiceMode} /></SettingsGroup>
    <SettingsGroup title="朗读语速" scope="所有聊天"><SettingsChoices label="朗读语速" value={s.ttsSpeed} onChange={s.setTtsSpeed} options={[{ value: .8, title: '慢', detail: '0.8 倍速' }, { value: 1, title: '标准', detail: '1.0 倍速' }, { value: 1.2, title: '快', detail: '1.2 倍速' }]} /></SettingsGroup>
    <SettingsGroup title="声音服务"><SettingsChoices label="声音服务" value={s.ttsEngine} onChange={s.setTtsEngine} options={[{ value: 'edge', title: 'Edge', detail: '默认声音服务' }, { value: 'mimo', title: 'MiMo', detail: '需要配置 MiMo 密钥；不可用时回退到默认声音' }]} /></SettingsGroup>
  </>;
}
