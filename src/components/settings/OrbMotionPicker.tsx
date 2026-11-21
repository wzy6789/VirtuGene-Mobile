import { useAuthStore } from '../../store/auth-store';
import { useSettingsStore } from '../../store/settings-store';
import { SoulOrb } from '../ui/SoulOrb';
import { SettingsChoices, SettingsGroup } from './SettingsUI';
import type { OrbMotionIntensity } from '../../lib/orb-vitality';

export function OrbMotionPicker() {
  const userId = useAuthStore(state => state.userId);
  const intensity = useSettingsStore(state => userId ? state.orbMotionByUser?.[userId] ?? 'gentle' : 'gentle');
  const setIntensity = useSettingsStore(state => state.setOrbMotionIntensity);
  return <SettingsGroup title="小星动态" scope="当前账号">
    <div className="vg-orb-color-preview"><SoulOrb size={64} motionContext="reading"/></div>
    <SettingsChoices<OrbMotionIntensity> label="小星动态强度" value={intensity} disabled={!userId}
      onChange={value => { if (userId) setIntensity(userId, value); }} options={[
        { value: 'gentle', title: '柔和' },
        { value: 'lively', title: '灵动' },
        { value: 'reduced', title: '减少动态' },
      ]}/>
  </SettingsGroup>;
}
