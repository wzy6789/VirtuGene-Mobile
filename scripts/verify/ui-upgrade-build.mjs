import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readdirSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';
const out = '.tmp-preview/ui-overhaul-20261015'; mkdirSync(out,{recursive:true});
const commands=[['typecheck',['node_modules/typescript/bin/tsc','--noEmit']],['build',['node_modules/vite/bin/vite.js','build']]];
const results=[];
for(const [name,args] of commands){
  const start=Date.now(),child=spawn(process.execPath,args,{stdio:['ignore','pipe','pipe'],windowsHide:true}); let stdout='',stderr='';
  child.stdout.on('data',data=>stdout+=data);child.stderr.on('data',data=>stderr+=data);
  const exit=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve);});
  writeFileSync(join(out,`${name}-latest.log`),stdout+'\nSTDERR\n'+stderr);
  results.push({name,exit,elapsedMs:Date.now()-start});
  if(exit!==0)break;
}
const css=readdirSync('dist/renderer/assets').filter(f=>f.endsWith('.css'));
const cssGzip=css.reduce((sum,f)=>sum+gzipSync(readFileSync(join('dist/renderer/assets',f))).length,0);
const baseline=JSON.parse(readFileSync('docs/UI-6.0.1-BASELINE.json','utf8'));
const budget={cssGzip,baseline:baseline.cssGzip,max:Math.floor(baseline.cssGzip*1.15),passed:cssGzip<=baseline.cssGzip*1.15};
writeFileSync(join(out,'build-latest.json'),JSON.stringify({recordedAt:new Date().toISOString(),results,budget},null,2));
console.log(JSON.stringify({results,budget}));
if(results.some(r=>r.exit!==0))process.exitCode=1;
