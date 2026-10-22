import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ChatBackgroundConfig } from '../../../lib/chat-background-config';
import { DEFAULT_SCENE_PREFERENCES, getChatScene } from '../../../lib/chat-scene/scene-registry';
import { loadSceneAssets, sceneAssetPool, type LoadedSceneAssets } from '../../../lib/chat-scene/scene-assets';
import { sceneCover, selectSceneAssets } from '../../../lib/chat-scene/scene-policy';
import { createSceneRuntime, inspectSceneRuntimeResources } from '../../../lib/chat-scene/scene-runtime';
import type { SceneMotionPolicy } from '../../../lib/chat-scene/scene-types';
import { prefersReducedMotion } from '../../../lib/mobile-motion';
import { mountSceneParticles } from './SceneParticles';
import { createScenePerformanceGuard } from '../../../lib/chat-scene/scene-performance';
import { inspectRealtimeResources } from '../../../lib/chat-scene/realtime-budget';
import { inspectRealtimeModelResources } from '../../../lib/chat-scene/realtime-model-assets';
import type { RealtimeSceneExecutor } from '../../../lib/chat-scene/realtime-renderer';
import { claimScenePreview, watchScenePreview } from '../../../lib/chat-scene/scene-preview-priority';
import { getSceneLightProfile } from '../../../lib/chat-scene/scene-lighting';
import {resolveEffectiveSceneAppearance} from '../../../lib/chat-scene/scene-time';
import '../../../styles/chat-scene.css';

interface SceneRecord { instance:number; frames:number; loads:number; state:string; requestedQuality:string; effectiveQuality:string; reason:string; pose:{x:number;y:number}; inputFocused:boolean;keyboardOpen:boolean;selectionBytes:number; backend?:string; rendererFailure?:string; animations?:()=>{time:number|null;state:string}[]; particles?:()=>unknown; depthProbe?:()=>unknown; }
const records=new WeakMap<HTMLElement,SceneRecord>(),hostBudgets=new Map<number,number>();let serial=0;
export function inspectChatScene(element:HTMLElement){const host=element.matches('.vg-chat-scene')?element:element.querySelector<HTMLElement>('.vg-chat-scene');const record=host&&records.get(host);return record?{...record,depthProbe:undefined,animations:record.animations?.(),particles:record.particles?.()}:undefined;}
export function probeChatSceneDepth(element:HTMLElement){const host=element.matches('.vg-chat-scene')?element:element.querySelector<HTMLElement>('.vg-chat-scene');return host?records.get(host)?.depthProbe?.():undefined;}
export const inspectChatSceneResources=()=>({...sceneAssetPool.inspect(),...inspectSceneRuntimeResources(),...inspectRealtimeResources(),...inspectRealtimeModelResources()});

