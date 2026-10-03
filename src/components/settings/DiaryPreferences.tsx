import { useState } from 'react';
import { useSettingsStore, sha256 } from '../../store/settings-store';
import { setDiaryUnlocked } from '../../lib/diary-unlock';
import { PinSettingsModal } from '../diary/DiaryLock';
import { DiarySharingOverviewModal } from '../diary/DiarySharing';
import { SettingsGroup, SettingsRow, SettingsSwitch } from './SettingsUI';

export function DiaryPreferences() {
  const s = useSettingsStore();
  const [pinOpen, setPinOpen] = useState(false);
  const [sharingOpen, setSharingOpen] = useState(false);
  return <>
    <p className="vg-settings-intro">日记默认只属于你。隐私锁保护本机查看，分享授权决定哪些角色可以知道内容。</p>
    <SettingsGroup title="隐私与分享"><SettingsRow title="手账隐私锁" icon="privacy" value={s.diaryPin ? '已设置' : '未设置'} onClick={() => setPinOpen(true)} /><SettingsRow title="谁能看到我的日记" icon="account" detail="查看已分享的日记，也可以收回授权" onClick={() => setSharingOpen(true)} /></SettingsGroup>
    <SettingsGroup title="写日记提醒"><SettingsSwitch title="每日提醒" detail="当天还没写日记时提醒，每天最多一次" checked={s.diaryReminderEnabled} onChange={s.setDiaryReminderEnabled} /><label className="vg-preference-row"><span className="vg-preference-copy"><strong>提醒时间</strong></span><input aria-label="日记提醒时间" type="time" value={s.diaryReminderTime} disabled={!s.diaryReminderEnabled} onChange={e => s.setDiaryReminderTime(e.target.value)} /></label></SettingsGroup>
    <SettingsGroup title="写作辅助"><SettingsSwitch title="AI 日记辅助" detail="启用已有的润色、续写与聊天提炼功能" checked={s.diaryAiEnabled} onChange={s.setDiaryAiEnabled} /></SettingsGroup>
    <PinSettingsModal open={pinOpen} currentPin={s.diaryPin} onClose={() => setPinOpen(false)} onSave={async pin => { s.setDiaryPin(pin ? await sha256(pin) : null); setDiaryUnlocked(!!pin); setPinOpen(false); }} />
    <DiarySharingOverviewModal open={sharingOpen} onClose={() => setSharingOpen(false)} />
  </>;
}
