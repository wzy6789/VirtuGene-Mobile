import { useState } from 'react';
import { ipc } from '../lib/ipc-client';
import { IS_MOBILE } from '../lib/platform';
import { LoginCard } from '../components/auth/LoginCard';
import { RegisterCard } from '../components/auth/RegisterCard';
import '../styles/auth-ui.css';
import starfieldBackdrop from '../assets/chat-scenes/orbital-observatory/poster-841.webp';

export function AuthPage() {
  const [mode, setMode] = useState<'login' | 'register'>('login');

  return (
    <main className="vg-auth-shell vg-auth-cinematic relative h-full w-full flex flex-col text-ink" aria-label="账号登录与注册">
      <img className="vg-auth-scene-backdrop" src={starfieldBackdrop} width={841} height={1870} alt="" aria-hidden="true" draggable={false} fetchPriority="high"/>
      {/* 浏览器随主题；原生端仍与白色系统图标配套使用深色背景。 */}
      {IS_MOBILE && (
        <div
          className="vg-auth-statusbar absolute top-0 inset-x-0 z-20 pointer-events-none"
          style={{ height: 'var(--vg-safe-top)' }}
        />
      )}

      {/* Mini titlebar — drag region + close（桌面端专属，手机端无标题栏） */}
      {!IS_MOBILE && (
      <header className="drag-region h-11 flex items-center justify-end shrink-0">
        <button
          type="button" aria-label="关闭窗口"
          onClick={() => ipc.window.close()}
          className="no-drag w-11 h-full flex items-center justify-center text-sub hover:bg-surface transition-colors"
        >
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 12 12"><path d="M1 1L11 11M11 1L1 11" stroke="currentColor" strokeWidth="1.5" /></svg>
        </button>
      </header>
      )}

      {/* Content */}
      <div
        data-auth-scroll
        className="flex-1 min-h-0 overflow-y-auto flex flex-col items-center"
        style={{ paddingTop: IS_MOBILE ? 'var(--vg-safe-top)' : undefined, paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        <div className="relative px-4 py-6 w-full max-w-[400px] my-auto shrink-0">
          <div className="vg-auth-surface p-5 sm:p-6">
          {mode === 'login' ? (
            <LoginCard onSwitch={() => setMode('register')} />
          ) : (
            <RegisterCard onSwitch={() => setMode('login')} />
          )}
          </div>
        </div>
      </div>
    </main>
  );
}