/** DOM scene layers share a single design-camera transform; messages remain sibling DOM. */
export function ChatSceneLayer({config}:{config:ChatBackgroundConfig}) {
  const preferences=useMemo(()=>({...DEFAULT_SCENE_PREFERENCES,...config.scene,experience:config.presentation}),[config.scene,config.presentation]);
  const scene=getChatScene(resolveEffectiveSceneAppearance(preferences).assetSceneId);
  const hostRef=useRef<HTMLDivElement>(null),planeRef=useRef<HTMLDivElement>(null),layersRef=useRef<HTMLDivElement>(null);
  const [viewport,setViewport]=useState({width:0,height:0,dpr:1}),[reduced,setReduced]=useState(()=>prefersReducedMotion());
  const [poster,setPoster]=useState<string>();
  const [performanceStatic,setPerformanceStatic]=useState(false);
  const [rendererFailure,setRendererFailure]=useState('');
  const [previewCovered,setPreviewCovered]=useState(false);
  const retireRef=useRef<(()=>void)|undefined>(undefined);
  const wantsRealtime=!!scene?.realtime&&preferences.renderer!=='layered'&&!rendererFailure;
  const selection=useMemo(()=>{const selected=scene&&viewport.width?selectSceneAssets(scene,viewport,preferences,reduced||performanceStatic||previewCovered):undefined;
    return selected&&wantsRealtime&&selected.quality!=='static'?{...selected,base:undefined,layers:[],windowMask:undefined,decodedBytes:selected.poster.width*selected.poster.height*4}:selected;
  },[scene,viewport,preferences.id,preferences.quality,preferences.motionEnabled,reduced,performanceStatic,previewCovered,wantsRealtime]);
  useLayoutEffect(()=>{
    if(hostRef.current?.closest('.vg-background-preview')){
      const release=claimScenePreview();
      return()=>{retireRef.current?.();release();};
    }
    return watchScenePreview(covered=>{retireRef.current?.();setPreviewCovered(covered);});
  },[]);
  useEffect(()=>setPerformanceStatic(false),[preferences.id,preferences.quality,preferences.motionEnabled]);
  useEffect(()=>setRendererFailure(''),[preferences.id,preferences.quality,preferences.renderer]);
  useLayoutEffect(()=>{
    const host=hostRef.current;if(!host)return;
    const room=host.closest('.chat-room,.vg-background-preview');let frame=0,last={width:0,height:0,dpr:1};
    const measure=()=>{
      const box=host.getBoundingClientRect();if(!box.width||!box.height)return;
      const active=document.activeElement;const focused=!!active&&!!room?.contains(active)&&active.matches('input,textarea,[contenteditable=true]');
      const keyboard=!!visualViewport&&innerHeight-visualViewport.height-visualViewport.offsetTop>120;
      const holdHeight=(focused||keyboard)&&Math.abs(box.width-last.width)<1;
      const next={width:box.width,height:holdHeight?last.height||box.height:box.height,dpr:devicePixelRatio||1};
      if(next.width!==last.width||next.height!==last.height||next.dpr!==last.dpr){last=next;setViewport(next);}
    };
    const resize=new ResizeObserver(()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(measure);});resize.observe(host);measure();
    return()=>{cancelAnimationFrame(frame);resize.disconnect();};
  },[]);
  useEffect(()=>{
    const host=hostRef.current,plane=planeRef.current,layers=layersRef.current;
    if(!host||!plane||!layers||!selection||!scene)return;
    const request=++serial,peakBudget=Math.max(selection.budgetBytes,...hostBudgets.values());hostBudgets.set(request,selection.budgetBytes);
    const variants=[selection.poster,...(selection.base?[selection.base]:[]),...(selection.windowMask?[selection.windowMask]:[]),...selection.layers.map(row=>row.variant)];
    // Covered chat and preview may share decoded images. Reserve pending decodes too;
    // a different preview uses its complete poster when two layered sets would exceed the cap.
    const retainedPoster=poster&&poster!==selection.poster.src?scene.poster[0].width*scene.poster[0].height*4:0;
    const budgetFallback=selection.quality!=='static'&&sceneAssetPool.estimatedBytesFor(variants)+retainedPoster+inspectRealtimeResources().realtimeReservedBytes>peakBudget;
    const activeSelection=budgetFallback?{...selection,quality:'static' as const,base:undefined,layers:[],windowMask:undefined,decodedBytes:selection.poster.width*selection.poster.height*4,budgetBytes:16*1024*1024}:selection;
    const abort=new AbortController();let alive=true,assets:LoadedSceneAssets|undefined,particles:Awaited<ReturnType<typeof mountSceneParticles>>|RealtimeSceneExecutor|undefined;
    let animations:Animation[]=[],frame=0,lastTime=0,target={x:0,y:0},pose={x:0,y:0},arriving=false;
    const performanceGuard=createScenePerformanceGuard();let monitor:ReturnType<typeof setInterval>|undefined,monitorStart=0;
    let policy:SceneMotionPolicy={mode:'paused',reason:'loading',effectFps:0,parallaxEnabled:false};
    const moving:{node:HTMLElement;factor:number;max:number}[]=[];
    const cover=sceneCover(scene,viewport.width,viewport.height);
    plane.style.width=`${scene.designSize.width}px`;plane.style.height=`${scene.designSize.height}px`;
    plane.style.transform=`translate3d(${cover.x}px,${cover.y}px,0) scale(${cover.scale})`;
    const record:SceneRecord={instance:request,frames:0,loads:0,state:'loading',requestedQuality:preferences.quality,effectiveQuality:activeSelection.quality,reason:'loading',pose,inputFocused:false,keyboardOpen:false,selectionBytes:activeSelection.decodedBytes,backend:activeSelection.quality==='static'?'poster':'layered',rendererFailure};records.set(host,record);
    record.animations=()=>animations.map(a=>({time:typeof a.currentTime==='number'?a.currentTime:null,state:a.playState}));
    record.particles=()=>particles?.inspect();
    host.dataset.sceneId=scene.id;host.dataset.sceneQuality=activeSelection.quality;host.dataset.sceneLoad='loading';
    host.dataset.sceneRenderer=wantsRealtime&&activeSelection.quality!=='static'?'loading':activeSelection.quality==='static'?'poster':'layered';
    const stop=()=>{cancelAnimationFrame(frame);frame=0;lastTime=0;};
    const tick=(now:number)=>{
      frame=0;if(!alive||policy.mode!=='idle'||!policy.parallaxEnabled||arriving)return;
      const dt=lastTime?Math.min(48,now-lastTime):16;lastTime=now;const blend=1-Math.exp(-dt/140);
      pose={x:pose.x+(target.x-pose.x)*blend,y:pose.y+(target.y-pose.y)*blend};record.pose=pose;record.frames++;
      for(const row of moving)row.node.style.transform=`translate3d(${pose.x*row.factor*row.max/cover.scale}px,${pose.y*row.factor*row.max/cover.scale}px,0)`;
      if(Math.hypot(target.x-pose.x,target.y-pose.y)>.002)frame=requestAnimationFrame(tick);else lastTime=0;
    };
    const pointer=(event:PointerEvent)=>{
      // Chat touch is scrolling, never a camera gesture; optional parallax follows only hover pointers.
      if(event.pointerType!=='mouse'||!policy.parallaxEnabled||policy.mode!=='idle'||arriving)return;
      const box=host.getBoundingClientRect();target={x:Math.max(-1,Math.min(1,(event.clientX-box.left)/box.width*2-1)),y:Math.max(-1,Math.min(1,(event.clientY-box.top)/box.height*2-1))};
      if(wantsRealtime&&activeSelection.quality!=='static'){if(particles&&'pointer' in particles)particles.pointer(target.x,target.y);return;}
      if(!frame)frame=requestAnimationFrame(tick);
    };
    const room=host.closest<HTMLElement>('.chat-room,.vg-background-preview')??host;
    room.addEventListener('pointermove',pointer,{passive:true});
    const runtime=createSceneRuntime(host,preferences,activeSelection.quality,snapshot=>{
      policy=snapshot.policy;record.inputFocused=snapshot.signals.inputFocused;record.keyboardOpen=snapshot.signals.keyboardOpen;
      if(performanceStatic&&policy.mode==='static')policy={...policy,reason:'performance'};
      if(previewCovered&&policy.mode==='static')policy={...policy,reason:'covered-preview'};
      if(budgetFallback&&policy.mode==='static')policy={...policy,reason:'resource-budget'};
      if(performanceGuard.level>=3)policy={...policy,parallaxEnabled:false};
      record.reason=policy.reason;
      host.dataset.scenePolicy=policy.mode;host.dataset.scenePause=policy.reason;host.dataset.sceneAmbient=policy.ambient??'off';
      host.dataset.sceneInput=String(snapshot.signals.inputFocused);host.dataset.sceneKeyboard=String(snapshot.signals.keyboardOpen);
      setReduced(old=>old===snapshot.signals.reduceMotion?old:snapshot.signals.reduceMotion);
      particles?.apply(policy);
      for(const animation of animations){if(animation.effect?.getTiming().iterations===Infinity){const rate=policy.ambient==='low'?.55:1;if(animation.playbackRate!==rate)animation.updatePlaybackRate(rate);}if(policy.mode==='idle'&&policy.ambient!=='off'&&performanceGuard.level<3){if(animation.playState==='paused')animation.play();}else if(animation.playState==='running')animation.pause();}
      if(policy.mode!=='idle')stop(); // Deliberately preserve current pose; do not snap to zero on input.
      if(policy.mode!=='idle'){clearInterval(monitor);monitor=undefined;performanceGuard.resetWindow();}
      else if(!monitor){monitorStart=performance.now();monitor=setInterval(()=>{if(!particles)return;const now=performance.now(),metrics=particles.inspect();const level=performanceGuard.sample(metrics.fps,performanceGuard.level>=2?18:policy.effectFps,now-monitorStart);monitorStart=now;particles.degrade(level);if(level>=3){policy={...policy,parallaxEnabled:false};stop();for(const animation of animations)if(animation.playState==='running')animation.pause();}if(level>=4)setPerformanceStatic(true);},4000);}
    });
    const image=(url:string,className:string)=>{const node=document.createElement('img');node.src=url;node.alt='';node.draggable=false;node.className=className;return node;};
    const animate=(node:HTMLElement,frames:Keyframe[],options:KeyframeAnimationOptions)=>{const animation=node.animate(frames,options);if(options.iterations===Infinity&&policy.ambient==='low')animation.updatePlaybackRate(.55);animations.push(animation);if(policy.mode!=='idle')animation.pause();return animation;};
    void loadSceneAssets(activeSelection,abort.signal).then(async loaded=>{
      if(!alive){loaded.release();return;}assets=loaded;record.loads++;record.state='ready';host.dataset.sceneLoad='ready';setPoster(loaded.poster.url);
      if(wantsRealtime&&activeSelection.quality!=='static'){
        record.state='preparing';host.dataset.sceneLoad='preparing';
        const fallback=(reason:string)=>{if(alive&&!abort.signal.aborted)setRendererFailure(reason);};
        try{
          const {mountRealtimeScene}=await import('../../../lib/chat-scene/realtime-renderer');if(!alive)return;
          const instance=await mountRealtimeScene(host,scene,loaded.poster,viewport,activeSelection.quality,abort.signal,fallback);
          if(!alive){instance.dispose();return;}particles=instance;record.backend='webgl2';record.depthProbe=instance.probeDepth;record.state='ready';host.dataset.sceneLoad='ready';host.dataset.sceneRenderer='webgl2';instance.apply(policy);
          if(policy.mode==='idle')animate(instance.canvas,[{opacity:0},{opacity:1}],{duration:450,fill:'both'});
        }catch(error){if(alive&&!abort.signal.aborted)fallback(error instanceof Error?error.message:'realtime-init-failed');}
        return;
      }
      host.dataset.sceneRenderer=activeSelection.quality==='static'?'poster':'layered';
      if(!loaded.base)return;
      const stage=document.createElement('div');Object.assign(stage.style,{position:'absolute',inset:'0'});stage.append(image(loaded.base.url,'vg-scene-base'));
      const illumination=document.createElement('div');illumination.className='vg-scene-ambient-light';stage.append(illumination);
      // Keep light attached to its source inside the room. Foreground image layers
      // are appended afterwards, so a soft window beam never floats above furniture.
      const lighting=getSceneLightProfile(scene);
      const window=scene.windowMaskRect??[scene.light.x,scene.light.y,scene.light.width,scene.light.height];
      const period=lighting.period*1000;
      const lightField=(kind:string,rect:readonly number[],color:string,opacity:number,duration:number,phase:number)=>{
        const node=document.createElement('div');node.className=`vg-scene-light-field vg-scene-light-${kind}`;
        Object.assign(node.style,{left:`${rect[0]}px`,top:`${rect[1]}px`,width:`${rect[2]}px`,height:`${rect[3]}px`});
        node.style.setProperty('--scene-light-color',color);illumination.append(node);
        // Electric light and its nearby reflected pool hold still. Only the
        // window varies with weather; a hearth can gently warm its own pool.
        const still=(kind==='lamp'||kind==='bounce')&&scene.effect!=='embers';
        const levels=still?[1,1,1,1,1,1]:[.96,.99,.965,1,.98,.96];
        animate(node,levels.map((level,index)=>({opacity:opacity*(1-(1-level)*lighting.breath*8),offset:[0,.16,.39,.57,.83,1][index]})),{duration:duration*2.3,delay:-phase,iterations:Infinity});
      };
      const [windowX,windowY,windowW,windowH]=window;
      lightField('window',[windowX-windowW*.08,windowY-windowH*.10,windowW*1.16,windowH*1.2],lighting.windowColor,lighting.windowGain,period*1.18,period*.2);
      lightField('beam',[Math.max(0,windowX-windowW*.72),windowY+windowH*.24,windowW*1.4,windowH*1.2],lighting.windowColor,lighting.shaftGain*.8,period*1.43,period*.61);
      lightField('lamp',[scene.light.x,scene.light.y,scene.light.width,scene.light.height],lighting.lampColor,lighting.lampGain,period,0);
      // Reflected light belongs below the actual lamp, not at the same
      // full-width coordinates in every photographed room.
      const bounceW=Math.min(scene.designSize.width*.62,Math.max(scene.designSize.width*.28,scene.light.width*.92));
      const bounceH=scene.designSize.height*.13;
      const bounceX=Math.max(0,Math.min(scene.designSize.width-bounceW,scene.light.x+scene.light.width*.5-bounceW*.5));
      const bounceY=Math.min(scene.designSize.height-bounceH,scene.light.y+scene.light.height*.72);
      lightField('bounce',[bounceX,bounceY,bounceW,bounceH],lighting.bounceColor,lighting.bounceGain,period*1.71,period*.83);
      if(scene.steam&&!loaded.layers.some(layer=>layer.id==='table')){
        const steam=document.createElement('div');steam.className='vg-scene-steam';Object.assign(steam.style,{left:`${scene.steam.x}px`,top:`${scene.steam.y}px`,width:`${scene.steam.width}px`,height:`${scene.steam.height}px`});
        for(let i=0;i<2;i++){const ribbon=document.createElement('i');steam.append(ribbon);animate(ribbon,[{transform:'translateY(18px) scaleX(.8)',opacity:.05},{transform:'translateY(-42px) scaleX(1.14)',opacity:.16},{transform:'translateY(-120px) scaleX(.94)',opacity:0}],{duration:8200+i*1700,delay:-i*3100,iterations:Infinity});}stage.append(steam);
      }
      const effect=document.createElement('div');effect.className='vg-scene-effect-host';
      if(loaded.windowMask){const rect=scene.windowMaskRect??[0,0,scene.designSize.width,scene.designSize.height];effect.style.maskImage=`url("${loaded.windowMask.url}")`;effect.style.webkitMaskImage=`url("${loaded.windowMask.url}")`;for(const[k,v]of Object.entries({'--scene-mask-x':rect[0],'--scene-mask-y':rect[1],'--scene-mask-w':rect[2],'--scene-mask-h':rect[3]}))effect.style.setProperty(k,`${v}px`);}
      const scaled=document.createElement('div');scaled.className='vg-scene-effect-scale';
      const effectRect=scene.windowMaskRect??[0,0,scene.designSize.width,scene.designSize.height];
      const effectScale=Math.min(1,cover.scale*(selection.quality==='rich'?1.5:1.25));
      Object.assign(scaled.style,{left:`${effectRect[0]}px`,top:`${effectRect[1]}px`,width:`${effectRect[2]*effectScale}px`,height:`${effectRect[3]*effectScale}px`,transform:`scale(${1/effectScale})`});effect.append(scaled);stage.append(effect);
      for(const row of loaded.layers){const definition=scene.layered.layers.find(l=>l.id===row.id)!;const node=document.createElement('div');node.className='vg-scene-layer';node.dataset.layer=row.id;
        Object.assign(node.style,{left:`${definition.rect[0]}px`,top:`${definition.rect[1]}px`,width:`${definition.rect[2]}px`,height:`${definition.rect[3]}px`});node.append(image(row.image.url,''));
        if(row.id==='table'&&scene.steam){
          const steam=document.createElement('div');steam.className='vg-scene-steam';Object.assign(steam.style,{left:`${scene.steam.x-definition.rect[0]}px`,top:`${scene.steam.y-definition.rect[1]}px`,width:`${scene.steam.width}px`,height:`${scene.steam.height}px`});
          for(let i=0;i<2;i++){const ribbon=document.createElement('i');steam.append(ribbon);animate(ribbon,[{transform:'translateY(24px) scaleX(.8)',opacity:.08},{transform:'translateY(-60px) scaleX(1.25)',opacity:.22},{transform:'translateY(-150px) scaleX(.9)',opacity:0}],{duration:7200+i*1700,delay:-i*3100,iterations:Infinity});}node.append(steam);
        }
        stage.append(node);if(definition.depthFactor)moving.push({node,factor:definition.depthFactor,max:Math.min(definition.maxOffsetPx,1.4)});
      }
      layers.replaceChildren(stage); // A fully decoded set takes ownership atomically, never half a table.
      if(policy.mode==='idle'){
        arriving=true;const arrival=animate(stage,[{opacity:0},{opacity:1}],{duration:450,fill:'both'});arrival.onfinish=()=>{arriving=false;};
      }
      void mountSceneParticles(scaled,loaded,abort.signal).then(instance=>{if(!alive){instance.dispose();return;}particles=instance;instance.apply(policy);},()=>{ /* Complete baked scene remains if decoration cannot initialize. */ });
    },error=>{if(!alive||error?.name==='AbortError')return;record.state='fallback';host.dataset.sceneLoad='fallback';});
    const retire=()=>{
      if(!alive)return;
      alive=false;hostBudgets.delete(request);abort.abort();stop();clearInterval(monitor);runtime.dispose();room.removeEventListener('pointermove',pointer);particles?.dispose();
      animations.forEach(a=>{a.onfinish=null;a.cancel();});animations=[];layers.replaceChildren();assets?.release();record.state='disposed';
    };
    retireRef.current=retire;
    return()=>{retire();if(retireRef.current===retire)retireRef.current=undefined;};
  },[scene,selection,preferences.parallaxEnabled,preferences.experience,viewport.width,viewport.height]);
  if(!scene)return null;
  return <div ref={hostRef} className="vg-chat-scene" aria-hidden="true"><div ref={planeRef} className="vg-scene-plane">
    <img className="vg-scene-poster" src={poster??scene.poster[0].src} alt="" draggable={false} onLoad={event=>{event.currentTarget.style.visibility='';}} onError={event=>{event.currentTarget.style.visibility='hidden';}}/>
    <div ref={layersRef} className="vg-scene-layered"/>
  </div></div>;
}
