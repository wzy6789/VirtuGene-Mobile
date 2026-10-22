import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { checkUpdate as checkMobileUpdate, openApkDownload, type UpdateInfo } from '../../lib/mobile-update';
import { FeedbackNotice } from '../ui/FeedbackNotice';
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
import { SettingsField, SettingsGroup, SettingsIcon, SettingsOverview, SettingsRow } from './SettingsUI';
import { Icon } from '../ui/Icon';
import { useThemeStore } from '../../store/theme-store';
import { useUIStore } from '../../store/ui-store';
import { DiaryPreferences } from './DiaryPreferences';
import { useSettingsDetailMotion } from './useSettingsDetailMotion';
import { resolveModel } from '../../lib/ai/llm';
import { useAiAvailability } from './useAiAvailability';
import { ProviderConnectionStatus } from './ProviderConnectionStatus';

export type { SettingsPage } from './settings-directory';
import { directory, detailSearch, pageTitles, type SettingsPage } from './settings-directory';
import { settingsLabelIndex } from './settings-label-index';
import { IS_ELECTRON, IS_MOBILE } from '../../lib/platform';
import { deleteGatewayAccount, isAiGatewayConfigured, refreshGatewaySession, setGatewayAccessToken } from '../../lib/ai/gateway-session';
import { LegalNoticeModal, type LegalDocument } from '../compliance/LegalNoticeModal';
const ChatQualityPanel=lazy(()=>import('./ChatQualityPanel').then(module=>({default:module.ChatQualityPanel})));
const CacheSettings=lazy(()=>import('./CacheSettings').then(module=>({default:module.CacheSettings})));

