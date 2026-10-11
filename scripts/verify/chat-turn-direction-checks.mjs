import {readFileSync} from 'node:fs';
import {ablateOwnedGuidance} from './chat-context-ablation-live.mjs';
const source=JSON.parse(readFileSync('docs/GUYUENA-LIVE-PLAIN-DISAPPOINTMENT-RESPONSE-HOLDOUT-R1-2026-10-11.json','utf8'));
let checks=0;
function check(value,label){if(!value)throw Error(label);checks++;}
for(const row of source.rows.slice(0,2)){
const original=row.calls[0].messages[0].content;
const changed=ablateOwnedGuidance(original,'古月娜','turn-direction-omitted');
const lines=original.split('\n'),index=lines.indexOf('[本轮交流的隐藏节奏]');
lines.splice(index+1,1);
check(changed===lines.join('\n'),'Exactly one leading direction removed, no other string changes');
for(const marker of ['[人物声音卡]','[VirtuGene · 古月娜当前关系]','[手机私聊表达契约]'])check(changed.slice(changed.indexOf(marker))===original.slice(original.indexOf(marker)),'Preserved complete tail from '+marker);
check(changed.startsWith(original.slice(0,original.indexOf('[本轮交流的隐藏节奏]'))),'Persona and sourced head unchanged');
}
for(const value of ['missing','[本轮交流的隐藏节奏]\n[人物声音卡]','[本轮交流的隐藏节奏]\nA\n[本轮交流的隐藏节奏]\nB\n']){
let rejected=false;try{ablateOwnedGuidance(value,'古月娜','turn-direction-omitted');}catch{rejected=true;}check(rejected,'Malformed or duplicated turn section rejected');
}
console.log('PASS turn-direction ablation: '+checks+' exact preservation checks; no model calls');
