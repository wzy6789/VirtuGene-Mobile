import { useEffect, useRef, useState, lazy, Suspense } from 'react';
import { useAuthStore } from './store/auth-store';
import { useThemeStore } from './store/theme-store';
import { ipc } from './lib/ipc-client';
import { AuthPage } from './pages/AuthPage';
import { ChatPage } from './pages/ChatPage';
import { MainLayout } from './components/layout/MainLayout';
import { SplashScreen } from './components/splash/SplashScreen';
import { UpdateNotesModal } from './components/update/UpdateNotesModal';
import { OnboardingGuide } from './components/onboarding/OnboardingGuide';
import { useUIStore } from './store/ui-store';
import { useSettingsStore } from './store/settings-store';
import { IS_MOBILE } from './lib/platform';
import { diaryRepo, todayStr } from './db/diary-repo';
import { getChangelog, LAST_SEEN_VERSION_KEY } from './lib/changelog';
import { initSeedCharacters } from './lib/seed-init';
import { notifyLocal, requestNotificationPermission } from './lib/notify';

// 手账按需加载：首次进入才拉取日记相关代码，加快主聊天页启动
const DiaryPage = lazy(() => import('./pages/DiaryPage').then((m) => ({ default: m.DiaryPage })));

export default function App() {
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn);

  const theme = useThemeStore((s) => s.theme);
  const activeView = useUIStore((s) => s.activeView);
  const didResize = useRef(false);
  const [ready, setReady] = useState(false);
  const [splashGone, setSplashGone] = useState(false);
  const [updateNotes, setUpdateNotes] = useState<{ version: string; notes: string[] } | null>(null);

  useEffect(() => {
    initSeedCharacters().finally(() => setReady(true));
  }, []);

  // Splash 淡出过渡：ready 后先淡出再卸载
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => setSplashGone(true), 400);
    return () => clearTimeout(t);
  }, [ready]);

  // Show the update announcement once per version change
  useEffect(() => {
    if (!ready) return;
    ipc.app.getVersion().then((v) => {
      if (!v) return;
      const entry = getChangelog(v);
      if (!entry) return;
      if (localStorage.getItem(LAST_SEEN_VERSION_KEY) !== v) {
        setUpdateNotes({ version: v, notes: entry.notes });
      }
    });
  }, [ready]);

  // Apply theme class at the root so both auth and chat screens are themed
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  useEffect(() => {
    if (isLoggedIn && !didResize.current) {
      ipc.window.setSize(1200, 800);
      didResize.current = true;
    }
    if (!isLoggedIn) {
      ipc.window.setSize(320, 466);
      didResize.current = false;
    }
  }, [isLoggedIn]);

  // 每日写日记提醒：到达设定时间且今天还没写 → 系统通知（每天最多一次）
  useEffect(() => {
    if (!isLoggedIn) return;
    const KEY = 'virtugene-diary-reminder-last';
    // 手机端首次启用提醒时请求通知权限
    if (IS_MOBILE && useSettingsStore.getState().diaryReminderEnabled) {
      void requestNotificationPermission();
    }
    const check = () => {
      const { diaryReminderEnabled, diaryReminderTime } = useSettingsStore.getState();
      if (!diaryReminderEnabled) return;
      const now = new Date();
      const hh = String(now.getHours()).padStart(2, '0');
      const mm = String(now.getMinutes()).padStart(2, '0');
      const today = todayStr();
      if (`${hh}:${mm}` !== diaryReminderTime) return;
      if (localStorage.getItem(KEY) === today) return;
      // 今天已写过日记 → 不提醒
      const userId = useAuthStore.getState().userId ?? '';
      diaryRepo.getByDate(userId, today).then((list) => {
        if (list.length > 0) return;
        // 手机端走系统本地通知；桌面端走 Electron 通知
        if (IS_MOBILE) {
          void notifyLocal('📓 我的手账', '今天还没有写日记，要不要记下点什么？');
        } else {
          void ipc.app.notify('📓 我的手账', '今天还没有写日记，要不要记下点什么？');
        }
        localStorage.setItem(KEY, today);
      });
    };
    check();
    const timer = setInterval(check, 30_000);
    return () => clearInterval(timer);
  }, [isLoggedIn]);

  const handleCloseUpdateNotes = () => {
    if (updateNotes) {
      localStorage.setItem(LAST_SEEN_VERSION_KEY, updateNotes.version);
    }
    setUpdateNotes(null);
  };

  if (!splashGone) {
    return (
      <div className={`fixed inset-0 z-[100] bg-app transition-opacity duration-300 ${ready ? 'opacity-0' : 'opacity-100'}`}>
        <SplashScreen />
      </div>
    );
  }

  return (
    <div className="h-full w-full bg-app text-ink">
      {isLoggedIn ? (
        <MainLayout>
          <Suspense fallback={<div className="h-full w-full flex items-center justify-center text-sm text-gray-500">正在唤醒手账…</div>}>
            {activeView === 'chat' ? <ChatPage /> : <DiaryPage />}
          </Suspense>
        </MainLayout>
      ) : (
        <AuthPage />
      )}
      <UpdateNotesModal
        open={!!updateNotes}
        onClose={handleCloseUpdateNotes}
        version={updateNotes?.version ?? ''}
        notes={updateNotes?.notes ?? []}
      />
      {/* 新手引导：仅桌面端（手机端为 4-tab 导航，引导锚点在桌面侧栏，手机上不显示） */}
      {isLoggedIn && !IS_MOBILE && <OnboardingGuide />}
    </div>
  );
}
