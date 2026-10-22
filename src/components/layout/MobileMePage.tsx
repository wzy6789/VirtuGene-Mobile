import { useState } from 'react';
import { useAuthStore, DEFAULT_USER_AVATAR } from '../../store/auth-store';
import { useThemeStore } from '../../store/theme-store';
import { useChatStore } from '../../store/chat-store';
import { useCharacterStateStore } from '../../store/character-state-store';
import { useEmotionStore } from '../../store/emotion-store';
import { resetDiaryUnlock } from '../../lib/diary-unlock';
import { Avatar } from '../ui/Avatar';
import { Modal } from '../ui/Modal';
import { SettingsPanel, type SettingsPage } from '../settings/SettingsPanel';
import { UserProfileModal } from '../settings/UserProfileModal';
import { WeeklyLifeReviewModal } from '../insights/WeeklyLifeReviewModal';
import { clearPersistedApiKey } from '../../lib/api-key-storage';
import { SpaceHeading } from '../ui/SpaceHeading';
import { Icon } from '../ui/Icon';
import { usePersonalCounts } from './usePersonalCounts';
import '../../styles/personal-space.css';
import { PrimaryPageBackdrop } from './PrimaryPageBackdrop';

export function MobileMePage() {
  const owner = useAuthStore(s => s.userId);
  return <PersonalSpace key={owner ?? 'signed-out'}/>;
}
function PersonalSpace() {
  const userId = useAuthStore(s => s.userId);
  const username = useAuthStore(s => s.username);
  const avatar = useAuthStore(s => s.avatar);
  const logout = useAuthStore(s => s.logout);
  const theme = useThemeStore(s => s.theme);
  const preference = useThemeStore(s => s.preference);
  const counts = usePersonalCounts();
  const [showSettings, setShowSettings] = useState(false);
  const [settingsPage, setSettingsPage] = useState<SettingsPage>('home');
  const [showProfile, setShowProfile] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [showLogout, setShowLogout] = useState(false);
  const openSettings = (page: SettingsPage) => { setSettingsPage(page); setShowSettings(true); };
  const disconnect = () => {
    if (useAuthStore.getState().userId !== userId) return;
    clearPersistedApiKey(); useChatStore.getState().reset(); useCharacterStateStore.getState().clear();
    useEmotionStore.getState().clearCurrent(); resetDiaryUnlock(); logout();
  };
  return <div className="vg-destination-page vg-personal-scene h-full min-h-0" data-primary-scene="night-coast">
    <PrimaryPageBackdrop page="me" />
    <div className="vg-personal vg-personal-space h-full overflow-y-auto">
    <SpaceHeading eyebrow="" title="我的" detail="" />
    <section className="vg-personal-profile vg-scene-glass" aria-label="个人资料">
    <button type="button" className="vg-personal-identity" onClick={() => setShowProfile(true)}>
      <Avatar avatar={avatar ?? DEFAULT_USER_AVATAR} size="lg" />
      <span><strong>{(username ?? '数字灵魂').split(/(?<=[a-z0-9])(?=[A-Z])|(?<=[_ .-])/u).map((part,index)=><span key={index}>{index>0&&<wbr/>}{part}</span>)}</strong><small>更换头像</small></span><Icon name="edit" size={18}/>
    </button>
    <div className="vg-personal-numbers" aria-label="本机记录统计">
      <div><strong data-personal-count="characters">{counts.characters}</strong><span>角色</span></div>
      <div><strong data-personal-count="relations">{counts.relations ?? '—'}</strong><span>关系记录</span></div>
    </div>
    </section>
    {counts.error && <p role="status" className="text-sm text-sub">统计暂时没有读到，重新进入可再试。</p>}
    <button type="button" className="vg-personal-weekly vg-scene-glass" onClick={() => setShowReview(true)}>
      <Icon name="spark"/><span><strong>本周回顾</strong></span>
    </button>
    <section className="vg-personal-links vg-scene-glass" aria-labelledby="personal-preferences-title">
      <h2 id="personal-preferences-title">偏好与软件</h2>
      <button type="button" className="vg-personal-row" onClick={() => openSettings('appearance')}><Icon name="moon"/><span className="vg-personal-row-copy"><span>外观与阅读</span><small>{preference === 'system' ? '跟随系统' : theme === 'dark' ? '深色' : '浅色'}</small></span></button>
      <button type="button" className="vg-personal-row" onClick={() => openSettings('connection')}><Icon name="connection"/><span>AI 连接</span></button>
      <button type="button" className="vg-personal-row" onClick={() => openSettings('home')}><Icon name="gear"/><span>设置</span></button>
      <button type="button" className="vg-personal-row" onClick={() => openSettings('about')}><Icon name="info"/><span>关于与更新</span></button>
    </section>
    <button type="button" className="vg-personal-exit" onClick={() => setShowLogout(true)}><Icon name="profile"/>退出登录</button>
    <SettingsPanel initialPage={settingsPage} open={showSettings} onClose={() => setShowSettings(false)}/>
    <UserProfileModal open={showProfile} onClose={() => setShowProfile(false)}/>
    <WeeklyLifeReviewModal open={showReview} onClose={() => setShowReview(false)}/>
    <Modal presentation="dialog" open={showLogout} title="退出登录？" onClose={() => setShowLogout(false)} canSnapshotOnExit={() => false}>
      <div className="p-5 space-y-4"><p className="text-sm leading-7 text-sub">退出后，本机记录保留。下次登录可继续。</p>
        <div className="flex flex-wrap justify-end gap-2"><button type="button" className="vg-button vg-button-secondary" onClick={() => setShowLogout(false)}>取消</button><button type="button" className="vg-button vg-button-danger" onClick={() => { setShowLogout(false); disconnect(); }}>退出登录</button></div>
      </div>
    </Modal>
    </div>
  </div>;
}
