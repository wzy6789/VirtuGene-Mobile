import { Color, DoubleSide, LinearFilter, Matrix4, Mesh, PerspectiveCamera, Scene, ShaderMaterial, SRGBColorSpace, Texture, Uniform, Vector2, Vector3, WebGLRenderer, type BufferGeometry, type Material } from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import type { SceneDefinition, SceneMotionPolicy, SceneQuality } from './scene-types';
import type { SceneImage } from './scene-assets';
import { sceneAssetPool } from './scene-assets';
import { sceneCover } from './scene-policy';
import { createRealtimeClock, createRealtimeFrameMeter, realtimeBudgetBytes } from './realtime-policy';
import { acquireSceneModel } from './realtime-model-assets';
import { countRealtimeContext, countRealtimeFrame, reserveRealtimeBytes } from './realtime-budget';
import { createRealtimeParticles } from './realtime-particles';
import { probeRealtimeDepth } from './realtime-depth-probe';
import { getSceneLightProfile } from './scene-lighting';

const vertexShader=`
uniform mat4 uBake;
varying vec4 vBake;
varying vec3 vWorld;
void main(){vec4 world=modelMatrix*vec4(position,1.);vWorld=world.xyz;vBake=uBake*world;gl_Position=projectionMatrix*viewMatrix*world;}`;
const fragmentShader=`
uniform sampler2D uSource;
uniform float uTime,uLight,uAmbientGain,uLightPeriod,uBreath,uVignette,uAspect,uFire;
uniform vec3 uLightPosition,uWindowPosition,uLampColor,uWindowColor,uBounceColor;
uniform vec4 uLightGains;
uniform vec2 uLampUv,uWindowUv,uWindowRadius;
varying vec4 vBake;
varying vec3 vWorld;
float lightNoise(float x){float i=floor(x),f=fract(x);f=f*f*(3.-2.*f);return mix(fract(sin(i*127.1+31.7)*43758.5453),fract(sin((i+1.)*127.1+31.7)*43758.5453),f);}
void main(){
 vec2 uv=vBake.xy/vBake.w*.5+.5;
 vec3 baked=texture2D(uSource,clamp(uv,vec2(0.),vec2(1.))).rgb;
 // Electric lamps hold their exposure. Only weather and a real fire vary;
 // smooth seeded drift avoids a room visibly breathing on a fixed loop.
 float weather=lightNoise(uTime/uLightPeriod+3.8)*.7+lightNoise(uTime/(uLightPeriod*.57)+17.)*.3;
 float fire=(lightNoise(uTime*1.15+7.)-.5)*.055*uFire;
 float lampPulse=1.+fire*uLight;
 vec2 lampDelta=(uv-uLampUv)/vec2(.26,.23);
 float lamp=exp(-dot(lampDelta,lampDelta)*1.5);
 lamp*=.35+.65*exp(-distance(vWorld,uLightPosition)*.38);
 vec2 windowDelta=(uv-uWindowUv)/uWindowRadius;
 float windowFill=exp(-dot(windowDelta,windowDelta)*1.05);
 windowFill*=.35+.65*exp(-distance(vWorld,uWindowPosition)*.20);
 float cloud=1.+(weather-.5)*uLight*uBreath*.45;
 vec2 bounceDelta=(uv-vec2(.43,.14))/vec2(.52,.23);
 float bounce=exp(-dot(bounceDelta,bounceDelta)*1.4);
 // A broad, feathered shaft crosses the room from the actual projected window.
 // It is part of the room material, never a layer above chat or a blur pass.
 vec2 ray=(uv-uWindowUv)*vec2(uAspect,1.);
 vec2 direction=normalize(vec2(-.28,-.75));
 float along=dot(ray,direction),across=abs(ray.x*direction.y-ray.y*direction.x);
 float width=.018+max(0.,along)*.24;
 float shaft=exp(-across*across/(width*width))*smoothstep(0.,.07,along)*(1.-smoothstep(.18,.72,along));
 shaft*=.90+.10*lightNoise(uv.y*3.+uv.x*1.7+uTime*.012);
 float luminance=dot(baked,vec3(.2126,.7152,.0722));
 float response=smoothstep(.005,.10,luminance)*(.06+.53*sqrt(max(0.,luminance)))*(1.-smoothstep(.50,1.,luminance)*.85);
 vec3 local=uLampColor*lamp*uLightGains.x*lampPulse;
 local+=uWindowColor*(windowFill*uLightGains.y+shaft*uLightGains.w)*cloud;
 local+=uBounceColor*bounce*uLightGains.z*(1.+(cloud-1.)*.35+fire*uLight*.5);
 // Preserve photographic highlights and texture instead of lifting the entire exposure.
 baked+=local*response*uAmbientGain;
 vec2 edge=(uv-.5)*vec2(1.4,1.1);
 baked*=1.-uVignette*smoothstep(.15,.72,dot(edge,edge));
 gl_FragColor=vec4(baked,1.);
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
}`;

