import { useEffect, useId, useRef, useState } from 'react';
import { Modal } from '../ui/Modal';
import { Icon } from '../ui/Icon';
import { FeedbackNotice } from '../ui/FeedbackNotice';
import { LoadingSkeleton } from '../ui/LoadingSkeleton';
import { SettingsField } from './SettingsUI';
import { createBackup, restoreBackup, hasBackup } from '../../lib/backup';
import { useAuthStore } from '../../store/auth-store';
import { useChatStore } from '../../store/chat-store';
import { useDiaryStore } from '../../store/diary-store';

/** Encrypted local backup; native storage and import remain in backup.ts. */
export function BackupSection() {
  const [mode, setMode] = useState<'backup' | 'restore' | null>(null);
  const [pwd, setPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [hasBackupFile, setHasBackupFile] = useState(false);
  const [checkError, setCheckError] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState('');
  const lock = useRef(false);
  const alive = useRef(true);
  const checkEpoch = useRef(0);
  const formId = useId();
  useEffect(() => { alive.current = true; return () => { alive.current = false; checkEpoch.current++; }; }, []);

  const checkBackup = async () => {
    const epoch = ++checkEpoch.current;
    setChecking(true); setCheckError(false); setHasBackupFile(false);
    try {
      const exists = await hasBackup();
      if (alive.current && checkEpoch.current === epoch) setHasBackupFile(exists);
    } catch {
      if (alive.current && checkEpoch.current === epoch) setCheckError(true);
    } finally {
      if (alive.current && checkEpoch.current === epoch) setChecking(false);
    }
  };
  const open = (next: 'backup' | 'restore') => {
    if (lock.current) return;
    checkEpoch.current++; setChecking(false); setCheckError(false);
    setPwd(''); setConfirmPwd(''); setError(''); setResult(''); setMode(next);
    if (next === 'restore') void checkBackup();
  };
  const close = () => {
    if (lock.current) return;
    checkEpoch.current++; setChecking(false); setMode(null); setPwd(''); setConfirmPwd(''); setError('');
  };
  const submit = async () => {
    if (lock.current || !mode || checking || (mode === 'restore' && (!hasBackupFile || checkError))) return;
    if (!pwd) { setError('请输入备份密码'); return; }
    if (mode === 'backup' && pwd.length < 4) { setError('备份密码至少 4 位'); return; }
    if (mode === 'backup' && pwd !== confirmPwd) { setError('两次输入的密码不一致'); return; }
    lock.current = true; setBusy(true); setError('');
    try {
      let message: string;
      if (mode === 'backup') {
        const path = await createBackup(pwd);
        message = `备份已保存到 ${path}`;
      } else {
        const restored = await restoreBackup(pwd);
        if (!restored.ok) { if (alive.current) setError(restored.error ?? '恢复失败，请重试'); return; }
        if (restored.account) {
          useAuthStore.getState().login(restored.account.userId, restored.account.username, '', '🧬');
          void useChatStore.getState().loadCharacters();
          void useDiaryStore.getState().load();
        }
        message = '恢复成功，账号与数据已还原。';
      }
      if (alive.current) { setResult(message); setMode(null); setPwd(''); setConfirmPwd(''); }
    } catch (cause) {
      if (alive.current) setError(`${mode === 'backup' ? '备份' : '恢复'}未完成：${cause instanceof Error ? cause.message : '请重试'}`);
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const ready = mode === 'backup' || (hasBackupFile && !checking && !checkError);
  return <section>
    <h3 className="text-sm font-medium text-ink mb-3">数据备份与恢复</h3>
    <div className="vg-settings-form space-y-4">
      <p className="text-sm leading-7 text-sub">把账号、角色、聊天与手账加密保存在手机存储，方便重装后恢复。</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <button type="button" onClick={() => open('backup')} className="vg-button vg-button-primary"><Icon name="download" />立即备份</button>
        <button type="button" onClick={() => open('restore')} className="vg-button vg-button-secondary"><Icon name="refresh" />从备份恢复</button>
      </div>
      {result && !mode && <FeedbackNotice message={result} tone="success" />}
    </div>
    <Modal presentation="dialog" canSnapshotOnExit={() => false} panelClassName="vg-settings-panel" open={mode !== null} onClose={close} title={mode === 'backup' ? '备份数据' : '从备份恢复'} width="max-w-sm" closeOnBackdrop={false} footer={<div className="vg-settings-design !py-3 flex justify-end gap-2">
      <button type="button" onClick={close} disabled={busy} className="vg-button vg-button-secondary">{ready ? '取消' : '返回'}</button>
      {ready && <button type="submit" form={formId} disabled={busy} className="vg-button vg-button-primary">{busy ? mode === 'backup' ? '备份中…' : '恢复中…' : mode === 'backup' ? '开始备份' : '恢复数据'}</button>}
    </div>}>
      <form id={formId} className="vg-settings-design space-y-4" aria-busy={busy || checking} onSubmit={event => { event.preventDefault(); void submit(); }}>
        {mode === 'restore' && checking ? <LoadingSkeleton label="正在查找备份" rows={2} /> : mode === 'restore' && checkError ? <FeedbackNotice message="暂时无法读取备份位置，请重试。" tone="error"><button type="button" onClick={() => void checkBackup()} className="vg-button vg-button-secondary">重新读取</button></FeedbackNotice> : mode === 'restore' && !hasBackupFile ? <p className="text-sm leading-7 text-sub">还没有找到备份文件。请先在原设备上备份，并将文件保留在同一存储位置。</p> : <>
          <p className="text-sm leading-7 text-sub">{mode === 'backup' ? '备份密码与登录密码独立。请妥善保存，恢复时需要用到。' : '备份文件已找到。恢复会合并覆盖当前设备数据，请确认使用的是需要恢复的备份。'}</p>
          <SettingsField label="备份密码" type="password" autoComplete={mode === 'backup' ? 'new-password' : 'current-password'} value={pwd} disabled={busy} onChange={event => { setPwd(event.target.value); setError(''); }} hint={mode === 'backup' ? '至少 4 位，建议使用不易猜测的密码。' : undefined} />
          {mode === 'backup' && <SettingsField label="再次输入备份密码" type="password" autoComplete="new-password" value={confirmPwd} disabled={busy} onChange={event => { setConfirmPwd(event.target.value); setError(''); }} />}
          {error && <FeedbackNotice message={error} tone="error" />}
        </>}
      </form>
    </Modal>
  </section>;
}
