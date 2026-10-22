import { build } from 'esbuild';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
const out=process.env.VG_CHARACTER_DRAFT_OUTPUT||'.tmp-preview/ui-overhaul-20261015/character-draft';mkdirSync(out,{recursive:true});
const bundle=await build({entryPoints:['scripts/verify/character-draft-storage.ts'],bundle:true,write:false,platform:'browser',format:'iife',loader:{'.png':'dataurl','.webp':'dataurl'},define:{'import.meta.env':'{}','import.meta.hot':'undefined',__APP_VERSION__:'"test"'}});
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/test.js'?'application/javascript':'text/html;charset=utf-8');res.end(req.url==='/test.js'?bundle.outputFiles[0].text:'<!doctype html><script src="/test.js"></script>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({channel:'chrome',headless:true});
const errors=[];let external=0,report;
try{
 const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>{if(new URL(route.request().url()).hostname==='127.0.0.1')return route.continue();external++;return route.abort();});
 await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.draftStorageChecks);
 report=await page.evaluate(()=>window.draftStorageChecks());if(errors.length||external)throw Error('Unexpected runtime error or external request');
}catch(error){report={complete:false,error:error.message};process.exitCode=1;}
finally{writeFileSync(`${out}/storage-result.json`,JSON.stringify({recordedAt:new Date().toISOString(),...report,errors,externalRequests:external},null,2));await browser.close();await new Promise(r=>server.close(r));}
console.log(JSON.stringify(report));
