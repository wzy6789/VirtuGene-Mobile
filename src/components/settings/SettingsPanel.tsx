import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Modal } from '../ui/Modal';
import { resonate } from '../../lib/haptics';
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
import { loadSecret, persistApiKey } from '../../lib/api-key-storage';
import { CLOUD_ASR_KEY_NAME } from '../../lib/cloud-asr';
import { SyncSection } from './SyncSection';
import { BackupSection } from './BackupSection';
import { ChangePasswordSection } from './ChangePasswordSection';
import { ModelSection } from './ModelSection';
import { ApiKeyManager } from './ApiKeyManager';
import { UserProfileModal } from './UserProfileModal';
import { GatewayStatusBadge } from './GatewayStatusBadge';
import { AppearanceSettings } from './AppearanceSettings';
import { VoicePreferences } from './VoicePreferences';
import { SettingsGroup, SettingsIcon, SettingsOverview, SettingsRow } from './SettingsUI';
import { useThemeStore } from '../../store/theme-store';
import { useUIStore } from '../../store/ui-store';
import { DiaryPreferences } from './DiaryPreferences';
import { useSettingsDetailMotion } from './useSettingsDetailMotion';
import { resolveModel } from '../../lib/ai/llm';
import { useAiAvailability } from './useAiAvailability';

export type { SettingsPage } from './settings-directory';
import { directory, detailSearch, pageTitles, SETTINGS_PAGES, type SettingsPage } from './settings-directory';
import { settingsLabelIndex } from './settings-label-index';
import { IS_ELECTRON, IS_MOBILE } from '../../lib/platform';
import { deleteGatewayAccount, isAiGatewayConfigured, refreshGatewaySession, setGatewayAccessToken } from '../../lib/ai/gateway';
import { LegalNoticeModal, type LegalDocument } from '../compliance/LegalNoticeModal';

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
  initialPage?: SettingsPage;
}

function maskKey(apiKey: string): string {
  if (apiKey.length <= 7) return 'sk-****';
  return apiKey.slice(0, 5) + '****' + apiKey.slice(-4);
}

