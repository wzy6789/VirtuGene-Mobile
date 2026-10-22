import {build} from 'esbuild';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {dirname,join,resolve} from 'node:path';
import {writeFileSync} from 'node:fs';
const baseline=process.argv.includes('--baseline');
const output='.tmp-preview/ui-upgrade-20261022/world-day-overview-'+(baseline?'red':'green')+'.json';
const {chromium}=createRequire(join(dirname(process.execPath),'package.json'))('playwright');
const bundle=await build({entryPoints:['scripts/verify/world-day-overview.ts'],bundle:true,write:false,platform:'browser',format:'iife',loader:{'.webp':'dataurl','.png':'dataurl'},define:{'import.meta.env':'{}',__APP_VERSION__:'"verify"'},plugins:[{name:'overview-path',setup(builder){
  builder.onResolve({filter:/^@world-overview$/},()=>baseline?{path:'baseline',namespace:'old-overview'}:{path:resolve('src/lib/world/day-overview.ts')});
  builder.onLoad({filter:/.*/,namespace:'old-overview'},()=>({contents:`import {readActionDay} from '${resolve('src/lib/action-cabin/query.ts').replaceAll('\\','/')}';export function useWorldDayOverview(){throw Error('baseline cost assertion should fail before hook verification');}export async function readWorldDayOverview(userId,now){const day=await readActionDay(userId,now);return {day:day.day,today:day.today.length,unplanned:day.pending.filter(r=>r.todo.recurrence.kind==='none'&&!r.todo.dueDate&&r.occurrence.dueDate==='9999-12-31').length};}`,loader:'ts',resolveDir:process.cwd()}));
}}]});
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/test.js'?'application/javascript':'text/html;charset=utf-8');res.end(req.url==='/test.js'?bundle.outputFiles[0].text:'<!doctype html><script src="/test.js"></script>');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const browser=await chromium.launch({channel:'chrome',headless:true});let report;
try{const page=await browser.newPage();await page.addInitScript(()=>{window.fetch=async()=>{throw Error('Network blocked');};if(navigator.mediaDevices)navigator.mediaDevices.getUserMedia=async()=>{throw Error('Microphone blocked');};});await page.goto('http://127.0.0.1:'+server.address().port);report=await page.evaluate(()=>window.worldOverviewChecks().catch(error=>({complete:false,error:error.message,cost:window.worldOverviewCost})));if(!report.complete)process.exitCode=1;}
catch(error){report={complete:false,error:error.stack};process.exitCode=1;}
finally{await browser.close();await new Promise(resolve=>server.close(resolve));writeFileSync(output,JSON.stringify({baseline,...report},null,2));console.log(JSON.stringify({baseline,...report},null,2));}
