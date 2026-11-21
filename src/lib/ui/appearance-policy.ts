/** Local display preferences; never character facts, model context or world time. */
export interface AppearanceExperience {
  preset:'cinematic'|'light'|'focus';
  transparency:'clear'|'balanced'|'solid';
  ambient:boolean;
  avatar:boolean;
}
export const DEFAULT_EXPERIENCE:Readonly<AppearanceExperience>=Object.freeze({preset:'cinematic',transparency:'balanced',ambient:true,avatar:true});
export function resolveExperience(value?:Partial<AppearanceExperience>):AppearanceExperience {
  return {preset:value?.preset==='light'||value?.preset==='focus'?value.preset:'cinematic',transparency:value?.transparency==='clear'||value?.transparency==='solid'?value.transparency:'balanced',ambient:value?.ambient!==false,avatar:value?.avatar!==false};
}
export function experiencePreset(preset:AppearanceExperience['preset']):AppearanceExperience {
  return {preset,transparency:preset==='focus'?'solid':'balanced',ambient:preset!=='focus',avatar:preset!=='focus'};
}
