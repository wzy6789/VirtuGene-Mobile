import { useEffect, useState } from 'react';
import { useAuthStore, DEFAULT_USER_AVATAR } from '../../store/auth-store';
import { useThemeStore } from '../../store/theme-store';
import { useChatStore } from '../../store/chat-store';
import { useCharacterStateStore } from '../../store/character-state-store';
import { useEmotionStore } from '../../store/emotion-store';
import { resetDiaryUnlock } from '../../lib/diary-unlock';
import { ipc } from '../../lib/ipc-client';
import { Avatar } from '../ui/Avatar';
import { Modal } from '../ui/Modal';
import { SettingsPanel } from '../settings/SettingsPanel';
import { UserProfileModal } from '../settings/UserProfileModal';
import { ApiKeyManager } from '../settings/ApiKeyManager';
import { checkUpdate, openApkDownload } from '../../lib/mobile-update';
import { clearPersistedApiKey } from '../../lib/api-key-storage';

/** 功能列表线性图标（SVG，克制不花哨） */
function RowIcon({ name }: { name: 'settings' | 'theme' | 'version' }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className: 'text-gene-purple/70',
  };
  if (name === 'settings')
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    );
  if (name === 'theme')
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
      </svg>
    );
  return (
    <svg {...common}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

/** 手机端「我的」页：微信「我」式 —— 用户卡 + 功能列表 + 同步 + 退出 */
export function MobileMePage() {
  const username = useAuthStore((s) => s.username);
  const avatar = useAuthStore((s) => s.avatar);
  const logout = useAuthStore((s) => s.logout);
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggle);
  const [showSettings, setShowSettings] = useState(false);
  const [showApiKeys, setShowApiKeys] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [version, setVersion] = useState('');
  /** 更新状态：idle / checking / found / downloading / error */
  const [updateState, setUpdateState] = useState<'idle' | 'checking' | 'found' | 'downloading' | 'error'>('idle');
  const [updateVersion, setUpdateVersion] = useState('');

  useEffect(() => {
    ipc.app.getVersion().then(setVersion).catch(() => {});
  }, []);

  /** 检查更新：有新版 → 弹确认 → 打开镜像下载 */
  const checkForUpdate = async () => {
    setUpdateState('checking');
    try {
      const info = await checkUpdate();
      if (!info) {
        setUpdateState('error');
        setTimeout(() => setUpdateState('idle'), 2000);
        return;
      }
      if (!info.hasUpdate) {
        // 已是最新
        setUpdateState('idle');
        return;
      }
      setUpdateVersion(info.version);
      setUpdateState('found');
      const confirmed = window.confirm(`发现新版本 v${info.version}\n\n${info.notes ? info.notes.slice(0, 120) : '是否立即下载更新？'}`);
      if (confirmed) {
        setUpdateState('downloading');
        await openApkDownload(info.apkUrl);
        setTimeout(() => setUpdateState('idle'), 3000);
      } else {
        setUpdateState('idle');
      }
    } catch {
      setUpdateState('error');
      setTimeout(() => setUpdateState('idle'), 2000);
    }
  };

  const handleLogout = () => {
    // 登出：清除设备加密存储的 API Key（下次需重新输密码登录）
    clearPersistedApiKey();
    useChatStore.getState().reset();
    useCharacterStateStore.getState().clear();
    useEmotionStore.getState().clearCurrent();
    resetDiaryUnlock();
    logout(); // zustand persist 会同步清掉登录态
  };

  const rowCls =
    'w-full flex items-center gap-3 px-4 py-4 text-sm text-ink transition-colors active:bg-surface';

  return (
    <div className="h-full flex flex-col overflow-y-auto pb-6">
      {/* 用户卡（点头像换头像，微信式） */}
      <button
        onClick={() => setShowProfile(true)}
        className="flex items-center gap-3.5 px-5 pt-8 pb-6 text-left transition-colors active:bg-surface"
      >
        <div className="relative shrink-0">
          <Avatar avatar={avatar ?? DEFAULT_USER_AVATAR} size="lg" className="ring-2 ring-gene-purple/30" />
          <span className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full bg-gene-purple/15 border border-line flex items-center justify-center text-[10px]">
            ✎
          </span>
        </div>
        <div className="min-w-0">
          <p className="text-lg font-semibold text-ink truncate">{username ?? '数字灵魂'}</p>
          <p className="text-xs text-gray-500 mt-0.5">点击头像更换</p>
        </div>
        <span className="text-gray-400 text-sm ml-auto">›</span>
      </button>

      {/* 功能列表 */}
      <div className="mx-4 rounded-2xl bg-surface border border-line overflow-hidden divide-y divide-line">
        <button className={rowCls} onClick={() => setShowApiKeys(true)}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-gene-purple/70 shrink-0">
            <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4" />
          </svg>
          <span className="flex-1 text-left">API Key 管理</span>
          <span className="text-gray-400 text-xs">›</span>
        </button>
        <button className={rowCls} onClick={() => setShowSettings(true)}>
          <RowIcon name="settings" />
          <span className="flex-1 text-left">完整设置</span>
          <span className="text-gray-400 text-xs">›</span>
        </button>
        <button className={rowCls} onClick={toggleTheme}>
          <RowIcon name="theme" />
          <span className="flex-1 text-left">深色模式</span>
          <span className="text-xs text-life-cyan">{theme === 'dark' ? '已开启' : '已关闭'}</span>
        </button>
        {/* 版本号（不可点）+ 下方「检查更新」入口 */}
        <div className={rowCls}>
          <RowIcon name="version" />
          <span className="flex-1 text-left">版本</span>
          <span className="text-xs text-gray-400">{version ? `v${version}` : ''}</span>
        </div>
      </div>

      {/* 检查更新（版本号下方单列入口） */}
      <div className="mx-4 mt-2">
        <button
          onClick={() => void checkForUpdate()}
          disabled={updateState === 'checking' || updateState === 'downloading'}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl bg-surface border border-line text-sm text-ink transition-colors active:bg-surface-strong disabled:opacity-60"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-gene-purple/70 shrink-0">
            <path d="M21 12a9 9 0 1 1-9-9" />
            <path d="M21 3v6h-6" />
          </svg>
          <span className="flex-1 text-left">
            {updateState === 'checking'
              ? '检查更新中…'
              : updateState === 'downloading'
                ? '正在下载…'
                : '检查更新'}
          </span>
          <span className="text-xs">
            {updateState === 'found'
              ? `发现新版本 v${updateVersion}`
              : updateState === 'error'
                ? '检查失败'
                : updateState === 'downloading'
                  ? '请稍候'
                  : '›'}
          </span>
        </button>
      </div>

      {/* 退出登录 */}
      <div className="mx-4 mt-5">
        <button
          onClick={() => setShowLogoutConfirm(true)}
          className="w-full py-4 rounded-2xl bg-red-500/10 text-red-400 text-sm active:bg-red-500/20 transition-colors"
        >
          断开灵魂链接
        </button>
      </div>

      <SettingsPanel open={showSettings} onClose={() => setShowSettings(false)} />
      <UserProfileModal open={showProfile} onClose={() => setShowProfile(false)} />
      {showApiKeys && <ApiKeyManager onClose={() => setShowApiKeys(false)} />}

      {/* 断开灵魂链接二次确认 */}
      <Modal open={showLogoutConfirm} onClose={() => setShowLogoutConfirm(false)} width="max-w-sm" closeOnBackdrop={false}>
        <div className="p-6">
          <p className="text-sm text-sub mb-2">断开灵魂链接？</p>
          <p className="text-xs text-gray-500 mb-6">断开后将返回登录页，本地数据（角色、对话、记忆）都会保留，下次登录继续。</p>
          <div className="flex gap-3 justify-end">
            <button
              onClick={() => setShowLogoutConfirm(false)}
              className="px-4 py-2 rounded-lg text-sm text-gray-400 hover:bg-surface transition-colors"
            >
              取消
            </button>
            <button
              onClick={() => {
                setShowLogoutConfirm(false);
                handleLogout();
              }}
              className="px-4 py-2 rounded-lg text-sm bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
            >
              确认断开
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
