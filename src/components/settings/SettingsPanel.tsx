import { useEffect, useState } from 'react';
import { Modal } from '../ui/Modal';
import { useAuthStore } from '../../store/auth-store';
import { useChatStore } from '../../store/chat-store';
import { useCharacterStateStore } from '../../store/character-state-store';
import { useEmotionStore } from '../../store/emotion-store';
import { useUpdateStore } from '../../store/update-store';
import { userRepo } from '../../db/user-repo';
import { encryptApiKey, verifyPassword } from '../../lib/crypto';
import { ipc } from '../../lib/ipc-client';
import { resetDiaryUnlock } from '../../lib/diary-unlock';
import { SyncSection } from './SyncSection';
import { BackupSection } from './BackupSection';
import { IS_ELECTRON, IS_MOBILE } from '../../lib/platform';

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
}

function maskKey(apiKey: string): string {
  if (apiKey.length <= 7) return 'sk-****';
  return apiKey.slice(0, 5) + '****' + apiKey.slice(-4);
}

export function SettingsPanel({ open, onClose }: SettingsPanelProps) {
  const { userId, username, apiKey, setApiKey, logout } = useAuthStore();
  const deleteAccount = useChatStore((s) => s.deleteAccount);
  const updateStatus = useUpdateStore((s) => s.status);
  const updateChecking = useUpdateStore((s) => s.checking);
  const checkUpdate = useUpdateStore((s) => s.check);
  const downloadUpdate = useUpdateStore((s) => s.download);
  const installUpdate = useUpdateStore((s) => s.install);

  // Key replacement state
  const [isReplacing, setIsReplacing] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [isValidating, setIsValidating] = useState(false);

  // Password for re-encryption
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Delete account state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // App version
  const [appVersion, setAppVersion] = useState('');

  useEffect(() => {
    if (!open) return;
    ipc.app.getVersion().then((v) => setAppVersion(v));
  }, [open]);

  const handleStartReplace = () => {
    setIsReplacing(true);
    setNewKey('');
    setPassword('');
    setKeyError(null);
  };

  const handleCancelReplace = () => {
    setIsReplacing(false);
    setNewKey('');
    setPassword('');
    setKeyError(null);
  };

  const handleValidateAndSave = async () => {
    if (!newKey.trim() || !password.trim()) return;
    setIsValidating(true);
    setKeyError(null);

    const result = await ipc.key.validate(newKey.trim());
    if (!result.valid) {
      setKeyError(result.error ?? 'Key 无效');
      setIsValidating(false);
      return;
    }

    // Verify password before re-encrypting
    if (!username || !userId) {
      setKeyError('用户信息丢失，请重新登录');
      setIsValidating(false);
      return;
    }

    const user = await userRepo.findByUsername(username);
    if (!user) {
      setKeyError('用户信息丢失，请重新登录');
      setIsValidating(false);
      return;
    }

    const pwdValid = await verifyPassword(password.trim(), user.passwordHash, user.passwordSalt);
    if (!pwdValid) {
      setKeyError('密码错误，请重新输入');
      setIsValidating(false);
      return;
    }

    // Re-encrypt the new key with the same password
    const salt = Uint8Array.from(atob(user.passwordSalt), (c) => c.charCodeAt(0));
    const { iv, ciphertext } = await encryptApiKey(newKey.trim(), password.trim(), salt);

    // Update IndexedDB user record
    await userRepo.update(userId, { apiKeyIv: iv, apiKeyCiphertext: ciphertext });

    // Update in-memory auth store
    setApiKey(newKey.trim());

    // Reset state
    setIsReplacing(false);
    setNewKey('');
    setPassword('');
    setKeyError(null);
    setIsValidating(false);
  };

  const handleDeleteAccount = async () => {
    setIsDeleting(true);
    await deleteAccount();
    useCharacterStateStore.getState().clear();
    useEmotionStore.getState().clearCurrent();
    resetDiaryUnlock();
    localStorage.clear();
    logout();
    setIsDeleting(false);
    setShowDeleteConfirm(false);
    onClose();
  };

  const masked = apiKey ? maskKey(apiKey) : '';

  return (
    <>
      <Modal open={open} onClose={onClose} title="设置">
        <div className="p-6 space-y-6">
          {/* API Key section */}
          <div>
            <h3 className="text-sm font-medium text-ink mb-3">基因序列标识</h3>
            <div className="p-4 rounded-xl bg-surface border border-line space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400">API Key</span>
                  <span className="text-sm text-ink font-mono">
                    {showKey ? apiKey : masked}
                  </span>
                </div>
                <button
                  onClick={() => setShowKey(!showKey)}
                  className="text-xs text-gray-500 hover:text-sub transition-colors"
                >
                  {showKey ? '隐藏' : '显示'}
                </button>
              </div>

              {!isReplacing ? (
                <button
                  onClick={handleStartReplace}
                  className="text-xs text-life-cyan hover:underline"
                >
                  更换基因序列
                </button>
              ) : (
                <div className="space-y-3 pt-2 border-t border-line">
                  <input
                    type={showKey ? 'text' : 'password'}
                    value={newKey}
                    onChange={(e) => {
                      setNewKey(e.target.value);
                      setKeyError(null);
                    }}
                    placeholder="输入新的 API Key (sk-...)"
                    className="w-full px-3 py-2 bg-surface border border-line-strong rounded-lg text-sm text-ink placeholder-gray-500 focus:outline-none focus:border-gene-purple/50 transition-colors"
                  />
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="输入登录密码以确认"
                      className="w-full px-3 py-2 bg-surface border border-line-strong rounded-lg text-sm text-ink placeholder-gray-500 focus:outline-none focus:border-gene-purple/50 transition-colors"
                    />
                    <button
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-500 hover:text-sub"
                    >
                      {showPassword ? '隐藏' : '显示'}
                    </button>
                  </div>
                  {keyError && (
                    <p className="text-xs text-red-400">{keyError}</p>
                  )}
                  <div className="flex gap-2">
                    <button
                      onClick={handleValidateAndSave}
                      disabled={!newKey.trim() || !password.trim() || isValidating}
                      className="px-4 py-2 rounded-lg text-sm bg-gene-purple hover:bg-[#5B4BD4] disabled:opacity-30 text-white transition-colors"
                    >
                      {isValidating ? '验证中...' : '确认更换'}
                    </button>
                    <button
                      onClick={handleCancelReplace}
                      className="px-4 py-2 rounded-lg text-sm text-gray-400 hover:bg-surface transition-colors"
                    >
                      取消
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 局域网同步：手机端作为客户端直连桌面端同步服务 */}
          {IS_MOBILE && <SyncSection />}

          {/* 数据备份 / 一键恢复（手机端，卸载不丢数据） */}
          {IS_MOBILE && <BackupSection />}

          {/* App update（仅桌面端支持自动更新） */}
          {IS_ELECTRON && (
            <div>
              <h3 className="text-sm font-medium text-ink mb-3">基因序列更新</h3>
            <div className="p-4 rounded-xl bg-surface border border-line space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-400">当前版本</span>
                <span className="text-sm text-ink font-mono">{appVersion ? `v${appVersion}` : 'v...'}</span>
              </div>

              {updateStatus?.state === 'available' && (
                <button
                  onClick={downloadUpdate}
                  className="w-full px-4 py-2 rounded-lg text-sm bg-gene-purple text-white hover:bg-[#5B4BD4] transition-colors"
                >
                  下载新版本 v{updateStatus.version}
                </button>
              )}
              {updateStatus?.state === 'downloaded' && (
                <button
                  onClick={installUpdate}
                  className="w-full px-4 py-2 rounded-lg text-sm bg-gene-purple text-white hover:bg-[#5B4BD4] transition-colors"
                >
                  重启安装 v{updateStatus.version}
                </button>
              )}
              {updateStatus?.state === 'downloading' && (
                <p className="text-xs text-life-cyan">正在下载更新... {updateStatus.percent}%</p>
              )}
              {updateStatus?.state === 'not-available' && (
                <p className="text-xs text-sub">已是最新版本</p>
              )}
              {updateStatus?.state === 'error' && (
                <p className="text-xs text-red-400">{updateStatus.message}</p>
              )}

              <button
                onClick={checkUpdate}
                disabled={updateChecking}
                className="w-full px-4 py-2 rounded-lg text-sm text-ink bg-surface border border-line-strong hover:border-gene-purple/50 disabled:opacity-50 transition-colors"
              >
                {updateChecking ? '检查中...' : '检查更新'}
              </button>
            </div>
            </div>
          )}

          {/* Danger zone */}
          <div className="p-4 rounded-xl bg-red-500/5 border border-red-500/10">
            <h3 className="text-sm font-medium text-red-400 mb-2">危险区域</h3>
            <p className="text-xs text-gray-500 mb-3">
              注销后所有基因序列和对话记录将被永久抹除，此操作不可撤销。
            </p>
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="px-4 py-2 rounded-lg text-sm bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
            >
              注销账号
            </button>
          </div>
        </div>
      </Modal>

      {/* Delete account confirmation modal */}
      <Modal open={showDeleteConfirm} onClose={() => setShowDeleteConfirm(false)}>
        <div className="p-6">
          <p className="text-sm text-sub mb-2">
            所有基因序列和对话记录将被永久抹除，此操作不可撤销。
          </p>
          <p className="text-xs text-gray-500 mb-6">确认注销？</p>
          <div className="flex gap-3 justify-end">
            <button
              onClick={() => setShowDeleteConfirm(false)}
              className="px-4 py-2 rounded-lg text-sm text-gray-400 hover:bg-surface transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleDeleteAccount}
              disabled={isDeleting}
              className="px-4 py-2 rounded-lg text-sm bg-red-500/20 text-red-400 hover:bg-red-500/30 disabled:opacity-50 transition-colors"
            >
              {isDeleting ? '注销中...' : '确认注销'}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
