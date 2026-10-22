import type { Container, Engine } from '@tsparticles/engine';
import { loadChatParticleEngine, destroyChatParticleContainer, getChatParticleOptions, getChatParticleFrameMetrics } from '../../../lib/chat-particle-engine';
import { DEFAULT_CHAT_BACKGROUND } from '../../../lib/chat-background-config';
import type { LoadedSceneAssets } from '../../../lib/chat-scene/scene-assets';
import type { SceneMotionPolicy } from '../../../lib/chat-scene/scene-types';
import { SCENE_EFFECT_PROFILES } from '../../../lib/chat-scene/scene-effects';

let sceneParticleSerial=0;
/** Stable scene-local variation without the diagonal lattice of linear modular seeds. */
function sceneRandom(id:string){
  let state=2166136261;
  for(let i=0;i<id.length;i++)state=Math.imul(state^id.charCodeAt(i),16777619);
  return ()=>{state=(state+0x6d2b79f5)|0;let value=Math.imul(state^(state>>>15),1|state);value^=value+Math.imul(value^(value>>>7),61|value);return ((value^(value>>>14))>>>0)/4294967296;};
}
/** One existing engine/container, local to the camera-aligned window mask. No Worker is claimed. */
export async function mountSceneParticles(mount:HTMLElement, assets:LoadedSceneAssets, signal:AbortSignal) {
  const slot=document.createElement('div');slot.className='vg-scene-particle-slot';mount.appendChild(slot);
  const night=assets.selection.scene.effect==='rain'||assets.selection.scene.effect==='train-rain';
  const profile=SCENE_EFFECT_PROFILES[assets.selection.scene.effect??(night?'rain':'dust')];
  const config={...DEFAULT_CHAT_BACKGROUND,themeId:night?'calm' as const:'warm' as const};
  const instanceId=`vg-scene-particles-${++sceneParticleSerial}`;
  let engine:Engine|undefined,container:Container|undefined,disposed=false, policy:SceneMotionPolicy={mode:'paused',effectFps:0,parallaxEnabled:false,reason:'initializing'};
  const dispose=()=>{if(disposed)return;disposed=true;if(container)destroyChatParticleContainer(container);slot.remove();};
  signal.addEventListener('abort',dispose,{once:true});
  try {
    engine=await loadChatParticleEngine();if(signal.aborted||disposed)throw new DOMException('Cancelled','AbortError');
    const options=getChatParticleOptions(config,true);options.fpsLimit=assets.selection.quality==='rich'?30:24;
    const count=profile.count[assets.selection.quality==='rich'?1:0];
    const rain=profile.shape==='vg-scene-rain',snow=profile.shape==='vg-scene-snow',mist=profile.shape==='vg-scene-mist';
    options.particles={...options.particles,shape:{type:profile.shape,close:true},
      paint:{color:{value:profile.colors},fill:{enable:true}},size:{value:profile.size},
      opacity:{value:profile.opacity,animation:{enable:false}},
      move:{enable:true,direction:profile.direction,speed:profile.speed,random:false,straight:rain,angle:snow?18:28,outModes:{default:'out'},drift:rain?{min:-.015,max:.025}:{min:-.06,max:.08}},
      rotate:{value:rain?profile.rotation:{min:mist?-8:0,max:snow?360:mist?8:0},animation:{enable:snow,speed:profile.rotation,sync:false},direction:'random',path:false},links:{enable:false}};
    // Physical display size, not 1440×3200 design pixels; only the effects use this reduced canvas.
    const candidate=await engine.load({id:instanceId,element:slot,options});
    if(!candidate)throw Error('scene:particle-init');container=candidate;
    if(signal.aborted||disposed){destroyChatParticleContainer(candidate);throw new DOMException('Cancelled','AbortError');}
    const {width,height}=container.canvas.size;
    const random=sceneRandom(assets.selection.scene.id);
    for(let i=0;i<count;i++){
      const u=random(),v=random(),depth=random(),variation=random();
      // A few close flecks establish depth; the majority stay slow and distant.
      // Reuse the existing exported window mask and the same particle budget.
      const near=depth>(assets.selection.scene.effect==='starfield'?.94:.78);
      const proximity=near?.8+random()*.2:depth*depth*.62;
      const size=(profile.size.min+(profile.size.max-profile.size.min)*proximity)*(near?1.22:1);
      const speed=(profile.speed.min+(profile.speed.max-profile.speed.min)*(.15+proximity*.85))*(near?1.1:1);
      container.particles.addParticle({x:u*width,y:v*height},{
        size:{value:size},opacity:{value:Math.min(profile.opacity,profile.opacity*(near?.96:.4+proximity*.5))},
        move:{speed:speed,direction:typeof profile.direction==='number'?profile.direction+(variation-.5)*3:profile.direction},
      });
    }
    container.canvas.render.drawParticles({value:0,factor:0});
    let tier=0;
    return { apply(next:SceneMotionPolicy){const previous=policy;policy=next;if(disposed||!container)return;const active=next.mode==='idle'&&next.particles!=='off',wasActive=previous.mode==='idle'&&previous.particles!=='off';container.fpsLimit=Math.min(tier>=2?18:30,next.particles==='low'?12:next.effectFps||20);if(active&&!wasActive)container.play();else if(!active)container.pause();},
      degrade(level:number){if(!container||level<=tier)return;tier=level;if(level>=1&&container.particles.count>Math.ceil(count/2))container.particles.removeQuantity(container.particles.count-Math.ceil(count/2));if(level>=2)container.fpsLimit=18;},
      inspect:()=>({effect:assets.selection.scene.effect??'dust',shape:profile.shape,frames:container?getChatParticleFrameMetrics(container).frames:0,fps:container?getChatParticleFrameMetrics(container).fps:0,particles:container?.particles.count??0,mode:policy.mode,canvas:{width:container?.canvas.size.width??0,height:container?.canvas.size.height??0},thread:'main-thread-offscreen-canvas'}),
      dispose(){signal.removeEventListener('abort',dispose);dispose();} };
  }catch(error){
    // 4.4 registers an item before loadCanvas/start can reject. Only remove this host's item.
    const partial=engine?.items.find(item=>item.id.description===instanceId);
    if(partial&&!partial.destroyed)destroyChatParticleContainer(partial);
    signal.removeEventListener('abort',dispose);dispose();throw error;
  }
}