function disposeModel(model:GLTF|undefined){
  if(!model)return;const geometries=new Set<BufferGeometry>(),materials=new Set<Material>();
  model.scene.traverse(object=>{const mesh=object as Mesh;if(!mesh.isMesh)return;geometries.add(mesh.geometry);for(const material of Array.isArray(mesh.material)?mesh.material:[mesh.material])materials.add(material);});
  geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());model.scene.clear();
}

/** Lazy genuine-geometry WebGL backend. Camera-projected baked color is intentional:
 * it preserves the accepted art under a fixed view, not a freely rotatable PBR room. */
export async function mountRealtimeScene(host:HTMLElement,definition:SceneDefinition,poster:SceneImage,viewport:{width:number;height:number;dpr:number},quality:SceneQuality,signal:AbortSignal,onFailure:(reason:string)=>void){
  const info=definition.realtime;if(!info||!poster.source)throw Error('scene:realtime-assets');
  const bytes=realtimeBudgetBytes(viewport.width,viewport.height,viewport.dpr,quality,poster.width,poster.height,info.byteLength);
  const reservation=reserveRealtimeBytes(bytes,sceneAssetPool.inspect().reservedBytes,(quality==='rich'?64:48)*1024*1024);
  if(!reservation)throw Error('scene:realtime-resource-budget');
  let renderer:WebGLRenderer|undefined,model:GLTF|undefined,texture:Texture|undefined,material:ShaderMaterial|undefined;
  let lease:Awaited<ReturnType<typeof acquireSceneModel>>|undefined,particles:ReturnType<typeof createRealtimeParticles>|undefined;
  let disposed=false,contextCounted=false,frame=0,lastDraw=0,frames=0,fps=0,tier=0,shaderFailure='';
  let policy:SceneMotionPolicy={mode:'paused',reason:'loading',effectFps:0,parallaxEnabled:false};
  let target={x:0,y:0},pose={x:0,y:0},lightGain=1,lightSeconds=0,lastLightClock=0;
  const canvas=document.createElement('canvas');canvas.className='vg-scene-webgl';canvas.setAttribute('aria-hidden','true');
  const clock=createRealtimeClock(),particleClock=createRealtimeClock(),frameMeter=createRealtimeFrameMeter(),time=new Uniform(0),particleTime=new Uniform(0);let scene:Scene|undefined,camera:PerspectiveCamera|undefined;
  const basePosition=new Vector3(),baseForward=new Vector3(),right=new Vector3(),up=new Vector3();let baseQuaternion:PerspectiveCamera['quaternion']|undefined;
  const cancelFrame=()=>{if(frame){cancelAnimationFrame(frame);frame=0;countRealtimeFrame(-1);}lastDraw=0;clock.suspend();particleClock.suspend();frameMeter.suspend();fps=0;};
  const lost=(event:Event)=>{event.preventDefault();fail('context-lost');};
  const dispose=()=>{
    if(disposed)return;disposed=true;cancelFrame();signal.removeEventListener('abort',dispose);canvas.removeEventListener('webglcontextlost',lost);
    particles?.dispose();particles=undefined;if(!model)material?.dispose();texture?.dispose();disposeModel(model);model=undefined;
    renderer?.dispose();renderer?.forceContextLoss();renderer=undefined;
    if(contextCounted){countRealtimeContext(-1);contextCounted=false;}lease?.release();lease=undefined;reservation.release();canvas.remove();
  };
  const fail=(reason:string)=>{if(disposed)return;dispose();if(!signal.aborted)onFailure(reason);};
  const render=()=>{
    if(!renderer||!scene||!camera||disposed)return;
    const lightDelta=Math.max(0,clock.seconds-lastLightClock);lastLightClock=clock.seconds;
    lightSeconds+=lightDelta*(policy.ambient==='low'?.55:1);time.value=lightSeconds;
    lightGain+=((policy.ambient==='low'?.45:1)-lightGain)*(1-Math.exp(-lightDelta*12));
    if(material)material.uniforms.uAmbientGain.value=lightGain;
    particleTime.value=particleClock.seconds;
    if(policy.parallaxEnabled&&tier<3){const blend=.28;pose={x:pose.x+(target.x-pose.x)*blend,y:pose.y+(target.y-pose.y)*blend};
      camera.position.copy(basePosition).addScaledVector(right,pose.x*.014).addScaledVector(up,pose.y*.009);
      camera.lookAt(basePosition.clone().addScaledVector(baseForward,8));camera.updateMatrixWorld(true);
    }
    renderer.render(scene,camera);if(shaderFailure)throw Error(shaderFailure);frames++;
  };
  const schedule=()=>{if(disposed||frame||policy.mode!=='idle')return;frame=requestAnimationFrame(tick);countRealtimeFrame(1);};
  const tick=(now:number)=>{
    frame=0;countRealtimeFrame(-1);if(disposed||policy.mode!=='idle')return;
    const limit=tier>=2?18:policy.effectFps||24,interval=1000/limit,elapsed=now-lastDraw;
    if(!lastDraw||elapsed>=interval){
      clock.step(now);frameMeter.frame(now);fps=frameMeter.fps;
      if(policy.particles!=='off')particleClock.step(now);else particleClock.suspend();
      lastDraw=now-(lastDraw?elapsed%interval:0);
      try{render();}catch{fail('render-failed');return;}
    }schedule();
  };
  signal.addEventListener('abort',dispose,{once:true});
  try{
    if(signal.aborted)throw new DOMException('Cancelled','AbortError');
    const gl=canvas.getContext('webgl2',{alpha:true,antialias:false,depth:true,premultipliedAlpha:false,powerPreference:'low-power'});
    if(!gl)throw Error('scene:webgl2-unavailable');
    renderer=new WebGLRenderer({canvas,context:gl,alpha:true,antialias:false,premultipliedAlpha:false});contextCounted=true;countRealtimeContext(1);
    renderer.debug.onShaderError=()=>{shaderFailure='scene:shader-compile';};
    if(renderer.capabilities.maxTextureSize<Math.max(poster.width,poster.height))throw Error('scene:texture-capability');
    renderer.outputColorSpace=SRGBColorSpace;renderer.setClearColor(new Color(0,0,0),0);
    renderer.setPixelRatio(Math.min(viewport.dpr,2));renderer.setSize(viewport.width,viewport.height,false);
    canvas.addEventListener('webglcontextlost',lost);
    const acquired=await acquireSceneModel(info.model,info.byteLength,signal);
    if(disposed||signal.aborted){acquired.release();throw new DOMException('Cancelled','AbortError');}lease=acquired;
    const {GLTFLoader}=await import('three/addons/loaders/GLTFLoader.js');if(disposed||signal.aborted)throw new DOMException('Cancelled','AbortError');
    const parsed=await new GLTFLoader().parseAsync(lease.buffer,'');
    if(disposed||signal.aborted){disposeModel(parsed);throw new DOMException('Cancelled','AbortError');}model=parsed;
    scene=new Scene();scene.add(model.scene);scene.updateMatrixWorld(true);
    const sourceCamera=model.cameras[0];if(!(sourceCamera instanceof PerspectiveCamera))throw Error('scene:camera-missing');
    camera=sourceCamera.clone();sourceCamera.matrixWorld.decompose(camera.position,camera.quaternion,camera.scale);camera.parent=null;camera.aspect=definition.designSize.width/definition.designSize.height;camera.updateProjectionMatrix();camera.updateMatrixWorld(true);
    const bakedMatrix=new Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);
    basePosition.copy(camera.position);baseQuaternion=camera.quaternion.clone();camera.getWorldDirection(baseForward);right.set(1,0,0).applyQuaternion(baseQuaternion);up.set(0,1,0).applyQuaternion(baseQuaternion);
    const cover=sceneCover(definition,viewport.width,viewport.height);
    camera.setViewOffset(definition.designSize.width,definition.designSize.height,-cover.x/cover.scale,-cover.y/cover.scale,viewport.width/cover.scale,viewport.height/cover.scale);camera.updateProjectionMatrix();
    texture=new Texture(poster.source);texture.colorSpace=SRGBColorSpace;texture.generateMipmaps=false;texture.minFilter=LinearFilter;texture.magFilter=LinearFilter;texture.needsUpdate=true;
    const windowCenter=new Vector3(...info.effectQuad[0]).lerp(new Vector3(...info.effectQuad[2]),.5);
    const lightCenter=info.lightPoint?new Vector3(...info.lightPoint):windowCenter.clone(),lightProfile=getSceneLightProfile(definition);
    const project=(point:Vector3)=>{const ndc=point.clone().applyMatrix4(bakedMatrix);return new Vector2(ndc.x*.5+.5,ndc.y*.5+.5);};
    const windowMin=project(new Vector3(...info.effectQuad[0])),windowMax=project(new Vector3(...info.effectQuad[2]));
    const windowRadius=new Vector2(Math.max(.24,Math.abs(windowMax.x-windowMin.x)*.85),Math.max(.20,Math.abs(windowMax.y-windowMin.y)*.75));
    material=new ShaderMaterial({uniforms:{uBake:{value:bakedMatrix},uSource:{value:texture},uTime:time,uLight:{value:1},uAmbientGain:{value:1},uLightPosition:{value:lightCenter},uWindowPosition:{value:windowCenter},uLampUv:{value:project(lightCenter)},uWindowUv:{value:project(windowCenter)},uWindowRadius:{value:windowRadius},uAspect:{value:definition.designSize.width/definition.designSize.height},uLightPeriod:{value:lightProfile.period},uBreath:{value:lightProfile.breath},uVignette:{value:lightProfile.vignette},uFire:{value:definition.effect==='embers'?1:0},uLampColor:{value:new Color(lightProfile.lampColor)},uWindowColor:{value:new Color(lightProfile.windowColor)},uBounceColor:{value:new Color(lightProfile.bounceColor)},uLightGains:{value:[lightProfile.lampGain,lightProfile.windowGain,lightProfile.bounceGain,lightProfile.shaftGain]}},vertexShader,fragmentShader,side:DoubleSide,toneMapped:false});
    let backgroundMaterial:ShaderMaterial|undefined;const oldMaterials=new Set<Material>();model.scene.traverse(object=>{const mesh=object as Mesh;if(!mesh.isMesh)return;for(const previous of Array.isArray(mesh.material)?mesh.material:[mesh.material])oldMaterials.add(previous);
      if(mesh.name==='VG_BAKED_DISTANT_BACKGROUND'){backgroundMaterial??=material!.clone();backgroundMaterial.uniforms=material!.uniforms;backgroundMaterial.depthWrite=false;mesh.material=backgroundMaterial;mesh.renderOrder=-10;}else mesh.material=material!;
      mesh.frustumCulled=false;
    });oldMaterials.forEach(m=>m.dispose());
    particles=createRealtimeParticles(scene,definition,quality,particleTime,{source:texture,bake:bakedMatrix,cameraWorld:camera.matrixWorld});
    render();if(signal.aborted||disposed)throw new DOMException('Cancelled','AbortError');host.append(canvas);
    return {
      canvas,
      apply(next:SceneMotionPolicy){const previous=policy;policy=next;if(disposed)return;if(next.particles==='off'||previous.particles==='off')particleClock.suspend();if(next.mode!=='idle')cancelFrame();else {if(previous.mode!=='idle'){clock.suspend();lastDraw=0;}schedule();}},
      pointer(x:number,y:number){if(policy.mode==='idle'&&policy.parallaxEnabled)target={x,y};},
      degrade(level:number){if(disposed||level<=tier)return;tier=level;particles?.degrade(level);if(level>=3&&material)material.uniforms.uLight.value=0;},
      inspect:()=>({backend:'webgl2',effect:definition.effect,shape:'gpu-instanced-depth',frames,fps,mode:policy.mode,clock:clock.seconds,particleClock:particleClock.seconds,channels:{ambient:policy.ambient,particles:policy.particles},lightGain,lightSeconds,particles:particles?.count??0,drawCalls:renderer?.info.render.calls??0,triangles:info.triangles,geometry:renderer?.info.memory.geometries??0,textures:renderer?.info.memory.textures??0,pose,canvas:{width:canvas.width,height:canvas.height},thread:'main-thread-webgl2-gpu-shaders',reservedBytes:bytes}),
      probeDepth:()=>renderer&&scene&&camera&&model?probeRealtimeDepth(renderer,scene,model.scene,camera,new Vector3(...info.effectQuad[0]).lerp(new Vector3(...info.effectQuad[2]),.5),definition.designSize.width,definition.designSize.height):undefined,
      dispose,
    };
  }catch(error){dispose();throw error;}
}
export type RealtimeSceneExecutor=Awaited<ReturnType<typeof mountRealtimeScene>>;
