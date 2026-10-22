import assert from 'node:assert/strict';
import {Matrix4,Mesh,Scene,Texture,Uniform,type InstancedBufferGeometry} from 'three';
import {createRealtimeParticles} from '../../src/lib/chat-scene/realtime-particles';
import type {SceneDefinition} from '../../src/lib/chat-scene/scene-types';
let checks=0;
for(const [id,effect]of [['polar-refuge','snow'],['orbital-observatory','starfield']] as const){
  const scene=new Scene(),texture=new Texture();
  const definition={id,effect,readingPreset:'frost',glass:{strength:.7,frost:.5,opening:[[0,0],[0,1],[1,1],[1,0]]},realtime:{effectQuad:[[0,0,-5],[3,0,-5],[3,4,-5],[0,4,-5]],cup:[.2,.3,-2]}} as SceneDefinition;
  const executor=createRealtimeParticles(scene,definition,'balanced',new Uniform(0),{source:texture,bake:new Matrix4(),cameraWorld:new Matrix4()});
  const glass=scene.children.find(node=>node.name==='VG_GPU_PARTICLES_6') as Mesh<InstancedBufferGeometry>;
  assert.equal(glass.geometry.instanceCount,1,'A dry glass pane owns exactly one instance');checks++;
  executor.degrade(1);
  for(const node of scene.children){const geometry=(node as Mesh<InstancedBufferGeometry>).geometry;assert(geometry.instanceCount<=geometry.getAttribute('aSeed').count,'Degradation must never overrun a one-pane attribute buffer');checks++;}
  assert.equal(glass.geometry.instanceCount,1,'Degradation keeps the only pane instead of duplicating or losing it');checks++;
  executor.dispose();assert.equal(scene.children.length,0,'Every pane and particle group is removed on disposal');texture.dispose();checks++;
}
console.log(JSON.stringify({status:'pass',checks}));
