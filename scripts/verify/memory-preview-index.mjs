import {build} from 'esbuild';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {readFileSync,writeFileSync} from 'node:fs';
const output=process.argv[2]??'.tmp-preview/ui-upgrade-20261022/memory-preview-index-result.json';
const {chromium}=createRequire(join(dirname(process.execPath),'package.json'))('playwright');
const common={bundle:true,write:false,platform:'browser',format:'iife',loader:{'.webp':'dataurl','.png':'dataurl','.css':'empty'},define:{'import.meta.env':'{}',__APP_VERSION__:'"verify"'}};
const legacy=await build({...common,stdin:{resolveDir:process.cwd(),loader:'ts',contents:`import {db} from './src/db';
window.seedMemoryPreviewLegacy=async()=>{await db.delete();await db.open();if(db.verno!==44)throw Error('Legacy schema is not v44');if(db.memories.schema.indexes.some(i=>i.name==='[userId+characterId+createdAt+id]'))throw Error('Legacy index unexpectedly present');
const rows=Array.from({length:12000},(_,i)=>({id:'irrelevant-'+i,userId:i%2?'v':'u',characterId:i%2?'a':'other-'+i%11,content:'unrelated',type:'fact',createdAt:2000+i}));
for(let i=0;i<10;i++)rows.push({id:'a-0'+i,userId:'u',characterId:'a',content:'saved-content-a-0'+i,type:i===9?'summary':'fact',sourceSessionId:i===9?'detached-session':undefined,pinned:i===9?true:undefined,status:'active',createdAt:1000});
await db.characters.bulkPut([{id:'a',createdBy:'u',name:'Preview A',systemPrompt:'test',createdAt:1},{id:'b',createdBy:'u',name:'Preview B',systemPrompt:'test',createdAt:1}]);await db.memories.bulkPut(rows);window.memoryPreviewBefore=await db.memories.toArray();db.close();return {version:44,rows:rows.length};};`},plugins:[{name:'actual-v44-schema',setup(builder){builder.onLoad({filter:/[\\/]src[\\/]db[\\/]index\.ts$/},args=>({loader:'ts',contents:readFileSync(args.path,'utf8').replace(/^\s*this\.version\(45\)\.stores\(\{memories:.*$/m,'')}));}}]});
const current=await build({...common,entryPoints:['scripts/verify/memory-preview-index.tsx']});
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url.endsWith('.js')?'application/javascript':'text/html;charset=utf-8');res.end(req.url==='/legacy.js'?legacy.outputFiles[0].text:req.url==='/current.js'?current.outputFiles[0].text:'<!doctype html><script src="/legacy.js"></script>');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const browser=await chromium.launch({channel:'chrome',headless:true});
let report;
try{const page=await browser.newPage();page.on('pageerror',e=>console.error('Page:',e.message));await page.addInitScript(()=>{window.fetch=async()=>{throw Error('Network blocked');};if(navigator.mediaDevices)navigator.mediaDevices.getUserMedia=async()=>{throw Error('Microphone blocked');};});await page.goto('http://127.0.0.1:'+server.address().port);await page.evaluate(()=>window.seedMemoryPreviewLegacy());await page.addScriptTag({url:'/current.js'});report=await page.evaluate(()=>window.memoryPreviewChecks());}
catch(error){report={complete:false,error:error.stack};process.exitCode=1;}
finally{await browser.close();await new Promise(resolve=>server.close(resolve));writeFileSync(output,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
