import type { SceneDefinition, SceneId } from './scene-types';

/** Shared art direction for the depth renderer and its layered fallback.
 * Gains describe local light; they never change chat text or action colors. */
export interface SceneLightProfile {
  lampColor: string; windowColor: string; bounceColor: string;
  lampGain: number; windowGain: number; bounceGain: number; shaftGain: number;
  vignette: number; period: number; breath: number; particleGain: number;
}
const profiles: Record<SceneId, SceneLightProfile> = {
  'polar-refuge': {lampColor:'#ffd5a2',windowColor:'#c8dff0',bounceColor:'#d3b58d',lampGain:.23,windowGain:.15,bounceGain:.085,shaftGain:.027,vignette:.045,period:34,breath:.10,particleGain:.25},
  'orbital-observatory': {lampColor:'#f4c797',windowColor:'#b9c9ed',bounceColor:'#c6a582',lampGain:.17,windowGain:.12,bounceGain:.06,shaftGain:.015,vignette:.065,period:42,breath:.06,particleGain:.18},
  'moonlit-bedroom': {lampColor:'#ffd2a3',windowColor:'#b7cde2',bounceColor:'#d0aa8b',lampGain:.18,windowGain:.10,bounceGain:.065,shaftGain:.018,vignette:.05,period:36,breath:.08,particleGain:.20},
  'guofeng-tea-room': {lampColor:'#ffd09a',windowColor:'#b9d3e6',bounceColor:'#d9ad7d',lampGain:.22,windowGain:.12,bounceGain:.08,shaftGain:.035,vignette:.05,period:24,breath:.12,particleGain:.26},
  'urban-window-seat': {lampColor:'#ffd1a1',windowColor:'#b6c9ec',bounceColor:'#d3a184',lampGain:.18,windowGain:.13,bounceGain:.065,shaftGain:.025,vignette:.06,period:28,breath:.12,particleGain:.24},
  'cafe-afternoon': {lampColor:'#ffe0ae',windowColor:'#fff0c9',bounceColor:'#e5ba89',lampGain:.14,windowGain:.20,bounceGain:.10,shaftGain:.045,vignette:.035,period:26,breath:.13,particleGain:.30},
  'cafe-rain-night': {lampColor:'#ffd09b',windowColor:'#aacfe6',bounceColor:'#dcaa80',lampGain:.21,windowGain:.14,bounceGain:.08,shaftGain:.032,vignette:.06,period:24,breath:.13,particleGain:.26},
  'snow-study': {lampColor:'#ffe0b4',windowColor:'#c6def0',bounceColor:'#d5bd9c',lampGain:.14,windowGain:.19,bounceGain:.075,shaftGain:.035,vignette:.05,period:30,breath:.10,particleGain:.28},
  'mist-coast': {lampColor:'#e5ddc4',windowColor:'#b9d9dc',bounceColor:'#a8c2c2',lampGain:.075,windowGain:.17,bounceGain:.045,shaftGain:.03,vignette:.035,period:30,breath:.10,particleGain:.18},
  'hearth-cabin': {lampColor:'#ffc48a',windowColor:'#a5bccb',bounceColor:'#e9a36d',lampGain:.26,windowGain:.08,bounceGain:.12,shaftGain:.025,vignette:.065,period:18,breath:.20,particleGain:.34},
  'night-train': {lampColor:'#f4d2a8',windowColor:'#b0c9e6',bounceColor:'#c7ad92',lampGain:.13,windowGain:.12,bounceGain:.06,shaftGain:.02,vignette:.07,period:24,breath:.11,particleGain:.23},
  'home-bedroom': {lampColor:'#ffd3a3',windowColor:'#b2c6dd',bounceColor:'#d8ab89',lampGain:.16,windowGain:.10,bounceGain:.06,shaftGain:.018,vignette:.065,period:28,breath:.10,particleGain:.22},
  'home-living': {lampColor:'#ffe1b6',windowColor:'#f1e7cd',bounceColor:'#dec39e',lampGain:.15,windowGain:.20,bounceGain:.09,shaftGain:.045,vignette:.035,period:26,breath:.12,particleGain:.28},
};
export function getSceneLightProfile(scene: Pick<SceneDefinition, 'id'>): Readonly<SceneLightProfile> {
  return profiles[scene.id];
}
