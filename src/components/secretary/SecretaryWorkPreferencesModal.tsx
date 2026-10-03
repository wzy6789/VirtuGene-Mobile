import { useEffect, useRef, useState } from 'react';
import { liveQuery } from 'dexie';
import type { SecretaryBinding } from '../../db';
import { useAuthStore } from '../../store/auth-store';
import { DEFAULT_WORK_PREFERENCES, DIARY_FORMATS, MOMENT_STYLES, REPLY_LENGTHS, TODO_PRIORITIES, readWorkPreferences, saveWorkPreferences, workPreferencesOrDefault, type SecretaryWorkPreferences } from '../../lib/secretary/work-preferences';
import { Modal } from '../ui/Modal';
import { SecretaryIcon } from './SecretaryIcon';
import { SecretarySurfaceIntro } from './SecretarySurfaceIntro';

export function SecretaryWorkPreferencesModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const userId = useAuthStore(s => s.userId) ?? '';
  const [snapshot, setSnapshot] = useState<SecretaryBinding>();
  const [form, setForm] = useState<SecretaryWorkPreferences>({ ...DEFAULT_WORK_PREFERENCES });
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const initialized = useRef(false), lock = useRef(false);
  useEffect(() => {
    initialized.current = false; setSnapshot(undefined); setForm({ ...DEFAULT_WORK_PREFERENCES }); setError(''); setNotice('');
    if (!open || !userId) return;
    const subscription = liveQuery(() => readWorkPreferences(userId)).subscribe({
      next: binding => {
        if (!initialized.current && binding) { initialized.current = true; setSnapshot(binding); setForm(workPreferencesOrDefault(binding.workPreferences)); }
        if (!binding) { setSnapshot(undefined); setError('请先聘用你的生活助理。'); }
      }, error: () => setError('办事习惯读取失败，请关闭后重试。'),
    });
    return () => subscription.unsubscribe();
  }, [open, userId]);
  const save = async () => {
    if (!snapshot || lock.current || snapshot.userId !== userId) return;
    lock.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const changed = await saveWorkPreferences(userId, form, { characterId: snapshot.characterId, employmentId: snapshot.employmentId, version: snapshot.workPreferencesUpdatedAt ?? 0 });
      if (useAuthStore.getState().userId === userId) { setSnapshot(changed); setNotice('办事习惯已保存，下次新请求开始沿用。'); }
    } catch (e) { if (useAuthStore.getState().userId === userId) setError(e instanceof Error ? e.message : '没有保存成功。'); }
    finally { lock.current = false; setBusy(false); }
  };
  const reload = async () => {
    try {
      const binding = await readWorkPreferences(userId);
      if (!binding || useAuthStore.getState().userId !== userId) return;
      setSnapshot(binding); setForm(workPreferencesOrDefault(binding.workPreferences)); setError(''); setNotice('已读取当前保存的习惯。');
    } catch { if (useAuthStore.getState().userId === userId) setError('读取失败，请关闭后重试。'); }
  };
  const select = (key: 'diaryFormat' | 'momentStyle' | 'replyLength' | 'todoPriority', label: string, choices: Record<string, string>) => <label className="block text-sm text-ink">{label}<select aria-label={label} value={form[key]} disabled={busy || !snapshot} onChange={e => { const value = e.currentTarget.value; setForm(f => ({ ...f, [key]: value })); setNotice(''); }} className="mt-2 min-h-12 w-full rounded-xl border border-line bg-surface px-3 text-sm text-ink">{Object.entries(choices).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>;
  if (snapshot && snapshot.userId !== userId) return null;
  return <Modal panelClassName="vg-settings-panel" open={open} onClose={() => { if (!lock.current) onClose(); }} title="办事习惯" width="max-w-md" mobileFullHeight footer={<div className="vg-secretary-ui vg-secretary-form-footer">
    {error && <div className="mb-3"><p role="alert" className="text-sm">{error}</p><button type="button" disabled={busy} onClick={() => void reload()} className="mt-1 text-sm text-gene-purple">重新读取已保存习惯</button></div>}
    {notice && <p role="status" className="mb-3 text-sm text-life-cyan">{notice}</p>}
    <div className="flex gap-3"><button type="button" disabled={busy || !snapshot} onClick={() => { setForm({ ...DEFAULT_WORK_PREFERENCES }); setNotice('已恢复默认选项，保存后生效。'); }} className="vg-secretary-footer-secondary">恢复默认选项</button><button type="button" disabled={busy || !snapshot || snapshot.userId !== userId || !Number.isInteger(form.reminderMinutes) || form.reminderMinutes < 0 || form.reminderMinutes > 10080} onClick={() => void save()} className="min-h-12 min-w-0 flex-1 rounded-xl bg-gene-purple px-3 text-sm text-white disabled:opacity-40">{busy ? '正在保存…' : '保存办事习惯'}</button></div>
  </div>}>
    <div className="vg-settings-design vg-secretary-ui vg-secretary-preferences space-y-4 p-5">
      <SecretarySurfaceIntro icon="settings" title="按你的习惯办事" detail="记住你的做事方式。当前消息里的要求优先，换助理后习惯保留；已开始的任务继续按当时设置办理。" />
      <section className="vg-secretary-form-section"><h3 className="vg-secretary-section-title"><SecretaryIcon name="diary" size={17} />记录与表达</h3><div className="vg-secretary-preference-fields">{select('diaryFormat', '日记格式', DIARY_FORMATS)}{select('momentStyle', '朋友圈文风', MOMENT_STYLES)}</div></section>
      <section className="vg-secretary-form-section"><h3 className="vg-secretary-section-title"><SecretaryIcon name="todo" size={17} />回应与安排</h3><div className="vg-secretary-preference-fields">{select('replyLength', '助理回应长度', REPLY_LENGTHS)}{select('todoPriority', '新待办默认优先级', TODO_PRIORITIES)}</div></section>
      <label className="flex items-start gap-3 text-sm text-ink"><input aria-label="开启主动协助" type="checkbox" checked={form.proactiveHelp === true} disabled={busy || !snapshot} onChange={e => setForm(f => ({ ...f, proactiveHelp: e.target.checked }))} className="mt-1" /><span>主动协助<span className="mt-1 block text-xs leading-relaxed text-sub">打开软件时，提示今天的重要安排、同一时间的事项或待补信息。可忽略、延后或关闭；不会自动修改记录。</span></span></label>
      <label className="block text-sm text-ink">默认提前提醒<input aria-label="默认提前提醒分钟" type="number" min={0} max={10080} step={1} value={Number.isFinite(form.reminderMinutes) ? form.reminderMinutes : ''} disabled={busy || !snapshot} onChange={e => { const value = e.currentTarget.value; setForm(f => ({ ...f, reminderMinutes: value === '' ? NaN : Number(value) })); setNotice(''); }} className="mt-2 min-h-12 w-full rounded-xl border border-line bg-surface px-3 text-sm text-ink" /><span className="mt-2 block text-xs leading-relaxed text-sub">单位：分钟，0表示准时。仅在你要求提醒时沿用；仍需具体日期和时间。</span></label>
      <div className="vg-secretary-preference-preview rounded-xl border border-line p-3 text-xs leading-relaxed text-sub" aria-label="办事习惯预览">
        <p>记日记时：{DIARY_FORMATS[form.diaryFormat]}{form.diaryFormat === 'sections' ? '，按发生的事、感受与接下来分段，有素材才写。' : '，保留真实细节。'}</p>
        <p className="mt-2">写朋友圈时：{MOMENT_STYLES[form.momentStyle]}，生成草稿供你查看。</p>
        <p className="mt-2">添加待办时：未说明优先级则为{TODO_PRIORITIES[form.todoPriority]}。要求提醒时，{Number.isFinite(form.reminderMinutes) && form.reminderMinutes > 0 ? `提前${form.reminderMinutes}分钟` : '准时'}提醒。</p>
      </div>
    </div>
  </Modal>;
}
