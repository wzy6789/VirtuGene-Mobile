import { build } from 'esbuild';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const out=process.argv[2]??'.tmp-preview/ui-overhaul-20261016/memory-original-live';mkdirSync(out,{recursive:true});
const built=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
import {useState} from 'react';import {createRoot} from 'react-dom/client';
import {MemoryArchiveModal} from './src/components/character/MemoryArchiveModal';
import {db} from './src/db';import {useAuthStore} from './src/store/auth-store';
import {memorySourceTombstoneRepo} from './src/db/memory-source-tombstone-repo';
import {readMemoryOriginal} from './src/lib/memory-original';
window.fetch=async()=>{throw Error('External requests disabled');};
useAuthStore.setState({userId:'original-owner',isLoggedIn:true});await db.open();
const character={id:'original-role',createdBy:'original-owner',name:'知微',avatar:'',tags:[],systemPrompt:'',greeting:'',isCustom:true,isPreset:false,createdAt:1};
await db.characters.put(character);
const memory={id:'original-memory',userId:'original-owner',characterId:character.id,type:'auto',content:'喜欢雨后散步',sourceSessionId:'original-session',sourceMessageIds:['original-message'],sourceMessageRevisions:{'original-message':1},createdAt:Date.UTC(2026,9,16,1),updatedAt:1};
async function reset(){await db.memorySourceTombstones.clear();await db.sessions.put({id:'original-session',characterId:character.id,userId:'original-owner',title:'一起聊天',createdAt:1,updatedAt:1});await db.messages.put({id:'original-message',sessionId:'original-session',role:'user',content:'原话：我喜欢雨后散步。',revision:1,createdAt:1,isProactive:false});await db.memories.put(memory);}
await reset();
window.restoreImported=async foreign=>{await db.memories.update(memory.id,{importedFromCharacterId:'another-role',importedFromMemoryId:'imported-summary'});await db.sessions.update('original-session',{characterId:foreign?'another-role':character.id});};
function Fixture(){const[open,setOpen]=useState(true),[key,setKey]=useState(0);window.originalTest={reset:async()=>{await reset();setKey(k=>k+1);setOpen(true);},edit:()=>db.messages.update('original-message',{content:'改过的原话不应冒充旧依据',revision:2}),remove:()=>db.messages.delete('original-message'),transfer:()=>db.sessions.update('original-session',{userId:'another-owner'}),wrongRole:()=>db.sessions.update('original-session',{characterId:'another-role'}),suppress:()=>memorySourceTombstoneRepo.record({userId:'original-owner',characterId:character.id,sourceType:'memory',sourceId:'hidden-projection',status:'withdrawn',suppressedMessageIds:['original-message']}),deleteMemory:()=>db.memories.delete(memory.id),group:seen=>db.transaction('rw',db.messages,db.sessions,async()=>{await db.sessions.update('original-session',{type:'group',groupId:'original-group'});await db.messages.update('original-message',{witnessedBy:seen?[character.id]:[]});}),owner:()=>useAuthStore.setState({userId:'another-owner'})};return <MemoryArchiveModal key={key} open={open} character={character} userId="original-owner" onClose={()=>setOpen(false)}/>;}
createRoot(document.getElementById('root')).render(<Fixture/>);
window.measureOriginal=async()=>{
  await reset();
  await db.messages.bulkPut(Array.from({length:12000},(_,i)=>({id:'unrelated-message-'+i,sessionId:'unrelated-session',role:'user',content:'synthetic unrelated content',revision:1,createdAt:i,isProactive:false})));
  await db.memorySourceTombstones.bulkPut(Array.from({length:8105},(_,i)=>({id:'unrelated-tombstone-'+i,userId:'original-owner',characterId:i%2?'original-role':'another-role',sourceType:'memory',sourceId:'projection-'+i,status:'withdrawn',sourceRevision:1,suppressedMessageIds:['unrelated-message-'+i],createdAt:1,updatedAt:1})));
  const bodies={},restore=[];
  for(const table of [db.memories,db.messages,db.sessions,db.memorySourceTombstones]){
    const core=table.core;bodies[table.name]=0;
    for(const method of ['get','getMany','query','openCursor']){const original=core[method];core[method]=async function(request){const result=await original.call(this,request);if(method==='get')bodies[table.name]+=result?1:0;else if(method==='getMany')bodies[table.name]+=result.filter(Boolean).length;else if(method==='query'&&request.values)bodies[table.name]+=result.result.length;else if(method==='openCursor'&&request.values&&result){const start=result.start;result.start=function(callback){return start.call(this,()=>{bodies[table.name]++;callback();});};}return result;};restore.push(()=>core[method]=original);}
  }
  try{const begin=performance.now(),value=await readMemoryOriginal('original-owner','original-role','original-memory');return {value,bodies,durationMs:performance.now()-begin,fixture:{unrelatedMessages:12000,unrelatedTombstones:8105}};}finally{restore.forEach(f=>f());}
};
`},bundle:true,write:false,format:'esm',platform:'browser',jsx:'automatic',loader:{'.css':'empty','.webp':'dataurl','.png':'dataurl'},define:{'import.meta.env':'{}','import.meta.hot':'undefined',__APP_VERSION__:'"test"'}});
const assets='dist/renderer/assets';const css=readdirSync(assets).filter(f=>f.endsWith('.css')).map(f=>readFileSync(assets+'/'+f,'utf8')).join('\n');
const server=createServer((req,res)=>{if(req.url==='/fixture.js'){res.setHeader('Content-Type','application/javascript');res.end(built.outputFiles[0].text);}else{res.setHeader('Content-Type','text/html;charset=utf-8');res.end('<!doctype html><html lang="zh-CN" class="dark"><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style><div id="root"></div><script type="module" src="/fixture.js"></script>');}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const browser=await chromium.launch({channel:'chrome',headless:true});const report={checks:[],errors:[],scope:'Actual archive component, synthetic local records; no model or Android.'};
const check=(value,label)=>{assert.ok(value,label);report.checks.push(label);};
try{const page=await browser.newPage({viewport:{width:390,height:844},recordVideo:{dir:out,size:{width:390,height:844}}});page.on('pageerror',e=>report.errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port+'/?virtugene-preview=mobile');const expand=()=>page.getByRole('button',{name:'看当时说的话',exact:true}).click();
await expand();await page.getByText('原话：我喜欢雨后散步。',{exact:true}).waitFor();check(true,'initial owned source is readable');
await page.evaluate(()=>originalTest.edit());await page.waitForTimeout(400);check(await page.getByText('原话：我喜欢雨后散步。',{exact:true}).count()===0,'editing source immediately removes stale original');check(await page.getByText('改过的原话不应冒充旧依据',{exact:true}).count()===0,'edited version is not presented as historical original');
for(const mutation of ['remove','transfer','wrongRole','suppress','deleteMemory']){await page.evaluate(()=>originalTest.reset());await expand();await page.getByText('原话：我喜欢雨后散步。',{exact:true}).waitFor();await page.evaluate(m=>originalTest[m](),mutation);await page.waitForTimeout(350);check(await page.getByText('原话：我喜欢雨后散步。',{exact:true}).count()===0,mutation+': live source invalidation removes quote');}
await page.evaluate(()=>originalTest.reset());await page.evaluate(()=>restoreImported(true));await expand();await page.waitForTimeout(350);check(await page.getByText('原话：我喜欢雨后散步。',{exact:true}).count()===0,'imported metadata cannot authorize another role raw chat');await page.evaluate(()=>restoreImported(false));await page.getByText('原话：我喜欢雨后散步。',{exact:true}).waitFor();check(true,'deduplicated import metadata preserves valid current-role originals');
await page.evaluate(()=>originalTest.reset());await page.evaluate(()=>originalTest.group(false));await expand();await page.waitForTimeout(350);check(await page.getByText('原话：我喜欢雨后散步。',{exact:true}).count()===0,'group membership is not inferred without witness');await page.evaluate(()=>originalTest.group(true));await page.getByText('原话：我喜欢雨后散步。',{exact:true}).waitFor();check(true,'recorded group witness can inspect source');
await page.screenshot({path:out+'/owned-group-source.png'});await page.evaluate(()=>originalTest.owner());await page.waitForTimeout(100);check(await page.getByRole('dialog').count()===0,'account switch removes the archive');
report.performance=await page.evaluate(()=>measureOriginal());check(report.performance.value.quotes.length===1,'large unrelated fixture preserves selected quote');check(report.performance.bodies.memories===1&&report.performance.bodies.messages===1&&report.performance.bodies.sessions===1&&report.performance.bodies.memorySourceTombstones===0,'only three selected bodies read despite 12000 messages and 8105 tombstones');
check(report.errors.length===0,'no runtime errors');report.status='pass';report.video=await page.video().path();await page.close();}catch(error){report.status='failed';report.failure=error.stack;process.exitCode=1;}finally{await browser.close();await new Promise(resolve=>server.close(resolve));writeFileSync(out+'/result.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
