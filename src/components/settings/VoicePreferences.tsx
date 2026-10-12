import { useSettingsStore } from '../../store/settings-store';
import { SettingsChoices, SettingsGroup, SettingsSwitch } from './SettingsUI';
import { useEffect, useState } from 'react';
import { clearSecret, loadSecret, persistSecret } from '../../lib/api-key-storage';

export function VoicePreferences() {
  const s = useSettingsStore();
  const [key, setKey] = useState('');
  const [configured, setConfigured] = useState(false);
  const [status, setStatus] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { let live = true; void loadSecret('mimo-key').then(value => { if (live) setConfigured(!!value); }); return () => { live = false; }; }, []);
  const save = async () => {
    if (!key.trim() || saving) return;
    setSaving(true); setStatus('');
    try {
      const value = key.trim(); await persistSecret('mimo-key', value);
      if (await loadSecret('mimo-key') !== value) { setStatus('密钥未能保存，请重试。'); return; }
      setKey(''); setConfigured(true); setStatus('已加密保存到本机；尚未验证服务连接。');
    } finally { setSaving(false); }
  };
  return <>
    <SettingsGroup title="声音与回复" scope="所有聊天"><SettingsSwitch title="消息朗读" label="角色语音" detail="显示播放入口，点按后听到角色回复" checked={s.ttsEnabled} onChange={s.setTtsEnabled} /><SettingsSwitch title="以语音消息回复" label="AI 语音消息" detail="生成语音气泡，点按播放，可展开文字" checked={s.aiVoiceMode} onChange={s.setAiVoiceMode} /></SettingsGroup>
    <SettingsGroup title="朗读语速" scope="所有聊天"><SettingsChoices label="朗读语速" value={s.ttsSpeed} onChange={s.setTtsSpeed} options={[{ value: .8, title: '慢', detail: '0.8 倍速' }, { value: 1, title: '标准', detail: '1.0 倍速' }, { value: 1.2, title: '快', detail: '1.2 倍速' }]} /></SettingsGroup>
    <SettingsGroup title="声音服务"><SettingsChoices label="声音服务" value={s.ttsEngine} onChange={s.setTtsEngine} options={[{ value: 'edge', title: 'Edge', detail: '默认声音服务' }, { value: 'mimo', title: 'MiMo', detail: '需要配置 MiMo 密钥；不可用时回退到默认声音' }]} /></SettingsGroup>
    <SettingsGroup title="MiMo 语音通话" scope="本机密钥">
      <div className="vg-settings-form p-4"><label className="block text-sm">MiMo API Key<input className="block w-full mt-2" type="password" autoComplete="off" value={key} onChange={event => setKey(event.target.value)} placeholder={configured ? '已配置，输入可替换' : '填写 api.xiaomimimo.com 的密钥'}/></label>
      <div className="flex gap-3 mt-3"><button type="button" disabled={!key.trim() || saving} onClick={() => void save()}>{saving ? '保存中…' : '加密保存'}</button>{configured && <button type="button" onClick={() => { clearSecret('mimo-key'); setKey(''); setConfigured(false); setStatus('已清除本机密钥。'); }}>清除密钥</button>}</div>
      <p role="status" className="text-xs text-sub mt-3">{status || '通话使用 ASR / Flash / TTS；不会自动调用最贵的模型或切换其他语音服务。'}</p></div>
    </SettingsGroup>
  </>;
}
