import type { Container, Engine, IShapeDrawer, ISourceOptions, Particle } from '@tsparticles/engine';
import type { ChatBackgroundConfig } from './chat-background-config';
import type { ChatAtmosphereThemeId } from './chat-atmosphere';

export interface ChatParticleProfile {
  shape: string;
  motion: string;
  direction: 'top' | 'bottom' | 'none' | 'top-right' | number;
  speed: { min: number; max: number };
  size: { min: number; max: number };
  colors: { light: string[]; dark: string[] };
  rotation: number;
}

/** Original silhouettes, using the MIT tsParticles engine rather than image assets or remote presets. */
export const CHAT_PARTICLE_PROFILES: Record<Exclude<ChatAtmosphereThemeId, 'neutral'>, ChatParticleProfile> = {
  cool: { shape: 'vg-snow', motion: 'snowfall', direction: 'bottom', speed: { min: .24, max: .62 }, size: { min: 1.6, max: 5.1 }, colors: { light: ['#7962b0', '#658ca9', '#a394c5'], dark: ['#d8c8ff', '#b8e5ff', '#9685dd'] }, rotation: 2.5 },
  warm: { shape: 'vg-amber', motion: 'rising-bokeh', direction: 'top', speed: { min: .16, max: .46 }, size: { min: 1.8, max: 3.8 }, colors: { light: ['#b76c2a', '#b88745', '#d19243'], dark: ['#ffd797', '#ffb66b', '#ffe6b2'] }, rotation: 0 },
  lively: { shape: 'vg-petal', motion: 'petal-fall', direction: 115, speed: { min: .34, max: .76 }, size: { min: 3.2, max: 7.2 }, colors: { light: ['#c56985', '#d48b98', '#b779a5'], dark: ['#f8aecb', '#ffccbf', '#d497d2'] }, rotation: 4.5 },
  calm: { shape: 'vg-rain', motion: 'diagonal-light-rain', direction: 110, speed: { min: .6, max: 1.2 }, size: { min: 1.2, max: 2.7 }, colors: { light: ['#4180aa', '#558eaf', '#77a8c1'], dark: ['#99d7ff', '#b3eaf3', '#6ab8f2'] }, rotation: 0 },
  steady: { shape: 'vg-firefly', motion: 'wandering-fireflies', direction: 'none', speed: { min: .14, max: .38 }, size: { min: 1.6, max: 4.2 }, colors: { light: ['#668736', '#77934d', '#a48c36'], dark: ['#d7ef96', '#8fd4a8', '#f3df99'] }, rotation: 0 },
  mysterious: { shape: 'vg-star', motion: 'constellation-drift', direction: 'top-right', speed: { min: .08, max: .25 }, size: { min: 1.3, max: 4.4 }, colors: { light: ['#7864aa', '#5b76b0', '#a177a9'], dark: ['#d7c7ff', '#9ec5ff', '#eeacd9'] }, rotation: 1.2 },
};

export interface ChatParticleFrameMetrics { frames: number; lastFrameTime: number; fps: number }
const frameMetrics = new WeakMap<Container, ChatParticleFrameMetrics>();
let enginePromise: Promise<Engine> | undefined;
let initializedEngine: Engine | undefined;
type ParticlePluginManager = Engine['pluginManager'] & { pathGenerators?: Map<Container, unknown> };

/** tsParticles 4.4 clears container plugins but leaves the move plugin's path cache keyed by that container. */
export function destroyChatParticleContainer(container: Container) {
  try { container.destroy(); }
  finally { (initializedEngine?.pluginManager as ParticlePluginManager | undefined)?.pathGenerators?.delete(container); }
}

/** Scoped diagnostics for engine caches; contains no account or conversation data. */
export function inspectChatParticleResources() {
  const paths = (initializedEngine?.pluginManager as ParticlePluginManager | undefined)?.pathGenerators;
  return { activeContainers: initializedEngine?.items.length ?? 0, pathCacheEntries: paths?.size ?? 0,
    destroyedPathEntries: paths ? [...paths.keys()].filter(container => container.destroyed).length : 0 };
}

