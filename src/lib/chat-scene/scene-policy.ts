import type { ImageVariant, SceneAssetSelection, SceneDefinition, SceneMotionPolicy, ScenePreferences, SceneQuality, SceneRuntimeSignals } from './scene-types';
import {deriveMotionPolicy} from '../ui/motion-policy';

export function deriveSceneMotion(s: SceneRuntimeSignals, p: ScenePreferences, quality: SceneQuality): SceneMotionPolicy {
  const channels=deriveMotionPolicy({visible:s.visible,appActive:s.appActive,surfaceMode:s.surfaceMode??(s.modalOpen?'long-form':s.voiceActive?'call':'chat'),reducedMotion:s.reduceMotion,selectingText:s.selectingText,fastScrolling:s.scrolling,keyboardTransitioning:s.keyboardTransitioning,inputFocused:s.inputFocused||s.keyboardOpen,streaming:s.phase!=='idle',quality:quality==='rich'?'high':quality==='static'?'light':'balanced',experience:p.experience});
  const staticReason = s.reduceMotion ? 'reduced-motion' : !p.motionEnabled ? 'motion-off' : quality === 'static' ? 'power-save' : '';
  if (staticReason) return {...channels,ambient:'off',particles:'off',mode:'static',effectFps:0,parallaxEnabled:false,reason:staticReason};
  const reason=!s.appActive?'background':!s.visible?'hidden':s.selectingText?'selection':s.surfaceMode==='long-form'?'long-form':s.scrolling?'scroll':s.keyboardTransitioning?'keyboard-transition':s.modalOpen?'covered':'';
  const paused=!!reason||channels.ambient==='off'&&channels.particles==='off';
  return {...channels,mode:paused?'paused':'idle',effectFps:paused?0:channels.particles==='off'?12:quality==='rich'?30:20,parallaxEnabled:p.parallaxEnabled&&channels.parallaxEnabled&&!paused,reason:reason||(s.inputFocused?'input-stable':s.phase!=='idle'?s.phase:'idle')};
}

export function sceneCover(scene: Pick<SceneDefinition, 'designSize' | 'cropAnchor'>, width: number, height: number) {
  const scale = Math.max(width / scene.designSize.width, height / scene.designSize.height) * 1.08;
  return { scale, x: (width - scene.designSize.width * scale) * scene.cropAnchor.x,
    y: (height - scene.designSize.height * scale) * scene.cropAnchor.y };
}

/** Both dimensions and the actual cover crop matter; decoded bytes never use WebP file size. */
export function chooseSceneVariant(variants: ImageVariant[], width: number, height: number): ImageVariant {
  const sorted = [...variants].sort((a, b) => a.width * a.height - b.width * b.height);
  const selected = sorted.find(v => v.width >= width && v.height >= height) ?? sorted[sorted.length - 1];
  if (!selected) throw Error('scene:missing-variant');
  return selected;
}
export function selectSceneAssets(scene: SceneDefinition, viewport: { width: number; height: number; dpr: number }, preferences: ScenePreferences, forceStatic = false): SceneAssetSelection {
  let quality: SceneQuality = forceStatic || preferences.quality === 'power-save' || !preferences.motionEnabled ? 'static' : preferences.quality === 'rich' ? 'rich' : 'balanced';
  let budgetBytes = (quality === 'static' ? 16 : quality === 'rich' ? 64 : 48) * 1024 * 1024;
  const cover = sceneCover(scene, viewport.width, viewport.height);
  const density = Math.max(1, Math.min(viewport.dpr || 1, quality === 'rich' ? 3 : 2));
  const targetScale = cover.scale * density;
  const pick = (variants: ImageVariant[], w = scene.designSize.width, h = scene.designSize.height) => chooseSceneVariant(variants, w * targetScale, h * targetScale);
  let poster = pick(scene.poster);
  let base = quality === 'static' ? undefined : pick(scene.layered.base);
  let layers = quality === 'static' ? [] : scene.layered.layers.map(layer => ({ layer, variant: pick(layer.variants, layer.rect[2], layer.rect[3]) }));
  const maskRect=scene.windowMaskRect;
  let windowMask = quality === 'static' ? undefined : pick(scene.windowMask,maskRect?.[2],maskRect?.[3]);
  const cost = () => [...new Map([poster, base, windowMask, ...layers.map(row => row.variant)].filter((v): v is ImageVariant => !!v).map(v => [v.src, v])).values()].reduce((sum, v) => sum + v.width * v.height * 4, 0);
  if (cost() > budgetBytes) { base = undefined; layers = []; windowMask = undefined; quality = 'static'; budgetBytes=16*1024*1024; }
  if (poster.width * poster.height * 4 > 16 * 1024 * 1024) poster = chooseSceneVariant(scene.poster, 0, 0);
  return { scene, quality, poster, base, layers, windowMask, decodedBytes: cost(), budgetBytes };
}
