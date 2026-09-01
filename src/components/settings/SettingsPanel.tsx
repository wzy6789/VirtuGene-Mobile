import { useEffect, useState } from 'react';
import { Modal } from '../ui/Modal';
import { useAuthStore } from '../../store/auth-store';
import { useChatStore } from '../../store/chat-store';
import { useCharacterStateStore } from '../../store/character-state-store';
import { useEmotionStore } from '../../store/emotion-store';
import { useUpdateStore } from '../../store/update-store';
import { useSettingsStore } from '../../store/settings-store';
import { userRepo } from '../../db/user-repo';
import { encryptApiKey, verifyPassword } from '../../lib/crypto';
import { ipc } from '../../lib/ipc-client';
import { resetDiaryUnlock } from '../../lib/diary-unlock';
import { persistSecret, loadSecret, clearSecret } from '../../lib/api-key-storage';
import { CLOUD_ASR_KEY_NAME } from '../../lib/cloud-asr';
import { SyncSection } from './SyncSection';
import { BackupSection } from './BackupSection';
import { ChangePasswordSection } from './ChangePasswordSection';
import { ModelSection } from './ModelSection';
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

  // 语音（TTS）设置
  const ttsEnabled = useSettingsStore((s) => s.ttsEnabled);
  const setTtsEnabled = useSettingsStore((s) => s.setTtsEnabled);
  const ttsSpeed = useSettingsStore((s) => s.ttsSpeed);
  const setTtsSpeed = useSettingsStore((s) => s.setTtsSpeed);
  const ttsEngine = useSettingsStore((s) => s.ttsEngine);
  const setTtsEngine = useSettingsStore((s) => s.setTtsEngine);
  const aiVoiceMode = useSettingsStore((s) => s.aiVoiceMode);
  const setAiVoiceMode = useSettingsStore((s) => s.setAiVoiceMode);
  const [asrKey, setAsrKey] = useState('');
  const [hasAsrKey, setHasAsrKey] = useState(false);

  // 我的背景（时代/社会背景）：让角色贴合用户所处的时代与生活语境
  const userBackground = useSettingsStore((s) => s.userBackground);
  const setUserBackground = useSettingsStore((s) => s.setUserBackground);
  const [userBg, setUserBg] = useState(userBackground);
  const saveUserBg = () => setUserBackground({ era: userBg.era.trim(), social: userBg.social.trim() });

  useEffect(() => {
    if (!open) return;
    ipc.app.getVersion().then((v) => setAppVersion(v));
    void loadSecret(CLOUD_ASR_KEY_NAME).then((k) => setHasAsrKey(!!k));
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

          {/* 账号安全（手机端：修改密码） */}
          {IS_MOBILE && (
            <div>
              <h3 className="text-sm font-medium text-ink mb-3">账号安全</h3>
              <div className="p-1 rounded-xl bg-surface border border-line divide-y divide-line overflow-hidden">
                <ChangePasswordSection />
              </div>
            </div>
          )}

          {/* 语音（TTS）（手机端：朗读开关 + 语速 + 云端识别 Key） */}
          {IS_MOBILE && (
            <div>
              <h3 className="text-sm font-medium text-ink mb-3">语音</h3>
              <div className="p-4 rounded-xl bg-surface border border-line space-y-3">
                {/* 朗读总开关 */}
                <label className="flex items-center justify-between gap-3">
                  <span className="text-xs text-gray-500">角色语音（点击消息 🔊 朗读）</span>
                  <button
                    onClick={() => setTtsEnabled(!ttsEnabled)}
                    title={ttsEnabled ? '已开启' : '已关闭'}
                    className={`relative w-11 h-6 rounded-full transition-colors ${ttsEnabled ? 'bg-gene-purple' : 'bg-gray-300'}`}
                  >
                    <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${ttsEnabled ? 'left-[22px]' : 'left-0.5'}`} />
                  </button>
                </label>
                {/* AI 语音消息（AI 回复自动合成语音，显示为语音气泡） */}
                <label className="flex items-center justify-between gap-3">
                  <span className="text-xs text-gray-500">AI 语音消息（回复自动合成语音）</span>
                  <button
                    onClick={() => setAiVoiceMode(!aiVoiceMode)}
                    title={aiVoiceMode ? '已开启' : '已关闭'}
                    className={`relative w-11 h-6 rounded-full transition-colors ${aiVoiceMode ? 'bg-gene-purple' : 'bg-gray-300'}`}
                  >
                    <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${aiVoiceMode ? 'left-[22px]' : 'left-0.5'}`} />
                  </button>
                </label>
                {/* 朗读语速 */}
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500">朗读语速</span>
                  <div className="flex rounded-lg border border-line overflow-hidden">
                    {[[0.8, '慢'], [1.0, '标准'], [1.2, '快']].map(([v, l]) => (
                      <button
                        key={v}
                        onClick={() => setTtsSpeed(Number(v))}
                        className={`px-3 py-1.5 text-xs transition-colors ${ttsSpeed === Number(v) ? 'bg-gene-purple/15 text-gene-purple' : 'text-gray-500 hover:text-ink'}`}
                      >
                        {l}
                      </button>
                    ))}
                  </div>
                </div>
                {/* 朗读引擎 */}
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500">朗读引擎</span>
                  <div className="flex rounded-lg border border-line overflow-hidden">
                    {[['edge', 'Edge'], ['mimo', 'MiMo']].map(([v, l]) => (
                      <button
                        key={v}
                        onClick={() => setTtsEngine(v as 'edge' | 'mimo')}
                        className={`px-3 py-1.5 text-xs transition-colors ${ttsEngine === v ? 'bg-gene-purple/15 text-gene-purple' : 'text-gray-500 hover:text-ink'}`}
                      >
                        {l}
                      </button>
                    ))}
                  </div>
                </div>
                <p className="text-[10px] text-gray-500 leading-relaxed -mt-1">
                  MiMo 需配置 MiMo API Key（我的 → API Key）；未配或失败自动回退 Edge → 系统语音。
                </p>
                {/* 云端识别 Key（语音转文字备用通道） */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs text-ink">云端识别</span>
                    <span className="text-[10px] text-life-cyan">{hasAsrKey ? '已配置' : '未配置'}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="password"
                      value={asrKey}
                      onChange={(e) => setAsrKey(e.target.value)}
                      placeholder="sk-…（硅基流动，选填）"
                      autoComplete="off"
                      className="flex-1 min-w-0 bg-surface border border-line-strong rounded-lg px-2.5 py-1.5 text-xs text-ink placeholder-gray-500 outline-none focus:border-gene-purple transition-colors"
                    />
                    <button
                      onClick={() => {
                        const k = asrKey.trim();
                        if (!k) return;
                        void persistSecret(CLOUD_ASR_KEY_NAME, k);
                        setAsrKey('');
                        setHasAsrKey(true);
                      }}
                      className="shrink-0 px-2.5 py-1.5 rounded-lg text-[11px] bg-gene-purple/15 text-gene-purple hover:bg-gene-purple/25 transition-colors"
                    >
                      保存
                    </button>
                    {hasAsrKey && (
                      <button
                        onClick={() => {
                          void clearSecret(CLOUD_ASR_KEY_NAME);
                          setHasAsrKey(false);
                        }}
                        className="shrink-0 px-2.5 py-1.5 rounded-lg text-[11px] text-gray-400 hover:text-red-400 transition-colors"
                      >
                        清除
                      </button>
                    )}
                  </div>
                  <p className="text-[10px] text-gray-500 leading-relaxed mt-1">
                    发语音时的转文字通道：优先用手机系统识别；部分手机（如 OPPO/ColorOS）没有系统识别，
                    填此 Key 后会自动用云端转文字（免费）。获取：注册 cloud.siliconflow.cn → 创建密钥。
                    Key 设备加密保存，不落明文。
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* 我的背景：让角色贴合用户所处的时代与社会语境 */}
          <div>
            <h3 className="text-sm font-medium text-ink mb-3">我的背景</h3>
            <div className="p-4 rounded-xl bg-surface border border-line space-y-3">
              <div>
                <p className="text-xs text-gray-500 mb-1.5">时代背景</p>
                <input
                  value={userBg.era}
                  onChange={(e) => setUserBg({ ...userBg, era: e.target.value })}
                  onBlur={saveUserBg}
                  placeholder="如：2026 年，人工智能普及的时代"
                  className="w-full bg-panel border border-line-strong rounded-lg px-3 py-2 text-xs text-ink placeholder-gray-500 outline-none focus:border-gene-purple"
                />
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1.5">社会 / 生活背景</p>
                <input
                  value={userBg.social}
                  onChange={(e) => setUserBg({ ...userBg, social: e.target.value })}
                  onBlur={saveUserBg}
                  placeholder="如：普通上班族，住在一线城市"
                  className="w-full bg-panel border border-line-strong rounded-lg px-3 py-2 text-xs text-ink placeholder-gray-500 outline-none focus:border-gene-purple"
                />
              </div>
              <p className="text-[10px] text-gray-500 leading-relaxed">
                填上你的时代与生活背景后，角色会默认与你在同一时代、同一语境里对话（说话用词、生活细节都会贴合）。
              </p>
            </div>
          </div>

          {/* 对话模型（手机端：多服务商 Key + 默认模型选择） */}
          {IS_MOBILE && <ModelSection />}

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

          {/* 关于与帮助（手机端微信/QQ 式） */}
          {IS_MOBILE && (
            <div>
              <h3 className="text-sm font-medium text-ink mb-3">关于</h3>
              <div className="p-4 rounded-xl bg-surface border border-line space-y-1 divide-y divide-line">
                <div className="flex items-center justify-between py-2">
                  <span className="text-sm text-sub">版本</span>
                  <span className="text-sm text-ink font-mono">v{appVersion || '...'}</span>
                </div>
                <div className="flex items-center justify-between py-2">
                  <span className="text-sm text-sub">口号</span>
                  <span className="text-xs text-life-cyan">Unlock Your Digital Soul</span>
                </div>
                <div className="py-2">
                  <p className="text-[11px] text-gray-500 leading-relaxed">
                    VirtuGene 手机版：数据全部存储在本机，支持局域网同步与加密备份。
                  </p>
                </div>
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
