import type { CSSProperties } from 'react';
import type { WorldScene } from '../../db';
import { getChatScene } from '../../lib/chat-scene/scene-registry';
import type { SceneId } from '../../lib/chat-scene/scene-catalog';
import { getSceneLightProfile } from '../../lib/chat-scene/scene-lighting';

const sceneMatches:ReadonlyArray<readonly [RegExp,SceneId]>=[
    [/咖啡|咖馆/,'cafe-afternoon'], [/茶|竹|古风|庭院|书院|山门/,'guofeng-tea-room'],
    [/卧室|床|寝室|房间|家中|家里/,'home-bedroom'], [/海|港|沙滩|岛/,'mist-coast'],
    [/雪|冰|寒|极北/,'polar-refuge'], [/书店|图书|书房|阅读/,'snow-study'],
    [/木屋|壁炉|篝火/,'hearth-cabin'], [/列车|火车|车站/,'night-train'],
    [/星河|星空|宇宙|太空/,'orbital-observatory'],
];

function worldSceneArtId(scene:Pick<WorldScene,'title'|'place'>): SceneId {
  const text=`${scene.title} ${scene.place}`;
  return sceneMatches.find(([pattern])=>pattern.test(text))?.[1]??'urban-window-seat';
}

/** Decorative room artwork only; titles and locations remain the scene's real records. */
export function worldSceneArt(scene:Pick<WorldScene,'title'|'place'>) {
  const art=getChatScene(worldSceneArtId(scene))??getChatScene('urban-window-seat')!;
  return art.poster[art.poster.length-1];
}

/** Small directory/header art uses the exported thumbnail, not the full poster. */
export function worldSceneThumbnail(scene:Pick<WorldScene,'title'|'place'>) {
  const art=getChatScene(worldSceneArtId(scene))??getChatScene('urban-window-seat')!;
  return art.thumbnail??art.poster[0];
}

/** Carry the cover's light into the reading edge, without loading an image or renderer. */
export function worldSceneReadingLight(scene:Pick<WorldScene,'title'|'place'>): CSSProperties {
  const light=getSceneLightProfile({id:worldSceneArtId(scene)});
  return {'--vg-reading-window':light.windowColor,'--vg-reading-lamp':light.lampColor} as CSSProperties;
}
