import type { WorldScene } from '../../db';
import { getChatScene } from '../../lib/chat-scene/scene-registry';
import type { SceneId } from '../../lib/chat-scene/scene-catalog';

/** Decorative room artwork only; titles and locations remain the scene's real records. */
export function worldSceneArt(scene:Pick<WorldScene,'title'|'place'>) {
  const text=`${scene.title} ${scene.place}`;
  const matches:ReadonlyArray<readonly [RegExp,SceneId]>=[
    [/咖啡|咖馆/,'cafe-afternoon'], [/茶|竹|古风|庭院|书院|山门/,'guofeng-tea-room'],
    [/卧室|床|寝室|房间|家中|家里/,'home-bedroom'], [/海|港|沙滩|岛/,'mist-coast'],
    [/雪|冰|寒|极北/,'polar-refuge'], [/书店|图书|书房|阅读/,'snow-study'],
    [/木屋|壁炉|篝火/,'hearth-cabin'], [/列车|火车|车站/,'night-train'],
    [/星河|星空|宇宙|太空/,'orbital-observatory'],
  ];
  const sceneId=matches.find(([pattern])=>pattern.test(text))?.[1]??'urban-window-seat';
  const art=getChatScene(sceneId)??getChatScene('urban-window-seat')!;
  return art.poster[art.poster.length-1];
}