type UpdateState = 'idle' | 'checking' | 'found' | 'opening' | 'opened' | 'latest' | 'error';

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
  const downloadDesktopUpdate = useUpdateStore((s) => s.download);
  const installUpdate = useUpdateStore((s) => s.install);

  const [version, setVersion] = useState<string | null>(null);
  const [updateState, setUpdateState] = useState<UpdateState>('idle');
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const pending = useRef<AbortController | null>(null);
  const context = useRef({ userId, mounted: false });
  context.current.userId = userId;
  useEffect(() => {
    context.current.mounted = true;
    let alive = true;
    void ipc.app.getVersion().then(value => { if (alive) setVersion(value); }).catch(() => { if (alive) setVersion(''); });
    return () => { alive = false; context.current.mounted = false; pending.current?.abort(); pending.current = null; };
  }, []);
  useEffect(() => {
    pending.current?.abort(); pending.current = null;
    setUpdateState('idle'); setUpdateInfo(null);
  }, [userId, open]);
  const isCurrent = (controller: AbortController, owner: string) => context.current.mounted &&
    context.current.userId === owner && useAuthStore.getState().userId === owner &&
    pending.current === controller && !controller.signal.aborted;
  const checkForUpdate = async () => {
    if (!userId || pending.current) return;
    const owner = userId, controller = new AbortController();
    pending.current = controller; setUpdateState('checking');
    try {
      const info = await checkMobileUpdate(controller.signal);
      if (!isCurrent(controller, owner)) return;
      if (!info) setUpdateState('error');
      else if (!info.hasUpdate) setUpdateState('latest');
      else { setUpdateInfo(info); setUpdateState('found'); }
    } catch { if (isCurrent(controller, owner)) setUpdateState('error'); }
    finally { if (pending.current === controller) pending.current = null; }
  };
  const cancelUpdate = () => { pending.current?.abort(); pending.current = null; setUpdateInfo(null); setUpdateState('idle'); };
  const downloadMobileUpdate = async () => {
    if (!userId || !updateInfo || pending.current) return;
    const owner = userId, controller = new AbortController();
    pending.current = controller; setUpdateState('opening');
    try {
      const url = await openApkDownload(updateInfo.apkUrl, controller.signal);
      if (!isCurrent(controller, owner)) return;
      if (url) { setUpdateInfo(null); setUpdateState('opened'); }
      else setUpdateState('error');
    } catch { if (isCurrent(controller, owner)) setUpdateState('error'); }
    finally { if (pending.current === controller) pending.current = null; }
  };
  const [page, setPage] = useState<SettingsPage>(initialPage);
  const [search, setSearch] = useState('');
  const [profileOpen, setProfileOpen] = useState(false);
  const [qualityOpen,setQualityOpen]=useState(false);
  const theme = useThemeStore(s => s.theme);
  const themePreference = useThemeStore(s => s.preference);
  const defaultModel = useSettingsStore(s => s.defaultModel);
  const currentModel = resolveModel(null, defaultModel);
  const currentModelConfigured = useAiAvailability(currentModel);
  const contentRef = useRef<HTMLDivElement>(null);
  const positions = useRef(new Map<SettingsPage, number>());
  const navigation = useRef<SettingsPage[]>([]);
  const providerBack = useRef<(() => void) | null>(null);
  const registerProviderBack = useCallback((handler: (() => void) | null) => { providerBack.current = handler; }, []);
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
  const goBack = () => {
    if (page === 'keys' && providerBack.current) { providerBack.current(); return; }
    const previous = navigation.current.pop();
    if (!previous) { onClose(); return; }
    const scroller = contentRef.current?.closest('[data-modal-scroll]');
    if (scroller) positions.current.set(page, scroller.scrollTop);
    motionDirection.current = -1;
    setPage(previous);
  };
  const openContent = (view: 'moments' | 'worldSettings') => { onClose(); useUIStore.getState().setActiveView(view); if (view === 'moments') useUIStore.getState().setMomentsSettingsRequested(true); };

  // Key replacement state
  const [isReplacing, setIsReplacing] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const keyRequest = useRef(0);

  // Password for re-encryption
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Delete account state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const deleteRequest = useRef(0);
  const deleteLock = useRef<number | null>(null);
  const [legalDocument, setLegalDocument] = useState<LegalDocument | null>(null);

  // 语音（TTS）设置
  const ttsEnabled = useSettingsStore((s) => s.ttsEnabled);
  const [hasAsrKey, setHasAsrKey] = useState(false);

  useEffect(() => {
    setIsReplacing(false); setNewKey(''); setPassword(''); setShowKey(false); setShowPassword(false); setProfileOpen(false);
    setShowDeleteConfirm(false); setDeleteError(''); setLegalDocument(null);
    deleteRequest.current++; deleteLock.current = null; setIsDeleting(false);
    keyRequest.current++; setIsValidating(false);
  }, [open, userId]);

  useEffect(() => {
    if (page !== 'credentials') {
      keyRequest.current++; setIsValidating(false); setIsReplacing(false);
      setNewKey(''); setPassword(''); setShowKey(false); setShowPassword(false); setKeyError(null);
    }
  }, [page]);

  useEffect(() => {
    if (!open) return;
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
    const epoch = ++keyRequest.current;
    const isCurrent = () => useAuthStore.getState().userId === userId && keyRequest.current === epoch;
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
    if (!isCurrent()) return;
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
    if (!userId || deleteLock.current !== null) return;
    const epoch = ++deleteRequest.current;
    const isCurrent = () => deleteRequest.current === epoch && useAuthStore.getState().userId === userId;
    deleteLock.current = epoch;
    resonate('warning');
    setIsDeleting(true);
    setDeleteError('');
    try {
      if (isAiGatewayConfigured()) {
        if (gatewayRefreshToken) {
          const session = await refreshGatewaySession(gatewayRefreshToken);
          if (!isCurrent()) return;
          setGatewayAccessToken(session.accessToken);
          useAuthStore.getState().setGatewayTokens(session);
        }
        await deleteGatewayAccount();
        if (!isCurrent()) return;
      }
      if (!isCurrent()) return;
      await deleteAccount();
      if (!isCurrent()) return;
      useCharacterStateStore.getState().clear();
      useEmotionStore.getState().clearCurrent();
      resetDiaryUnlock();
      setGatewayAccessToken(null);
      localStorage.clear();
      logout();
      setShowDeleteConfirm(false);
      onClose();
    } catch {
      if (isCurrent()) setDeleteError('注销未完成，请重新检查账号状态后重试。');
    } finally {
      if (deleteLock.current === epoch) deleteLock.current = null;
      if (isCurrent()) setIsDeleting(false);
    }
  };

  const updateLabel = updateState === 'latest' ? '已是最新版本' : updateState === 'error' ? '检查失败，可重试' : updateState === 'opened' ? '请在系统下载器中继续' : updateState === 'found' ? '发现新版本' : '';

  const masked = apiKey ? maskKey(apiKey) : '尚未配置';

  const matchesSearch = (item: {page:SettingsPage; terms:string}) => `${pageTitles[item.page]} ${item.terms} ${settingsLabelIndex[item.page] ?? ''}`.toLowerCase().includes(search.trim().toLowerCase());

  return (
    <>
      <Modal open={open} onClose={onClose} title={pageTitles[page]} mobileFullHeight panelClassName="vg-settings-panel" canSnapshotOnExit={() => useAuthStore.getState().userId === userId && !['keys', 'credentials', 'inputVoice', 'account', 'diary', 'sync'].includes(page)} onBack={page === 'home' ? undefined : goBack}>
        <div ref={contentRef} className="vg-settings-design vg-settings-transition" >
          <div key={page} ref={detailMotionRef} className={`vg-settings-detail ${page === 'home' || page === 'connection' ? 'vg-settings-open-list' : ''}`}>
          {page === 'home' && <>
            <SettingsOverview />
            <label className="vg-search-field vg-settings-search"><SettingsIcon name="search" /><input aria-label="搜索设置" type="search" placeholder="搜索设置，例如声音、备份" value={search} onChange={e => setSearch(e.target.value)} /></label>
            {['你的偏好', '连接与内容', '设备与软件'].map(group => {
              const items = directory.filter(item => item.group === group && matchesSearch(item));
              return items.length > 0 && <SettingsGroup key={group} title={group}>{items.map(item => <SettingsRow key={item.page} title={pageTitles[item.page]} icon={item.icon} detail={search ? item.detail : undefined} value={item.page === 'appearance' ? themePreference === 'system' ? '跟随系统' : theme === 'dark' ? '深色' : '浅色' : item.page === 'voice' ? ttsEnabled ? '朗读已开启' : '朗读已关闭' : item.page === 'account' ? username ?? undefined : undefined} onClick={() => navigate(item.page)} />)}</SettingsGroup>;
            })}
            {search && detailSearch.some(item => matchesSearch(item)) && <SettingsGroup title="直接进入设置">{detailSearch.filter(item => matchesSearch(item)).map(item => <SettingsRow key={item.page} icon={item.icon} title={pageTitles[item.page]} detail={item.path} onClick={() => navigate(item.page)} />)}</SettingsGroup>}
            {search && ![...directory, ...detailSearch].some(item => matchesSearch(item)) && <p className="vg-settings-intro" role="status">没有找到这项设置，试试“语音”“密钥”或“备份”。</p>}
          </>}
          {page === 'appearance' && <AppearanceSettings />}
          {page === 'account' && <><SettingsGroup title="头像"><SettingsRow title="更换头像" icon="account" value={username ?? undefined} onClick={() => setProfileOpen(true)} /></SettingsGroup>{IS_MOBILE && <div className="vg-settings-form"><ChangePasswordSection /></div>}
          {/* Danger zone */}
          <div className="vg-settings-form">
            <h3 className="text-sm font-medium text-ink mb-2">账号管理</h3>
            <p className="text-sm leading-7 text-sub mb-3">
              注销后账号与全部本机记录将被永久抹除，此操作不可撤销。
            </p>
            <button
              onClick={() => { setDeleteError(''); setShowDeleteConfirm(true); }}
              className="vg-button vg-button-danger"
            >
              注销账号
            </button>
          </div>

          </>}
          {page === 'voice' && <><VoicePreferences /><SettingsGroup title="语音输入"><SettingsRow title="云端识别" icon="voice" value={hasAsrKey ? '已配置' : '未配置'} onClick={() => navigate('inputVoice')} /></SettingsGroup></>}
          {page === 'inputVoice' && <ApiKeyManager embedded onlySpeech onClose={() => navigate('voice')} />}
          {page === 'connection' && <><section className="vg-settings-model-summary" aria-label="当前默认模型">
            <div><span>默认对话模型</span><span>{currentModelConfigured ? '配置已就绪' : '还需配置连接'}</span></div>
            <h3>{currentModel.label}</h3>
            <ProviderConnectionStatus provider={currentModel.provider} model={currentModel.id} active={open && page === 'connection'}/>
            <button type="button" className="vg-button vg-button-secondary" onClick={() => navigate('model')}>选择模型<Icon name="chevron" size={18}/></button>
          </section><SettingsGroup title="连接管理"><SettingsRow title="服务商密钥" icon="connection" detail="OpenAI、Claude、Gemini 等平台与自定义 API" onClick={() => navigate('keys')} /><SettingsRow title="账号绑定密钥" icon="account" value={apiKey ? '已配置' : '未配置'} detail="DeepSeek 账号密钥，可选配置" onClick={() => navigate('credentials')} /></SettingsGroup><GatewayStatusBadge /></>}
          {page === 'model' && <ModelSection onManageProviders={() => navigate('keys')} />}
          {page === 'keys' && <ApiKeyManager embedded onClose={() => navigate('connection')} onBackHandlerChange={registerProviderBack} />}
          {page === 'credentials' && <>
          {/* API Key section */}
          <div>
            <h3 className="text-sm font-medium text-ink mb-3">账号绑定密钥</h3>
            <div className="vg-settings-form space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1 space-y-1">
                  <span className="text-xs text-sub">API Key</span>
                  <span className="block text-sm text-ink font-mono break-all" data-sensitive>
                    {showKey ? apiKey : masked}
                  </span>
                </div>
                <button
                  onClick={() => setShowKey(!showKey)}
                  type="button" aria-pressed={showKey} aria-label={showKey ? '隐藏账号密钥' : '显示账号密钥'} className="vg-button vg-button-secondary shrink-0"
                >
                  {showKey ? '隐藏' : '显示'}
                </button>
              </div>

              {!isReplacing ? (
                <button
                  onClick={handleStartReplace}
                  className="vg-button vg-button-secondary"
                >
                  更换密钥
                </button>
              ) : (
                <div className="space-y-3 pt-2 border-t border-line">
                  <SettingsField label="新的 API Key" autoComplete="off" spellCheck={false} autoCapitalize="none" disabled={isValidating} data-sensitive
                    type={showKey ? 'text' : 'password'}
                    value={newKey}
                    onChange={(e) => {
                      setNewKey(e.target.value);
                      setKeyError(null);
                    }}
                    placeholder="输入新的 API Key (sk-...)"
                  />
                  <div className="space-y-2">
                    <SettingsField label="登录密码" autoComplete="current-password" disabled={isValidating} data-sensitive
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="输入登录密码以确认"
                    />
                    <button
                      onClick={() => setShowPassword(!showPassword)}
                      type="button" aria-pressed={showPassword} className="vg-button vg-button-ghost"
                    >
                      <Icon name="eye" />{showPassword ? '隐藏密码' : '显示密码'}
                    </button>
                  </div>
                  {keyError && (
                    <FeedbackNotice message={keyError} tone="error" />
                  )}
                  <div className="flex gap-2">
                    <button
                      onClick={handleValidateAndSave}
                      disabled={!newKey.trim() || !password.trim() || isValidating}
                      className="vg-button vg-button-primary"
                    >
                      {isValidating ? '验证中...' : '确认更换'}
                    </button>
                    <button
                      onClick={handleCancelReplace}
                      disabled={isValidating} className="vg-button vg-button-secondary"
                    >
                      取消
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>


          </>}
          {page === 'privacy' && <><SettingsGroup title="内容设置"><SettingsRow title="日记设置" icon="diary" detail="隐私锁、提醒与分享授权" onClick={() => navigate('diary')} /><SettingsRow title="朋友圈设置" icon="account" detail="好友分享节奏与可见范围" onClick={() => openContent('moments')} /><SettingsRow title="世界设定" icon="world" detail="长期规则、地点与人物事实" onClick={() => openContent('worldSettings')} /></SettingsGroup></>}
          {page === 'diary' && <DiaryPreferences />}
          {page === 'data' && <><SettingsGroup title="记录与设备"><SettingsRow title="备份与恢复" icon="data" onClick={() => navigate('backup')} /><SettingsRow title="局域网同步" icon="connection" detail="手机与电脑连接同一 Wi-Fi" onClick={() => navigate('sync')} /><SettingsRow title="聊天质量" icon="data" detail="本机统计、声音样本与表达验收" onClick={()=>setQualityOpen(true)} /><SettingsRow title="清理缓存" icon="data" detail="保留聊天与生活记录" onClick={() => navigate('cache')} /></SettingsGroup></>}
          {page === 'backup' && <BackupSection />}
          {page === 'cache' && <Suspense fallback={<p className="vg-settings-intro">正在检查缓存…</p>}><CacheSettings /></Suspense>}
          {page === 'sync' && <SyncSection />}
          {page === 'about' && <>
          {/* App update（仅桌面端支持自动更新） */}
          {IS_ELECTRON && (
            <div>
              <h3 className="text-sm font-medium text-ink mb-3">软件更新</h3>
            <div className="p-4 rounded-xl bg-surface border border-line space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-400">当前版本</span>
                <span className="text-sm text-ink font-mono">{version === null ? '读取中…' : version ? `v${version}` : '未读取到'}</span>
              </div>

              {updateStatus?.state === 'available' && (
                <button
                  onClick={downloadDesktopUpdate}
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
              <h3 className="text-xl font-bold text-ink mb-3">VirtuGene</h3>
              <div className="vg-settings-form space-y-1 divide-y divide-line">
                <div className="flex items-center justify-between py-2">
                  <span className="text-sm text-sub">版本</span>
                  <span className="text-sm text-ink font-mono">{version === null ? '读取中…' : version ? `v${version}` : '未读取到'}</span>
                </div>
                <div className="py-2">
                  <button type="button" className="vg-button vg-button-secondary w-full" onClick={() => void checkForUpdate()} disabled={updateState === 'checking' || updateState === 'opening'}>{updateState === 'checking' ? '检查更新中…' : updateState === 'opening' ? '正在打开下载链接…' : '检查更新'}</button>
                  {updateLabel && <p role="status" aria-live="polite" className="mt-2 text-sm text-sub">{updateLabel}</p>}
                </div>
                <div className="py-2">
                  <div className="space-y-3 text-sm text-sub leading-7">
                    <p>聊天记录与日记优先保存在本机，支持局域网同步与加密备份。</p>
                    <p>角色回复由人工智能模型生成，可能存在不准确或不符合预期的内容，请结合自己的判断使用。</p>
                    <p>云端 AI 会处理本轮输入与必要上下文。网关模式经 VirtuGene 转发；自带密钥模式向所选服务商或自定义地址发送请求，密钥随该请求用于认证。详见隐私说明。</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 py-3">
                  <button type="button" onClick={() => setLegalDocument('privacy')} className="vg-button vg-button-ghost"><Icon name="shield" />隐私说明</button>
                  <button type="button" onClick={() => setLegalDocument('terms')} className="vg-button vg-button-ghost"><Icon name="info" />使用说明</button>
                  <button type="button" onClick={() => { onClose(); window.dispatchEvent(new Event('virtugene:open-onboarding')); }} className="vg-button vg-button-ghost"><Icon name="spark" />重新查看引导</button>
                </div>
              </div>
            </div>
          )}


          </>}
          </div>
        </div>
      </Modal>
    <Modal presentation="dialog" open={open && !!updateInfo} title="发现新版本" onClose={cancelUpdate} canSnapshotOnExit={() => false}>
      <div className="p-5 space-y-4 text-ink">
        <p className="text-xl break-words">{updateInfo && 'v' + updateInfo.version}</p>
        <p className="text-sm leading-7 whitespace-pre-wrap break-words">{updateInfo?.notes.slice(0, 2000) || '可以继续使用当前版本，确认后再打开下载链接。'}</p>
        {updateState === 'error' && <p role="alert" className="text-sm text-sub">下载链接暂时没有打开，可以再试一次。</p>}
        <div className="flex flex-wrap justify-end gap-2"><button type="button" className="vg-button vg-button-secondary" onClick={cancelUpdate}>暂不更新</button><button type="button" className="vg-button vg-button-primary" onClick={() => void downloadMobileUpdate()} disabled={updateState === 'opening'}>{updateState === 'opening' ? '正在打开…' : '下载更新'}</button></div>
      </div>
    </Modal>
      <UserProfileModal open={profileOpen && open} onClose={() => setProfileOpen(false)} />
      {qualityOpen&&open&&<Suspense fallback={null}><ChatQualityPanel open onClose={()=>setQualityOpen(false)} /></Suspense>}
      <LegalNoticeModal document={open ? legalDocument : null} onClose={() => setLegalDocument(null)} />

      {/* Delete account confirmation modal */}
      <Modal presentation="dialog" panelClassName="vg-settings-panel" open={showDeleteConfirm && open} title="注销账号" onClose={() => { if (!isDeleting) setShowDeleteConfirm(false); }} canSnapshotOnExit={() => false}>
        <div className="vg-settings-design space-y-4" aria-busy={isDeleting}>
          <p className="text-sm leading-7 text-sub">
            账号与全部本机记录将被永久抹除，此操作不可撤销。
          </p>
          {deleteError && <FeedbackNotice message={deleteError} tone="error" className="mb-4" />}
          <div className="flex gap-3 justify-end">
            <button
              onClick={() => setShowDeleteConfirm(false)}
              disabled={isDeleting} className="vg-button vg-button-secondary"
            >
              取消
            </button>
            <button
              onClick={handleDeleteAccount}
              disabled={isDeleting}
              className="vg-button vg-button-danger"
            >
              {isDeleting ? '注销中...' : '确认注销'}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
