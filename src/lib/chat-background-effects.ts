import type { ChatAtmosphereThemeId } from './chat-atmosphere';

/** Full-room light choreography. Particle physics and original canvas drawers
 * live in the lazy particle engine; this layer adds broad, prepainted depth. */
interface BackgroundEffectProfile {
  period: number;
  angle:string;
  sway:string;
  origin:string;
  description:string;
}
const profiles: Record<ChatAtmosphereThemeId, BackgroundEffectProfile> = {
  neutral:{period:22,angle:'-14deg',sway:'22px',origin:'28% 22%',description:'流动柔光与悬浮星尘'},
  cool:{period:24,angle:'-24deg',sway:'26px',origin:'26% 18%',description:'银紫月雾、六角雪晶与缓慢飘落的晶尘'},
  warm:{period:20,angle:'18deg',sway:'18px',origin:'28% 68%',description:'琥珀散景、上升暖尘与柔和的夕照'},
  lively:{period:16,angle:'-18deg',sway:'32px',origin:'68% 22%',description:'旋转桃瓣、珊瑚微光与轻盈的花雨'},
  calm:{period:22,angle:'26deg',sway:'24px',origin:'24% 12%',description:'蓝色光雨、流线与通透水光'},
  steady:{period:26,angle:'-12deg',sway:'18px',origin:'70% 72%',description:'森林萤火、远近光点与柔和的林间光'},
  mysterious:{period:28,angle:'-32deg',sway:'28px',origin:'62% 24%',description:'星群、细微星座连线与紫靛星云'},
};
export function getChatBackgroundEffectProfile(theme: ChatAtmosphereThemeId) {
  return profiles[theme] ?? profiles.neutral;
}
