import fs from 'node:fs';import path from 'node:path';import http from 'node:http';import assert from 'node:assert/strict';import {build} from 'esbuild';import {chromium} from 'playwright';
const root=process.env.VG_STOCK_OUTPUT||'.tmp-preview/ui-overhaul-20261016/stock-send';fs.mkdirSync(root,{recursive:true});
const rounds=Number(process.env.VG_STOCK_ROUNDS??2);assert.ok(Number.isInteger(rounds)&&rounds>=2&&rounds<=40,'2..40 rounds per role');
const report={at:new Date().toISOString(),scope:'Same current source and identical synthetic stock, only suppression query changes. CPU4x desktop, mocked 100ms transport; no real model, Android, presented-frame or GPU measurement.',variants:[],checks:[],complete:false};
const browser=await chromium.launch({channel:'chrome',headless:true});
const check=(value,label)=>{assert.ok(value,label);report.checks.push(label);};
try{for(const variant of ['account-scan','scope-index']){
 const bundle=await build({entryPoints:['scripts/verify/ui-stock-send.ts'],bundle:true,write:false,platform:'browser',format:'iife',loader:{'.webp':'dataurl','.png':'dataurl'},define:{'import.meta.env':'{}',__APP_VERSION__:'"stock-verification"','__VG_STOCK_ROUNDS__':String(rounds)},plugins:[{name:'controlled-old-query',setup(builder){if(variant!=='account-scan')return;builder.onLoad({filter:/memory-source-tombstone-repo\.ts$/},args=>{const source=fs.readFileSync(args.path,'utf8'),needle="const rows = await db.memorySourceTombstones.where('[userId+characterId]')\n      .equals([userId, characterId]).toArray();\n    return new Set(rows.flatMap(row => row.suppressedMessageIds ?? []));";const normalized=source.replaceAll('\r\n','\n');assert.equal(normalized.split(needle).length,2,'patch exactly the original suppression query once');return {loader:'ts',contents:normalized.replace(needle,"const rows = await db.memorySourceTombstones.where('userId').equals(userId).toArray();\n    return new Set(rows.filter(row => row.characterId === characterId).flatMap(row => row.suppressedMessageIds ?? []));")};});}}]});
 const server=http.createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/fixture.js'?'text/javascript':'text/html; charset=utf-8');res.end(req.url==='/fixture.js'?bundle.outputFiles[0].text:'<!doctype html><script src="/fixture.js"></script>');});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+server.address().port,context=await browser.newContext(),page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
 try{
  await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  await page.addInitScript(()=>{const RealDate=Date,fixed=Date.parse('2026-10-16T04:00:00Z');class FixedDate extends RealDate{constructor(...args){super(...(args.length?args:[fixed]));}static now(){return fixed;}}window.Date=FixedDate;if(navigator.mediaDevices)navigator.mediaDevices.getUserMedia=async()=>{throw Error('Microphone blocked');};HTMLMediaElement.prototype.play=async()=>{throw Error('Audio blocked');};});
  const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});await page.goto(origin);await page.waitForFunction(()=>typeof window.stockSend==='function');
  const data=await page.evaluate(()=>window.stockSend());check(errors.length===0,variant+' no browser runtime errors');report.variants.push({variant,...data});fs.writeFileSync(root+'/result.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify({variant,samples:data.samples.map(row=>({character:row.character,iteration:row.iteration,preparationMs:row.preparationMs,firstCallbackMs:row.firstCallbackMs,suppressionCalls:row.suppressionCalls,tombstoneReads:row.reads.memorySourceTombstones}))}));
 }finally{await context.close();await new Promise(resolve=>server.close(resolve));}
 }
 const [before,after]=report.variants;check(before.samples.length===rounds*3&&after.samples.length===rounds*3,`${rounds*3} complete sends per variant`);
 report.roundsPerRole=rounds;
 for(let i=0;i<rounds*3;i++){
  const a=before.samples[i],b=after.samples[i],label=b.character+'/'+b.iteration;
  check(a.requestHash===b.requestHash,label+' all captured generation request fields identical, excluding credentials/callbacks/signal');
  check(a.disableThinking===b.disableThinking,label+' thinking option unchanged');
  check(a.suppressionCalls===b.suppressionCalls&&b.suppressionCalls>0,label+' same fresh suppression check count');
  check(JSON.stringify(a.diaryIds)===JSON.stringify(b.diaryIds),label+' authorized diary references unchanged');
  check(a.reads.memorySourceTombstones.bodyRows>=8105*a.suppressionCalls,label+' causal old query actually reads all account tombstones');
  check(b.reads.memorySourceTombstones.bodyRows<=2*b.suppressionCalls,label+' indexed query reads at most two matching bodies per call');
  const names=[...new Set([...Object.keys(a.reads),...Object.keys(b.reads)])].filter(name=>name!=='memorySourceTombstones').sort();
  const otherReads=row=>Object.fromEntries(names.map(name=>[name,{bodyRows:row.reads[name]?.bodyRows??0,keyRows:row.reads[name]?.keyRows??0}]));
  check(JSON.stringify(otherReads(a))===JSON.stringify(otherReads(b)),label+' all other table body/key reads unchanged');
 }
 report.complete=true;
}catch(error){report.failure=error.stack;process.exitCode=1;}
finally{await browser.close();fs.writeFileSync(root+'/result.json',JSON.stringify(report,null,2));console.log(JSON.stringify({complete:report.complete,checks:report.checks.length,failure:report.failure,evidence:root+'/result.json'}));}
