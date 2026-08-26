import { useState, useEffect } from 'react';
import { useThemeStore } from '../../store/theme-store';
import { useAuthStore, DEFAULT_USER_AVATAR } from '../../store/auth-store';
import { useChatStore } from '../../store/chat-store';
import { useCharacterStateStore } from '../../store/character-state-store';
import { useEmotionStore } from '../../store/emotion-store';
import { useUIStore } from '../../store/ui-store';
import { ipc } from '../../lib/ipc-client';
import { useRipple } from '../../lib/ripple';
import { resetDiaryUnlock } from '../../lib/diary-unlock';
import { CharacterList } from '../character/CharacterList';
import { CharacterAddModal } from '../character/CharacterAddModal';
import { SettingsPanel } from '../settings/SettingsPanel';
import { UserProfileModal } from '../settings/UserProfileModal';
import { Avatar } from '../ui/Avatar';
import { Modal } from '../ui/Modal';
import { useResizable } from '../../hooks/useResizable';

/** 收起时仅剩左侧工具条的宽度 */
const SIDEBAR_COLLAPSED = 48;
/** 默认宽度借鉴微信/QQ 联系人面板的比例（略宽） */
const SIDEBAR_DEFAULT = 280;
const SIDEBAR_MIN = 220;
const SIDEBAR_MAX = 360;
const SIDEBAR_SNAP = 140;

/** 工具条按钮统一样式（带悬停光晕） */
const RAIL_BTN =
  'w-9 h-9 flex items-center justify-center rounded-lg text-lg text-gray-400 hover:bg-surface hover:text-ink hover:shadow-[0_0_12px_rgba(108,92,231,0.25)] transition-all shrink-0 ripple-host';

export function Sidebar() {
  const { theme, toggle } = useThemeStore();
  const logout = useAuthStore((s) => s.logout);
  const avatar = useAuthStore((s) => s.avatar) ?? DEFAULT_USER_AVATAR;
  const activeView = useUIStore((s) => s.activeView);
  const setActiveView = useUIStore((s) => s.setActiveView);
  const ripple = useRipple();
  const { width, setWidth, isDragging, startDrag } = useResizable({
    initial: SIDEBAR_DEFAULT,
    min: SIDEBAR_COLLAPSED,
    max: SIDEBAR_MAX,
    snap: (w) => (w < SIDEBAR_SNAP ? SIDEBAR_COLLAPSED : Math.max(SIDEBAR_MIN, w)),
  });
  const collapsed = width < SIDEBAR_SNAP;
  const [showAddModal, setShowAddModal] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  const handleLogout = () => {
    ipc.window.setSize(320, 466);
    localStorage.removeItem('virtugene-auth');
    useChatStore.getState().reset();
    useCharacterStateStore.getState().clear();
    useEmotionStore.getState().clearCurrent();
    // 手账隐私锁：换账号后必须重新解锁
    resetDiaryUnlock();
    logout();
  };

  return (
    <>
      <aside
        className={`relative h-full bg-glass backdrop-blur-xl border-r border-line flex shrink-0 ${
          isDragging ? '' : 'transition-[width] duration-300 ease-in-out'
        }`}
        style={{ width }}
      >
        {/* 拖拽拉伸条：整条右边缘都可拖（原版样式），悬停变紫提示 */}
        <div
          onMouseDown={startDrag}
          className="absolute inset-y-0 right-0 w-1.5 cursor-col-resize hover:bg-gene-purple/30 transition-colors z-10"
        />

        {/* 左侧工具条 —— 电脑版微信/QQ 风格（工具统一放在上方） */}
        <div className="w-12 shrink-0 border-r border-line flex flex-col items-center py-2 gap-1">
          <span className="text-xl mt-1 mb-2" title="VirtuGene">🧬</span>

          <button onClick={() => setShowProfile(true)} title="个人资料" className={RAIL_BTN} onPointerDown={ripple.onPointerDown}>
            <Avatar avatar={avatar} size="sm" className="w-7 h-7 text-base ring-1 ring-gene-purple/30" />
          </button>
          <button onClick={() => setShowSettings(true)} title="设置" className={RAIL_BTN} onPointerDown={ripple.onPointerDown}>
            ⚙️
          </button>
          <button
            id="guide-diary"
            onClick={() => setActiveView(activeView === 'diary' ? 'chat' : 'diary')}
            title="我的手账（日记）"
            className={`${RAIL_BTN} ${activeView === 'diary' ? 'text-gene-purple bg-gene-purple/15 shadow-[0_0_10px_rgba(108,92,231,0.3)]' : ''}`}
            onPointerDown={ripple.onPointerDown}
          >
            📓
          </button>
          <button onClick={toggle} title="切换主题" className={RAIL_BTN} onPointerDown={ripple.onPointerDown}>
            {theme === 'dark' ? '🌙' : '☀️'}
          </button>
          <button
            onClick={() => setWidth(collapsed ? SIDEBAR_DEFAULT : SIDEBAR_COLLAPSED)}
            title={collapsed ? '展开侧栏' : '收起侧栏'}
            className={RAIL_BTN}
            onPointerDown={ripple.onPointerDown}
          >
            {collapsed ? '▶' : '◀'}
          </button>
          <button
            onClick={() => setShowLogoutConfirm(true)}
            title="断开灵魂链接"
            className={`${RAIL_BTN} hover:bg-red-500/10 hover:text-red-400 hover:shadow-[0_0_12px_rgba(239,68,68,0.25)]`}
            onPointerDown={ripple.onPointerDown}
          >
            ↩
          </button>

          <div className="flex-1" />
        </div>

        {/* 联系人面板（可调宽，overflow-hidden 防止收起时内容溢出） */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          <div className="relative h-14 flex items-center px-4 border-b border-line shrink-0">
            {/* 底部紫青光带（品牌感） */}
            <div className="absolute bottom-0 left-4 right-4 h-px bg-gradient-to-r from-transparent via-gene-purple/40 to-life-cyan/30 pointer-events-none" />
            <span className="text-base font-bold tracking-wide bg-gradient-to-r from-gene-purple to-life-cyan bg-clip-text text-transparent">
              VirtuGene
            </span>
          </div>

          {/* 基因实验室入口 —— 放在「搜索基因」上方（常驻青色微光） */}
          <div className="px-3 pt-2 pb-1 shrink-0">
            <button
              id="guide-genelab"
              onClick={() => setShowAddModal(true)}
              onPointerDown={ripple.onPointerDown}
              className="ripple-host w-full flex items-center gap-3 rounded-xl border border-dashed border-life-cyan/40 text-life-cyan hover:bg-life-cyan/10 hover:border-life-cyan/70 hover:shadow-[0_2px_18px_rgba(0,206,201,0.28)] transition-all px-3 py-2 shadow-[0_0_10px_rgba(0,206,201,0.12)]"
            >
              <span className="shrink-0">🧬</span>
              <span className="text-sm font-medium">基因实验室</span>
            </button>
          </div>

          {/* 联系人列表：原生滚动条完全贴右缘（8px 加宽，微信式），
              拉伸由右下角小把手负责，两者互不干扰 */}
          <div className="flex-1 overflow-hidden pt-1">
            <div className="h-full overflow-y-auto contacts-scroll">
              <CharacterList collapsed={collapsed} />
            </div>
          </div>
        </div>
      </aside>

      <CharacterAddModal open={showAddModal} onClose={() => setShowAddModal(false)} />
      <SettingsPanel open={showSettings} onClose={() => setShowSettings(false)} />
      <UserProfileModal open={showProfile} onClose={() => setShowProfile(false)} />

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
    </>
  );
}
