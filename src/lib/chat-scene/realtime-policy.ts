import type { SceneQuality } from './scene-types';
/** Accounts for a WebGL texture copy, actual geometry CPU/GPU copies and render surfaces.
 * The shared DOM poster lease is counted separately by the existing image pool. */
export function realtimeBudgetBytes(width:number,height:number,dpr:number,quality:SceneQuality,textureWidth:number,textureHeight:number,modelBytes:number) {
  // The room and effects share a render buffer; preserve phone background detail.
  const density=Math.min(Math.max(1,dpr),2);
  return Math.ceil(width*density)*Math.ceil(height*density)*12+textureWidth*textureHeight*4+modelBytes*4+384*1024;
}
/** Time advances only on active rendered frames. Pause/resume never catches up wall time. */
export function createRealtimeClock(){let time=0,previous:number|undefined;return {
  step(now:number){if(previous!==undefined)time+=Math.max(0,Math.min(80,now-previous));previous=now;return time/1000;},
  suspend(){previous=undefined;},get seconds(){return time/1000;},
};}
/** Performance feedback uses actual render intervals, independently of motion's dt cap. */
export function createRealtimeFrameMeter(){let previous:number|undefined,fps=0;return {
  frame(now:number){if(previous!==undefined&&now>previous){const sample=1000/(now-previous);fps=fps?fps*.8+sample*.2:sample;}previous=now;},
  suspend(){previous=undefined;fps=0;},get fps(){return fps;},
};}
