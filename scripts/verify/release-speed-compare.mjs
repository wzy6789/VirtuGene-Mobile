import {build} from 'esbuild';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {dirname,join,resolve} from 'node:path';
import {writeFileSync,existsSync} from 'node:fs';
const output=process.argv[2]??'docs/RELEASE-SPEED-COMPARE-2026-10-13.json';if(existsSync(output))throw Error('Do not overwrite evidence');
const fixture=process.argv[3]??'scripts/verify/release-speed-compare.ts';
const {chromium}=createRequire(join(dirname(process.execPath),'package.json'))('playwright');
const browser=await chromium.launch({channel:'chrome',headless:true});const report={date:new Date().toISOString(),versions:[],errors:[],complete:false,modelCalls:0};
try{
 for(const [label,root] of [['6.0.24','release/speed-source-6.0.24'],['6.1.0','release/speed-source-6.1.0'],['6.1.0-exact-diary-only','release/speed-source-6.1.0'],['fixed','.']]){
  const sourceRoot=resolve(root);
  const bundle=await build({entryPoints:[fixture],bundle:true,write:false,platform:'browser',format:'iife',loader:{'.webp':'dataurl','.png':'dataurl'},define:{'import.meta.env':'{}',__APP_VERSION__:'"test"'},plugins:[{name:'release-root',setup(builder){builder.onResolve({filter:/^@release\//},args=>({path:join(sourceRoot,'src',args.path.slice(9)+'.ts')}));if(label==='6.1.0-exact-diary-only')builder.onLoad({filter:/lib[\\/]character-memory\.ts$/},async(args)=>{const {readFileSync}=await import('node:fs');let contents=readFileSync(args.path,'utf8');const start=contents.indexOf('    const allowed = await Promise.all(audience.map(async (characterId) => {');const end=contents.indexOf('    if (allowed.some',start);if(start<0||end<0)throw Error('Exact-only comparison anchor missing');contents=contents.slice(0,start)+`    const allowed=await Promise.all(audience.map(async characterId=>isVisibleToCharacter(row,characterId)&&(row.visibility!=='world'||row.characterId===characterId)&&(await db.characterKnowledge.where('[characterId+eventId]').equals([characterId,'diary:'+row.id]).toArray()).some(knowledge=>knowledge.userId===p.userId&&knowledge.canMention&&knowledge.knowledgeLevel==='full')));\n`+contents.slice(end);return {contents,loader:'ts'};});}}]});
  const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/test.js'?'application/javascript':'text/html');res.end(req.url==='/test.js'?bundle.outputFiles[0].text:'<!doctype html><script src="/test.js"></script>');});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const context=await browser.newContext();
  try{const page=await context.newPage();const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>!!window.releaseSpeed);const data=await page.evaluate(()=>window.releaseSpeed());report.versions.push({label,...data});writeFileSync(output,JSON.stringify(report,null,2));console.log(JSON.stringify({label,samples:data.samples}));}
  finally{await context.close();await new Promise(resolve=>server.close(resolve));}
 }
 if(fixture==='scripts/verify/release-speed-compare.ts'){
   const fingerprints=report.versions.filter(version=>version.label!=='6.0.24').flatMap(version=>version.samples.map(sample=>sample.promptFingerprint));
   report.promptContentUnchanged=fingerprints.length===9&&new Set(fingerprints).size===1;
   if(!report.promptContentUnchanged)throw Error('Released 6.1.0 and optimized prompt content differs');
 }
 report.complete=report.versions.length===4;
}catch(error){report.errors.push(error.message);}finally{await browser.close();writeFileSync(output,JSON.stringify(report,null,2));}
console.log(JSON.stringify({complete:report.complete,errors:report.errors,evidence:output}));if(!report.complete)process.exitCode=1;
