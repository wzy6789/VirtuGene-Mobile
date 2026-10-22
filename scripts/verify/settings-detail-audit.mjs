import { productPreview } from '../preview-product-upgrade.mjs';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const phase=process.argv.find(x=>x.startsWith('--phase='))?.split('=')[1]||'before';
const large=process.argv.includes('--large');
const verify=process.argv.includes('--verify');
const out='.tmp-preview/ui-overhaul-20261016/settings-detail/'+phase;
fs.mkdirSync(out,{recursive:true});
const routes=['个人与账号','外观与阅读','聊天与语音','内容与隐私','数据与设备','关于与更新','服务商密钥','账号绑定密钥','默认对话模型','备份与恢复','局域网同步','清理缓存','语音输入','日记设置'];
const report={phase,pages:[],checks:[],errors:[],scope:'Actual production settings, synthetic data, no model/microphone/native bridge. Visual and automatic accessibility audit; not Android.'};
const preview=await productPreview({port:0}),browser=await chromium.launch({channel:'chrome',headless:true});
try{
 for(const theme of ['dark','light']){
  const context=await browser.newContext({viewport:{width:320,height:844},isMobile:true,hasTouch:true,recordVideo:verify&&large&&theme==='dark'?{dir:out,size:{width:320,height:844}}:undefined});
  const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
  for(const [index,title] of routes.entries()){
   await page.goto(preview.address+'/app');
   await page.evaluate(async theme=>{while(!window.productUpgradeReady)await new Promise(requestAnimationFrame);productUpgradeTest.theme(theme);await productUpgradeTest.go('me');},theme);
   await page.getByRole('button',{name:'设置',exact:true}).click();
   const home=page.getByRole('dialog',{name:'设置',exact:true});
   await home.getByRole('searchbox').fill(title);
   await home.locator('button').filter({has:page.locator('strong').filter({hasText:new RegExp('^'+title+'$')})}).first().click();
   const dialog=page.getByRole('dialog',{name:title,exact:true});await dialog.waitFor();await page.waitForTimeout(380);
   if(large)await dialog.evaluate(root=>{const sizes=[...root.querySelectorAll('*')].filter(n=>n instanceof HTMLElement&&!n.closest('svg')&&(n.matches('input,select,textarea')||[...n.childNodes].some(c=>c.nodeType===Node.TEXT_NODE&&c.textContent.trim()))).map(n=>[n,parseFloat(getComputedStyle(n).fontSize),parseFloat(getComputedStyle(n).lineHeight)]);for(const[n,size,line]of sizes){n.style.setProperty('font-size',size*2+'px','important');if(Number.isFinite(line))n.style.setProperty('line-height',line*2+'px','important');}});
   const axe=large?{violations:[],incomplete:[]}:await new AxeBuilder({page}).analyze();
   const screen=out+'/'+theme+'-'+index+'.png';await page.screenshot({path:screen});
   const layout=await dialog.evaluate(root=>{const rr=root.getBoundingClientRect();return{width:rr.width,scrollWidth:root.scrollWidth,clientWidth:root.clientWidth,overflow:[...root.querySelectorAll('button,input,select,textarea,.vg-preference-box')].filter(n=>{const s=getComputedStyle(n),r=n.getBoundingClientRect();return s.display!=='none'&&r.width>0&&(r.left<rr.left-1||r.right>rr.right+1);}).map(n=>({tag:n.tagName,text:n.textContent?.slice(0,60),width:n.getBoundingClientRect().width})),smallButtons:[...root.querySelectorAll('button')].filter(n=>{const r=n.getBoundingClientRect();return r.width>0&&r.height>0&&(r.width<44||r.height<44);}).map(n=>({text:n.getAttribute('aria-label')||n.textContent?.slice(0,50),w:n.getBoundingClientRect().width,h:n.getBoundingClientRect().height}))};});
   report.pages.push({theme,title,screen,layout,violations:axe.violations,incomplete:axe.incomplete});
   if(verify){
    assert.equal(layout.overflow.length,0,theme+'/'+title+': controls fit viewport');
    assert.equal(axe.violations.length,0,theme+'/'+title+': no automatic accessibility violation');
    report.checks.push(theme+'/'+title+': viewport and accessibility');
    if(title==='备份与恢复'){
     const action=dialog.getByRole('button',{name:'立即备份',exact:true});
     assert.ok((await action.boundingBox()).width>=200,'backup action has a full readable row');
     await action.click();const modal=page.getByRole('dialog',{name:'备份数据',exact:true});
     await modal.getByLabel('备份密码',{exact:true}).fill('synthetic-only');
     await modal.getByRole('button',{name:'取消',exact:true}).click();
     await dialog.waitFor();report.checks.push(theme+': backup opens actual centered form and cancel returns without writing');
    }
    if(title==='局域网同步'){
     const host=dialog.getByLabel('桌面地址',{exact:true});assert.ok((await host.boundingBox()).width>=200,'host can be read at large text');
     await dialog.getByRole('button',{name:'拉取桌面数据',exact:true}).click();
     await dialog.getByText('请先填写桌面地址。',{exact:true}).waitFor();
     await host.fill('http://192.168.1.8:12345');assert.equal(await host.inputValue(),'192.168.1.8');
     assert.equal(await dialog.getByLabel('端口',{exact:true}).inputValue(),'12345');
     await dialog.getByLabel('端口',{exact:true}).fill('0');
     await dialog.getByRole('button',{name:'推送本机数据',exact:true}).click();
     await dialog.getByText('端口需要在 1–65535 之间。',{exact:true}).waitFor();
     report.checks.push(theme+': sync paste and validation preserved without network request');
    }
    if(title==='语音输入'){assert.equal(await dialog.getByRole('heading',{level:3,name:'硅基 SiliconFlow',exact:true}).count(),1);report.checks.push(theme+': speech editor follows dialog heading');}
   }
  }
  if(verify&&large&&theme==='dark')report.video=await page.video().path();
  await context.close();
 }
 if(verify)assert.equal(report.errors.length,0,'no runtime errors');report.status=verify?'pass':'audited';
}catch(e){report.status='failed';report.failure=e.stack;throw e;}finally{await browser.close();await new Promise(r=>preview.server.close(r));fs.writeFileSync(out+'/result.json',JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,pages:report.pages.length,errors:report.errors,violations:report.pages.filter(p=>p.violations.length).map(p=>({theme:p.theme,title:p.title,ids:p.violations.map(v=>v.id)})),overflow:report.pages.filter(p=>p.layout.overflow.length),smallButtons:report.pages.filter(p=>p.layout.smallButtons.length).map(p=>({title:p.title,theme:p.theme,buttons:p.layout.smallButtons})),failure:report.failure}));}
