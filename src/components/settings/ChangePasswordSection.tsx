import { useState } from 'react';
import { Modal } from '../ui/Modal';
import { useAuthStore } from '../../store/auth-store';
import { userRepo } from '../../db/user-repo';
import { hashPassword, verifyPassword, encryptApiKey } from '../../lib/crypto';
import { persistApiKey } from '../../lib/api-key-storage';

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

  const inputCls =
    'w-full px-3 py-2 bg-surface border border-line-strong rounded-lg text-sm text-ink placeholder-gray-500 focus:outline-none focus:border-gene-purple/50 transition-colors';

  const reset = () => {
    setOldPwd('');
    setNewPwd('');
    setConfirmPwd('');
    setError(null);
    setDone(false);
  };

  const handleSubmit = async () => {
    setError(null);
    const { userId, apiKey } = useAuthStore.getState();
    if (!userId) return;

    // 1. 新密码校验
    if (!newPwd || newPwd.length < 6) { setError('新密码至少需要 6 位'); return; }
    if (newPwd !== confirmPwd) { setError('两次输入的新密码不一致'); return; }
    if (newPwd === oldPwd) { setError('新密码不能与原密码相同'); return; }

    setBusy(true);
    try {
      // 2. 验证原密码
      const user = await userRepo.findByUsername(useAuthStore.getState().username ?? '');
      if (!user) { setError('账号不存在'); return; }
      const ok = await verifyPassword(oldPwd, user.passwordHash, user.passwordSalt);
      if (!ok) { setError('原密码不正确'); return; }

      // 3. 用新密码重新哈希 + 重新加密 API Key
      const saltBytes = Uint8Array.from(atob(user.passwordSalt), (c) => c.charCodeAt(0));
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
      await userRepo.update(userId, {
        passwordHash: hash,
        passwordSalt: salt,
        apiKeyIv,
        apiKeyCiphertext,
      });
      // 4. 更新设备加密存储的 Key（新密码下的密文已更新，但设备密钥不变）
      if (apiKey) void persistApiKey(apiKey);

      setDone(true);
      setTimeout(() => { setOpen(false); reset(); }, 1500);
    } catch (e) {
      setError((e as Error)?.message ?? '修改失败，请重试');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <button
        onClick={() => { reset(); setOpen(true); }}
        className="w-full flex items-center gap-3 px-4 py-3 text-sm text-ink transition-colors hover:bg-surface"
      >
        <span className="text-sm flex-1 text-left">修改密码</span>
        <span className="text-gray-400 text-xs">›</span>
      </button>

      <Modal open={open} onClose={() => { setOpen(false); reset(); }} title="修改密码" width="max-w-sm" closeOnBackdrop={false}>
        <div className="p-6 space-y-4">
          {done ? (
            <div className="py-8 text-center">
              <p className="text-lg mb-2">✓</p>
              <p className="text-sm text-life-cyan">密码已修改</p>
            </div>
          ) : (
            <>
              <p className="text-xs text-gray-500">先验证原密码，再设置新密码（输两次避免输错）。修改后 API Key 会用新密码重新加密。</p>
              <input type="password" value={oldPwd} onChange={(e) => setOldPwd(e.target.value)} placeholder="原密码" className={inputCls} />
              <input type="password" value={newPwd} onChange={(e) => setNewPwd(e.target.value)} placeholder="新密码（至少 6 位）" className={inputCls} />
              <input type="password" value={confirmPwd} onChange={(e) => setConfirmPwd(e.target.value)} placeholder="再次输入新密码" className={inputCls} />
              {error && <p className="text-xs text-red-400">{error}</p>}
              <div className="flex justify-end gap-2">
                <button onClick={() => { setOpen(false); reset(); }} className="px-4 py-2 rounded-lg text-sm text-gray-400 hover:bg-surface transition-colors">取消</button>
                <button
                  onClick={() => void handleSubmit()}
                  disabled={busy || !oldPwd || !newPwd || !confirmPwd}
                  className="px-4 py-2 rounded-lg text-sm bg-gene-purple text-white hover:bg-[#5B4BD4] transition-all disabled:opacity-50"
                >
                  {busy ? '修改中…' : '确认修改'}
                </button>
              </div>
            </>
          )}
        </div>
      </Modal>
    </div>
  );
}