/** Read-only lifecycle evidence; does not initialize the engine or expose chat state. */
export function inspectChatParticleEngine() {
  return initializedEngine?.items.filter(container => container.actualOptions.key === 'vg-chat-particles').map(container => ({ instanceId: String(container.id), destroyed: container.destroyed, animationStatus: container.animationStatus })) ?? [];
}

export function getChatParticleFrameMetrics(container: Container) {
  return frameMetrics.get(container) ?? { frames: 0, lastFrameTime: 0, fps: 0 };
}

export function getChatParticleProfile(theme: ChatAtmosphereThemeId) {
  return CHAT_PARTICLE_PROFILES[theme === 'neutral' ? 'cool' : theme];
}

export function chatParticleCount(config: ChatBackgroundConfig) {
  return config.strength === 'vivid' ? config.effect === 'dust' ? 96 : 72 : config.effect === 'dust' ? 58 : 42;
}

function drawStar(context: OffscreenCanvasRenderingContext2D, radius: number, points: number, inner: number) {
  for (let index = 0; index < points * 2; index++) {
    const angle = -Math.PI / 2 + index * Math.PI / points;
    const length = index % 2 ? radius * inner : radius;
    const x = Math.cos(angle) * length, y = Math.sin(angle) * length;
    if (!index) context.moveTo(x, y); else context.lineTo(x, y);
  }
  context.closePath();
}

