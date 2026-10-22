import { useSettingsStore } from '../../store/settings-store';
import { useThemeStore } from '../../store/theme-store';
import { SettingsChoices, SettingsGroup, SettingsSwitch } from './SettingsUI';
import { FontRuler } from '../ui/PhysicalInteractions';
import { OrbColorPicker } from './OrbColorPicker';
import { OrbMotionPicker } from './OrbMotionPicker';
import { ChatAppearanceSettings } from '../chat/ChatAppearanceSettings';

export function AppearanceSettings({includeOrbColor=true}:{includeOrbColor?:boolean}={}) {
  const { preference, setTheme } = useThemeStore();
  const chatFontSize = useSettingsStore(s => s.chatFontSize);
  const setChatFontSize = useSettingsStore(s => s.setChatFontSize);
  const reduceMotion = useSettingsStore(s => s.reduceMotion);
  const setReduceMotion = useSettingsStore(s => s.setReduceMotion);
  const hapticsEnabled = useSettingsStore(s => s.hapticsEnabled);
  const setHapticsEnabled = useSettingsStore(s => s.setHapticsEnabled);
  const backgroundEnabled=useSettingsStore(s=>s.chatBackgroundEnabled);
  const setBackgroundEnabled=useSettingsStore(s=>s.setChatBackgroundEnabled);
  return <>
    <SettingsGroup title="页面主题"><SettingsChoices label="页面主题" value={preference} onChange={setTheme} options={[{ value: 'dark', title: '深色' }, { value: 'light', title: '浅色' }, {value:'system',title:'跟随系统'}]} /></SettingsGroup>
    <SettingsGroup title="聊天字号" scope="所有聊天"><div className="vg-font-preview" style={{fontSize:chatFontSize}}><div>今天的街角很安静，我们慢慢聊。</div><div>这个大小读起来很舒服。</div></div><div className="vg-settings-font-ruler"><FontRuler value={chatFontSize} onChange={setChatFontSize} /></div></SettingsGroup>
    {includeOrbColor&&<SettingsGroup title="聊天背景" scope="全局默认"><SettingsSwitch title="启用聊天背景" checked={backgroundEnabled} onChange={setBackgroundEnabled}/><ChatAppearanceSettings/></SettingsGroup>}
    {includeOrbColor && <OrbColorPicker/>}
    <OrbMotionPicker/>
    <SettingsGroup title="动态效果" scope="立即生效"><SettingsSwitch title="减少动态效果" checked={reduceMotion} onChange={setReduceMotion} /><SettingsSwitch title="触感反馈" checked={hapticsEnabled} onChange={setHapticsEnabled} /></SettingsGroup>
  </>;
}
