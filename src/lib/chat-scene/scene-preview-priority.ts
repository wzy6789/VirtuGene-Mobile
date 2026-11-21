/** The visible appearance preview owns the GPU budget while the room is covered.
 * Retire callbacks run synchronously before the preview can acquire resources. */
let previews=0;
const rooms=new Set<(covered:boolean)=>void>();
export function watchScenePreview(covered:(active:boolean)=>void){
  rooms.add(covered);covered(previews>0);
  return()=>{rooms.delete(covered);};
}
export function claimScenePreview(){
  if(++previews===1)rooms.forEach(covered=>covered(true));
  let released=false;
  return()=>{if(released)return;released=true;if(--previews===0)rooms.forEach(covered=>covered(false));};
}
