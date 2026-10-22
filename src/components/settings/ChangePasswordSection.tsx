import { useEffect, useId, useRef, useState } from 'react';
import { Modal } from '../ui/Modal';
import { useAuthStore } from '../../store/auth-store';
import { userRepo } from '../../db/user-repo';
import { hashPassword, verifyPassword, encryptApiKey } from '../../lib/crypto';
import { persistApiKey } from '../../lib/api-key-storage';
import { SettingsField } from './SettingsUI';
import { Icon } from '../ui/Icon';
import { FeedbackNotice } from '../ui/FeedbackNotice';

/**
 * 修改密码（手机端设置）：
 * 1. 输入原密码 → 验证（防止他人改）
 * 2. 输入新密码两次 → 一致且 ≥6 位
 * 3. 用新密码重新加密 API Key（Key 是密码加密的），更新账号
 */
export function ChangePasswordSection() {
  const [open, setOpen] = useState(false);
  const [oldPwd, setOldPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const owner = useAuthStore(s => s.userId);
  const lock = useRef(false);
  const alive = useRef(true);
  const formId = useId();
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { setOpen(false); reset(); }, [owner]);

  const reset = () => {
    setOldPwd('');
    setNewPwd('');
    setConfirmPwd('');
    setError(null);
    setDone(false);
  };

  const handleSubmit = async () => {
    if (lock.current) return;
    setError(null);
    const { userId, apiKey } = useAuthStore.getState();
    if (!userId) return;
    const current = () => alive.current && useAuthStore.getState().userId === userId;

    // 1. 新密码校验
    if (!newPwd || newPwd.length < 6) { setError('新密码至少需要 6 位'); return; }
    if (newPwd !== confirmPwd) { setError('两次输入的新密码不一致'); return; }
    if (newPwd === oldPwd) { setError('新密码不能与原密码相同'); return; }

    lock.current = true; setBusy(true);
    try {
      // 2. 验证原密码
      const user = await userRepo.findByUsername(useAuthStore.getState().username ?? '');
      if (!current()) return;
      if (!user) { setError('账号不存在'); return; }
      const ok = await verifyPassword(oldPwd, user.passwordHash, user.passwordSalt);
      if (!current()) return;
      if (!ok) { setError('原密码不正确'); return; }

      // 3. 用新密码重新哈希 + 重新加密 API Key
      const newSaltBytes = crypto.getRandomValues(new Uint8Array(16));
      const { hash, salt } = await hashPassword(newPwd, newSaltBytes);
      // 解密旧 Key（用原密码），用新密码重新加密
      let apiKeyIv = user.apiKeyIv;
      let apiKeyCiphertext = user.apiKeyCiphertext;
      if (apiKey) {
        const { iv, ciphertext } = await encryptApiKey(apiKey, newPwd, newSaltBytes);
        apiKeyIv = iv;
        apiKeyCiphertext = ciphertext;
      }
      if (!current() || user.id !== userId) return;
      await userRepo.update(userId, {
        passwordHash: hash,
        passwordSalt: salt,
        apiKeyIv,
        apiKeyCiphertext,
      });
      // 4. 更新设备加密存储的 Key（新密码下的密文已更新，但设备密钥不变）
      if (!current()) return;
      if (apiKey) void persistApiKey(apiKey, current);
      setOldPwd(''); setNewPwd(''); setConfirmPwd(''); setDone(true);
    } catch (e) {
      if (current()) setError((e as Error)?.message ?? '修改失败，请重试');
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const close = () => { if (!lock.current) { setOpen(false); reset(); } };

  return (
    <div>
      <button
        onClick={() => { reset(); setOpen(true); }}
        className="w-full flex items-center gap-3 px-4 py-3 text-sm text-ink transition-colors hover:bg-surface"
      >
        <span className="text-sm flex-1 text-left">修改密码</span>
        <Icon name="chevron" size={18} />
      </button>

      <Modal presentation="dialog" canSnapshotOnExit={() => false} panelClassName="vg-settings-panel" open={open} onClose={close} title="修改密码" width="max-w-sm" closeOnBackdrop={false} footer={!done ? <div className="vg-settings-design !py-3">              <div className="flex justify-end gap-2">
                <button type="button" disabled={busy} onClick={close} className="vg-button vg-button-secondary">取消</button>
                <button
                  type="submit" form={formId}
                  disabled={busy || !oldPwd || !newPwd || !confirmPwd}
                  className="vg-button vg-button-primary"
                >
                  {busy ? '修改中…' : '确认修改'}
                </button>
              </div></div> : <div className="vg-settings-design !py-3"><button type="button" onClick={close} className="vg-button vg-button-primary w-full">完成</button></div>}>
        <form id={formId} className="vg-settings-design space-y-4" aria-busy={busy} onSubmit={event => { event.preventDefault(); void handleSubmit(); }}>
          {done ? (
            <div className="py-8 text-center">
              <Icon name="check" size={28} className="mx-auto mb-3 text-sub" />
              <p className="text-base text-ink" role="status">密码已修改</p>
            </div>
          ) : (
            <>
              <p className="text-sm leading-7 text-sub">验证原密码后设置新密码。已绑定的 API Key 会随之重新加密。</p>
              <SettingsField label="原密码" type="password" autoComplete="current-password" value={oldPwd} disabled={busy} onChange={e => { setOldPwd(e.target.value); setError(null); }} />
              <SettingsField label="新密码" hint="至少 6 位，不能与原密码相同。" type="password" autoComplete="new-password" value={newPwd} disabled={busy} onChange={e => { setNewPwd(e.target.value); setError(null); }} />
              <SettingsField label="再次输入新密码" type="password" autoComplete="new-password" value={confirmPwd} disabled={busy} onChange={e => { setConfirmPwd(e.target.value); setError(null); }} />
              {error && <FeedbackNotice message={error} tone="error" />}

            </>
          )}
        </form>
      </Modal>
    </div>
  );
}
