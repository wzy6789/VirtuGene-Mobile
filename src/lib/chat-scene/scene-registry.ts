import type { ImageVariant, SceneDefinition, SceneId, ScenePreferences } from './scene-types';
import { sceneExports } from './scene-bundled-assets';
import { DEFAULT_SCENE_ID, getSceneDescription } from './scene-catalog';

interface ExportImage { file:string; width:number; height:number; bytes:number; rect?:[number,number,number,number] }
interface SceneExport {
  sceneId:SceneId; designWidth:number; designHeight:number; cupMouth?:[number,number]; windowPolygon:[number,number][];
  thumbnail?:ExportImage; lightRect?:[number,number,number,number]; glass?:{strength:number;frost:number};
  qualities:Record<string,{poster:ExportImage;cleanPlate:ExportImage;layers:(ExportImage&{id:string;rect:[number,number,number,number];depthFactor?:number;maxOffsetPx?:number})[];windowMask:ExportImage}>;
}
export const DEFAULT_SCENE_PREFERENCES: Readonly<ScenePreferences> = Object.freeze({id:DEFAULT_SCENE_ID,quality:'auto',motionEnabled:true,parallaxEnabled:false,renderer:'layered'});
const definitions = new Map<SceneId,SceneDefinition>();
for (const entry of sceneExports) {
  const data=entry.metadata as unknown as SceneExport,urls:Record<string,string|undefined>=entry.urls;
  const rows=Object.values(data.qualities).sort((a,b)=>a.poster.width-b.poster.width);
  const variant=(image:ExportImage):ImageVariant=>{const src=urls[image.file];if(!src)throw Error(`scene:missing-bundled-asset:${data.sceneId}/${image.file}`);return {src,width:image.width,height:image.height,byteLength:image.bytes};};
  const layerIds=rows[0].layers.map(l=>l.id);
  const info=getSceneDescription(data.sceneId),light=data.lightRect??[660,960,750,1200];
  const fire=info.effect==='embers',cold=info.effect==='snow'||info.effect==='mist';
  definitions.set(data.sceneId,{
    schemaVersion:1,id:data.sceneId,label:info.label,backend:entry.realtime?'webgl2':'dom-2.5d',
    designSize:{width:data.designWidth,height:data.designHeight},cropAnchor:{x:.5,y:.5},
    poster:rows.map(row=>variant(row.poster)),
    thumbnail:data.thumbnail?variant(data.thumbnail):undefined,
    layered:{base:rows.map(row=>variant(row.cleanPlate)),layers:layerIds.map(id=>{const layer=rows[0].layers.find(l=>l.id===id)!;return {id,rect:layer.rect,
      variants:rows.map(row=>variant(row.layers.find(l=>l.id===id)!)),depthFactor:layer.depthFactor??(id==='table'?1:id==='plant'?.65:0),maxOffsetPx:layer.maxOffsetPx??(id==='table'?6:id==='plant'?4:0)};})},
    windowMask:rows.map(row=>variant(row.windowMask)),windowMaskRect:rows[0].windowMask.rect,
    glass:data.glass?{...data.glass,opening:data.windowPolygon.map(([x,y])=>[x/data.designWidth,1-y/data.designHeight] as [number,number])}:undefined,
    steam:data.cupMouth?{x:data.cupMouth[0]-68,y:data.cupMouth[1]-430,width:136,height:430}:undefined,
    light:{x:light[0],y:light[1],width:light[2],height:light[3],color:fire?'#ffb65a':cold?'#c4e3ef':'#ffe5a2',duration:fire?6400:24000,opacity:fire?[.08,.2]:[.08,.12]},readingPreset:info.readingPreset,effect:info.effect,
    realtime:entry.realtime?{model:entry.realtime.model,byteLength:entry.realtime.metadata.bytes,geometryBytes:entry.realtime.metadata.vertices*24+entry.realtime.metadata.triangles*12,triangles:entry.realtime.metadata.triangles,effectQuad:entry.realtime.metadata.effectQuad as [number,number,number][],lightPoint:entry.realtime.metadata.lightPoint as [number,number,number],cup:(entry.realtime.metadata.cup??undefined) as [number,number,number]|undefined,ambientVolume:('ambientVolume' in entry.realtime.metadata?entry.realtime.metadata.ambientVolume:undefined) as NonNullable<SceneDefinition['realtime']>['ambientVolume']}:undefined,
  });
}
export const CHAT_SCENES = [...definitions.values()];
export function getChatScene(id:SceneId) { return definitions.get(id) ?? definitions.get(DEFAULT_SCENE_ID); }
