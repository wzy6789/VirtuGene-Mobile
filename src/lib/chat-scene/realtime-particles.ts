import { AdditiveBlending, BufferAttribute, Color, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, NormalBlending, ShaderMaterial, Vector3, type Matrix4, type Scene, type Texture, type Uniform } from 'three';
import type { SceneDefinition, SceneQuality } from './scene-types';
import { SCENE_EFFECT_PROFILES } from './scene-effects';
import { getSceneLightProfile } from './scene-lighting';

const vertexShader=`
attribute vec4 aSeed;
uniform float uTime,uKind,uRate,uWind;
uniform vec3 uOrigin,uAcross,uUp,uDepth;
uniform vec3 uLampPosition,uWindowPosition;
uniform mat4 uBake,uCameraWorld;
varying vec2 vUv;
varying float vLife,vSeed,vNear;
varying float vIllumination,vWarmth;
varying float vGlass;
varying vec4 vBake;
float particleHash(float x){return fract(sin(x*127.1+31.7)*43758.5453);}
float airNoise(float x){float i=floor(x),f=fract(x);f=f*f*(3.-2.*f);return mix(particleHash(i),particleHash(i+1.),f);}
void main(){
  vUv=uv;vSeed=aSeed.w;vGlass=aSeed.x<0.?1.:0.;
  if(vGlass>.5){
    vec4 viewPosition=modelViewMatrix*vec4(uOrigin+uAcross*uv.x+uUp*uv.y,1.);
    vBake=uBake*uCameraWorld*viewPosition;vLife=.5;vNear=1.;vIllumination=1.;vWarmth=.3;
    gl_Position=projectionMatrix*viewPosition;return;
  }
  // Every depth band may point towards or away from the camera. A high seed
  // is not necessarily a nearby particle (the rain bands extend along -Z).
  float nearParticle=uDepth.z<0.?1.-aSeed.z:aSeed.z;vNear=nearParticle;
  float age=aSeed.y+uTime*uRate*(.72+aSeed.w*.48+nearParticle*.16);
  float life=fract(age);vLife=life;
  float gust=(airNoise(uTime*.13+7.)-.5)*1.4+(airNoise(uTime*.24+21.)-.5)*.35;
  vec3 center=uOrigin+uAcross*aSeed.x+uUp*aSeed.y+uDepth*aSeed.z;
  if(uKind>6.5){
    center.x+=(airNoise(uTime*.012+aSeed.w*17.)-.5)*.015;
  }else if(uKind>0.5&&uKind<2.5){
    // A fresh lane is chosen only between fully faded lives, so weather does
    // not repeat the same tracks while remaining deterministic and pauseable.
    float lane=fract(aSeed.x+particleHash(floor(age)+aSeed.w*27.));
    center=uOrigin+uAcross*lane+uUp*(1.-life)+uDepth*aSeed.z;
    center.x-=life*uWind*length(uUp);
    center.x+=sin(uTime*(uKind>1.5?.65:.35)+aSeed.w*24.)*(uKind>1.5?.075:.012);
    center.x+=gust*(uKind>1.5?.10:.022)*(.4+nearParticle*.6);
    if(uKind>1.5){center.y+=sin(uTime*.8+aSeed.x*19.)*.025;center.z+=sin(uTime*.4+aSeed.w*13.)*.04;}
  }else if(uKind>2.5&&uKind<3.5){
    center=uOrigin+uAcross*aSeed.x+uUp*life+uDepth*aSeed.z;
    center.x+=sin(life*5.+aSeed.w*12.)*(.018+life*.07);
    center.x+=gust*life*.018;
  }else if(uKind>5.5&&uKind<6.5){
    // Condensation grows, rests, then slides. Reset happens only after fading.
    float slide=smoothstep(.62,1.,life);
    center=uOrigin+uAcross*(.04+aSeed.x*.92)+uUp*(.12+aSeed.z*.78-slide*.16);
    center.x+=sin(slide*4.+aSeed.w*12.)*slide*.007;
    vNear=1.;
  }else if(uKind>4.5&&uKind<5.5){
    center=uOrigin+uAcross*(aSeed.x-.5)*(.12+life*.8)+uUp*life+uDepth*aSeed.z;
    // Shared advection gives the individual ribbons one coherent rising plume.
    center.x+=(airNoise(life*2.4-uTime*.13+11.)-.5)*(.012+life*.11);
    center.x+=sin(life*8.-uTime*.4+aSeed.x)*life*.012;
  }else{
    center=uOrigin+uAcross*aSeed.x+uUp*(uKind>3.5?aSeed.y:life)+uDepth*aSeed.z;
    center.x+=sin(uTime*.17+aSeed.w*19.)*(uKind>3.5?.22:.055);
    center.x+=gust*(uKind>3.5?.08:.018);
    center.y+=sin(uTime*.23+aSeed.w*23.)*.018;
  }
  float size=mix(.009,.020,aSeed.w)*mix(.7,1.4,nearParticle);
  vec2 extent=vec2(size);
  if(uKind>0.5&&uKind<1.5)extent=vec2(mix(.014,.034,nearParticle),mix(.13,.36,nearParticle)*(.8+aSeed.w*.4));
  if(uKind>1.5&&uKind<2.5){extent=vec2(mix(.020,.088,nearParticle)*(.7+aSeed.w*.6));extent.x*=.55+.45*abs(sin(uTime*.9+aSeed.x*19.));}
  if(uKind>2.5&&uKind<3.5)extent=vec2(.010+aSeed.w*.011,.022+aSeed.w*.035);
  if(uKind>3.5&&uKind<4.5)extent=vec2(.46+aSeed.w*.50,.12+aSeed.z*.12);
  if(uKind>4.5&&uKind<5.5)extent=vec2(.035+life*.20,.18+life*.19);
  if(uKind>5.5&&uKind<6.5){float grow=.7+.3*smoothstep(0.,.5,life);extent=vec2(.036+aSeed.w*.032)*grow;extent.y*=1.2+smoothstep(.62,1.,life)*2.5;}
  if(uKind>6.5)extent=vec2(.009+aSeed.w*.026);
  vec2 offset=position.xy*extent;
  float rotation=uKind>1.5&&uKind<2.5?uTime*.25+aSeed.w*6.28:uKind>.5&&uKind<1.5?uWind+gust*.012:0.;
  offset=mat2(cos(rotation),-sin(rotation),sin(rotation),cos(rotation))*offset;
  vec4 viewPosition=modelViewMatrix*vec4(center,1.);viewPosition.xy+=offset;
  float lamp=exp(-distance(center,uLampPosition)*.70);
  float windowLight=exp(-distance(center,uWindowPosition)*.28);
  vIllumination=max(lamp,windowLight*.85);
  vWarmth=lamp/(lamp+windowLight+.001);
  vBake=uKind>5.5?uBake*uCameraWorld*viewPosition:vec4(0.,0.,0.,1.);
  gl_Position=projectionMatrix*viewPosition;
}`;
const fragmentShader=`
uniform float uTime,uKind,uOpacity;
uniform vec3 uColor;
uniform vec3 uLampColor,uWindowColor;
uniform float uParticleLightGain;
uniform sampler2D uSource;
uniform float uGlassStrength,uGlassFrost,uGlassOrientation;
uniform int uGlassEdges;
uniform vec2 uGlassPolygon[8];
varying vec2 vUv;
varying float vLife,vSeed,vNear;
varying float vIllumination,vWarmth;
varying float vGlass;
varying vec4 vBake;
void main(){
  vec2 p=(vUv-.5)*2.;float r=length(p);
  float alpha=exp(-r*r*5.)*.65+exp(-r*r*23.)*.35;
  if(uKind>.5&&uKind<1.5){
    float width=mix(.36,.14,clamp((p.y+1.)*.5,0.,1.));
    float streak=exp(-p.x*p.x/(width*width));
    float tail=1.-smoothstep(-.6,1.,p.y);
    float head=exp(-p.x*p.x*12.-(p.y+.55)*(p.y+.55)*24.);
    alpha=(streak*(.25+tail*.55)+head*.22)*(1.-smoothstep(.82,1.,abs(p.y)));
  }
  if(uKind>1.5&&uKind<2.5){
    // At room-view distance a flake reads as a small irregular aggregate,
    // never as an ornamental six-point star.
    vec2 flake=p*vec2(1.+vSeed*.35,1.-vSeed*.16);
    float core=exp(-dot(flake,flake)*mix(7.,4.,vNear));
    vec2 lobe=flake-vec2(.20,-.12);
    alpha=core*.76+exp(-dot(lobe,lobe)*15.)*.20;
  }
  if(uKind>2.5&&uKind<3.5)alpha=exp(-p.x*p.x*9.)*exp(-(p.y+.35)*(p.y+.35)*5.)*(1.-smoothstep(.25,1.,p.y));
  if(uKind>3.5&&uKind<4.5){
    float curl=p.y+sin(p.x*3.+uTime*.22+vSeed*6.)*.22;
    float fold=sin(p.x*5.-uTime*.3+sin(p.y*3.))* .5+.5;
    alpha=exp(-p.x*p.x*2.4-curl*curl*9.)*(.16+fold*.14);
  }
  if(uKind>4.5&&uKind<5.5){
    float curl=p.x+sin(p.y*3.4-uTime*.65+vLife*5.)*(.12+vLife*.24);
    float width=.10+vLife*.25;
    float ribbon=exp(-curl*curl/(width*width));
    float secondaryDistance=(curl-.19*sin(p.y*4.+uTime*.4))/.14;
    float secondary=exp(-secondaryDistance*secondaryDistance);
    float veil=exp(-curl*curl*5.)*.16;
    float wisps=.72+.28*sin(p.y*7.+vLife*12.-uTime*.45);
    alpha=(ribbon*.27+secondary*.13+veil)*exp(-p.y*p.y*2.7)*wisps;
  }
  float envelope=smoothstep(0.,.12,vLife)*(1.-smoothstep(.78,1.,vLife));
  if(uKind>3.5&&uKind<4.5)envelope=.7+.15*sin(uTime*.18+vSeed*20.);
  if(uKind<.5)envelope*=.76;
  if(uKind>4.5&&uKind<5.5)envelope*=1.-smoothstep(.45,1.,vLife);
  if(uKind>6.5)envelope=.72+vSeed*.28;
  alpha*=uOpacity*envelope*mix(.55,1.,vNear);
  vec3 color=uColor;
  vec3 environment=mix(uWindowColor,uLampColor,vWarmth);
  color=mix(color,environment,.24);
  if(uKind<.5||uKind>4.5&&uKind<5.5){
    alpha*=.68+vIllumination*(.65+uParticleLightGain);
    color*=.90+vIllumination*uParticleLightGain;
  }
  if(uKind>2.5&&uKind<3.5)color=mix(color,vec3(1.,.92,.73),(1.-vLife)*exp(-r*r*12.)*.65);
  if(uKind>6.5){alpha*=.82;color=mix(uColor,vec3(.95,.96,1.),vSeed*.4);}
  if(uKind>5.5&&uKind<6.5){
    float slide=smoothstep(.62,1.,vLife);
    vec2 drop=vec2(p.x,(p.y+slide*.45)*(1.+slide*1.6));
    float radius=length(drop);
    float edge=1.-smoothstep(.80,1.,radius);
    vec2 normal=drop*sqrt(max(0.,1.-min(1.,radius*radius)));
    vec2 uv=vBake.xy/vBake.w*.5+.5;
    // Sample the existing room art: a tiny lens, not an added glow disk or blur.
    vec3 refracted=texture2D(uSource,clamp(uv+normal*vec2(.004,.0025),vec2(0.),vec2(1.))).rgb;
    float rimDistance=(radius-.78)*12.;
    float rim=exp(-rimDistance*rimDistance);
    float light=max(0.,dot(normalize(drop+vec2(.001)),vec2(-.6,.8)));
    float glint=exp(-dot(drop-vec2(-.28,.35),drop-vec2(-.28,.35))*60.);
    float trail=exp(-p.x*p.x*85.)*smoothstep(-.2,.2,p.y)*(1.-smoothstep(.35,1.,p.y))*slide;
    color=refracted*(1.-rim*.16)+environment*(rim*light*.44+glint*.60+trail*.10);
    alpha=(edge*.64+rim*.25+trail*.24)*uOpacity*envelope;
  }
  if(vGlass>.5){
    vec2 sourceUv=vBake.xy/vBake.w*.5+.5;
    float boundary=1.;
    for(int i=0;i<8;i++){
      if(i>=uGlassEdges)break;
      int j=i+1;if(j>=uGlassEdges)j=0;
      vec2 a=uGlassPolygon[i],edge=uGlassPolygon[j]-a;
      float signedDistance=(edge.x*(sourceUv.y-a.y)-edge.y*(sourceUv.x-a.x))*uGlassOrientation/max(length(edge),.001);
      if(signedDistance<0.)discard;
      boundary=min(boundary,signedDistance);
    }
    float rim=exp(-boundary*135.);
    vec2 reflectionUv=(vUv-vec2(.17,.48))/vec2(.14,.27);
    float reflection=exp(-dot(reflectionUv,reflectionUv)*2.2);
    float grain=fract(sin(dot(sourceUv,vec2(1731.31,2737.17)))*43758.5453);
    float frost=exp(-boundary*92.)*smoothstep(.30,.84,grain)*uGlassFrost;
    vec2 bend=vec2((vUv.x-.5)*.0015,0.)*rim;
    vec3 transmitted=texture2D(uSource,clamp(sourceUv+bend,vec2(0.),vec2(1.))).rgb;
    color=transmitted*(1.-rim*.08)+uWindowColor*(rim*.35+frost*.45)+uLampColor*reflection*.24;
    alpha=(rim*.21+reflection*.065+frost*.22)*uGlassStrength;
  }
  if(alpha<.003)discard;
  gl_FragColor=vec4(color,alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/** Camera-facing instanced quads simulated entirely in the vertex shader.
 * They share the real room depth buffer, not a screen rectangle or 2D mask. */
export function createRealtimeParticles(scene:Scene,definition:SceneDefinition,quality:SceneQuality,time:Uniform<number>,projection:{source:Texture;bake:Matrix4;cameraWorld:Matrix4}){
  const groups:{mesh:Mesh;geometry:InstancedBufferGeometry;material:ShaderMaterial;count:number}[]=[];
  const profile=SCENE_EFFECT_PROFILES[definition.effect??'dust'];
  const lighting=getSceneLightProfile(definition);
  const quad=definition.realtime!.effectQuad.map(p=>new Vector3(...p));
  const windowCenter=quad[0].clone().lerp(quad[2],.5);
  const lampCenter=definition.realtime?.lightPoint?new Vector3(...definition.realtime.lightPoint):windowCenter.clone();
  const glass=definition.glass,glassPolygon=Array.from({length:8},(_,i)=>glass?.opening[i]??[0,0]);
  const glassArea=glass?.opening.reduce((sum,p,i)=>{const q=glass.opening[(i+1)%glass.opening.length];return sum+p[0]*q[1]-q[0]*p[1];},0)??1;
  let randomState=2166136261;
  for(const character of definition.id)randomState=Math.imul(randomState^character.charCodeAt(0),16777619);
  const random=()=>{randomState+=0x6D2B79F5;let t=randomState;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};
  const add=(kind:number,count:number,origin:Vector3,across:Vector3,up:Vector3,depth:Vector3,color:string,opacity:number,rate:number,wind=0,withGlass=false)=>{
    const geometry=new InstancedBufferGeometry();geometry.setIndex([0,1,2,2,1,3]);
    geometry.setAttribute('position',new BufferAttribute(new Float32Array([-.5,-.5,0,.5,-.5,0,-.5,.5,0,.5,.5,0]),3));
    geometry.setAttribute('uv',new BufferAttribute(new Float32Array([0,0,1,0,0,1,1,1]),2));
    // Stable per scene, without the visible diagonal lattice of modular seeds.
    const seed=new Float32Array(count*4);for(let i=0;i<seed.length;i++)seed[i]=random();
    if(withGlass)seed[0]=-1;
    geometry.setAttribute('aSeed',new InstancedBufferAttribute(seed,4));geometry.instanceCount=count;
    const material=new ShaderMaterial({uniforms:{uTime:time,uKind:{value:kind},uRate:{value:rate},uWind:{value:wind},uOpacity:{value:opacity},uColor:{value:new Color(color)},uOrigin:{value:origin},uAcross:{value:across},uUp:{value:up},uDepth:{value:depth},uSource:{value:projection.source},uBake:{value:projection.bake},uCameraWorld:{value:projection.cameraWorld},uLampPosition:{value:lampCenter},uWindowPosition:{value:windowCenter},uLampColor:{value:new Color(lighting.lampColor)},uWindowColor:{value:new Color(lighting.windowColor)},uParticleLightGain:{value:lighting.particleGain},uGlassStrength:{value:glass?.strength??0},uGlassFrost:{value:glass?.frost??0},uGlassOrientation:{value:glassArea>=0?1:-1},uGlassEdges:{value:glass?.opening.length??0},uGlassPolygon:{value:glassPolygon.flat()}},vertexShader,fragmentShader,transparent:true,depthTest:true,depthWrite:false,blending:kind===3||kind===7?AdditiveBlending:NormalBlending,toneMapped:false});
    const mesh=new Mesh(geometry,material);mesh.name='VG_GPU_PARTICLES_'+kind;mesh.frustumCulled=false;mesh.renderOrder=10;scene.add(mesh);groups.push({mesh,geometry,material,count});
  };
  const lived=definition.effect==='garden-rain'||definition.effect==='city-rain';
  const rain=definition.effect==='rain'||definition.effect==='train-rain'||definition.effect==='bedroom-rain'||lived;
  const kind=rain?1:definition.effect==='snow'?2:definition.effect==='embers'?3:definition.effect==='mist'?4:definition.effect==='starfield'?7:0;
  const origin=quad[0].clone(),across=quad[1].clone().sub(origin),up=quad[3].clone().sub(origin);
  const count=kind===1?(quality==='rich'?220:144):kind===2?(quality==='rich'?164:112):quality==='rich'?104:64;
  const thickness=kind===1||kind===2?-1.8:kind===7?-3.0:kind===4?-1.2:kind===3?.11:.60;
  const wind=definition.effect==='train-rain'?.30:definition.effect==='city-rain'?.075:definition.effect==='garden-rain'?.035:.10;
  const rainRate=definition.effect==='train-rain'?.40:definition.effect==='bedroom-rain'?.18:definition.effect==='city-rain'?.22:.28;
  add(kind,kind===4?Math.floor(count*.45):count,origin,across,up,new Vector3(0,0,thickness),profile.colors[0],lived?.65:kind===4?.46:kind===1?.68:kind===2?.84:.72,kind===1?rainRate:kind===2?.056:kind===3?.30:.026,wind);
  if(rain||glass)add(6,(rain?(quality==='rich'?30:18):0)+(glass?1:0),origin,across,up,new Vector3(),profile.colors[1],.80,.030,0,!!glass);
  // A small second depth range gives interior life even when the window is partly covered.
  const volume=definition.realtime?.ambientVolume;
  add(0,lived?(quality==='rich'?28:20):quality==='rich'?40:28,new Vector3(...(volume?.origin??[-1.65,.7,.65]) as [number,number,number]),new Vector3(...(volume?.across??[3.3,0,0]) as [number,number,number]),new Vector3(...(volume?.up??[0,1.8,0]) as [number,number,number]),new Vector3(...(volume?.depth??[0,0,-3]) as [number,number,number]),definition.readingPreset==='hearth'?'#e9be83':definition.readingPreset==='frost'?'#bdd9ef':'#ddded0',lived?.46:.52,.027);
  if(definition.realtime?.cup)add(5,quality==='rich'?24:18,new Vector3(...definition.realtime.cup),new Vector3(.07,0,0),new Vector3(0,.46,0),new Vector3(0,0,.035),'#e6e1d8',.46,.12);
  let tier=0;
  return {get count(){return groups.reduce((sum,g)=>sum+g.geometry.instanceCount,0);},get draws(){return groups.length;},degrade(level:number){if(level<=tier)return;tier=level;if(level>=1)for(const g of groups)g.geometry.instanceCount=Math.min(g.count,Math.max(1,Math.ceil(g.count*.55)));},dispose(){for(const g of groups){scene.remove(g.mesh);g.geometry.dispose();g.material.dispose();}groups.length=0;}};
}
