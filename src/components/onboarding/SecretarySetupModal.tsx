import { useEffect, useId, useRef, useState } from 'react';
import { Modal } from '../ui/Modal';
import { useAuthStore } from '../../store/auth-store';
import { createSecretary, findSecretary, openSecretary, SECRETARY_INTRO_PREFIX } from '../../lib/secretary/character';
import { DEFAULT_SECRETARY_PERSONALITY, secretaryPersonality, type SecretaryPersonality } from '../../lib/secretary/personality';
import { SecretaryPersonalitySelector } from '../secretary/SecretaryPersonalitySelector';
import { db } from '../../db';
import type { Character } from '../../db';
import { SecretaryManagementModal } from '../secretary/SecretaryManagementModal';
import { SecretaryAppearanceSelector } from '../secretary/SecretaryAppearanceSelector';
import { DEFAULT_SECRETARY_APPEARANCE, type SecretaryAppearance } from '../../lib/secretary/appearance';
import { SecretaryIcon, type SecretaryIconName } from '../secretary/SecretaryIcon';
import { LoadingSkeleton } from '../ui/LoadingSkeleton';
import { FeedbackNotice } from '../ui/FeedbackNotice';
import { SettingsField } from '../settings/SettingsUI';
import '../../styles/assistant-preferences.css';

export function SecretarySetupModal({ open, onClose, welcome = false }: { open: boolean; onClose: () => void; welcome?: boolean }) {
  const userId = useAuthStore(s => s.userId) ?? '';
  return open && userId ? <SecretarySetup key={userId} userId={userId} onClose={onClose} welcome={welcome} /> : null;
}

