import { useState } from 'react';
import { ipc } from '../lib/ipc-client';
import { IS_MOBILE } from '../lib/platform';
import { LoginCard } from '../components/auth/LoginCard';
import { RegisterCard } from '../components/auth/RegisterCard';

export function AuthPage() {
  const [mode, setMode] = useState<'login' | 'register'>('login');

  return (
    <div className="relative h-full w-full flex flex-col bg-app">
      {/* 顶部状态栏深色条（手机端状态栏区域，固定 24px + safe-area，避免白色） */}
      {IS_MOBILE && (
        <div
          className="absolute top-0 inset-x-0 z-20 pointer-events-none bg-[#0F0F1A]"
          style={{ height: 'calc(env(safe-area-inset-top, 0px) + 24px)' }}
        />
      )}

      {/* Mini titlebar — drag region + close（桌面端专属，手机端无标题栏） */}
      {!IS_MOBILE && (
      <header className="drag-region h-8 flex items-center justify-end shrink-0">
        <button
          onClick={() => ipc.window.close()}
          className="no-drag w-8 h-full flex items-center justify-center text-gray-500 hover:text-white hover:bg-red-500/80 transition-colors"
        >
          <svg width="10" height="10" viewBox="0 0 12 12"><path d="M1 1L11 11M11 1L1 11" stroke="currentColor" strokeWidth="1.5" /></svg>
        </button>
      </header>
      )}

      {/* Content */}
      <div
        className="flex-1 flex items-center justify-center"
        style={IS_MOBILE ? { paddingTop: 'calc(env(safe-area-inset-top, 0px) + 24px)' } : undefined}
      >
        {/* Subtle glow */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-1/3 -left-20 w-48 h-48 bg-gene-purple/8 rounded-full blur-3xl" />
          <div className="absolute bottom-1/3 -right-20 w-48 h-48 bg-life-cyan/5 rounded-full blur-3xl" />
        </div>

        {/* Card — no frame; form floats over the glow background (WeChat style) */}
        <div className="relative z-10 px-4 py-8 w-[320px]">
          {mode === 'login' ? (
            <LoginCard onSwitch={() => setMode('register')} />
          ) : (
            <RegisterCard onSwitch={() => setMode('login')} />
          )}
        </div>
      </div>
    </div>
  );
}
