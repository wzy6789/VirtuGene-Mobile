import {DEFAULT_SCENE_ID,isSceneId,type SceneId} from './scene-catalog';
import type {ScenePreferences} from './scene-types';
export interface SceneTimeVariant {id:string;label:string;sceneId:SceneId}
const cafeTimes:ReadonlyArray<SceneTimeVariant>=[{id:'dusk',label:'黄昏',sceneId:'cafe-afternoon'},{id:'rain-night',label:'雨夜',sceneId:'cafe-rain-night'}];
/** Only real same-room assets are offered. No universal day/night recolor. */
export function sceneTimeOptions(id:SceneId):ReadonlyArray<SceneTimeVariant>{
 return id==='cafe-afternoon'||id==='cafe-rain-night'?cafeTimes:[{id:'original',label:'原有光照',sceneId:id}];
}
export function resolveEffectiveSceneAppearance(preferences:Pick<ScenePreferences,'id'|'timeVariantId'>){
 const id=isSceneId(preferences.id)?preferences.id:DEFAULT_SCENE_ID;
 const options=sceneTimeOptions(id),defaultId=id==='cafe-rain-night'?'rain-night':id==='cafe-afternoon'?'dusk':'original';
 const requested=preferences.timeVariantId??defaultId,variant=options.find(v=>v.id===requested)??options.find(v=>v.id===defaultId)!;
 return {sceneId:id,assetSceneId:variant.sceneId,timeVariantId:variant.id,label:variant.label,options,reason:requested===variant.id?'':'此时段不适用于当前场景，预览使用该场景的原有光照。'};
}
