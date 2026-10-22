import {build} from 'esbuild';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {dirname,join,resolve,extname,sep} from 'node:path';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import assert from 'node:assert/strict';
const {chromium}=createRequire(join(dirname(process.execPath),'package.json'))('playwright');
const output=resolve('.tmp-preview/notices-ui-20261013'),root=resolve('dist/renderer');mkdirSync(output,{recursive:true});
const html=readFileSync(join(root,'index.html'),'utf8'),css=[...html.matchAll(/href="([^" ]+\.css)"/g)].map(m=>m[1]);
const fixture=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
import {useState} from 'react';import {createRoot} from 'react-dom/client';
import {UpdateNotesModal} from './src/components/update/UpdateNotesModal';import {LegalNoticeModal} from './src/components/compliance/LegalNoticeModal';import {UseTimeReminder} from './src/components/compliance/UseTimeReminder';
function Fixture(){const [kind,setKind]=useState('');return <main><button onClick={()=>setKind('update')}>打开公告</button><button onClick={()=>setKind('privacy')}>打开隐私</button><button onClick={()=>setKind('terms')}>打开使用</button><button onClick={()=>{sessionStorage.setItem('virtugene-active-use-ms','7200000');setKind('reminder');}}>打开休息提醒</button>{kind==='update'&&<UpdateNotesModal open onClose={()=>setKind('')} version="6.1.0" notes={['助理与行动舱合并，记录与安排在一起。','改善聊天、群聊与设置界面的层次和交互。',...Array.from({length:12},(_,i)=>'长公告滚动检查 '+i+'：操作仍然清晰，关闭始终可用。')]}/>}<LegalNoticeModal document={kind==='privacy'||kind==='terms'?kind:null} onClose={()=>setKind('')}/>{kind==='reminder'&&<UseTimeReminder/>}</main>};createRoot(document.getElementById('root')).render(<Fixture/>);
`},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',loader:{'.css':'empty'},define:{'import.meta.env':'{}','import.meta.hot':'undefined'}});
const server=createServer((req,res)=>{
 if(req.url==='/fixture.js'){res.setHeader('Content-Type','application/javascript');res.end(fixture.outputFiles[0].text);return;}
 if(req.url.startsWith('/assets/')){const file=resolve(root,'.'+req.url);if(!file.startsWith(root+sep)){res.writeHead(404).end();return;}res.setHeader('Content-Type',extname(file)==='.css'?'text/css':'font/woff2');res.end(readFileSync(file));return;}
 res.setHeader('Content-Type','text/html;charset=utf-8');res.end(`<html><head><meta name="viewport" content="width=device-width,initial-scale=1">${css.map(h=>`<link rel="stylesheet" href="${h}">`).join('')}</head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`);
});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:'chrome',headless:true});const checks=[],errors=[],screenshots=[];
const check=(ok,label,detail)=>{assert.ok(ok,label+': '+JSON.stringify(detail));checks.push({label,detail});console.log('PASS '+label);};
try{
 for(const theme of ['dark','light'])for(const width of [320,390,430]){
 const page=await browser.newPage({viewport:{width,height:568},reducedMotion:'reduce'});page.on('pageerror',e=>errors.push(e.message));await page.clock.install();await page.goto(`http://127.0.0.1:${server.address().port}/?virtugene-preview=mobile`);await page.evaluate(t=>document.documentElement.classList.toggle('dark',t==='dark'),theme);
 for(const [button,title,kind] of [['打开公告','更新说明','update'],['打开隐私','隐私说明','privacy'],['打开使用','使用说明','terms'],['打开休息提醒','弹窗','reminder']]){
  await page.getByRole('button',{name:button,exact:true}).click();if(kind==='reminder')await page.clock.runFor(30001);
  const dialog=page.getByRole('dialog',{name:title,exact:true});await dialog.waitFor();
  const layout=await dialog.evaluate(node=>{const r=node.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,page:node.classList.contains('vg-mobile-page'),small:[...node.querySelectorAll('p,li')].filter(x=>parseFloat(getComputedStyle(x).fontSize)<12).length};});
  check(layout.left>=-1&&layout.right<=width+1&&layout.top>=-1&&layout.bottom<=569,`${theme}-${width}-${kind}短屏不越界`,layout);
  check(layout.small===0,`${theme}-${width}-${kind}说明字号不低于12px`);
  if(kind==='update'){
   check(!layout.page,`${theme}-${width}公告是居中弹窗`);
   const action=dialog.getByRole('button',{name:'知道了',exact:true});const rect=await action.boundingBox();check(rect.height>=44&&rect.y+rect.height<=569,`${theme}-${width}长公告底部操作固定可见`,rect);
   await action.click();
  }else if(kind==='reminder'){const action=dialog.getByRole('button',{name:'我知道了'});check((await action.boundingBox()).height>=44,`${theme}-${width}休息提醒主操作44px`);await action.click();}
  else{const scroll=dialog.locator('[data-modal-scroll]');const bottom=await scroll.evaluate(x=>{x.scrollTop=x.scrollHeight;const last=x.querySelector('section:last-child');const r=x.getBoundingClientRect(),end=last.getBoundingClientRect();return {scrolled:x.scrollTop,overflow:x.scrollHeight>x.clientHeight,endBottom:end.bottom,viewportBottom:r.bottom};});check(bottom.endBottom<=bottom.viewportBottom+1&&(!bottom.overflow||bottom.scrolled>0),`${theme}-${width}-${kind}说明末段可滚动读到`,bottom);await page.keyboard.press('Escape');}
  await dialog.waitFor({state:'hidden'});
  if(kind!=='reminder')check(await page.getByRole('button',{name:button,exact:true}).evaluate(x=>x===document.activeElement),`${theme}-${width}-${kind}关闭恢复入口焦点`);
 }
 await page.getByRole('button',{name:'打开公告',exact:true}).click();await page.getByRole('dialog',{name:'更新说明'}).waitFor();const file=join(output,`${theme}-${width}-announcement.png`);await page.screenshot({path:file});screenshots.push(file);await page.close();
 }
 check(errors.length===0,'页面异常为零',errors);writeFileSync(join(output,'result.json'),JSON.stringify({passed:checks.length,checks,errors,screenshots,productionCss:css,scope:'Real notice/reminder components, production CSS; browser clock advances actual foreground reminder timer; no native device test'},null,2));
}catch(e){writeFileSync(join(output,'failure.json'),JSON.stringify({checks,errors,error:String(e)},null,2));throw e;}finally{await browser.close();await new Promise(r=>server.close(r));}
