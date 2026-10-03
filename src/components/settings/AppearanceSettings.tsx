import { useSettingsStore } from '../../store/settings-store';
import { useThemeStore } from '../../store/theme-store';
import { SettingsChoices, SettingsGroup, SettingsSwitch } from './SettingsUI';

export function AppearanceSettings() {
  const { theme, toggle } = useThemeStore();
  const chatFontSize = useSettingsStore(s => s.chatFontSize);
  const setChatFontSize = useSettingsStore(s => s.setChatFontSize);
  const reduceMotion = useSettingsStore(s => s.reduceMotion);
  const setReduceMotion = useSettingsStore(s => s.setReduceMotion);
  return <>
    <p className="vg-settings-intro">让屏幕与文字适合你的阅读习惯。修改后立即生效。</p>
    <SettingsGroup title="页面主题"><SettingsChoices label="页面主题" value={theme} onChange={next => { if (next !== theme) toggle(); }} options={[{ value: 'dark', title: '深色', detail: '安静的深色背景，柔和的紫色点缀' }, { value: 'light', title: '浅色', detail: '明亮的背景，清晰的阅读层次' }]} /></SettingsGroup>
    <SettingsGroup title="聊天字号" scope="所有聊天"><div className="vg-font-preview"><div>今天的街角很安静，我们慢慢聊。</div><div>这个大小读起来很舒服。</div></div><label className="vg-font-slider"><span>小</span><input aria-label="聊天字号" type="range" min="12" max="22" value={chatFontSize} onChange={event => setChatFontSize(Number(event.target.value))} /><span>大</span><output>{chatFontSize}</output></label><style>{`.vg-font-preview { font-size:${chatFontSize}px; }`}</style></SettingsGroup>
    <SettingsGroup title="动态效果" scope="立即生效"><SettingsSwitch title="减少动态效果" detail="缩短页面与弹窗过渡，暂停背景动效。系统开启减少动态效果时也会自动生效。" checked={reduceMotion} onChange={setReduceMotion} /></SettingsGroup>
  </>;
}
