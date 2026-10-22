import { useThemeStore } from '../store/theme-store';
import { IS_CAPACITOR } from './platform';

/** Sync saved/system preference before mounting React, then track only relevant changes. */
export function installThemePreferences(): () => void {
  document.documentElement.dataset.vgPlatform = IS_CAPACITOR ? 'native' : 'web';
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const sync = () => {
    const theme = useThemeStore.getState().theme;
    document.documentElement.classList.toggle('dark',theme === 'dark');
    document.documentElement.dataset.vgTheme = theme;
    const background = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content',background || (theme === 'dark' ? '#10151d' : '#f4f2ed'));
  };
  const updateSystem = () => useThemeStore.getState().syncSystemTheme();
  updateSystem(); sync();
  const unsubscribe = useThemeStore.subscribe(sync);
  media.addEventListener('change',updateSystem);
  return () => { unsubscribe(); media.removeEventListener('change',updateSystem); };
}
