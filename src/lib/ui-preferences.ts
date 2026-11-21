import { useSettingsStore } from '../store/settings-store';
import {useAuthStore} from '../store/auth-store';
import {useChatBackgroundStore,readBackgroundRows} from '../store/chat-background-store';
import {resolveExperience} from './ui/appearance-policy';

/** Apply persisted preferences before the first frame and observe live changes. */
export function installUiPreferences(): () => void {
  const media = window.matchMedia('(prefers-reduced-motion: reduce)');
  const sync = () => {
    const value = String(media.matches || useSettingsStore.getState().reduceMotion === true);
    if (document.documentElement.dataset.vgReducedMotion !== value){document.documentElement.dataset.vgReducedMotion = value;window.dispatchEvent(new Event('vg:motion-preference'));}
    const owner=useAuthStore.getState().userId,experience=resolveExperience(owner?readBackgroundRows(owner).global.config.presentation:undefined);
    document.documentElement.dataset.vgExperience=experience.preset;
    document.documentElement.dataset.vgTransparency=experience.transparency;
  };
  sync();
  const unsubscribe = useSettingsStore.subscribe(sync);
  const removeBackground=useChatBackgroundStore.subscribe(sync),removeOwner=useAuthStore.subscribe(sync);
  media.addEventListener('change', sync);
  return () => { unsubscribe();removeBackground();removeOwner(); media.removeEventListener('change', sync); };
}
