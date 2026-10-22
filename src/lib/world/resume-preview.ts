import Dexie from 'dexie';
import {db} from '../../db';

/** The selected cover only: two authorization keys and at most one entry. */
export async function loadWorldResumePreview(sceneId:string,userId:string,worldId:string,isCurrent:()=>boolean){
  return db.transaction('r',[db.worldScenes,db.worlds,db.worldSceneEntries],async()=>{
    if(!isCurrent())return undefined;
    const [scene,world]=await Promise.all([db.worldScenes.get(sceneId),db.worlds.get(worldId)]);
    if(!isCurrent()||!scene||!world||scene.userId!==userId||world.userId!==userId||scene.worldId!==worldId||!['active','paused'].includes(scene.status))return undefined;
    const entry=await db.worldSceneEntries.where('[sceneId+index]').between([sceneId,Dexie.minKey],[sceneId,Dexie.maxKey]).last();
    return isCurrent()?{scene,excerpt:entry?.kind==='narration'?entry.content.trim().slice(0,240):undefined}:undefined;
  });
}
