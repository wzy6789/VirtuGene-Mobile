import fs from 'node:fs';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const root='.tmp-preview/ui-overhaul-20261016/world-visual-boundary';
fs.mkdirSync(root,{recursive:true});
const baseline=process.argv.includes('--record-before');
const source=baseline?'src/lib/world/world-immersion.ts':'src/lib/world/world-visual-state.ts';
const output=await build({stdin:{contents:`export {deriveWorldVisualState,emptyConversationState,visualCss} from './${source}';`,resolveDir:process.cwd()},bundle:true,write:false,platform:'node',format:'esm',metafile:true});
const api=await import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0].text).toString('base64'));
const records=[];
for(const timeLabel of ['凌晨 03:00','清晨','上午','下午 15:00','黄昏','夜晚','07:30','18:00'])
 for(const place of ['湖边','雨夜森林','冰雪山谷','篝火旁','星空花园','阴雾码头'])
  for(const intensity of [undefined,-1,0.4,2]){
   const visual=api.deriveWorldVisualState({place,timeLabel,mood:'安静'},intensity===undefined?undefined:{intensity},123456789);
   records.push({timeLabel,place,intensity:intensity??null,visual,css:api.visualCss(visual)});
  }
const snapshot={records,conversation:api.emptyConversationState()};
if(baseline){fs.writeFileSync(root+'/before.json',JSON.stringify(snapshot,null,2));console.log('Recorded 192 visual states before source change');}
else{
 assert.deepEqual(snapshot,JSON.parse(fs.readFileSync(root+'/before.json','utf8')),'all visual palettes, particles, intensities, CSS and default conversation values are unchanged');
 const one=api.emptyConversationState(),two=api.emptyConversationState();one.previousTopics.push('private');assert.deepEqual(two.previousTopics,[],'defaults have independent arrays');
 const inputs=Object.keys(output.metafile.inputs);
 assert.ok(!inputs.some(file=>/chat-conversation-state|chat-expression|chat-turn-cues|world-attention/.test(file)),'visual defaults do not pull conversation analysis');
 fs.writeFileSync(root+'/parity.json',JSON.stringify({pass:true,visualCases:records.length,inputs,scope:'Pure visual/default-state parity and import boundary; not full scene runtime or GPU performance.'},null,2));
 console.log('PASS 192 visual states, fresh defaults and isolated dependency graph');
}
if(process.argv.includes('--check-current-home')){
 const audit=JSON.parse(fs.readFileSync(process.argv.find(arg=>arg.startsWith('--audit='))?.slice(8)||'.tmp-preview/ui-overhaul-20261016/startup-chunks/world-canon-after/result.json','utf8'));
 const browser=JSON.parse(fs.readFileSync(process.argv.find(arg=>arg.startsWith('--browser='))?.slice(10)||root+'/browser-final/result.json','utf8'));
 const modules=audit.chunks.filter(chunk=>browser.home.files.includes(chunk.file)).flatMap(chunk=>chunk.modules);
 assert.ok(!modules.some(module=>/\/chat-(conversation-state|expression-boundary|expression-guidance|turn-cues)\.ts$/.test(module.id)),'home must not load conversation analysis for visual defaults');
}
