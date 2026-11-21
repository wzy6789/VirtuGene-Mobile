import { useThemeStore } from '../store/theme-store';
import { IS_CAPACITOR } from './platform';
import { registerPlugin, SystemBars, SystemBarsStyle } from '@capacitor/core';

const SystemAppearance = registerPlugin<{setTheme(options:{dark:boolean}):Promise<void>}>('SystemAppearance');

/** Sync saved/system preference before mounting React, then track only relevant changes. */
export function installThemePreferences(): () => void {
  document.documentElement.dataset.vgPlatform = IS_CAPACITOR ? 'native' : 'web';
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  let currentTheme = '', revision = 0;
  const sync = () => {
    const theme = useThemeStore.getState().theme;
    document.documentElement.classList.toggle('dark',theme === 'dark');
    document.documentElement.dataset.vgTheme = theme;
    const background = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content',background || (theme === 'dark' ? '#10151d' : '#f4f2ed'));
    if(IS_CAPACITOR && currentTheme!==theme){
      currentTheme=theme;const request=++revision;
      // Keep Capacitor's lifecycle style in sync, then color its native inset.
      // A late completion from rapid theme changes must never restore an old theme.
      void SystemBars.setStyle({style:theme==='dark'?SystemBarsStyle.Dark:SystemBarsStyle.Light})
        .then(()=>request===revision?SystemAppearance.setTheme({dark:theme==='dark'}):undefined)
        .catch(()=>{if(request===revision)currentTheme='';});
    }
  };
  const updateSystem = () => useThemeStore.getState().syncSystemTheme();
  const restoreAppearance = () => {
    if (document.hidden) return;
    currentTheme = '';
    sync();
  };
  updateSystem(); sync();
  const unsubscribe = useThemeStore.subscribe(sync);
  media.addEventListener('change',updateSystem);
  document.addEventListener('visibilitychange',restoreAppearance);
  window.addEventListener('pageshow',restoreAppearance);
  return () => { revision++;unsubscribe(); media.removeEventListener('change',updateSystem); document.removeEventListener('visibilitychange',restoreAppearance); window.removeEventListener('pageshow',restoreAppearance); };
}
