import type { SceneId, SceneReadingPreset, SceneEffect } from './scene-catalog';
import type { AppearanceExperience } from '../ui/appearance-policy';
import type { EffectLevel } from '../ui/motion-policy';
export type { SceneId } from './scene-catalog';
export type SceneQuality = 'static' | 'balanced' | 'rich';
export interface ScenePreferences {
  id: SceneId;
  quality: 'auto' | 'rich' | 'power-save';
  motionEnabled: boolean;
  parallaxEnabled: boolean;
  /** auto prefers the real-time backend; layered explicitly keeps the compatibility renderer. */
  renderer?: 'auto' | 'layered';
  /** Runtime adapter of the effective local appearance, not a second store. */
  experience?:Partial<AppearanceExperience>;
  timeVariantId?:string;
}
export interface ImageVariant { src: string; width: number; height: number; byteLength: number }
export interface SceneLayer { id: string; variants: ImageVariant[]; rect: [number, number, number, number]; depthFactor: number; maxOffsetPx: number }
export interface SceneDefinition {
  schemaVersion: 1; id: SceneId; label: string; backend: 'dom-2.5d' | 'webgl2';
  designSize: { width: number; height: number }; cropAnchor: { x: number; y: number };
  poster: ImageVariant[];
  thumbnail?: ImageVariant;
  layered: { base: ImageVariant[]; layers: SceneLayer[] };
  windowMask: ImageVariant[];
  windowMaskRect?: [number, number, number, number];
  steam?: { x: number; y: number; width: number; height: number };
  light: { x: number; y: number; width: number; height: number; color?:string; duration?:number; opacity?:[number,number] };
  readingPreset: SceneReadingPreset;
  effect?: SceneEffect;
  glass?: { strength:number; frost:number; opening:[number,number][] };
  realtime?: { model:string; byteLength:number; triangles:number; geometryBytes:number; effectQuad:[number,number,number][]; lightPoint?:[number,number,number]; cup?:[number,number,number]; ambientVolume?:{origin:[number,number,number];across:[number,number,number];up:[number,number,number];depth:[number,number,number]} };
}
export interface SceneRuntimeSignals {
  visible: boolean; appActive: boolean; inputFocused: boolean; keyboardOpen: boolean;
  scrolling: boolean; modalOpen: boolean; phase: 'idle' | 'waiting' | 'streaming';
  voiceActive: boolean; reduceMotion: boolean;
  selectingText?:boolean; keyboardTransitioning?:boolean; surfaceMode?:'chat'|'long-form'|'call';
}
export interface SceneMotionPolicy {
  mode: 'static' | 'paused' | 'idle'; effectFps: 0 | 12 | 20 | 24 | 30;
  parallaxEnabled: boolean; reason: string;
  ambient?:EffectLevel;avatar?:EffectLevel;particles?:EffectLevel;
  glassQuality?:'realtime'|'hybrid'|'static';transitions?:'instant'|'full';
}
export interface SceneAssetSelection {
  scene: SceneDefinition; quality: SceneQuality; poster: ImageVariant;
  base?: ImageVariant; layers: { layer: SceneLayer; variant: ImageVariant }[];
  windowMask?: ImageVariant; decodedBytes: number; budgetBytes: number;
}
