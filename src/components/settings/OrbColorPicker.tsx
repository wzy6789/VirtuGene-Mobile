import { useSettingsStore } from '../../store/settings-store';
import { ORB_COLORS } from '../../lib/orb-colors';
import { SoulOrb } from '../ui/SoulOrb';
import { SettingsGroup } from './SettingsUI';

export function OrbColorPicker(){
  const selected=useSettingsStore(s=>s.orbColor),setColor=useSettingsStore(s=>s.setOrbColor);
  return <SettingsGroup title="小星颜色" scope="所有小球">
    <div className="vg-orb-color-preview"><SoulOrb size={64} emotion="happy" animated={false}/><p>选一个喜欢的颜色<small>立即生效，自动保存；默认保留角色配色。</small></p></div>
    <div className="vg-orb-color-options" role="group" aria-label="小星颜色">{ORB_COLORS.map(color=><button key={color.id} type="button" aria-label={`小星颜色：${color.name}`} aria-pressed={selected===color.id} onClick={()=>setColor(color.id)}><i aria-hidden="true" style={{background:`radial-gradient(circle at 30% 25%,${color.highlight},${color.body} 55%,${color.depth})`}}/><span>{color.name}</span></button>)}</div>
  </SettingsGroup>;
}
