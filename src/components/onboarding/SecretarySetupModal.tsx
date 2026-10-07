import { useEffect, useRef, useState } from 'react';
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

export function SecretarySetupModal({ open, onClose, welcome = false }: { open: boolean; onClose: () => void; welcome?: boolean }) {
  const userId = useAuthStore(s => s.userId) ?? '';
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [existing, setExisting] = useState(false);
  const [existingCharacter, setExistingCharacter] = useState<Character>();
  const [revision, setRevision] = useState<number>();
  const [personalityLocked, setPersonalityLocked] = useState(false);
  const [personality, setPersonality] = useState<SecretaryPersonality>(DEFAULT_SECRETARY_PERSONALITY);
  const [appearance, setAppearance] = useState<SecretaryAppearance>(DEFAULT_SECRETARY_APPEARANCE);
  const [preferences, setPreferences] = useState('');
  const [loading, setLoading] = useState(true);
  const lock = useRef(false);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setName(''); setError(''); setExisting(false); setExistingCharacter(undefined); setRevision(undefined); setPersonalityLocked(false); setLoading(true); setPersonality(DEFAULT_SECRETARY_PERSONALITY); setAppearance(DEFAULT_SECRETARY_APPEARANCE); setPreferences('');
    void Promise.all([findSecretary(userId), db.secretaryBindings.get(userId)]).then(([c, binding]) => {
      if (!alive) return;
      setRevision(binding?.revision);
      setAppearance(binding?.appearance ?? c?.secretaryAppearance ?? DEFAULT_SECRETARY_APPEARANCE);
      setPersonalityLocked(!!c || !!binding && binding.status !== 'dismissed');
      if (c) { setName(c.name); setExisting(true); setExistingCharacter(c); setPreferences(c.secretaryPreferences ?? ''); }
      if (c || binding && binding.status !== 'dismissed') setPersonality(secretaryPersonality(binding?.personality ?? c?.secretaryPersonality));
    }).catch(() => { if (alive) setError('角色读取失败，可以重试。'); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [open, userId]);
  const close = () => {
    if (lock.current) return;
    try { localStorage.setItem(SECRETARY_INTRO_PREFIX + userId, '1'); } catch { /* optional preference */ }
    onClose();
  };
  const create = async () => {
    if (lock.current || loading || !name.trim()) return;
    lock.current = true; setBusy(true); setError('');
    try {
      const character = await createSecretary(userId, name, { personality, appearance, preferences, expectedRevision: revision });
      await openSecretary(character);
      if (useAuthStore.getState().userId !== userId) return;
      try { localStorage.setItem(SECRETARY_INTRO_PREFIX + userId, '1'); } catch { /* optional preference */ }
      onClose();
    } catch (e) { if (useAuthStore.getState().userId === userId) setError(e instanceof Error ? e.message : '创建未完成，请重试。'); }
    finally { lock.current = false; setBusy(false); }
  };
  if (existingCharacter) return <SecretaryManagementModal character={existingCharacter} open={open} onClose={close} />;
  return <Modal open={open} onClose={close} title={personalityLocked ? '恢复你的私人助理' : welcome ? '先认识你的私人助理' : '聘用你的私人助理'} width="max-w-md" closeOnBackdrop={false} mobileFullHeight footer={<div className="vg-secretary-ui vg-secretary-form-footer">
    {error && <p role="alert" className="mb-3 text-sm">{error}</p>}
    <button type="button" disabled={busy || loading || !name.trim()} onClick={() => void create()} className="w-full min-h-12 rounded-xl bg-gene-purple text-white font-medium disabled:opacity-40">{busy ? '正在准备…' : existing ? `和${name}聊聊` : personalityLocked ? '恢复助理，进入聊天' : '取好名字，开始创建'}</button>
    <button type="button" disabled={busy} onClick={close} className="w-full min-h-12 mt-1 text-xs text-sub">{existing ? '稍后再聊' : '稍后再说，角色页可以随时创建'}</button>
  </div>}>
    <div className="vg-secretary-ui vg-secretary-setup px-5 pb-6 pt-4 space-y-5">
      <div className="vg-secretary-review-intro rounded-2xl border border-line p-5">
        <span className="vg-secretary-icon-tile"><SecretaryIcon name="profile" size={24} /></span>
        <p className="mt-3 text-lg font-semibold text-ink">把琐事理顺，把日子留下。</p>
        <p className="mt-2 text-sm leading-relaxed text-sub">{personalityLocked ? '当前聘用的性格会保留，工作记录也会继续保留。' : welcome ? '欢迎来到 VirtuGene。先给陪你记录和安排生活的助理取个名字，之后还可以创造其他角色。' : '帮你记录和安排生活，也有你喜欢的性格。名字由你决定，聘用后直接和 TA 聊天。'}</p>
      </div>
      <div className="vg-secretary-setup-features grid grid-cols-2 gap-3 text-sm text-ink">
        {([['diary', '代写并保存日记'], ['moment', '写应用内朋友圈'], ['calendar', '创建和安排待办'], ['check', '划掉已完成事项']] satisfies [SecretaryIconName, string][]).map(([icon, label]) => <p key={label} className="rounded-xl bg-surface p-3"><SecretaryIcon name={icon} size={18} />{label}</p>)}
      </div>
      <p className="text-xs leading-relaxed text-sub">行动舱的小球会显示待机、思考、忙碌、完成和遇到困难。具体进展以事项状态和办事记录为准。</p>
      <label className="block text-sm font-medium text-ink">{existing ? '你已经创建了助理' : '你想叫 TA 什么？'}
        <input aria-label="助理名字" value={name} onChange={e => setName(e.target.value)} placeholder="由你取名" maxLength={40} disabled={busy || existing || loading}
          className="mt-2 w-full min-h-12 rounded-xl border border-line bg-surface px-4 text-base text-ink outline-none focus:border-gene-purple"
          onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); void create(); } }} />
      </label>
      <SecretaryPersonalitySelector value={personality} preferences={preferences} onChange={setPersonality} onPreferencesChange={setPreferences} disabled={busy || existing || loading} personalityLocked={personalityLocked} />
      <SecretaryAppearanceSelector personality={personality} value={appearance} onChange={setAppearance} disabled={busy || loading || personalityLocked} />
      <p className="text-xs text-sub">同一时间一位在职助理。{personalityLocked ? '恢复当前聘用时沿用原有性格；想换性格，可在助理管理中解雇并重新聘用。' : '每次聘用都可以重新取名、选择性格，已有记录保留。'}</p>
      <p className="text-xs leading-relaxed text-sub">名字以后可以修改。日记默认私密；朋友圈先写草稿，你说发布才发出。清楚的指令直接执行，结果可以查看和撤销。</p>
    </div>
  </Modal>;
}
