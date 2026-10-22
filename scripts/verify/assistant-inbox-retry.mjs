import {productPreview} from '../preview-product-upgrade.mjs';
import {chromium} from 'playwright';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const phase=process.argv.find(x=>x.startsWith('--phase='))?.split('=')[1]||'before';
const out='.tmp-preview/ui-overhaul-20261016/assistant-inbox/'+phase;fs.mkdirSync(out,{recursive:true});
const report={checks:[],errors:[],scope:'Actual SecretaryInboxModal embedded and modal; synthetic owned source and task; controlled table read failure; no model/media/native use.'};
const preview=await productPreview({port:0}),browser=await chromium.launch({channel:'chrome',headless:true});let activePage;
try{
 for(const theme of ['dark','light'])for(const embedded of [true,false]){
  const context=await browser.newContext({viewport:{width:320,height:844},isMobile:true,hasTouch:true}),page=await context.newPage();activePage=page;page.on('pageerror',e=>report.errors.push(e.message));
  const check=(ok,label)=>{assert.ok(ok,theme+'/'+embedded+': '+label);report.checks.push(theme+'/'+embedded+': '+label);};
  await page.goto(preview.address+'/app');await page.evaluate(async({theme,embedded})=>{while(!window.productUpgradeReady)await new Promise(requestAnimationFrame);productUpgradeTest.theme(theme);await productUpgradeTest.openInboxReadFixture(embedded);},{theme,embedded});
  await page.getByRole('alert').filter({hasText:'办事记录读取失败'}).waitFor();await page.waitForTimeout(300);await page.screenshot({path:out+'/'+theme+'-'+embedded+'-failure.png'});
  check(await page.getByRole('button',{name:'重新读取办事记录',exact:true}).count()===1,'failure offers an actionable inline retry');
  check(!(await page.locator('.vg-secretary-inbox').innerText()).includes('0 条请求'),'failure does not claim zero requests');
  check(await page.getByText('事情都理顺了',{exact:true}).count()===0,'failed read is not a completed empty state');
  await page.getByRole('button',{name:'未办成（暂未读取）',exact:true}).click();
  await page.evaluate(()=>productUpgradeTest.allowInboxRead());await page.getByRole('button',{name:'重新读取办事记录',exact:true}).click();
  await page.getByText('核对明天的安排',{exact:true}).waitFor();check(true,'retry retrieves actual owned task without closing');
  check(await page.getByRole('alert').count()===0,'successful retry clears failure');
  check(await page.getByRole('button',{name:'未办成（1）',exact:true}).getAttribute('aria-pressed')==='true','retry preserves selected category');
  check(await page.getByText('1 条请求',{exact:true}).count()===1,'successful read displays real count');
  const isolation=await page.evaluate(()=>productUpgradeTest.snapshot().isolation);check(Object.values(isolation).every(n=>n===0),'no model or media calls');
  await page.screenshot({path:out+'/'+theme+'-'+embedded+'-ready.png'});
  if(!embedded){
   await page.evaluate(()=>productUpgradeTest.closeInboxReadFixture());await page.locator('[role="dialog"]').waitFor({state:'hidden'});await page.waitForTimeout(350);
   await page.evaluate(()=>productUpgradeTest.revokeAndReopenInbox());await page.getByRole('alert').filter({hasText:'办事记录读取失败'}).waitFor();
   check(await page.evaluate(()=>window.__inboxRenderSamples.every(text=>!text.includes('核对明天的安排'))),'reopen does not flash a previously authorized but now deleted source');
   check(await page.getByText('核对明天的安排',{exact:true}).count()===0,'failed reopen shows no cached original request');
  }
  await context.close();
 }
 assert.equal(report.errors.length,0);report.status='pass';
}catch(e){report.status='failed';report.failure=e.stack;report.dom=await activePage?.evaluate(()=>({text:document.body.innerText,read:window.__inboxReadFixture}));await activePage?.screenshot({path:out+'/failure.png'});process.exitCode=1;}finally{await browser.close();await new Promise(r=>preview.server.close(r));fs.writeFileSync(out+'/result.json',JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,checks:report.checks.length,failure:report.failure,dom:report.dom}));}
