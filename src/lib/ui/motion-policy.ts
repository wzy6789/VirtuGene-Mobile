import {resolveExperience,type AppearanceExperience} from './appearance-policy';
export type EffectLevel='off'|'low'|'full';
export interface MotionContext {
  visible:boolean;appActive:boolean;fullyCovered?:boolean;surfaceMode?:'chat'|'long-form'|'call';
  reducedMotion:boolean;selectingText?:boolean;fastScrolling?:boolean;keyboardTransitioning?:boolean;
  inputFocused?:boolean;streaming?:boolean;quality?:'high'|'balanced'|'light';experience?:Partial<AppearanceExperience>;
}
/** A single pure allocation rule, shared by scene, avatar and control adapters. */
export function deriveMotionPolicy(context:MotionContext) {
  const experience=resolveExperience(context.experience);
  const stopped=context.reducedMotion||!context.visible||!context.appActive||context.fullyCovered||context.selectingText||context.surfaceMode==='long-form';
  const busy=context.fastScrolling||context.keyboardTransitioning;
  const low=context.inputFocused||context.streaming||context.quality==='light'||experience.preset==='light'||context.surfaceMode==='call';
  const level:EffectLevel=stopped||busy?'off':low?'low':'full';
  const ambient:EffectLevel=experience.ambient?level:'off',avatar:EffectLevel=experience.avatar?level:'off';
  const particles:EffectLevel=!experience.ambient||stopped||busy||context.inputFocused||context.streaming||experience.preset==='focus'?'off':low?'low':'full';
  return {ambient,avatar,particles,parallaxEnabled:!stopped&&!busy&&!low&&experience.preset==='cinematic',
    transitions:context.reducedMotion?'instant' as const:'full' as const,
    glassQuality:experience.transparency==='solid'||experience.preset==='light'||experience.preset==='focus'?'static' as const:context.quality==='high'?'realtime' as const:'hybrid' as const};
}
