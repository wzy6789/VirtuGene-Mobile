import {SettingsChoices,SettingsGroup,SettingsSwitch} from '../settings/SettingsUI';
import {experiencePreset,resolveExperience,type AppearanceExperience} from '../../lib/ui/appearance-policy';
export function AppearanceExperienceControls({value,onChange}:{value?:Partial<AppearanceExperience>;onChange:(value:AppearanceExperience)=>void}){
 const selected=resolveExperience(value);
 return <>
  <SettingsGroup title="外观体验"><SettingsChoices label="外观体验" value={selected.preset} onChange={preset=>onChange(experiencePreset(preset))} options={[
   {value:'cinematic',title:'电影沉浸'},
   {value:'light',title:'轻量运行'},
   {value:'focus',title:'专注阅读'}]}/></SettingsGroup>
  <SettingsGroup title="玻璃与动态"><SettingsChoices label="界面通透程度" value={selected.transparency} onChange={transparency=>onChange({...selected,transparency})} options={[
   {value:'clear',title:'通透'}, {value:'balanced',title:'柔和'}, {value:'solid',title:'实体'}]}/>
   <SettingsSwitch title="环境轻动态" checked={selected.ambient} onChange={ambient=>onChange({...selected,ambient})}/>
   <SettingsSwitch title="头像轻动态" checked={selected.avatar} onChange={avatar=>onChange({...selected,avatar})}/>
  </SettingsGroup>
 </>;
}
