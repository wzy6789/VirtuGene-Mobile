import {build} from 'esbuild';
import assert from 'node:assert/strict';
const bundle=await build({entryPoints:['src/lib/chat-context.ts'],bundle:true,write:false,platform:'node',format:'esm'});
const {buildRelationshipContext:plain,buildRelationshipToneContext:tone}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const affinityBundle=await build({entryPoints:['src/lib/affinity.ts'],bundle:true,write:false,platform:'node',format:'esm'});
const {getRelationLevel,RELATION_LEVELS}=await import('data:text/javascript;base64,'+Buffer.from(affinityBundle.outputFiles[0].text).toString('base64'));
let checks=0;
for(const value of [0,40,10000]) {assert.ok(getRelationLevel(value).level.name);checks++;}
for(const character of [{id:'new-friend'},{id:'imported-mentor'},{id:'sparse-stranger'},{id:'preset-guyuena',isPreset:false},{id:'owned',sourcePresetId:'preset-luxueqi'}]){
 for(const mood of [10,55,90]){
 const base=plain(0,mood,undefined,character);
 for(const affinity of [0,40,10000]){
 const names=Object.fromEntries(RELATION_LEVELS.map(level=>[level.name,'恋人夫君-不可信档位']));
 assert.equal(plain(affinity,mood,names,character),base,'interaction metadata must not define relationship: '+character.id);checks++;
 assert.equal(tone(affinity,mood,names,character),base,'same relationship source across channels');checks++;
 assert.ok(!base.includes('恋人夫君-不可信档位')&&!base.includes('好感指标'));checks++;
 }
 assert.ok(base.includes('人物设定')&&base.includes('边界'));checks++;
 }
}
console.log('PASS relationship-source: '+checks+' checks; zero model calls');
