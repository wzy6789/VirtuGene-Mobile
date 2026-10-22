import {SettingsChoices,SettingsGroup,SettingsSwitch} from '../settings/SettingsUI';
import {experiencePreset,resolveExperience,type AppearanceExperience} from '../../lib/ui/appearance-policy';
export function AppearanceExperienceControls({value,onChange}:{value?:Partial<AppearanceExperience>;onChange:(value:AppearanceExperience)=>void}){
 const selected=resolveExperience(value);
 return <>
  <SettingsGroup title="外观体验"><SettingsChoices label="外观体验" value={selected.preset} onChange={preset=>onChange(experiencePreset(preset))} options={[
   {value:'cinematic',title:'电影沉浸',detail:'完整场景、透光边缘与轻柔生命感'},
   {value:'light',title:'轻量运行',detail:'保留同样的构图，减少复杂特效'},
   {value:'focus',title:'专注阅读',detail:'增强文字承托，收起持续装饰'}]}/></SettingsGroup>
  <SettingsGroup title="玻璃与动态"><SettingsChoices label="界面通透程度" value={selected.transparency} onChange={transparency=>onChange({...selected,transparency})} options={[
   {value:'clear',title:'通透',detail:'控制区更多透入环境颜色'}, {value:'balanced',title:'柔和',detail:'清楚的轮廓与稳定阅读表面'}, {value:'solid',title:'实体',detail:'减少透明度，文字和布局保持原样'}]}/>
   <SettingsSwitch title="环境轻动态" detail="阅读时保留局部光感；选字、详情和后台暂停。" checked={selected.ambient} onChange={ambient=>onChange({...selected,ambient})}/>
   <SettingsSwitch title="头像轻动态" detail="只改变视觉陪伴，不代表情绪或关系分数。" checked={selected.avatar} onChange={avatar=>onChange({...selected,avatar})}/>
  </SettingsGroup>
 </>;
}
