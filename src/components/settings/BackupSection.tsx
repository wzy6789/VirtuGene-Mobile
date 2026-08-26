import { useState } from 'react';
import { Modal } from '../ui/Modal';
import { createBackup, restoreBackup, hasBackup, deleteBackup } from '../../lib/backup';
import { useAuthStore } from '../../store/auth-store';
import { useChatStore } from '../../store/chat-store';
import { useDiaryStore } from '../../store/diary-store';
import { useCharacterStateStore } from '../../store/character-state-store';
import { useEmotionStore } from '../../store/emotion-store';
import { resetDiaryUnlock } from '../../lib/diary-unlock';

/**
 * 数据备份 / 一键恢复（2.1.0）：
 * - 备份：全量数据（含账号）密码加密 → 写共享存储（卸载不丢）
 * - 恢复：输密码解密 → 全量导入 → 账号自动重建
 * - 设置页内嵌区块 + 首启恢复引导共用
 */
export function BackupSection() {
  const [backupOpen, setBackupOpen] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [pwd, setPwd] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [hasBackupFile, setHasBackupFile] = useState(false);
  const [confirmPwd, setConfirmPwd] = useState('');

  const inputCls =
    'w-full px-3 py-2 bg-surface border border-line-strong rounded-lg text-sm text-ink placeholder-gray-500 focus:outline-none focus:border-gene-purple/50 transition-colors';

  // 检测备份文件是否存在
  const checkBackup = async () => {
    setHasBackupFile(await hasBackup().catch(() => false));
  };

  const doBackup = async () => {
    if (!pwd || pwd.length < 4) { setMsg('备份密码至少 4 位'); return; }
    if (pwd !== confirmPwd) { setMsg('两次输入的密码不一致'); return; }
    setBusy(true);
    setMsg(null);
    try {
      const path = await createBackup(pwd);
      setMsg(`备份成功！已保存到 ${path}`);
      setBackupOpen(false);
      setPwd('');
      setConfirmPwd('');
    } catch (e) {
      setMsg('备份失败：' + ((e as Error)?.message ?? '未知错误'));
    } finally {
      setBusy(false);
    }
  };

  const doRestore = async () => {
    if (!pwd) { setMsg('请输入备份密码'); return; }
    setBusy(true);
    setMsg(null);
    try {
      const r = await restoreBackup(pwd);
      if (!r.ok) {
        setMsg(r.error ?? '恢复失败');
        return;
      }
      // 账号恢复后自动登录
      if (r.account) {
        useAuthStore.getState().login(r.account.userId, r.account.username, '', '🧬');
        useChatStore.getState().loadCharacters();
        useDiaryStore.getState().load();
      }
      setMsg('恢复成功！账号与全部数据已还原。');
      setRestoreOpen(false);
      setPwd('');
      setHasBackupFile(false);
    } catch (e) {
      setMsg('恢复失败：' + ((e as Error)?.message ?? '可能是密码错误'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h3 className="text-sm font-medium text-ink mb-3">🧬 数据备份 / 恢复</h3>
      <div className="p-4 rounded-xl bg-surface border border-line space-y-3">
        <p className="text-[11px] text-gray-500">
          备份会把账号、角色、聊天与日记加密保存到手机存储。卸载重装后可用备份一键恢复，无需重新注册。
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => { checkBackup(); setBackupOpen(true); }}
            className="flex-1 px-4 py-2 rounded-lg text-sm bg-gene-purple text-white hover:bg-[#5B4BD4] disabled:opacity-50 transition-all"
          >
            立即备份
          </button>
          <button
            onClick={() => { checkBackup(); setRestoreOpen(true); }}
            className="flex-1 px-4 py-2 rounded-lg text-sm text-life-cyan bg-life-cyan/10 border border-life-cyan/30 hover:bg-life-cyan/20 transition-all"
          >
            从备份恢复
          </button>
        </div>
        {msg && <p className="text-xs text-gray-500 break-all">{msg}</p>}

        {/* 备份弹窗 */}
        <Modal open={backupOpen} onClose={() => { setBackupOpen(false); setMsg(null); }} title="备份数据" width="max-w-sm" closeOnBackdrop={false}>
          <div className="p-6 space-y-4">
            <p className="text-xs text-gray-500">设置一个备份密码（独立于登录密码）。备份文件会加密保存，卸载 App 也不丢失。</p>
            <input type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} placeholder="备份密码（至少 4 位）" className={inputCls} />
            <input type="password" value={confirmPwd} onChange={(e) => setConfirmPwd(e.target.value)} placeholder="确认备份密码" className={inputCls} />
            {msg && <p className="text-xs text-red-400">{msg}</p>}
            <div className="flex justify-end gap-2">
              <button onClick={() => { setBackupOpen(false); setMsg(null); }} className="px-4 py-2 rounded-lg text-sm text-gray-400 hover:bg-surface transition-colors">取消</button>
              <button onClick={() => void doBackup()} disabled={busy} className="px-4 py-2 rounded-lg text-sm bg-gene-purple text-white hover:bg-[#5B4BD4] transition-all disabled:opacity-50">
                {busy ? '备份中…' : '开始备份'}
              </button>
            </div>
          </div>
        </Modal>

        {/* 恢复弹窗 */}
        <Modal open={restoreOpen} onClose={() => { setRestoreOpen(false); setMsg(null); }} title="一键恢复" width="max-w-sm" closeOnBackdrop={false}>
          <div className="p-6 space-y-4">
            {!hasBackupFile ? (
              <p className="text-xs text-gray-500">未检测到备份文件。请先在原设备上「立即备份」，并把备份文件保留在同一存储位置。</p>
            ) : (
              <>
                <p className="text-xs text-gray-500">检测到备份文件。输入备份密码即可恢复账号与全部数据（当前设备数据会被合并覆盖）。</p>
                <input type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} placeholder="备份密码" className={inputCls} />
                {msg && <p className="text-xs text-red-400">{msg}</p>}
                <div className="flex justify-end gap-2">
                  <button onClick={() => { setRestoreOpen(false); setMsg(null); }} className="px-4 py-2 rounded-lg text-sm text-gray-400 hover:bg-surface transition-colors">取消</button>
                  <button onClick={() => void doRestore()} disabled={busy} className="px-4 py-2 rounded-lg text-sm bg-life-cyan text-[#0F0F1A] hover:bg-[#00B8B3] transition-all disabled:opacity-50">
                    {busy ? '恢复中…' : '一键恢复'}
                  </button>
                </div>
              </>
            )}
          </div>
        </Modal>
      </div>
    </div>
  );
}
