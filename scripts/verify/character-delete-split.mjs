import {build} from 'esbuild';
import {chromium} from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
const mode=process.argv.includes('--switch-during-load')?'switch':process.argv.includes('--fail-download')?'failure':'normal';
const phase=process.argv.find(x=>x.startsWith('--phase='))?.split('=')[1]||mode+'-accepted';
const out='.tmp-preview/ui-overhaul-20261016/memory-startup-boundary/cold-delete/'+phase;fs.mkdirSync(out,{recursive:true});
const built=await build({entryPoints:['scripts/verify/character-delete.ts'],bundle:true,splitting:true,write:false,outdir:path.resolve(out+'/chunks'),format:'esm',platform:'browser',loader:{'.png':'dataurl','.webp':'dataurl'},define:{'import.meta.env':'{}','import.meta.hot':'undefined',__APP_VERSION__:'"test"'}});
const files=new Map(built.outputFiles.map(f=>[path.basename(f.path),f.text]));for(const f of built.outputFiles)fs.writeFileSync(out+'/'+path.basename(f.path),f.text);
const memoryChunk=[...files.keys()].find(f=>f.startsWith('memory-repo-'));assert.ok(memoryChunk,'actual split memory repository chunk');
let held=false,release;const gate=new Promise(r=>{release=r;});
const server=createServer(async(req,res)=>{const name=path.basename(req.url);if(files.has(name)){if(name===memoryChunk&&!held){held=true;await gate;if(mode==='failure'){res.writeHead(503);res.end('Controlled unavailable module');return;}}res.setHeader('Content-Type','text/javascript');res.end(files.get(name));}else{res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><script type="module" src="/character-delete.js"></script>');}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({channel:'chrome',headless:true});
const report={checks:[],errors:[],scope:'Actual code-split repositories/chat store and real IndexedDB; 10000-message fixture with real HTTP module download held. This esbuild harness is not Vite dist or Android performance; artificial hold invalidates wall-time benchmark use.'};
const check=(ok,label)=>{assert.ok(ok,label);report.checks.push(label);};
try{
 const page=await browser.newPage();page.on('pageerror',e=>report.errors.push(e.message));
 await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>!!window.characterDeleteTest);
 check(!held,'initial lightweight store does not request memory module');
 await page.evaluate(()=>{window.__coldDeletion={};void characterDeleteTest.run(10000).then(result=>{window.__coldDeletion.result=result;},error=>{window.__coldDeletion.failure=error.stack;});});
 const deadline=Date.now()+15000;while(!held&&Date.now()<deadline)await page.waitForTimeout(20);check(held,'first actual deletion requests memory module');
 const before=await page.evaluate(async()=>{const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('virtugene');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});try{return await Promise.race([new Promise((resolve,reject)=>{const tx=db.transaction(['characters','messages','memorySourceTombstones'],'readonly'),rows={};for(const [table,key]of [['characters','delete-character'],['messages','delete-message-0']]){const r=tx.objectStore(table).get(key);r.onsuccess=()=>rows[table]=!!r.result;}const count=tx.objectStore('memorySourceTombstones').count();count.onsuccess=()=>rows.tombstones=count.result;tx.oncomplete=()=>resolve(rows);tx.onerror=()=>reject(tx.error);}),new Promise((_,reject)=>setTimeout(()=>reject(Error('readonly probe blocked behind premature write transaction')),1500))]);}finally{db.close();}});
 report.whileHeld=before;check(before.characters&&before.messages&&before.tombstones===1,'pending module download starts no partial deletion or tombstones, independent read remains available');
 if(mode==='switch')await page.evaluate(()=>characterDeleteTest.switchOwner('foreign-user'));
 release();await page.waitForFunction(()=>!!window.__coldDeletion?.result||!!window.__coldDeletion?.failure,{},{timeout:60000});const result=await page.evaluate(()=>window.__coldDeletion);
 if(mode==='normal'){
  assert.ok(!result.failure,result.failure);report.deletion=result.result;
  check(result.result.checks===20,'actual bounded deletion, summary/source revocation, rollback and owner guards pass after module release');
  check(!result.result.fullSessionRead&&result.result.maxBulkRead<=100,'message source protection remains bounded');
 }else{
  report.expectedOperationFailure=result.failure;
  check(mode==='switch'?result.failure?.includes('账号已切换'):/(dynamically imported|Failed to fetch|Importing a module)/i.test(result.failure??''),'controlled module failure or account change rejects before transaction');
  const stored=await page.evaluate(async()=>{const database=await new Promise((resolve,reject)=>{const r=indexedDB.open('virtugene');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});try{return await new Promise((resolve,reject)=>{const tx=database.transaction(['characters','messages','memorySourceTombstones'],'readonly'),rows={};for(const [table,key]of [['characters','delete-character'],['messages','delete-message-0'],['messages','delete-message-9999']]){const r=tx.objectStore(table).get(key);r.onsuccess=()=>rows[key]=!!r.result;}const r=tx.objectStore('memorySourceTombstones').count();r.onsuccess=()=>rows.tombstones=r.result;tx.oncomplete=()=>resolve(rows);tx.onerror=()=>reject(tx.error);});}finally{database.close();}});
  report.afterRejectedLoad=stored;check(stored['delete-character']&&stored['delete-message-0']&&stored['delete-message-9999']&&stored.tombstones===1,'rejected module load leaves full role history and original tombstones intact');
  if(mode==='switch')check(await page.evaluate(()=>characterDeleteTest.owner())==='foreign-user','late operation does not switch account back');
 }
 check(report.errors.length===0,'no browser errors or transaction expiry');report.status='pass';
}catch(e){report.status='failed';report.failure=e.stack;process.exitCode=1;}finally{release();await browser.close();await new Promise(r=>server.close(r));fs.writeFileSync(out+'/result.json',JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,checks:report.checks.length,deletionChecks:report.deletion?.checks,failure:report.failure}));}
