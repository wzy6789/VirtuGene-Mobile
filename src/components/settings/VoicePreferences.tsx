import { useSettingsStore } from '../../store/settings-store';
import { SettingsChoices, SettingsGroup, SettingsRow, SettingsSwitch } from './SettingsUI';
import { Modal } from '../ui/Modal';
import { useEffect, useState } from 'react';
import { clearSecret, loadSecret, persistSecret } from '../../lib/api-key-storage';
import { normalizedMimoKey, loadMimoKey } from '../../lib/voice-call/key';

export function VoicePreferences() {
  const s = useSettingsStore();
  const [key, setKey] = useState('');
  const [configured, setConfigured] = useState(false);
  const [status, setStatus] = useState('');
  const [saving, setSaving] = useState(false);
  const [choice, setChoice] = useState<'speed' | 'engine' | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const [unreadable, setUnreadable] = useState(false);
  useEffect(() => { let live = true; void loadMimoKey().then(value => { if (live) setConfigured(!!value); }).catch(() => {
    if (live) { setConfigured(true); setUnreadable(true); setStatus('本机保存的密钥无法读取，请重新填写并保存。'); }
  }); return () => { live = false; }; }, []);
  const save = async () => {
    if (!key.trim() || saving) return;
    setSaving(true); setStatus('');
    try {
      const value = normalizedMimoKey(key);
      if (!value) { setStatus('密钥包含空格、换行或不可见字符，请只复制完整 API Key，不包含 Bearer 或其他说明。'); return; }
      await persistSecret('mimo-key', value);
      if (await loadSecret('mimo-key') !== value) { setStatus('密钥未能保存，请重试。'); return; }
      setKey(''); setConfigured(true); setUnreadable(false); setStatus('已加密保存到本机；尚未验证服务连接。');
    } finally { setSaving(false); }
  };
  return <>
    <SettingsGroup title="声音与回复" scope="所有聊天"><SettingsSwitch title="消息朗读" checked={s.ttsEnabled} onChange={s.setTtsEnabled} /><SettingsSwitch title="语音回复" checked={s.aiVoiceMode} onChange={s.setAiVoiceMode} /></SettingsGroup>
    <SettingsGroup title="朗读偏好" scope="所有聊天">
      <SettingsRow title="朗读语速" value={s.ttsSpeed === .8 ? '慢 · 0.8×' : s.ttsSpeed === 1.2 ? '快 · 1.2×' : `标准 · ${s.ttsSpeed}×`} onClick={() => setChoice('speed')} />
      <SettingsRow title="声音服务" value={s.ttsEngine === 'mimo' ? 'MiMo' : 'Edge'} onClick={() => setChoice('engine')} />
    </SettingsGroup>
    <SettingsGroup title="高级语音">
      <button type="button" className="vg-preference-row" aria-expanded={advanced} aria-controls="mimo-voice-configuration" onClick={() => setAdvanced(value => !value)}><span className="vg-preference-row-content"><span className="vg-preference-copy"><strong>MiMo 语音密钥</strong><small>用于 MiMo 朗读与语音通话</small></span><span className="vg-preference-value">{unreadable ? '需要重填' : configured ? '本机已保存' : '未配置'}</span></span></button>
      <div id="mimo-voice-configuration" hidden={!advanced} className="vg-voice-secret">
        <p className="text-sm leading-7 text-sub mb-3">密钥仅保存在本机，保存不代表已连接。调用语音服务可能产生费用。</p>
        <label className="vg-settings-field">MiMo API Key<input type="password" autoComplete="off" autoCapitalize="none" spellCheck={false} data-sensitive value={key} onChange={event => setKey(event.target.value)} placeholder={configured ? '输入新密钥可替换' : '填写 api.xiaomimimo.com 的密钥'}/></label>
        <div className="flex flex-wrap gap-3 mt-3"><button type="button" className="vg-button vg-button-secondary" disabled={!key.trim() || saving} onClick={() => void save()}>{saving ? '保存中…' : '加密保存'}</button>{configured && <button type="button" className="vg-button vg-button-ghost" disabled={saving} onClick={() => { clearSecret('mimo-key'); setKey(''); setConfigured(false); setUnreadable(false); setStatus('已清除本机密钥。'); }}>清除密钥</button>}</div>
        {status&&<p role="status" className="text-xs text-sub mt-3">{status}</p>}
      </div>
    </SettingsGroup>
    <Modal presentation="dialog" panelClassName="vg-settings-panel vg-voice-choice-dialog" width="max-w-sm" open={choice !== null} onClose={() => setChoice(null)} title={choice === 'speed' ? '朗读语速' : '声音服务'} canSnapshotOnExit={() => false}>
      <div className="vg-settings-design">
        {choice === 'speed' && <SettingsChoices label="朗读语速" value={s.ttsSpeed} onChange={value => { s.setTtsSpeed(value); setChoice(null); }} options={[{ value: .8, title: '慢 · 0.8×' }, { value: 1, title: '标准 · 1×' }, { value: 1.2, title: '快 · 1.2×' }]} />}
        {choice === 'engine' && <SettingsChoices label="声音服务" value={s.ttsEngine} onChange={value => { s.setTtsEngine(value); setChoice(null); if (value === 'mimo' && (!configured || unreadable)) setAdvanced(true); }} options={[{ value: 'edge', title: 'Edge' }, { value: 'mimo', title: 'MiMo', detail: unreadable ? '本机密钥需要重填' : configured ? '本机已保存密钥，未验证连接' : '需配置密钥' }]} />}
      </div>
    </Modal>
  </>;
}
