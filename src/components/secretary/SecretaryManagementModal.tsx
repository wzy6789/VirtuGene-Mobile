import { useEffect, useRef, useState } from 'react';
import { liveQuery } from 'dexie';
import { db, type Character, type SecretaryBinding } from '../../db';
import { normalizeSecretaryBinding } from '../../db/secretary-binding';
import { useAuthStore } from '../../store/auth-store';
import { useChatStore } from '../../store/chat-store';
import { createSecretary, dismissSecretary, openSecretary } from '../../lib/secretary/character';
import { DEFAULT_SECRETARY_PERSONALITY, SECRETARY_PERSONALITIES, secretaryPersonality, type SecretaryPersonality } from '../../lib/secretary/personality';
import { SecretaryPersonalitySelector } from './SecretaryPersonalitySelector';
import { Modal } from '../ui/Modal';
import { Avatar } from '../ui/Avatar';
import { SecretaryAppearanceSelector } from './SecretaryAppearanceSelector';
import { DEFAULT_SECRETARY_APPEARANCE, parseSecretaryAvatar, type SecretaryAppearance } from '../../lib/secretary/appearance';
import { SecretaryIcon } from './SecretaryIcon';

export function SecretaryManagementModal({ character, open, onClose }: { character: Character; open: boolean; onClose: () => void }) {
  const userId = useAuthStore(s => s.userId);
  const [snapshot, setSnapshot] = useState<{ character: Character; binding: SecretaryBinding; drafts: number; unfinished: number }>();
  const [name, setName] = useState('');
  const [personality, setPersonality] = useState<SecretaryPersonality>(DEFAULT_SECRETARY_PERSONALITY);
  const [appearance, setAppearance] = useState<SecretaryAppearance | undefined>(DEFAULT_SECRETARY_APPEARANCE);
  const [preferences, setPreferences] = useState('');
  const [busy, setBusy] = useState(false);
  const [reviewDismissal, setReviewDismissal] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const lock = useRef(false);
  useEffect(() => {
    if (!open || !userId) return;
    const subscription = liveQuery(() => db.transaction('r', db.characters, db.secretaryBindings, db.secretaryTasks, db.todos, async () => {
      const current = await db.characters.get(character.id);
      if (!current || current.createdBy !== userId || current.agentProfile !== 'secretary' || current.isPreset) throw new Error('只能管理你自己的助理。');
      const stored = await db.secretaryBindings.get(userId);
      if (!stored || stored.characterId !== current.id) throw new Error('助理资料未就绪，请重新打开。');
      const tasks = await db.secretaryTasks.where('characterId').equals(current.id).filter(t => t.userId === userId).toArray();
      return { character: current, binding: normalizeSecretaryBinding(stored, current),
        drafts: tasks.reduce((n, t) => n + t.results.filter(r => r.action.kind === 'moment.draft' && r.status === 'draft').length, 0),
        unfinished: await db.todos.where('userId').equals(userId).filter(t => t.status === 'todo').count() };
    })).subscribe({ next: value => setSnapshot(value), error: e => setError(e instanceof Error ? e.message : '助理资料读取失败。') });
    return () => subscription.unsubscribe();
  }, [open, character.id, userId]);
  const employmentId = snapshot?.binding.employmentId;
  const dismissed = snapshot?.binding.status === 'dismissed';
  useEffect(() => {
    if (!snapshot) return;
    setName(dismissed ? '' : snapshot.character.name);
    setPersonality(dismissed ? DEFAULT_SECRETARY_PERSONALITY : secretaryPersonality(snapshot.binding.personality));
    setAppearance(dismissed ? DEFAULT_SECRETARY_APPEARANCE : parseSecretaryAvatar(snapshot.character.avatar)?.appearance);
    setPreferences(snapshot.character.secretaryPreferences ?? ''); setReviewDismissal(false); setNotice('');
  }, [employmentId, dismissed]);
  const close = () => { if (!lock.current) onClose(); };
  const run = async (work: () => Promise<void>) => {
    if (lock.current || !snapshot || !userId) return;
    lock.current = true; setBusy(true); setError(''); setNotice('');
    try { await work(); } catch (e) { if (useAuthStore.getState().userId === userId) setError(e instanceof Error ? e.message : '操作未完成，请重试。'); }
    finally { lock.current = false; setBusy(false); }
  };
  const save = () => run(async () => {
    if (!name.trim() || Array.from(name.trim()).length > 20) throw new Error('请输入1至20个字的名字。');
    if (dismissed) {
      const hired = await createSecretary(userId!, name, { personality, appearance, preferences, expectedRevision: snapshot!.binding.revision });
      await openSecretary(hired);
      if (useAuthStore.getState().userId === userId) onClose();
    } else {
      await useChatStore.getState().updateCharacter(character.id, { name: name.trim(), secretaryPreferences: preferences, secretaryEmploymentId: snapshot!.binding.employmentId, ...(appearance ? { secretaryAppearance: appearance } : {}) });
      if (useAuthStore.getState().userId === userId) setNotice('助理资料已保存。');
    }
  });
  const dismiss = () => run(async () => {
    await dismissSecretary(userId!, character.id, snapshot!.binding.employmentId!);
    setReviewDismissal(false);
  });
  if (!userId || character.createdBy !== userId) return null;
  return <Modal panelClassName="vg-settings-panel" open={open} onClose={close} title="助理管理" width="max-w-md" closeOnBackdrop={false} mobileFullHeight footer={<div className="vg-secretary-ui vg-secretary-form-footer">
    {error && <p role="alert" className="mb-3 text-sm">{error}</p>}
    {notice && <p role="status" className="mb-3 text-sm text-life-cyan">{notice}</p>}
    <div className="flex gap-3"><button type="button" disabled={busy} onClick={close} className="vg-secretary-footer-secondary">关闭管理</button><button type="button" disabled={busy || !snapshot || !name.trim()} onClick={() => void save()} className="min-h-12 min-w-0 flex-1 rounded-xl bg-gene-purple px-3 text-sm font-medium text-white disabled:opacity-40">{busy ? '正在办理…' : dismissed ? '聘用新助理，保留记录' : '保存助理资料'}</button></div>
  </div>}>
    <div className="vg-settings-design vg-secretary-ui vg-secretary-management space-y-4 px-5 py-5">
      <div className="vg-secretary-profile rounded-2xl border border-line p-4">
        <div className="flex items-center gap-3">{snapshot && <Avatar avatar={snapshot.character.avatar} size="lg" className="!h-12 !w-12 shrink-0" />}<div className="min-w-0 flex-1"><p className="mb-1 text-xs text-sub">你的生活助理</p><p className="break-words text-base font-semibold text-ink">{snapshot ? dismissed ? '聘用下一位助理' : snapshot.character.name : '正在读取助理资料…'}</p></div>{snapshot && <span className={`vg-secretary-employment ${dismissed ? 'is-vacant' : ''}`}>{dismissed ? '空缺中' : '在职'}</span>}</div>
        <p className="vg-secretary-profile-note mt-3 text-xs leading-relaxed text-sub"><SecretaryIcon name="shield" size={15} />同一时间一位助理。解雇后可以重新取名、选择性格，聊天、日记、朋友圈、待办和草稿都保留。</p>
      </div>
      {snapshot && <div className="vg-secretary-profile-stats grid grid-cols-2 gap-3 text-center text-sm text-ink"><p className="rounded-xl bg-surface p-3"><span className="block text-xl font-semibold">{snapshot.unfinished}</span><span className="mt-1 block text-xs text-sub">未完成待办</span></p><p className="rounded-xl bg-surface p-3"><span className="block text-xl font-semibold">{snapshot.drafts}</span><span className="mt-1 block text-xs text-sub">保留的朋友圈草稿</span></p></div>}
      <section className="vg-secretary-form-section"><h3 className="vg-secretary-section-title"><SecretaryIcon name="profile" size={17} />基本资料</h3><label className="block text-sm text-ink">{dismissed ? '新助理叫什么？' : '助理名字'}<input aria-label={dismissed ? '新助理名字' : '助理名字'} value={name} onChange={e => setName(e.target.value)} disabled={busy || !snapshot} maxLength={40} placeholder="由你取名" className="mt-2 min-h-12 w-full rounded-xl border border-line bg-surface px-3 text-base text-ink" /></label></section>
      <section className="vg-secretary-form-section"><SecretaryPersonalitySelector value={personality} preferences={preferences} onChange={setPersonality} onPreferencesChange={setPreferences} disabled={busy || !snapshot} personalityLocked={!dismissed} /></section>
      <section className="vg-secretary-form-section"><SecretaryAppearanceSelector personality={personality} value={appearance} onChange={setAppearance} disabled={busy || !snapshot} customAvatar={!dismissed ? snapshot?.character.avatar : undefined} /></section>
      {!dismissed && snapshot && <>
        <button type="button" disabled={busy} onClick={() => void run(async () => { await openSecretary(snapshot.character); if (useAuthStore.getState().userId === userId) onClose(); })} className="min-h-11 w-full rounded-xl border border-line text-sm text-ink">和{snapshot.character.name}聊聊</button>
        {reviewDismissal ? <div className="rounded-xl border border-line bg-surface p-4"><p className="text-sm text-ink">解雇{snapshot.character.name}后，TA 将停止办事。</p><p className="mt-2 text-xs leading-relaxed text-sub">已经完成的记录保留；未完成请求停止。新助理上任后，旧草稿和待补充事项由你手动继续。</p><button type="button" disabled={busy} onClick={() => void dismiss()} className="mt-3 min-h-11 w-full rounded-xl border border-red-400/30 text-sm text-red-400">解雇并保留记录</button><button type="button" disabled={busy} onClick={() => setReviewDismissal(false)} className="mt-2 min-h-11 w-full text-sm text-sub">暂不解雇</button></div>
          : <button type="button" disabled={busy} onClick={() => setReviewDismissal(true)} className="min-h-11 w-full text-sm text-sub">解雇这位助理</button>}
      </>}
      {!!snapshot?.binding.employments?.length && <details className="vg-secretary-history rounded-xl border border-line p-3"><summary className="cursor-pointer text-sm text-ink">聘用记录（{snapshot.binding.employments.length}）</summary><ol className="mt-3 space-y-3">{[...snapshot.binding.employments].reverse().map(item => <li key={item.id} className="text-sm text-ink"><p>{item.name} · {SECRETARY_PERSONALITIES.find(p => p.id === item.personality)?.archetype ?? '温柔树洞'}</p><p className="mt-1 text-xs text-sub">{new Date(item.hiredAt).toLocaleDateString('zh-CN')} 聘用 · {item.dismissedAt ? `${new Date(item.dismissedAt).toLocaleDateString('zh-CN')} 离职` : item.id === snapshot.binding.employmentId && !dismissed ? '在职' : '历史聘用'}</p></li>)}</ol></details>}
    </div>
  </Modal>;
}