function createDrawer(shape: string): IShapeDrawer {
  const gradients = new WeakMap<Particle, CanvasGradient>();
  return {
    beforeDraw: ({ context }) => context.save(),
    afterDraw: ({ context }) => context.restore(),
    draw: ({ context, radius, particle, opacity }) => {
      switch (shape) {
        case 'vg-scene-rain': {
          let gradient = gradients.get(particle);
          if (!gradient) {
            const color = particle.getFillColor();
            const hue = color?.h ?? 210, saturation = color?.s ?? 18, lightness = color?.l ?? 80;
            gradient = context.createLinearGradient(0, -radius * 5.4, 0, radius * 3.2);
            gradient.addColorStop(0, `hsla(${hue},${saturation}%,${lightness}%,0)`);
            gradient.addColorStop(.36, `hsla(${hue},${saturation}%,${lightness}%,.16)`);
            gradient.addColorStop(.82, `hsla(${hue},${saturation}%,${lightness}%,.82)`);
            gradient.addColorStop(1, `hsla(${hue},${saturation}%,${lightness}%,0)`);
            gradients.set(particle, gradient);
          }
          context.globalAlpha = opacity; context.fillStyle = gradient;
          context.moveTo(0, -radius * 5.4);
          context.lineTo(radius * .22, radius * 2.2);
          context.quadraticCurveTo(0, radius * 3.8, -radius * .22, radius * 2.2);
          context.closePath();
          break;
        }
        case 'vg-scene-snow':
        case 'vg-scene-dust':
        case 'vg-scene-mist':
        case 'vg-scene-ember': {
          // Scene effects have their own silhouettes; existing atmosphere presets remain unchanged.
          const snow = shape === 'vg-scene-snow', mist = shape === 'vg-scene-mist', ember = shape === 'vg-scene-ember';
          let gradient = gradients.get(particle);
          if (!gradient) {
            const color = particle.getFillColor();
            const hue = color?.h ?? 42, saturation = color?.s ?? 35, lightness = color?.l ?? 82;
            gradient = context.createRadialGradient(0, 0, 0, 0, 0, radius);
            gradient.addColorStop(0, `hsla(${hue},${saturation}%,${Math.min(96, lightness + (ember ? 16 : 4))}%,${mist ? .25 : .94})`);
            gradient.addColorStop(mist ? .3 : .45, `hsla(${hue},${saturation}%,${lightness}%,${mist ? .15 : .48})`);
            gradient.addColorStop(1, `hsla(${hue},${saturation}%,${lightness}%,0)`);
            gradients.set(particle, gradient);
          }
          context.globalAlpha = opacity; context.fillStyle = gradient;
          if (mist) context.scale(4.2, 1.2);
          else if (ember) context.scale(.72, 1.7);
          else if (snow) context.scale(1, .82 + (particle.id % 5) * .045);
          context.arc(0, 0, radius, 0, Math.PI * 2);
          break;
        }
        case 'vg-snow':
          drawStar(context, radius, 6, .22);
          break;
        case 'vg-petal':
          context.moveTo(0, -radius);
          context.bezierCurveTo(radius * 1.25, -radius * .65, radius * .8, radius * .8, -radius * .2, radius);
          context.bezierCurveTo(-radius, radius * .25, -radius * .9, -radius * .3, 0, -radius);
          context.closePath();
          break;
        case 'vg-rain':
          context.moveTo(-radius * .24, -radius * 5.4);
          context.lineTo(radius * .3, -radius * 4.5);
          context.lineTo(radius * .22, radius * 2.5);
          context.quadraticCurveTo(0, radius * 3.4, -radius * .22, radius * 2.5);
          context.closePath();
          break;
        case 'vg-star':
          if (particle.id % 4) context.arc(0, 0, radius * .62, 0, Math.PI * 2);
          else drawStar(context, radius * 1.25, 4, .16);
          break;
        default: {
          const glow = shape === 'vg-firefly' || particle.id % 11 === 0;
          if (!glow) { context.arc(0, 0, radius, 0, Math.PI * 2); break; }
          const extent = shape === 'vg-firefly' ? radius * 2.1 : radius;
          let gradient = gradients.get(particle);
          if (!gradient) {
            const color = particle.getFillColor();
            const hue = color?.h ?? 40, saturation = color?.s ?? 80, lightness = color?.l ?? 70;
            gradient = context.createRadialGradient(0, 0, 0, 0, 0, extent);
            gradient.addColorStop(0, `hsla(${hue},${saturation}%,${Math.min(92, lightness + 18)}%,.95)`);
            gradient.addColorStop(.24, `hsla(${hue},${saturation}%,${lightness}%,.66)`);
            gradient.addColorStop(.7, `hsla(${hue},${saturation}%,${lightness}%,.17)`);
            gradient.addColorStop(1, `hsla(${hue},${saturation}%,${lightness}%,0)`);
            gradients.set(particle, gradient);
          }
          context.globalAlpha = opacity;
          context.fillStyle = gradient;
          context.arc(0, 0, extent, 0, Math.PI * 2);
        }
      }
    },
  };
}

/** One shared lazy initialization; no CDN, extra frame scheduler, or per-frame React work. */
export function loadChatParticleEngine(): Promise<Engine> {
  if (!enginePromise) {
    enginePromise = Promise.all([
      import('@tsparticles/engine'), import('@tsparticles/basic'),
      import('@tsparticles/updater-rotate'), import('@tsparticles/plugin-interactivity'), import('@tsparticles/interaction-particles-links'),
    ]).then(async ([{ tsParticles: engine }, { loadBasic }, { loadRotateUpdater }, { loadInteractivityPlugin }, { loadParticlesLinksInteraction }]) => {
      await loadBasic(engine);
      await loadRotateUpdater(engine);
      await loadInteractivityPlugin(engine);
      await loadParticlesLinksInteraction(engine);
      for (const profile of Object.values(CHAT_PARTICLE_PROFILES)) {
        engine.pluginManager.addShape([profile.shape], async () => createDrawer(profile.shape));
      }
      for (const shape of ['vg-scene-rain', 'vg-scene-snow', 'vg-scene-dust', 'vg-scene-mist', 'vg-scene-ember']) {
        engine.pluginManager.addShape([shape], async () => createDrawer(shape));
      }
      engine.pluginManager.addPlugin({
        id: 'vg-chat-frame-metrics', needsPlugin: () => true, loadOptions: () => {},
        getPlugin: async container => {
          const metrics = { frames: 0, lastFrameTime: 0, fps: 0 };
          frameMetrics.set(container, metrics);
          return { layer: 6, resize: () => {
            // Resizing clears a canvas, including paused/reduced-motion fields. Repaint one static frame.
            if (!container.destroyed && !container.animationStatus) container.canvas.render.drawParticles({ value: 0, factor: 0 });
          }, drawSettingsCleanup: (_context, delta) => {
            // Static initialization and resume both have delta=0; they are not frame-rate samples.
            const now = performance.now(), elapsed = delta.value;
            if (elapsed > 0) metrics.fps = metrics.fps ? metrics.fps * .8 + 1000 / elapsed * .2 : 1000 / elapsed;
            metrics.lastFrameTime = now; metrics.frames++;
          } };
        },
      });
      await engine.init();
      initializedEngine = engine;
      return engine;
    }).catch(error => { enginePromise = undefined; throw error; });
  }
  return enginePromise;
}

