import type { SceneEffect } from './scene-catalog';
/** Local physical effects, clipped by the exported geometry mask, never over message text. */
export const SCENE_EFFECT_PROFILES = {
  starfield:{shape:'vg-scene-dust',direction:'none',speed:{min:.008,max:.022},size:{min:.45,max:1.25},colors:['#d4dced','#b7c8e1','#ede0cb'],opacity:.75,count:[38,58],rotation:0},
  dust:{shape:'vg-scene-dust',direction:'top',speed:{min:.09,max:.32},size:{min:.6,max:2.1},colors:['#f2d4a4','#dcb98b','#ffe6bd'],opacity:.65,count:[30,46],rotation:0},
  rain:{shape:'vg-scene-rain',direction:108,speed:{min:.7,max:1.5},size:{min:.65,max:1.9},colors:['#b3c6d6','#d1dee5','#95abbc'],opacity:.67,count:[48,72],rotation:18},
  snow:{shape:'vg-scene-snow',direction:'bottom',speed:{min:.14,max:.46},size:{min:.7,max:2.7},colors:['#e8f0f6','#cbd9e4','#f8fbff'],opacity:.82,count:[36,54],rotation:1.5},
  mist:{shape:'vg-scene-mist',direction:'top-right',speed:{min:.045,max:.12},size:{min:2.4,max:5.8},colors:['#d5e7e6','#b4ced0','#eaf1ea'],opacity:.34,count:[12,18],rotation:0},
  embers:{shape:'vg-scene-ember',direction:'top',speed:{min:.25,max:.75},size:{min:.6,max:1.9},colors:['#ffd7a0','#ef9b62','#ffe3b5'],opacity:.86,count:[20,30],rotation:0},
  'train-rain':{shape:'vg-scene-rain',direction:125,speed:{min:1.1,max:1.95},size:{min:.55,max:1.5},colors:['#bbcbdc','#9aacc3','#d2dee9'],opacity:.62,count:[36,54],rotation:35},
  'bedroom-rain':{shape:'vg-scene-rain',direction:100,speed:{min:.32,max:.78},size:{min:.55,max:1.4},colors:['#bdcbd8','#abbccf','#d4dde5'],opacity:.54,count:[26,38],rotation:10},
  'home-dust':{shape:'vg-scene-dust',direction:'top',speed:{min:.06,max:.2},size:{min:.55,max:1.8},colors:['#f0d9ad','#ffe8c3','#debb83'],opacity:.62,count:[24,36],rotation:0},
  'garden-rain':{shape:'vg-scene-rain',direction:100,speed:{min:.3,max:.65},size:{min:.5,max:1.3},colors:['#b3c1bd','#d0dcd6','#9fafaa'],opacity:.51,count:[30,44],rotation:10},
  'city-rain':{shape:'vg-scene-rain',direction:104,speed:{min:.42,max:.85},size:{min:.5,max:1.4},colors:['#bac8d5','#dce4eb','#a4b3c3'],opacity:.60,count:[34,50],rotation:14},
} satisfies Record<SceneEffect,{shape:string;direction:'top'|'bottom'|'top-right'|'none'|number;speed:{min:number;max:number};size:{min:number;max:number};colors:string[];opacity:number;count:[number,number];rotation:number}>;
