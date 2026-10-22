import {build} from 'esbuild';
import postcss from 'postcss';
import tailwind from 'tailwindcss';
import autoprefixer from 'autoprefixer';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {join,resolve,extname,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const root=resolve('release/chat-core-implementation-20261021/preview');mkdirSync(root,{recursive:true});
const full=JSON.parse(readFileSync('release/chat-core-implementation-20261021/live/full-comparison/full-comparison-results-20261022.json','utf8'));
const followup=JSON.parse(readFileSync('release/chat-core-implementation-20261021/live/full-comparison/review-followup-20261022/full-comparison-results-20261022.json','utf8'));
const groups=[{title:'轻聊与人物偏好',caseId:'light',report:full},{title:'情绪与认真决定',caseId:'emotion',report:followup},{title:'改期、暂停与续聊',caseId:'continuity',report:full}].map(({title,caseId,report})=>({title,rows:report.rows.filter(row=>row.variant==='current'&&row.caseId===caseId).map(({input,replies})=>({input,replies}))}));
if(groups.some(group=>group.rows.length!==10))throw Error('Only intact ten-turn groups may be shown');
for(const [title,path,turns] of [
  ['最新家常六轮 · 修复前完整原稿','live/user-casual-final-20261022/result.json',6],
  ['近况来源修复后 · 独立复查','live/user-casual-final-20261022/observation-recheck/result.json',1],
]){
  const report=JSON.parse(readFileSync(join('release/chat-core-implementation-20261021',path),'utf8'));
  if(!report.complete||report.rows.length!==turns||report.rows.some(row=>!row.completed||row.failed))throw Error('Incomplete added recorded group');
  groups.push({title,rows:report.rows.map(({input,replies})=>({input,replies}))});
}
const definitions={'import.meta.env':'{}','import.meta.hot':'undefined',__APP_VERSION__:'"isolated-dialogue-review"',CORE_DIALOGUE_GROUPS:JSON.stringify(groups)};
const built=await build({entryPoints:['scripts/verify/chat-core-dialogue-preview.tsx'],bundle:true,metafile:true,write:false,format:'iife',platform:'browser',jsx:'automatic',loader:{'.png':'dataurl','.webp':'dataurl','.jpg':'dataurl','.svg':'dataurl','.css':'empty'},define:definitions});
const bundle=built.outputFiles[0].text;writeFileSync(join(root,'preview.js'),bundle);
const main=readFileSync('src/main.tsx','utf8'),styles=[...main.matchAll(/import ['"]\.\/(styles\/[^'"]+\.css)['"]/gu)].map(match=>join('src',match[1]));
const sourceCss=styles.map(path=>readFileSync(path,'utf8')).join('\n');
const css=(await postcss([tailwind(),autoprefixer()]).process(sourceCss,{from:resolve('src/styles/preview-joined.css')})).css;
writeFileSync(join(root,'preview.css'),css);
const extra='html,body,#root{margin:0;min-height:100%;width:100%;}body{background:var(--bg,#101323);color:var(--text,#eee);font-family:system-ui,sans-serif}.dialogue-preview{max-width:560px;margin:auto;min-height:100vh}.dialogue-preview header{padding:24px 18px 16px;border-bottom:1px solid var(--border,#30334b)}.dialogue-preview h1{font-size:22px;margin:4px 0 16px}.dialogue-preview header p{font-size:12px;color:var(--text-secondary,#abb);margin:0}.dialogue-preview label{display:flex;align-items:center;gap:12px;font-size:14px}.dialogue-preview select{flex:1;min-width:0;padding:10px;border-radius:12px;background:var(--bg-panel,#242838);color:inherit;border:1px solid var(--border,#444)}.preview-notice{padding:12px 18px;font-size:12px;line-height:1.7;color:var(--text-secondary,#abb)}.dialogue-preview section{padding:8px 14px 22px;display:grid;gap:16px;min-width:0}.dialogue-preview footer{padding:16px 18px;font-size:12px;color:var(--text-secondary,#abb)}';
const html='<!doctype html><html class="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>古月娜 · 完整对话回看</title><link rel="stylesheet" href="/preview.css"><style>'+extra+'.dialogue-preview{height:100dvh;overflow-y:auto;overscroll-behavior:contain}</style></head><body><div id="root"></div><script src="/preview.js"></script></body></html>';
writeFileSync(join(root,'index.html'),html);
const publicRoot=resolve('public');
const server=createServer((req,res)=>{
  const pathname=new URL(req.url,'http://127.0.0.1').pathname;
  if(req.method!=='GET'){res.writeHead(405).end();return;}
  if(pathname==='/'){res.setHeader('Content-Type','text/html;charset=utf-8');res.end(html);return;}
  if(pathname==='/preview.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle);return;}
  if(pathname==='/preview.css'){res.setHeader('Content-Type','text/css');res.end(css);return;}
  const asset=resolve(publicRoot,'.'+decodeURIComponent(pathname));
  if(!asset.startsWith(publicRoot+'/')&&!asset.startsWith(publicRoot+'\\')||!existsSync(asset)){res.writeHead(404).end();return;}
  const mime={'.woff2':'font/woff2','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml'}[extname(asset)];
  if(!mime){res.writeHead(404).end();return;}
  res.setHeader('Content-Type',mime);res.end(readFileSync(asset));
});
await new Promise((accept,reject)=>{server.once('error',reject);server.listen(5396,'127.0.0.1',accept);});
const url='http://127.0.0.1:5396/';
const {chromium}=createRequire(join(dirname(process.execPath),'package.json'))('playwright');
const browser=await chromium.launch({channel:'chrome',headless:true});let external=0;const errors=[],checks=[];
try{
  const context=await browser.newContext({permissions:[],reducedMotion:'reduce'});
  await context.route('**/*',route=>{if(route.request().url().startsWith(url))return route.continue();external++;return route.abort();});
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  for(const width of [320,390,430]){
    await page.setViewportSize({width,height:844});await page.goto(url);await page.getByRole('heading',{name:'古月娜',exact:true}).waitFor();
    for(const index of groups.map((_,index)=>String(index))){
      await page.getByLabel('对话场景',{exact:true}).selectOption(index);
      const layout=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,allText:document.querySelector('section')?.textContent}));
      const ok=!layout.overflow&&layout.allText.includes(groups[Number(index)].rows[0].input)&&layout.allText.includes(groups[Number(index)].rows.at(-1).replies.at(-1));
      checks.push({width,scene:Number(index),ok});
      const lastReply=groups[Number(index)].rows.at(-1).replies.at(-1);
      const last=page.getByText(lastReply,{exact:true}).last();await last.scrollIntoViewIfNeeded();
      checks.push({width,scene:Number(index),kind:'last-turn-reachable',ok:await last.isVisible()&&await last.evaluate(node=>{const box=node.getBoundingClientRect();return box.top>=0&&box.bottom<=innerHeight;})});
      await page.locator('.dialogue-preview').evaluate(node=>{node.scrollTop=0;});
      if(width===390&&index==='1')await page.screenshot({path:join(root,'emotion-390.png'),fullPage:true});
      if(width===390&&index===String(groups.length-1))await page.screenshot({path:join(root,'latest-casual-390.png'),fullPage:true});
    }
  }
}finally{await browser.close();}
const report={url,checks,complete:checks.every(check=>check.ok)&&errors.length===0,errors,externalRequests:external,modelCalls:0,microphoneUsed:false,audioPlayed:false,actualComponents:['src/components/chat/MessageBubble.tsx','src/components/chat/MessageText.tsx'],styles:styles.map(path=>({path,sha256:createHash('sha256').update(readFileSync(path)).digest('hex')})),bundleSha256:createHash('sha256').update(bundle).digest('hex'),scope:'Actual current bubble component and current CSS; intact recorded synthetic-user model conversations. Read-only distinct origin, no application/private database writes, no network API, microphone or audio. Not current live generation or Android.'};
writeFileSync(join(root,'preview-evidence.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({url,complete:report.complete,checks:checks.length,errors,modelCalls:0,microphoneUsed:false}));
if(!report.complete){await new Promise(resolve=>server.close(resolve));process.exitCode=1;}
else if(process.argv.includes('--verify-only'))await new Promise(resolve=>server.close(resolve));
