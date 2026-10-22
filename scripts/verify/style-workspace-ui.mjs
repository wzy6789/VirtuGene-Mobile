import {build} from 'esbuild';
import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import {createServer} from 'node:http';
import {readFileSync,readdirSync,mkdirSync,writeFileSync} from 'node:fs';
import {basename} from 'node:path';
import assert from 'node:assert/strict';
const out='.tmp-preview/ui-overhaul-20261015/style-workspace';mkdirSync(out,{recursive:true});
const bundle=await build({entryPoints:['scripts/verify/chat-background-complete.tsx'],bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',loader:{'.png':'dataurl','.webp':'dataurl','.css':'empty'},define:{'import.meta.env':'{"DEV":true}','import.meta.hot':'undefined',__APP_VERSION__:'"test"'}});
const assets='dist/renderer/assets',css=readdirSync(assets).filter(f=>f.endsWith('.css'));
const server=createServer((req,res)=>{if(req.url==='/fixture.js'){res.setHeader('Content-Type','application/javascript');res.end(bundle.outputFiles[0].text);}else if(req.url.startsWith('/assets/')){try{res.end(readFileSync(`${assets}/${basename(req.url)}`));}catch{res.writeHead(404).end();}}else{res.setHeader('Content-Type','text/html;charset=utf-8');res.end(`<!doctype html><html lang="zh-CN" class="dark"><head><title>造型间隔离检查</title><meta name="viewport" content="width=device-width,initial-scale=1">${css.map(f=>`<link rel="stylesheet" href="/assets/${f}">`).join('')}<style>html,body,#app{height:100%;margin:0;background:var(--bg);color:var(--text)}</style></head><body><main id="app" class="mobile-layout"></main><script src="/fixture.js"></script></body></html>`);}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true}),page=await context.newPage();
const report={checks:[],errors:[],axe:[],external:[],screenshots:[],actualModelCalls:0,microphoneCalls:0,limitations:['Desktop browser simulation, not Android.','No paid model/voice service calls.','No same-condition before capture for the full workspace.']};
page.on('pageerror',e=>report.errors.push(e.message));
await page.route('**/*',route=>{const url=route.request().url();if(/^https?:/.test(url)&&!url.startsWith('http://127.0.0.1:')){report.external.push(new URL(url).origin);return route.abort();}return route.continue();});
const api=(name,...args)=>page.evaluate(({name,args})=>backgroundTest[name](...args),{name,args});
const check=(condition,name)=>{assert.ok(condition,name);report.checks.push(name);};
const editor=()=>page.getByRole('dialog',{name:'角色造型间',exact:true});
const tab=name=>editor().getByRole('button',{name,exact:true});
async function previewMode(mode){const summary=editor().locator('summary').filter({hasText:'预览选项'});await summary.click();await tab(mode==='dark'?'深色':'浅色').click();await summary.click();}
async function open(){await page.getByRole('button',{name:'聊天设置',exact:true}).click();await page.getByRole('dialog',{name:'聊天设置',exact:true}).getByRole('button',{name:/角色造型间/}).click();await editor().waitFor();await page.waitForFunction(()=>!document.querySelector('.vg-style-workspace .vg-modal-footer button:last-child').disabled);}
async function closeSettings(){await page.getByRole('dialog',{name:'聊天设置',exact:true}).getByRole('button',{name:'返回',exact:true}).click();}
async function shot(name){await page.screenshot({path:`${out}/${name}.png`});report.screenshots.push(`${out}/${name}.png`);}
try{
 await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>window.backgroundTest);await api('setup');await open();
 const initialMessages=await api('messageCount');
 const originalAvatar=(await api('roleRecord')).avatar;
 check(await editor().locator('.vg-modal-footer').getByRole('button',{name:'保存外观',exact:true}).count()===1,'one fixed save action outside the scrolling control panel');
 for(const width of [320,390,430])for(const mode of ['dark','light']){
   await page.setViewportSize({width,height:844});await api('theme',mode);await previewMode(mode);await tab('素材').click();
   await editor().locator('[data-modal-scroll]').evaluate(n=>n.scrollTop=0);await page.waitForTimeout(160);await shot(`materials-${mode}-${width}`);
   check(await editor().evaluate(n=>n.scrollWidth<=n.clientWidth+1),`${width}/${mode}: no horizontal overflow`);
   check(await editor().getByRole('button',{name:'保存外观',exact:true}).evaluate(n=>{const r=n.getBoundingClientRect();return r.width>=44&&r.height>=44&&r.bottom<=innerHeight+1;}),`${width}/${mode}: fixed save remains reachable`);
 }
 await page.setViewportSize({width:390,height:844});await api('theme','dark');await previewMode('dark');
 const file=Buffer.from(await api('file','noise'));
 await editor().getByLabel('上传角色头像').setInputFiles({name:'avatar.png',mimeType:'image/png',buffer:file});
 await editor().getByRole('slider',{name:'头像纵向',exact:true}).waitFor();await page.waitForFunction(()=>!document.querySelector('.vg-style-workspace .vg-modal-footer button:last-child').disabled);
 const previewAvatar=()=>editor().locator('.vg-background-preview header img').getAttribute('src');
 const oldAvatar=await previewAvatar();
 await editor().getByRole('slider',{name:'头像纵向',exact:true}).fill('0.7');
 await page.waitForFunction(before=>document.querySelector('.vg-style-workspace .vg-background-preview header img')?.getAttribute('src')!==before,oldAvatar);
 check((await previewAvatar()).startsWith('data:image/jpeg;base64,'),'uploaded and cropped avatar is decoded and rendered in actual preview');
 check(!(await api('rows')).roleRow,'avatar and crop remain draft before save');
 await page.evaluate(()=>{window.releaseStyleBitmap=undefined;const original=window.createImageBitmap;let armed=true;window.createImageBitmap=async(...args)=>{if(armed&&args[0] instanceof Blob&&args[0].type==='image/jpeg'){armed=false;await new Promise(resolve=>window.releaseStyleBitmap=resolve);}return original(...args);};});
 await editor().getByRole('slider',{name:'头像纵向',exact:true}).fill('0.9');await page.waitForFunction(()=>!!window.releaseStyleBitmap);
 await tab('小球').click();await editor().getByRole('radio',{name:'薄荷',exact:true}).click();await editor().getByRole('radio',{name:'活泼',exact:true}).click();
 await page.evaluate(()=>releaseStyleBitmap());await page.waitForFunction(()=>!document.querySelector('.vg-style-workspace .vg-modal-footer button:last-child').disabled);
 check(await editor().locator('[data-soul-orb-host]').getAttribute('data-orb-intensity')==='lively','draft orb motion uses actual production engine');
 check(await editor().locator('[data-soul-orb-host]').evaluate(n=>n.style.getPropertyValue('--orb-body'))==='#57bda2','draft orb palette reaches actual orb renderer');
 await api('reduced',true);await page.waitForFunction(()=>document.querySelector('.vg-style-workspace [data-soul-orb-host]')?.getAttribute('data-orb-motion')==='paused');check(true,'global reduced motion overrides lively role preview');await api('reduced',false);
 check(true,'late avatar crop preserves newer orb palette and motion choices');
 await tab('色彩').click();await editor().getByRole('button',{name:'背景主题：暖杏',exact:true}).click();
 await shot('colors-dark-390');
 await api('failSave');await editor().getByRole('button',{name:'保存外观',exact:true}).click();await editor().getByRole('alert').waitFor();
 check(!(await api('rows')).roleRow,'failed visual save leaves prior setting untouched');
 check(await editor().locator('.vg-background-preview header img').count()===1,'failed save retains avatar draft and preview');
 await editor().getByRole('button',{name:'保存外观',exact:true}).dblclick();await editor().waitFor({state:'hidden'});
 const saved=(await api('rows')).roleRow;check(saved.revision===1&&saved.config.themeId==='warm'&&saved.config.roleVisual.orbColor==='mint'&&saved.config.roleVisual.orbMotion==='lively'&&!!saved.config.roleVisual.avatar.image,'single atomic save contains avatar, palette, motion and background');
 await closeSettings();
 check(await page.locator('.chat-header .vg-chat-identity-avatar').getAttribute('src')===saved.config.roleVisual.avatar.image,'saved avatar reaches real chat header');
 check(await page.locator('.chat-header [data-soul-orb-host]').getAttribute('data-orb-intensity')==='lively','saved orb motion reaches real chat header');
 check(await api('messageCount')===initialMessages,'visual edits and preview produce no persisted messages');
 check((await api('roleRecord')).avatar===originalAvatar,'local avatar override leaves original persona record untouched');
 await api('reload');check((await api('rows')).roleRow.config.roleVisual.avatar.image===saved.config.roleVisual.avatar.image,'role visuals persist after repository reload');
 await api('save',{roleVisual:saved.config.roleVisual},'','fixed');check(!(await api('rows')).global.config.roleVisual,'global default rejects role avatar and orb overrides');
 await page.evaluate(()=>chatStreamTest.switchTo('b'));await page.waitForFunction(()=>document.querySelector('.chat-header [data-soul-orb-host]')?.getAttribute('data-orb-intensity')==='gentle');
 check(await page.locator('.chat-header .vg-chat-identity-avatar').getAttribute('src')!==saved.config.roleVisual.avatar.image,'another role keeps its own avatar and global orb motion');
 await page.evaluate(()=>chatStreamTest.switchTo('a'));await page.waitForFunction(src=>document.querySelector('.chat-header .vg-chat-identity-avatar')?.getAttribute('src')===src,saved.config.roleVisual.avatar.image);
 await open();await editor().getByRole('button',{name:'恢复默认',exact:true}).click();
 check((await api('rows')).roleRow.revision===1,'reset changes only the draft');
 await editor().getByRole('button',{name:'关闭造型间',exact:true}).click();await page.getByRole('button',{name:'放弃修改',exact:true}).click();await closeSettings();
 check((await api('rows')).roleRow.config.roleVisual.orbColor==='mint','cancelled reset keeps saved role override');
 await open();await tab('小球').click();await editor().getByRole('radio',{name:'冰蓝',exact:true}).click();await api('save',{themeId:'calm'},'a');await editor().getByRole('button',{name:'保存外观',exact:true}).click();
 await editor().getByRole('alert').filter({hasText:/其他窗口/}).waitFor();check((await api('rows')).roleRow.config.roleVisual.orbColor==='mint','concurrent change blocks overwrite and retains draft for review');
 await editor().getByRole('button',{name:'关闭造型间',exact:true}).click();await page.getByRole('button',{name:'放弃修改',exact:true}).click();await closeSettings();
 await open();await editor().getByRole('button',{name:'恢复默认',exact:true}).click();await editor().getByRole('button',{name:'保存外观',exact:true}).click();await editor().waitFor({state:'hidden'});await closeSettings();
 check(!(await api('rows')).roleRow,'saving reset removes only the independent role appearance');
 await open();for(const mode of ['dark','light']){await api('theme',mode);const axe=await new AxeBuilder({page}).include('.vg-style-workspace').analyze();report.axe.push({mode,violations:axe.violations,incomplete:axe.incomplete});check(axe.violations.length===0,`workspace ${mode}: axe has no violations`);}
 await api('account','another-account');await editor().waitFor({state:'hidden'});check(true,'owner change removes private workspace');
 await api('setup');await open();await api('deleteRole');await editor().waitFor({state:'hidden'});check(true,'deleting the source role removes its private workspace');
 check(report.errors.length===0&&report.external.length===0,'no uncaught errors or external network requests');report.status='pass';
}catch(error){report.status='failed';report.failure=error.stack;throw error;}finally{writeFileSync(`${out}/result.json`,JSON.stringify(report,null,2));await browser.close();await new Promise(resolve=>server.close(resolve));console.log(JSON.stringify({status:report.status,checks:report.checks.length,failure:report.failure}));}
