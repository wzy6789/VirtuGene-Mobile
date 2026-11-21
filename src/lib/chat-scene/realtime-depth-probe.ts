import { BoxGeometry, Color, Mesh, MeshBasicMaterial, Raycaster, Vector3, WebGLRenderTarget, type PerspectiveCamera, type Scene, type Object3D, type WebGLRenderer } from 'three';
/** Explicit local diagnostic, never invoked by the normal animation loop.
 * Same screen pixel, opposite sides of an actual room surface: depth-on must
 * hide the rear marker, and depth-off is the positive control. */
export function probeRealtimeDepth(renderer:WebGLRenderer,scene:Scene,room:Object3D,camera:PerspectiveCamera,target:Vector3,width:number,height:number){
  const probeCamera=camera.clone();probeCamera.clearViewOffset();probeCamera.aspect=width/height;probeCamera.updateProjectionMatrix();probeCamera.updateMatrixWorld(true);
  const origin=new Vector3().setFromMatrixPosition(probeCamera.matrixWorld);let direction=target.clone().sub(origin).normalize(),probeTarget='effect-center';
  const occluders:Object3D[]=[];room.traverse(object=>{const mesh=object as Mesh;if(mesh.isMesh&&(Array.isArray(mesh.material)?mesh.material.some(m=>m.depthWrite):mesh.material.depthWrite))occluders.push(mesh);});
  const ray=new Raycaster(origin,direction,.05,100);let hit=ray.intersectObjects(occluders,false)[0];
  // An open sea/sky ray genuinely has no opaque surface. Probe the room below
  // that opening rather than pretending the sky should occlude a particle.
  if(!hit){probeTarget='interior-below-opening';direction=new Vector3(target.x,target.y*.2,target.z).sub(origin).normalize();ray.set(origin,direction);hit=ray.intersectObjects(occluders,false)[0];}
  // Cameras may sit at the world origin; scaling target.y is then not a
  // meaningful "below". Find an actual visible room surface in camera space.
  if(!hit)for(const [x,y] of [[0,0],[0,-.45],[-.65,-.45],[.65,-.45],[-.7,.3]]){
    direction=new Vector3(x,y,.5).unproject(probeCamera).sub(origin).normalize();ray.set(origin,direction);hit=ray.intersectObjects(occluders,false)[0];
    if(hit){probeTarget='visible-room-surface';break;}
  }
  if(!hit)throw Error('depth-probe:no-room-intersection');
  const ndc=hit.point.clone().project(probeCamera),x=(ndc.x*.5+.5)*width,y=(.5-ndc.y*.5)*height;
  probeCamera.setViewOffset(width,height,x-2,y-2,4,4);probeCamera.updateProjectionMatrix();
  const material=new MeshBasicMaterial({color:new Color(1,0,1),toneMapped:false,depthTest:true,depthWrite:false});
  const marker=new Mesh(new BoxGeometry(.024,.024,.024),material);marker.renderOrder=1000;marker.frustumCulled=false;scene.add(marker);
  const output=new WebGLRenderTarget(4,4,{depthBuffer:true}),previous=renderer.getRenderTarget(),pixel=new Uint8Array(4);
  const sample=(distance:number,depthTest:boolean)=>{marker.position.copy(origin).addScaledVector(direction,distance);material.depthTest=depthTest;renderer.setRenderTarget(output);renderer.render(scene,probeCamera);renderer.readRenderTargetPixels(output,2,2,1,1,pixel);return {rgba:[...pixel],marker:pixel[0]>240&&pixel[1]<15&&pixel[2]>240};};
  try{
    const front=sample(Math.max(.15,hit.distance-.05),true),rear=sample(hit.distance+.05,true),control=sample(hit.distance+.05,false);
    return {front,rear,control,probeTarget,surfaceDistance:hit.distance,sameScreenPixel:[x,y],pass:front.marker&&!rear.marker&&control.marker};
  }finally{scene.remove(marker);marker.geometry.dispose();material.dispose();output.dispose();renderer.setRenderTarget(previous);renderer.render(scene,camera);}
}