function SecretarySetup({ userId, onClose, welcome }: { userId: string; onClose: () => void; welcome: boolean }) {
  const formId = useId();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [existingCharacter, setExistingCharacter] = useState<Character>();
  const [revision, setRevision] = useState<number>();
  const [personalityLocked, setPersonalityLocked] = useState(false);
  const [personality, setPersonality] = useState<SecretaryPersonality>(DEFAULT_SECRETARY_PERSONALITY);
  const [appearance, setAppearance] = useState<SecretaryAppearance>(DEFAULT_SECRETARY_APPEARANCE);
  const [preferences, setPreferences] = useState('');
  const [loading, setLoading] = useState(true);
  const [readFailed, setReadFailed] = useState(false);
  const [readAttempt, setReadAttempt] = useState(0);
  const lock = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let alive = true;
    setName(''); setError(''); setReadFailed(false); setExistingCharacter(undefined); setRevision(undefined); setPersonalityLocked(false); setLoading(true); setPersonality(DEFAULT_SECRETARY_PERSONALITY); setAppearance(DEFAULT_SECRETARY_APPEARANCE); setPreferences('');
    void Promise.all([findSecretary(userId), db.secretaryBindings.get(userId)]).then(([c, binding]) => {
      if (!alive) return;
      setRevision(binding?.revision);
      setAppearance(binding?.appearance ?? c?.secretaryAppearance ?? DEFAULT_SECRETARY_APPEARANCE);
      setPersonalityLocked(!!c || !!binding && binding.status !== 'dismissed');
      if (c) { setName(c.name); setExistingCharacter(c); setPreferences(c.secretaryPreferences ?? ''); }
      if (c || binding && binding.status !== 'dismissed') setPersonality(secretaryPersonality(binding?.personality ?? c?.secretaryPersonality));
    }).catch(() => { if (alive) setReadFailed(true); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [readAttempt, userId]);
  const close = () => {
    if (lock.current) return;
    try { localStorage.setItem(SECRETARY_INTRO_PREFIX + userId, '1'); } catch { /* optional preference */ }
    onClose();
  };
  const create = async () => {
    if (lock.current || loading || readFailed || !name.trim() || useAuthStore.getState().userId !== userId) return;
    if (Array.from(name.trim()).length > 20) { setError('名字请保持在 1–20 个字。'); return; }
    const isCurrent = () => mounted.current && useAuthStore.getState().userId === userId;
    lock.current = true; setBusy(true); setError('');
    try {
      const character = await createSecretary(userId, name, { personality, appearance, preferences, expectedRevision: revision });
      if (!isCurrent()) return;
      await openSecretary(character);
      if (!isCurrent()) return;
      try { localStorage.setItem(SECRETARY_INTRO_PREFIX + userId, '1'); } catch { /* optional preference */ }
      onClose();
    } catch (e) { if (isCurrent()) setError(e instanceof Error ? e.message : '创建未完成，请重试。'); }
    finally { lock.current = false; if (isCurrent()) setBusy(false); }
  };
  const nameCount = Array.from(name.trim()).length;
  if (existingCharacter) return <SecretaryManagementModal character={existingCharacter} open onClose={close} />;
  return <Modal open onClose={close} title={personalityLocked ? '恢复你的私人助理' : welcome ? '先认识你的私人助理' : '聘用你的私人助理'} panelClassName="vg-settings-panel" width="max-w-md" closeOnBackdrop={false} mobileFullHeight canSnapshotOnExit={() => false} footer={<div className="vg-secretary-ui vg-secretary-form-footer">
    {error && <FeedbackNotice tone="error" message={error} />}
    <div className="flex gap-3"><button type="button" disabled={busy} onClick={close} className="vg-button vg-button-secondary">稍后再说</button>
    <button type="submit" form={formId} disabled={busy || loading || readFailed || !nameCount || nameCount > 20} className="vg-button vg-button-primary min-w-0 flex-1">{busy ? '正在准备…' : personalityLocked ? '恢复助理' : '创建助理'}</button></div>
  </div>}>
    <div className="vg-settings-design vg-secretary-ui vg-secretary-setup vg-assistant-preferences px-5 py-5 space-y-5">
      <div className="vg-secretary-surface-intro">
        <div className="flex items-center gap-3"><span className="vg-secretary-icon-tile"><SecretaryIcon name="profile" size={24} /></span><h3 className="text-lg font-semibold text-ink">让日常，有个照应</h3></div>
        <p className="mt-3 text-sm leading-7 text-sub">{personalityLocked ? '恢复原来的性格与形象，接着处理已经留下的工作。' : welcome ? '欢迎来到 VirtuGene。先认识陪你记录和安排生活的助理，其他角色可以稍后创造。' : '取一个喜欢的名字，选一种合拍的性格，和 TA 一起安排生活。'}</p>
      </div>
      <div className="vg-settings-form grid grid-cols-2 gap-3 text-sm text-sub">
        {([['diary', '记录日记'], ['moment', '起草朋友圈'], ['calendar', '安排待办'], ['check', '跟进事项']] satisfies [SecretaryIconName, string][]).map(([icon, label]) => <p key={label} className="flex items-center gap-2"><SecretaryIcon name={icon} size={18} />{label}</p>)}
      </div>
      {loading ? <LoadingSkeleton label="正在读取助理资料" rows={3} /> : readFailed ? <FeedbackNotice tone="error" message="助理资料暂时没有读到，请重试后再创建。"><button type="button" onClick={() => setReadAttempt(attempt => attempt + 1)} className="vg-button vg-button-secondary">重新读取</button></FeedbackNotice> :
      <form id={formId} className="space-y-5" aria-busy={busy} onSubmit={event => { event.preventDefault(); void create(); }} onKeyDown={event => { if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault(); }}>
        <div className="vg-settings-form"><SettingsField label="助理名字" value={name} onChange={event => { setName(event.target.value); setError(''); }} placeholder="你想叫 TA 什么？" maxLength={40} disabled={busy} aria-invalid={nameCount > 20 || undefined} hint={`1–20 个字，之后也能修改 · ${nameCount}/20`} /></div>
        <section className="vg-settings-form"><SecretaryPersonalitySelector value={personality} preferences={preferences} onChange={setPersonality} onPreferencesChange={setPreferences} disabled={busy} personalityLocked={personalityLocked} /></section>
        <section className="vg-settings-form"><SecretaryAppearanceSelector personality={personality} value={appearance} onChange={setAppearance} disabled={busy || personalityLocked} /></section>
        <p className="text-sm leading-7 text-sub">同一时间一位在职助理。日记默认私密，朋友圈先存草稿，由你决定发布。{personalityLocked ? '当前性格会保留；想换一种相处方式，可在助理管理中重新聘用。' : '名字和补充偏好随时可改，聘用后可在聊天中安排事情。'}</p>
      </form>}
    </div>
  </Modal>;
}
