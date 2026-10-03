import { useSettingsStore } from '../store/settings-store';

/** Apply persisted preferences before the first frame and observe live changes. */
export function installUiPreferences(): () => void {
  const media = window.matchMedia('(prefers-reduced-motion: reduce)');
  const sync = () => {
    const value = String(media.matches || useSettingsStore.getState().reduceMotion === true);
    if (document.documentElement.dataset.vgReducedMotion === value) return;
    document.documentElement.dataset.vgReducedMotion = value;
    window.dispatchEvent(new Event('vg:motion-preference'));
  };
  sync();
  const unsubscribe = useSettingsStore.subscribe(sync);
  media.addEventListener('change', sync);
  return () => { unsubscribe(); media.removeEventListener('change', sync); };
}
