import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {dirname,join,basename} from 'node:path';
import {createServer} from 'node:http';
import {readFileSync,readdirSync,mkdirSync,writeFileSync} from 'node:fs';
const {chromium}=createRequire(join(dirname(process.execPath),'package.json'))('playwright');
const bundle=await build({entryPoints:['scripts/verify/character-delete-ui.tsx'],bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',loader:{'.png':'dataurl','.webp':'dataurl','.css':'empty'},define:{'import.meta.env':'{}','import.meta.hot':'undefined',__APP_VERSION__:'"test"'}});
const assets='dist/renderer/assets',css=readdirSync(assets).filter(f=>f.endsWith('.css')).map(f=>`<link rel="stylesheet" href="/assets/${f}">`).join('');
const server=createServer((req,res)=>{if(req.url==='/test.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].text);}else if(req.url.startsWith('/assets/')){res.end(readFileSync(join(assets,basename(req.url))));}else{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(`<!doctype html><html class="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1">${css}<style>html,body,#app{height:100%;margin:0;background:var(--bg);color:var(--text)}</style></head><body><div id="app" class="mobile-layout"></div><script src="/test.js"></script></body></html>`);}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const browser=await chromium.launch({channel:'chrome',headless:true});
let checks=0;const check=(ok,label)=>{if(!ok)throw Error(label);checks++;console.log('ok '+label);};
try{
  const page=await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>!!window.characterDeleteUI);
  for(const mobile of [true,false]) {
    await page.evaluate(mobile=>window.characterDeleteUI.setup(mobile),mobile);
    if(mobile){await page.getByRole('button',{name:'管理删除压力测试角色',exact:true}).click();await page.getByRole('button',{name:'删除角色',exact:true}).click();}
    else {await page.getByText('删除压力测试角色',{exact:true}).click({button:'right'});await page.getByRole('button',{name:'删除角色',exact:true}).click();}
    await page.getByRole('button',{name:'确认删除',exact:true}).waitFor();
    await page.evaluate(()=>{
      window.deleteFrames=0;window.deleteMaxGap=0;window.deleteLast=performance.now();window.deleteActive=true;
      const step=time=>{window.deleteFrames++;window.deleteMaxGap=Math.max(window.deleteMaxGap,time-window.deleteLast);window.deleteLast=time;if(window.deleteActive)requestAnimationFrame(step);};requestAnimationFrame(step);
    });
    await page.getByRole('button',{name:'确认删除',exact:true}).click();
    const busy=page.getByRole('button',{name:'正在删除…',exact:true});await busy.waitFor();
    check(await busy.isDisabled()&&await page.getByRole('button',{name:'取消',exact:true}).isDisabled(),`${mobile?'mobile':'desktop'} blocks repeated confirmation and cancellation while committing`);
    check(await page.getByRole('status').filter({hasText:'正在清理聊天与关联记录'}).count()===1,`${mobile?'mobile':'desktop'} announces real deletion progress`);
    await page.keyboard.press('Escape');
    await busy.waitFor({state:'hidden'});
    check(await page.evaluate(()=>{window.deleteActive=false;return window.deleteFrames>5;}),`${mobile?'mobile':'desktop'} continues animation frames during actual 10,000-message UI deletion`);
    check(await page.evaluate(()=>window.characterDeleteUI.remaining())===0,`${mobile?'mobile':'desktop'} deletes all history and closes confirmation`);
    check(await page.locator('.vg-delete-confirmation').count()===0,`${mobile?'mobile':'desktop'} confirmation closes after the commit`);
  }
  check(await page.evaluate(()=>window.characterDeleteUI.network())===0&&errors.length===0,'no external network or unhandled UI errors');
  const out='.tmp-preview/character-delete';mkdirSync(out,{recursive:true});writeFileSync(`${out}/ui-result.json`,JSON.stringify({checks,status:'PASS',paidCalls:0},null,2)+'\n');console.log(`PASS character-delete-ui: ${checks} checks`);
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