export function SettingsPanel({ open, onClose, initialPage = 'home' }: SettingsPanelProps) {
  const { userId, username, apiKey, gatewayRefreshToken, setApiKey, logout } = useAuthStore();
  const deleteAccount = useChatStore((s) => s.deleteAccount);
  const updateStatus = useUpdateStore((s) => s.status);
  const updateChecking = useUpdateStore((s) => s.checking);
  const checkUpdate = useUpdateStore((s) => s.check);
  const downloadUpdate = useUpdateStore((s) => s.download);
  const installUpdate = useUpdateStore((s) => s.install);

  const [page, setPage] = useState<SettingsPage>(initialPage);
  const [search, setSearch] = useState('');
  const [profileOpen, setProfileOpen] = useState(false);
  const theme = useThemeStore(s => s.theme);
  const themePreference = useThemeStore(s => s.preference);
  const defaultModel = useSettingsStore(s => s.defaultModel);
  const currentModel = resolveModel(null, defaultModel);
  const currentModelConfigured = useAiAvailability(currentModel);
  const contentRef = useRef<HTMLDivElement>(null);
  const positions = useRef(new Map<SettingsPage, number>());
  const navigation = useRef<SettingsPage[]>([]);
  const motionDirection = useRef<1 | -1>(1);
  const detailMotionRef = useSettingsDetailMotion({ page, open, owner: userId, direction: motionDirection.current, scrollTop: positions.current.get(page) ?? 0, allowSnapshot: !['keys', 'credentials', 'inputVoice', 'account', 'diary', 'sync'].includes(page) });
  const navigate = (next: SettingsPage) => {
    const scroller = contentRef.current?.closest('[data-modal-scroll]');
    if (scroller) positions.current.set(page, scroller.scrollTop);
    navigation.current.push(page);
    motionDirection.current = 1;
    setPage(next);
  };
  useEffect(() => {
    if (!open) return;
    setPage(initialPage); setSearch(''); positions.current.clear(); navigation.current = [];
  }, [open, initialPage]);
  useLayoutEffect(() => {
    (contentRef.current?.closest('[role="dialog"]') as HTMLElement | null)?.focus({ preventScroll: true });
  }, [page, open]);
  const parentPage = (): SettingsPage => (SETTINGS_PAGES[page].parent ?? 'home') as SettingsPage;
  const goBack = () => {
    const scroller = contentRef.current?.closest('[data-modal-scroll]');
    if (scroller) positions.current.set(page, scroller.scrollTop);
    motionDirection.current = -1;
    setPage(navigation.current.pop() ?? parentPage());
  };
  const openContent = (view: 'moments' | 'worldSettings') => { onClose(); useUIStore.getState().setActiveView(view); if (view === 'moments') useUIStore.getState().setMomentsSettingsRequested(true); };

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
  const [deleteError, setDeleteError] = useState('');
  const [legalDocument, setLegalDocument] = useState<LegalDocument | null>(null);

  // App version
  const [appVersion, setAppVersion] = useState('');

  // 语音（TTS）设置
  const ttsEnabled = useSettingsStore((s) => s.ttsEnabled);
  const [hasAsrKey, setHasAsrKey] = useState(false);

  useEffect(() => {
    setIsReplacing(false); setNewKey(''); setPassword(''); setShowKey(false); setShowPassword(false); setProfileOpen(false);
  }, [open, userId]);

  useEffect(() => {
    if (!open) return;
    ipc.app.getVersion().then((v) => setAppVersion(v));
    void loadSecret(CLOUD_ASR_KEY_NAME).then((k) => setHasAsrKey(!!k));
  }, [open, page]);

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
    if (!newKey.trim() || !password || isValidating) return;
    const isCurrent = () => useAuthStore.getState().userId === userId;
    setIsValidating(true);
    setKeyError(null);
    try {
    const result = await ipc.key.validate(newKey.trim());
    if (!isCurrent()) return;
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

    const pwdValid = await verifyPassword(password, user.passwordHash, user.passwordSalt);
    if (!isCurrent()) return;
    if (!pwdValid) {
      setKeyError('密码错误，请重新输入');
      setIsValidating(false);
      return;
    }

    // Re-encrypt the new key with the same password
    const salt = Uint8Array.from(atob(user.passwordSalt), (c) => c.charCodeAt(0));
    const { iv, ciphertext } = await encryptApiKey(newKey.trim(), password, salt);
    if (!isCurrent() || user.id !== userId) return;

    // Update IndexedDB user record
    await userRepo.update(userId, { apiKeyIv: iv, apiKeyCiphertext: ciphertext });
    if (!isCurrent()) return;

    // Update in-memory auth store
    setApiKey(newKey.trim());
    await persistApiKey(newKey.trim(), isCurrent);
    if (!isCurrent()) return;

    // Reset state
    setIsReplacing(false);
    setNewKey('');
    setPassword('');
    setKeyError(null);
    setIsValidating(false);
    } catch {
      if (isCurrent()) setKeyError('密钥未能保存，请重试');
    } finally {
      if (isCurrent()) setIsValidating(false);
    }
  };

  const handleDeleteAccount = async () => {
    resonate('warning');
    setIsDeleting(true);
    setDeleteError('');
    try {
      if (isAiGatewayConfigured()) {
        if (gatewayRefreshToken) {
          const session = await refreshGatewaySession(gatewayRefreshToken);
          setGatewayAccessToken(session.accessToken);
          useAuthStore.getState().setGatewayTokens(session);
        }
        await deleteGatewayAccount();
      }
      await deleteAccount();
      useCharacterStateStore.getState().clear();
      useEmotionStore.getState().clearCurrent();
      resetDiaryUnlock();
      setGatewayAccessToken(null);
      localStorage.clear();
      logout();
      setShowDeleteConfirm(false);
      onClose();
    } catch {
      setDeleteError('服务器账号未能删除，请检查网络后重试。本机数据尚未清除。');
    } finally {
      setIsDeleting(false);
    }
  };

  const masked = apiKey ? maskKey(apiKey) : '尚未配置';

  const matchesSearch = (item: {page:SettingsPage; terms:string}) => `${pageTitles[item.page]} ${item.terms} ${settingsLabelIndex[item.page] ?? ''}`.toLowerCase().includes(search.trim().toLowerCase());

  return (
    <>
      <Modal open={open} onClose={onClose} title={pageTitles[page]} mobileFullHeight panelClassName="vg-settings-panel" canSnapshotOnExit={() => useAuthStore.getState().userId === userId} onBack={page === 'home' ? undefined : goBack}>
        <div ref={contentRef} className="vg-settings-design vg-settings-transition" >
          <div key={page} ref={detailMotionRef} className="vg-settings-detail">
          {page === 'home' && <>
            <SettingsOverview />
            <label className="vg-settings-search"><SettingsIcon name="search" /><input aria-label="搜索设置" type="search" placeholder="搜索设置，例如声音、备份" value={search} onChange={e => setSearch(e.target.value)} /></label>
            {['你的偏好', '连接与内容', '设备与软件'].map(group => {
              const items = directory.filter(item => item.group === group && matchesSearch(item));
              return items.length > 0 && <SettingsGroup key={group} title={group}>{items.map(item => <SettingsRow key={item.page} title={pageTitles[item.page]} icon={item.icon} detail={search ? item.detail : undefined} value={item.page === 'appearance' ? themePreference === 'system' ? '跟随系统' : theme === 'dark' ? '深色' : '浅色' : item.page === 'voice' ? ttsEnabled ? '朗读已开启' : '朗读已关闭' : item.page === 'account' ? username ?? undefined : undefined} onClick={() => navigate(item.page)} />)}</SettingsGroup>;
            })}
            {search && detailSearch.some(item => matchesSearch(item)) && <SettingsGroup title="直接进入设置">{detailSearch.filter(item => matchesSearch(item)).map(item => <SettingsRow key={item.page} icon={item.icon} title={pageTitles[item.page]} detail={item.path} onClick={() => navigate(item.page)} />)}</SettingsGroup>}
            {search && ![...directory, ...detailSearch].some(item => matchesSearch(item)) && <p className="vg-settings-intro" role="status">没有找到这项设置，试试“语音”“密钥”或“备份”。</p>}
          </>}
          {page === 'appearance' && <AppearanceSettings />}
          {page === 'account' && <><SettingsGroup title="个人资料"><SettingsRow title="头像与个人资料" icon="account" value={username ?? undefined} onClick={() => setProfileOpen(true)} /></SettingsGroup>{IS_MOBILE && <div className="vg-settings-form"><ChangePasswordSection /></div>}
          {/* Danger zone */}
          <div className="p-4 rounded-xl bg-red-500/5 border border-red-500/10">
            <h3 className="text-sm font-medium text-red-400 mb-2">账号管理</h3>
            <p className="text-xs text-gray-500 mb-3">
              注销后账号与全部本机记录将被永久抹除，此操作不可撤销。
            </p>
            <button
              onClick={() => { setDeleteError(''); setShowDeleteConfirm(true); }}
              className="px-4 py-2 rounded-lg text-sm bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
            >
              注销账号
            </button>
          </div>

          </>}
          {page === 'voice' && <><p className="vg-settings-intro">这里的偏好影响所有角色聊天。专属声线可在对应角色的聊天设置中调整。</p><VoicePreferences /><SettingsGroup title="语音输入"><SettingsRow title="云端识别" icon="voice" value={hasAsrKey ? '已配置' : '未配置'} detail="系统识别不可用时的备用通道" onClick={() => navigate('inputVoice')} /></SettingsGroup></>}
          {page === 'inputVoice' && <ApiKeyManager embedded onlySpeech onClose={() => navigate('voice')} />}
          {page === 'connection' && <><GatewayStatusBadge /><p className="vg-settings-intro">选择默认模型，或管理已有服务的连接。配置密钥不等于连接测试成功。</p><SettingsGroup title="模型与服务"><SettingsRow title="默认对话模型" icon="connection" value={currentModelConfigured ? '已配置' : '待配置'} detail={currentModel.label + (currentModel.provider === 'deepseek' ? ' · DeepSeek 会话统一使用 Flash' : ' · 已固定模型的会话保留原选择')} onClick={() => navigate('model')} /><SettingsRow title="服务商密钥" icon="connection" detail="OpenAI、Claude、Gemini 等平台与自定义 API" onClick={() => navigate('keys')} /><SettingsRow title="账号绑定密钥" icon="account" value={apiKey ? '已配置' : '未配置'} detail="DeepSeek 账号密钥，可选配置" onClick={() => navigate('credentials')} /></SettingsGroup></>}
          {page === 'model' && <ModelSection onManageProviders={() => navigate('keys')} />}
          {page === 'keys' && <ApiKeyManager embedded onClose={() => navigate('connection')} />}
          {page === 'credentials' && <>
          {/* API Key section */}
          <div>
            <h3 className="text-sm font-medium text-ink mb-3">账号绑定密钥</h3>
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
                  更换密钥
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


          </>}
          {page === 'privacy' && <><p className="vg-settings-intro">决定哪些内容属于自己，哪些可以与角色分享。</p><SettingsGroup title="内容设置"><SettingsRow title="日记设置" icon="diary" detail="隐私锁、提醒与分享授权" onClick={() => navigate('diary')} /><SettingsRow title="朋友圈设置" icon="account" detail="好友分享节奏与可见范围" onClick={() => openContent('moments')} /><SettingsRow title="世界设定" icon="world" detail="长期规则、地点与人物事实" onClick={() => openContent('worldSettings')} /></SettingsGroup></>}
          {page === 'diary' && <DiaryPreferences />}
          {page === 'data' && <><p className="vg-settings-intro">把记录妥善留下，也可以与同一网络中的电脑互传。</p><SettingsGroup title="记录与设备"><SettingsRow title="备份与恢复" icon="data" onClick={() => navigate('backup')} /><SettingsRow title="局域网同步" icon="connection" detail="手机与电脑连接同一 Wi-Fi" onClick={() => navigate('sync')} /></SettingsGroup></>}
          {page === 'backup' && <BackupSection />}
          {page === 'sync' && <SyncSection />}
          {page === 'about' && <>
          {/* App update（仅桌面端支持自动更新） */}
          {IS_ELECTRON && (
            <div>
              <h3 className="text-sm font-medium text-ink mb-3">软件更新</h3>
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
                  <div className="space-y-2 text-[11px] text-gray-500 leading-relaxed">
                    <p>聊天记录与日记优先保存在本机，支持局域网同步与加密备份。</p>
                    <p>角色回复由人工智能模型生成，可能存在不准确或不符合预期的内容，请结合自己的判断使用。</p>
                    <p>连接云端 AI 服务时，必要的角色设定、最近对话和当前输入会被发送至 VirtuGene 网关及模型服务商；不会上传你的供应商密钥。</p>
                  </div>
                </div>
                <div className="flex items-center gap-5 py-3">
                  <button type="button" onClick={() => setLegalDocument('privacy')} className="text-xs text-life-cyan hover:underline">隐私说明</button>
                  <button type="button" onClick={() => setLegalDocument('terms')} className="text-xs text-life-cyan hover:underline">使用说明</button>
                  <button type="button" onClick={() => { onClose(); window.dispatchEvent(new Event('virtugene:open-onboarding')); }} className="text-xs text-life-cyan hover:underline">重新查看引导</button>
                </div>
              </div>
            </div>
          )}


          </>}
          </div>
        </div>
      </Modal>
      <UserProfileModal open={profileOpen && open} onClose={() => setProfileOpen(false)} />
      <LegalNoticeModal document={legalDocument} onClose={() => setLegalDocument(null)} />

      {/* Delete account confirmation modal */}
      <Modal panelClassName="vg-settings-panel" open={showDeleteConfirm} title="注销账号" onClose={() => setShowDeleteConfirm(false)}>
        <div className="vg-settings-design">
          <p className="text-sm text-sub mb-2">
            账号与全部本机记录将被永久抹除，此操作不可撤销。
          </p>
          <p className="text-xs text-gray-500 mb-6">确认注销？</p>
          {deleteError && <p className="text-xs text-red-400 mb-4">{deleteError}</p>}
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
