import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync} from 'node:fs';
const cases=[['古月娜','docs/GUYUENA-LIVE-CASUAL-SIDEWALK-HOLDOUT-R1-2026-10-10.json',false],['陆雪琪','docs/LUXUEQI-LIVE-CASUAL-SIDEWALK-HOLDOUT-R2-2026-10-10.json',true]].map(([name,path,compact])=>({name,path,compact,row:JSON.parse(readFileSync(path,'utf8')).rows[0]}));
const responses=cases.map(({name,row})=>({characterName:name,input:row.input,raw:row.calls[0].raw}));
const bundle=await build({entryPoints:['scripts/verify/chat-human-live.ts'],bundle:true,write:false,platform:'browser',format:'iife',loader:{'.png':'dataurl','.webp':'dataurl'},define:{LIVE_PROXY:'"http://127.0.0.1:1/no-network"',LIVE_TOKEN:'"local-only"',LIVE_RESPONSES:JSON.stringify(responses),LIVE_GENERATION_MODE:'"production"',LIVE_DEFER_DELIVERY:'true','import.meta.env':'{}',__APP_VERSION__:'"local-check"'}});
const server=createServer((request,response)=>{response.setHeader('Content-Type',request.url==='/test.js'?'text/javascript':'text/html; charset=utf-8');response.end(request.url==='/test.js'?bundle.outputFiles[0].text:'<script src="/test.js"></script>');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const {chromium}=createRequire(join(dirname(process.execPath),'package.json'))('playwright');
const browser=await chromium.launch({channel:'chrome',headless:true});
const rows=[];
try{
 for(const item of cases){
  const page=await browser.newPage();await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>!!window.liveExpression);
  const persona=await page.evaluate(name=>window.liveExpression.presets(true).find(c=>c.name===name),item.name);
  await page.evaluate(p=>window.liveExpression.setup(p,p.proactivity??0.5),persona);
  const row=await page.evaluate(input=>window.liveExpression.turn(input),item.row.input);
  const prompt=row.calls[0]?.messages[0]?.content??'';
  const pass=!row.failed&&row.calls.length===1&&row.calls[0].replayed&&prompt.includes('[人物声音卡]')&&prompt.includes(item.compact?'接这件小事，说出你自己此刻的反应。':'轻松交流，从这件事里');
  rows.push({name:item.name,pass,compact:item.compact,row});await page.close();
 }
 writeFileSync('release/chat-compact-react-routing-2026-10-10.json',JSON.stringify({modelCalls:0,scope:'Captured replies only, actual private request routing and isolated IndexedDB; not fresh expression',rows},null,2)+'\n');
 if(rows.some(row=>!row.pass))throw Error('Owned reaction routing failed');
 console.log('PASS actual private routing: Gu retains ordinary guidance, Lu receives compact reaction; zero paid calls');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
