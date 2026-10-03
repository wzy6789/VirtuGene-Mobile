import { useState } from 'react';
import { useUIStore } from '../../store/ui-store';
import { Modal } from '../ui/Modal';
import { SECRETARY_CAPABILITIES } from '../../lib/secretary/capabilities';
import { SecretaryWorkPreferencesModal } from './SecretaryWorkPreferencesModal';
import { SecretaryMemoryModal } from './SecretaryMemoryModal';
import { SecretaryIcon, type SecretaryIconName } from './SecretaryIcon';
import { SecretarySurfaceIntro } from './SecretarySurfaceIntro';

export function SecretaryMoreMenu({ onInbox, onReview, onManage, disabled }: { onInbox: () => void; onReview: () => void; onManage: () => void; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [showCapabilities, setShowCapabilities] = useState(false);
  const [showWorkPreferences, setShowWorkPreferences] = useState(false);
  const [showMemory, setShowMemory] = useState(false);
  const go = (action: () => void) => { setOpen(false); action(); };
  const actions: { label: string; title: string; detail: string; icon: SecretaryIconName; action: () => void; disabled?: boolean }[] = [
    { label: '办事收件箱', title: '办事收件箱', detail: '待处理事项、草稿与办事记录', icon: 'inbox', action: onInbox },
    { label: '每日整理', title: '每日整理', detail: '回顾今天，整理明天的安排', icon: 'spark', action: onReview, disabled },
    { label: '助理管理 · 解雇与聘用', title: '助理管理', detail: '名字、形象与聘用记录', icon: 'profile', action: onManage },
    { label: '助理能力 · 已开放的功能', title: '助理能力', detail: '看看 TA 可以帮你做什么', icon: 'todo', action: () => setShowCapabilities(true) },
    { label: '办事习惯 · 格式、文风与提醒', title: '办事习惯', detail: '日记格式、文风与提醒偏好', icon: 'settings', action: () => setShowWorkPreferences(true) },
    { label: '助理记忆 · 查看、纠正与忘记', title: '助理记忆', detail: '记住的信息与偏好，由你管理', icon: 'diary', action: () => setShowMemory(true) },
  ];
  return <>
    {showWorkPreferences && <SecretaryWorkPreferencesModal open onClose={() => setShowWorkPreferences(false)} />}
    {showMemory && <SecretaryMemoryModal open onClose={() => setShowMemory(false)} />}
    <button type="button" aria-label="助理更多操作" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)} className="vg-secretary-more flex h-12 w-12 items-center justify-center rounded-xl text-sub"><svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></svg></button>
    <Modal open={open} onClose={() => setOpen(false)} title="助理工作台" width="max-w-sm" panelClassName="vg-settings-panel" footer={<div className="vg-secretary-ui vg-secretary-form-footer vg-secretary-workbench-footer"><div className="vg-secretary-record-links grid grid-cols-3 gap-2">{[['日记', 'diary'], ['朋友圈', 'moments'], ['待办', 'todo']].map(([label, view]) => <button key={view} type="button" onClick={() => go(() => useUIStore.getState().setActiveView(view as 'diary' | 'moments' | 'todo'))} className="min-h-12 rounded-xl border border-line text-xs text-sub">查看{label}</button>)}</div></div>}>
      <div className="vg-settings-design vg-secretary-ui vg-secretary-menu space-y-4 p-5">
        <SecretarySurfaceIntro icon="spark" title="生活里的事，一起理顺" detail="办事有结果，记录有去处。日记私密保存，朋友圈由你选择发布。" />
        <div className="vg-secretary-menu-actions">{actions.map((item, index) => <button key={item.label} type="button" aria-label={item.label} disabled={item.disabled} onClick={() => go(item.action)} className={`vg-secretary-menu-row ${index < 2 ? 'is-featured' : ''} disabled:opacity-40`}><span className="vg-secretary-icon-tile"><SecretaryIcon name={item.icon} size={20} /></span><span className="min-w-0 flex-1"><span className="block text-sm font-medium text-ink">{item.title}</span><span className="mt-1 block text-xs text-sub">{item.detail}</span></span><SecretaryIcon name="chevron" size={14} className="text-sub" /></button>)}</div>
      </div>
    </Modal>
    <Modal open={showCapabilities} onClose={() => setShowCapabilities(false)} title="助理能力" width="max-w-lg" panelClassName="vg-settings-panel" mobileFullHeight>
      <div className="vg-settings-design vg-secretary-ui vg-secretary-capabilities space-y-3 p-4">
        <SecretarySurfaceIntro icon="todo" title="从一句话，开始办事" value={`${SECRETARY_CAPABILITIES.length} 项能力`} detail="以下软件内能力已开放，直接在聊天里交代即可。执行结果可查看；修改与取消待办可撤销。" />
        {SECRETARY_CAPABILITIES.map(item => <section key={item.name} className="rounded-xl border border-line p-4"><div className="flex items-center justify-between gap-2"><h3 className="text-sm font-medium text-ink">{item.name}</h3><span className="shrink-0 text-xs text-life-cyan">已开放</span></div><p className="mt-2 text-xs leading-relaxed text-sub">{item.detail}</p><p className="mt-3 rounded-lg bg-surface p-2 text-xs leading-relaxed text-ink">试着说：{item.example}</p></section>)}
      </div>
    </Modal>
  </>;
}