export function getChatParticleOptions(config: ChatBackgroundConfig, dark: boolean): ISourceOptions {
  const profile = getChatParticleProfile(config.themeId);
  const fireflies = config.themeId === 'steady';
  return {
    key: 'vg-chat-particles', autoPlay: false, fullScreen: { enable: false }, detectRetina: false,
    // The host owns visibility arbitration, avoiding a second visibility handler starting duplicate rAFs.
    fpsLimit: 30, smooth: false, pauseOnBlur: false, pauseOnOutsideViewport: false,
    background: { opacity: 0 }, resize: { enable: true, delay: .18 },
    interactivity: { events: { onHover: { enable: false }, onClick: { enable: false } } },
    particles: {
      number: { value: 0, density: { enable: false } },
      shape: { type: profile.shape, close: true },
      paint: { color: { value: profile.colors[dark ? 'dark' : 'light'] }, fill: { enable: true } },
      size: { value: profile.size },
      opacity: { value: { min: dark ? .28 : .24, max: dark ? .85 : .65 }, animation: { enable: fireflies, speed: .48, sync: false, startValue: 'random' } },
      move: { enable: true, direction: profile.direction, speed: profile.speed, random: true, straight: !fireflies, outModes: { default: 'out' }, drift: fireflies ? { min: -.2, max: .2 } : { min: -.05, max: .1 } },
      rotate: { value: config.themeId === 'calm' ? 18 : { min: 0, max: 360 }, animation: { enable: profile.rotation > 0, speed: profile.rotation, sync: false }, direction: 'random', path: false },
      links: { enable: config.themeId === 'mysterious', color: profile.colors[dark ? 'dark' : 'light'][1], distance: 66, opacity: dark ? .18 : .14, width: .6, frequency: .12, triangles: { enable: false } },
    },
  };
}

/** Stratified full-field placement guarantees visible central particles even in a short preview. */
export function seedChatParticles(container: Container, config: ChatBackgroundConfig) {
  const count = chatParticleCount(config), profile = getChatParticleProfile(config.themeId);
  const { width, height } = container.canvas.size;
  const columns = 7, rows = Math.ceil(count / columns);
  for (let index = 0; index < count; index++) {
    const randomX = ((index * 37 + 11) % 97) / 97, randomY = ((index * 61 + 23) % 101) / 101;
    const near = index % 4 === 0;
    const size = config.themeId === 'warm' && index % 11 === 0 ? 10 + randomX * 8
      : near ? profile.size.max * (.78 + randomX * .22) : profile.size.min + randomX * (profile.size.max - profile.size.min) * .36;
    container.particles.addParticle({ x: ((index % columns + .15 + randomX * .7) / columns) * width, y: ((Math.floor(index / columns) + .15 + randomY * .7) / rows) * height }, {
      size: { value: size }, opacity: { value: near ? { min: .48, max: .88 } : { min: .25, max: .58 } },
    });
  }
  container.canvas.render.drawParticles({ value: 0, factor: 0 });
}
