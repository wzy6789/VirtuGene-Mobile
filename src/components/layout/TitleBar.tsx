import { useState } from 'react';
import { ipc } from '../../lib/ipc-client';

export function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false);

  const handleMaximize = () => {
    ipc.window.maximize();
    setIsMaximized(!isMaximized);
  };

  return (
    <header className="relative drag-region h-9 flex items-center justify-between bg-app border-b border-line select-none shrink-0">
      {/* 底部紫青光带（光感） */}
      <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-gene-purple/50 to-life-cyan/30 pointer-events-none" />
      {/* Logo */}
      <div className="flex items-center gap-2 pl-4">
        <span className="text-xl">🧬</span>
        <span className="text-sm font-semibold tracking-wide text-ink">
          Virtu<span className="text-gene-purple">Gene</span>
        </span>
      </div>

      {/* Window controls */}
      <div className="flex h-full no-drag">
        <button
          onClick={() => ipc.window.minimize()}
          className="w-11 h-full flex items-center justify-center text-gray-400 hover:bg-surface-strong transition-colors"
        >
          <svg width="12" height="12" viewBox="0 0 12 12"><rect y="5" width="12" height="1.5" fill="currentColor" /></svg>
        </button>
        <button
          onClick={handleMaximize}
          className="w-11 h-full flex items-center justify-center text-gray-400 hover:bg-surface-strong transition-colors"
        >
          <svg width="12" height="12" viewBox="0 0 12 12"><rect x="1" y="1" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
        </button>
        <button
          onClick={() => ipc.window.close()}
          className="w-11 h-full flex items-center justify-center text-gray-400 hover:bg-red-500/80 hover:text-white transition-colors"
        >
          <svg width="12" height="12" viewBox="0 0 12 12"><path d="M1 1L11 11M11 1L1 11" stroke="currentColor" strokeWidth="1.5" /></svg>
        </button>
      </div>
    </header>
  );
}
