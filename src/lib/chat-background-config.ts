import { isChatAtmosphereThemeId, resolveCharacterAtmosphere, type ChatAtmosphereThemeId } from './chat-atmosphere';
import type { Character } from '../db';
import { ORB_COLORS, type OrbColor } from './orb-colors';
import type { OrbMotionIntensity } from './orb-vitality';
import type { ScenePreferences } from './chat-scene/scene-types';
import { DEFAULT_SCENE_ID, isSceneId } from './chat-scene/scene-catalog';
import {resolveExperience,type AppearanceExperience} from './ui/appearance-policy';

export interface RoleVisualConfig {
  avatar?: { source: string; image: string; x: number; y: number; zoom: number };
  orbColor?: OrbColor;
  orbMotion?: OrbMotionIntensity;
}

export interface ChatBackgroundConfig {
  schemaVersion: 1;
  mode: 'clean' | 'atmosphere' | 'image' | 'scene';
  /** Local appearance only; never a change to story location or model context. */
  scene?: ScenePreferences;
  themeId: ChatAtmosphereThemeId;
  imageAssetId?: string;
  focalPoint: { x: number; y: number };
  zoom: number;
  mask: number;
  blur: number;
  effect: 'glow' | 'dust';
  strength: 'off' | 'gentle' | 'vivid';
  lightDarkPolicy: 'app' | 'light' | 'dark';
  /** Local visual override only; never persona data, sync or model context. */
  roleVisual?: RoleVisualConfig;
  presentation?:AppearanceExperience;
}
export interface GlobalChatBackground { strategy: 'characterRecommended' | 'fixed'; config: ChatBackgroundConfig }
export const DEFAULT_CHAT_BACKGROUND: Readonly<ChatBackgroundConfig> = Object.freeze({ schemaVersion: 1, mode: 'scene', scene:Object.freeze({id:DEFAULT_SCENE_ID,quality:'auto',motionEnabled:true,parallaxEnabled:false,renderer:'layered'}), themeId: 'cool', focalPoint: Object.freeze({ x: .5, y: .5 }), zoom: 1, mask: .4, blur: 0, effect: 'glow', strength: 'gentle', lightDarkPolicy: 'app' });
export const DEFAULT_GLOBAL_BACKGROUND: GlobalChatBackground = { strategy: 'characterRecommended', config: DEFAULT_CHAT_BACKGROUND };
/** One-time adoption for existing conversations; later explicit choices remain authoritative. */
export const CINEMATIC_CHAT_DEFAULT_VERSION = 1;
export function adoptCinematicChatBackground(config:ChatBackgroundConfig):ChatBackgroundConfig {
  if(config?.schemaVersion!==1||!['clean','atmosphere'].includes(config.mode))return config;
  return {...config,mode:'scene',scene:{...DEFAULT_CHAT_BACKGROUND.scene!}};
}
const bounded = (value: unknown, low: number, high: number, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? Math.min(high, Math.max(low, value)) : fallback;
/** Invalid fields are sanitized, unknown schema never becomes an accidental destructive migration. */
export function normalizeChatBackground(raw: unknown): { config: ChatBackgroundConfig; reasons: string[] } {
  const reasons: string[] = [];
  const record = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  if (record.schemaVersion !== 1) return { config: structuredClone(DEFAULT_CHAT_BACKGROUND), reasons: ['schema-unsupported'] };
  const pick = <T extends string>(key: string, options: readonly T[], fallback: T): T => {
    if (options.includes(record[key] as T)) return record[key] as T;
    reasons.push(`${key}-invalid`); return fallback;
  };
  const point = record.focalPoint && typeof record.focalPoint === 'object' ? record.focalPoint as Record<string, unknown> : {};
  const config: ChatBackgroundConfig = {
    schemaVersion: 1, mode: pick('mode', ['clean','atmosphere','image','scene'], DEFAULT_CHAT_BACKGROUND.mode),
    themeId: isChatAtmosphereThemeId(record.themeId) ? record.themeId : 'cool',
    focalPoint: { x: bounded(point.x, 0, 1, .5), y: bounded(point.y, 0, 1, .5) },
    zoom: bounded(record.zoom, 1, 2, 1), mask: bounded(record.mask, .35, .85, .4), blur: bounded(record.blur, 0, 12, 0),
    effect: pick('effect', ['glow','dust'], 'glow'), strength: pick('strength', ['off','gentle','vivid'], 'gentle'),
    lightDarkPolicy: pick('lightDarkPolicy', ['app','light','dark'], 'app'),
  };
  if (config.mode === 'scene') {
    const scene = record.scene && typeof record.scene === 'object' ? record.scene as Record<string,unknown> : {};
    config.scene = { id: isSceneId(scene.id) ? scene.id : DEFAULT_SCENE_ID,
      quality: scene.quality === 'rich' || scene.quality === 'power-save' ? scene.quality : 'auto',
      motionEnabled: scene.motionEnabled !== false, parallaxEnabled: scene.parallaxEnabled === true,
      renderer:scene.renderer==='auto'?'auto':'layered' };
    if(typeof scene.timeVariantId==='string'&&scene.timeVariantId.length<80)config.scene.timeVariantId=scene.timeVariantId;
  }
  if(record.presentation&&typeof record.presentation==='object')config.presentation=resolveExperience(record.presentation as Partial<AppearanceExperience>);
  if (!isChatAtmosphereThemeId(record.themeId)) reasons.push('theme-invalid');
  const visual = record.roleVisual as Partial<RoleVisualConfig> | undefined;
  if (visual && typeof visual === 'object') {
    const validImage = (value: unknown): value is string => typeof value === 'string' && value.length <= 1_000_000 && /^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(value);
    const value: RoleVisualConfig = {};
    if (ORB_COLORS.some(color => color.id === visual.orbColor)) value.orbColor = visual.orbColor;
    if (['gentle','lively','reduced'].includes(visual.orbMotion ?? '')) value.orbMotion = visual.orbMotion;
    if (visual.avatar && validImage(visual.avatar.source) && validImage(visual.avatar.image)) value.avatar = { source: visual.avatar.source, image: visual.avatar.image, x: bounded(visual.avatar.x,0,1,.5), y: bounded(visual.avatar.y,0,1,.5), zoom: bounded(visual.avatar.zoom,1,2,1) };
    if (Object.keys(value).length) config.roleVisual = value;
  }
  if (config.mode === 'image' && typeof record.imageAssetId === 'string' && /^bg:[\w-]{1,100}$/.test(record.imageAssetId)) config.imageAssetId = record.imageAssetId;
  // Leaving image mode deliberately releases its resource; it is not kept invisibly forever.
  return { config, reasons };
}
export function resolveChatBackground(character: Character | undefined, global: GlobalChatBackground | undefined, override: ChatBackgroundConfig | undefined) {
  const recommended = resolveCharacterAtmosphere(character);
  const defaults = global ?? DEFAULT_GLOBAL_BACKGROUND;
  const config = { ...(override ?? (defaults.strategy === 'characterRecommended' ? { ...defaults.config, themeId: recommended.primary === 'neutral' ? 'cool' : recommended.primary } : defaults.config)) };
  config.presentation=resolveExperience({...defaults.config.presentation,...override?.presentation});
  if (!override) delete config.roleVisual;
  return { config, secondary: !override && defaults.strategy === 'characterRecommended' ? recommended.secondary : undefined, recommended, independent: !!override };
}
export function chatBackgroundError(error: unknown): string {
  const message = error instanceof Error ? `${error.name}:${error.message}` : String(error);
  if (/conflict/.test(message)) return '这份外观已在其他窗口修改。请关闭后重新打开，再保存你的选择。';
  if (/owner/.test(message)) return '账号或角色已变化，未保存本次修改。';
  if (/Quota|quota/i.test(message)) return '本机存储空间不足。原背景和当前草稿都已保留，请释放空间或选较小图片后重试。';
  if (/missing/.test(message)) return '本地图片已缺失，请重新选择图片。聊天仍可使用安全主题。';
  return '外观未能保存，原设置和草稿已保留。请重试；仍失败时可先选择纯净模式。';
}
