import {productPreview} from '../preview-product-upgrade.mjs';import {chromium} from 'playwright';import AxeBuilder from '@axe-core/playwright';import fs from 'node:fs';import assert from 'node:assert/strict';
const phase=process.argv.find(x=>x.startsWith('--phase='))?.split('=')[1]||'before',out='.tmp-preview/ui-overhaul-20261016/world-record-journey/'+phase;fs.mkdirSync(out,{recursive:true});
const preview=await productPreview({port:0}),browser=await chromium.launch({channel:'chrome',headless:true}),report={checks:[],errors:[],axe:[],scope:'Actual world entry/canvas/control/story-save/library/source detail components and local repositories. Synthetic stored scene, no model-generated prose or Android.'};const check=(ok,label)=>{assert.ok(ok,label);report.checks.push(label);};
try{for(const theme of ['dark','light'])for(const width of phase==='before'?[390]:[320,390,430]){
 const height=width===320?568:width===430?932:844;
 const context=await browser.newContext({viewport:{width,height},isMobile:true,hasTouch:true,recordVideo:width===390&&theme==='dark'?{dir:out,size:{width,height}}:undefined}),page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));const label=theme+'/'+width;
 await page.goto(preview.address+'/app');await page.evaluate(async theme=>{while(!window.productUpgradeReady)await new Promise(requestAnimationFrame);productUpgradeTest.theme(theme);productUpgradeTest.previewAiConfigured(false);await productUpgradeTest.seedWorldReading();await productUpgradeTest.go('world');},theme);
 await page.getByRole('button',{name:'继续这一幕',exact:true}).click();await page.getByText('但有些话，或许才刚刚开始。',{exact:true}).waitFor();await page.locator('.vg-soul-ghost').waitFor({state:'detached'});
 if(phase==='scope-before'){
  await page.evaluate(async()=>{await productUpgradeTest.pauseWorldRecordScene();productUpgradeTest.worldSettingsOwner('world-record-another-owner');});
  await page.getByText('这一幕暂时无法打开，请重新读取或返回世界。',{exact:true}).waitFor();
  check((await page.evaluate(()=>productUpgradeTest.worldReadingScene())).status==='paused',label+' another owner cannot resume the previous account scene');
  await context.close();continue;
 }
 if(width===390&&phase!=='before'){
  await page.getByRole('button',{name:'世界控制',exact:true}).click();
  await page.evaluate(()=>productUpgradeTest.holdWorldRecordPreparation());
  await page.getByRole('dialog',{name:'世界偏好',exact:true}).getByRole('button',{name:/^写入世界记录/}).click();
  await page.waitForFunction(()=>productUpgradeTest.worldRecordPreparation().entered);
  await page.getByRole('dialog',{name:'世界偏好',exact:true}).getByRole('button',{name:'返回',exact:true}).click();
  check(await page.getByRole('status').filter({hasText:'正在写入世界记录'}).count()===1,label+' closing controls keeps pending local save visible');
  await page.evaluate(()=>productUpgradeTest.holdWorldRecordExit());
  await page.getByRole('button',{name:'离开世界',exact:true}).click();await page.waitForFunction(()=>productUpgradeTest.worldRecordExit().entered);
  await page.evaluate(()=>productUpgradeTest.releaseWorldRecordPreparation());await page.waitForTimeout(100);
  let abandoned=await page.evaluate(()=>productUpgradeTest.worldRecordRows());check(!abandoned.event&&!abandoned.memory,label+' leaving during preparation does not start late save or success notification');
  check((await page.evaluate(()=>productUpgradeTest.snapshot())).navigation.activeView==='canvas',label+' cancelled record stays cancelled while exit pause is still pending');
  await page.evaluate(()=>productUpgradeTest.releaseWorldRecordExit());await page.getByRole('navigation',{name:'世界档案'}).waitFor();
  await page.getByRole('button',{name:'继续这一幕',exact:true}).click();await page.getByText('但有些话，或许才刚刚开始。',{exact:true}).waitFor();
  for(const mode of ['exit','owner']){
   await page.getByRole('button',{name:'世界控制',exact:true}).click();await page.evaluate(mode=>productUpgradeTest.changeWorldRecordScopeDuringWrite(mode),mode);
   await page.getByRole('dialog',{name:'世界偏好',exact:true}).getByRole('button',{name:/^写入世界记录/}).click();
   if(mode==='owner')await page.getByText('这一幕暂时无法打开，请重新读取或返回世界。',{exact:true}).waitFor();
   else await page.getByRole('navigation',{name:'世界档案'}).waitFor();
   const rolledBack=await page.evaluate(()=>productUpgradeTest.worldRecordRows());
   check(!rolledBack.event&&!rolledBack.memory&&rolledBack.knowledge.length===0,label+' '+mode+' during participant write rolls the complete local record back');
   check(await page.getByText('已经写入这个世界：雨后的站台',{exact:true}).count()===0,label+' '+mode+' does not publish a stale save success');
   if(mode==='owner')check(await page.locator('.vg-modal-exit').count()===0,label+' owner change retains no old control snapshot');
   await page.evaluate(async()=>{productUpgradeTest.worldSettingsOwner('stream-test-user');await productUpgradeTest.go('home');await productUpgradeTest.go('world');});
   await page.getByRole('button',{name:'继续这一幕',exact:true}).click();await page.getByText('但有些话，或许才刚刚开始。',{exact:true}).waitFor();
  }
 }
 await page.getByRole('button',{name:'世界控制',exact:true}).click();const controls=page.getByRole('dialog',{name:'世界偏好',exact:true}),save=controls.getByRole('button',{name:/^写入世界记录/});
 await page.evaluate(()=>productUpgradeTest.failWorldRecordOnce());await save.click();await page.waitForTimeout(120);
 await page.screenshot({path:out+'/'+theme+'-'+width+'-failure.png'});
 check(await controls.getByRole('alert').filter({hasText:'记录没有完整写入'}).count()===1,label+' failed write offers visible feedback inside controls');
 check(await controls.getByRole('alert').evaluate(n=>{const r=n.getBoundingClientRect(),s=n.closest('[data-modal-scroll]')?.getBoundingClientRect();return r.top>=Math.max(0,s?.top??0)&&r.bottom<=Math.min(innerHeight,s?.bottom??innerHeight);}),label+' failure feedback is inside actual phone viewport and scroll clip');
 if(width===390){const axe=await new AxeBuilder({page}).analyze();report.axe.push({theme,state:'save-failure',violations:axe.violations,incomplete:axe.incomplete});check(axe.violations.length===0,label+' failed local save passes automatic accessibility scan');}
 let rows=await page.evaluate(()=>productUpgradeTest.worldRecordRows());check(!rows.event&&!rows.memory&&rows.knowledge.length===0,label+' failed memory write leaves no half-saved event or permissions');
 await page.evaluate(()=>productUpgradeTest.failWorldRecordOnce('knowledge'));await save.click();await controls.getByRole('alert').waitFor();await page.waitForTimeout(80);
 rows=await page.evaluate(()=>productUpgradeTest.worldRecordRows());check((await page.evaluate(()=>productUpgradeTest.worldRecordFailure())).calls===2,label+' controlled failure reaches second participant permission');check(!rows.event&&!rows.memory&&rows.knowledge.length===0,label+' late permission failure rolls all record parts back');
 await page.evaluate(()=>productUpgradeTest.holdWorldRecordPreparation());await save.evaluate(n=>{n.click();n.click();});await page.waitForFunction(()=>productUpgradeTest.worldRecordPreparation().entered);
 check(await controls.getByRole('status').filter({hasText:'正在写入世界记录'}).count()===1,label+' pending local save announces real work');
 check((await page.evaluate(()=>productUpgradeTest.worldRecordPreparation())).calls===1,label+' synchronous double click starts only one record write');
 await page.screenshot({path:out+'/'+theme+'-'+width+'-saving.png'});await page.evaluate(()=>productUpgradeTest.releaseWorldRecordPreparation());await controls.waitFor({state:'hidden'});await page.locator('.vg-modal-exit').waitFor({state:'hidden'});
 await page.getByText('这一段已经写入世界记录。',{exact:true}).waitFor();rows=await page.evaluate(()=>productUpgradeTest.worldRecordRows());
 check(rows.event?.memoryIds?.[0]===rows.memory?.id&&rows.knowledge.length===2,label+' success links one event, one saved memory and both participant permissions');
 check(rows.event.visibility==='selected'&&rows.memory.visibility==='selected'&&rows.memory.visibleTo.join(',')==='a,b',label+' saving preserves selected audience');
 await page.getByRole('button',{name:'离开世界',exact:true}).click();await page.getByRole('navigation',{name:'世界档案'}).getByRole('button',{name:'记忆',exact:true}).click();await page.getByRole('heading',{name:'记忆馆',exact:true}).waitFor();
 const row=page.locator('.vg-memory-exhibit-list li').filter({hasText:'雨后的站台'});await row.getByRole('button').click();const detail=page.getByRole('dialog',{name:'记录详情',exact:true});await detail.getByText('来源原文（当前）',{exact:true}).click();
 await detail.getByText('雨声渐渐停了，你们的话还没有说完。',{exact:true}).waitFor();check(true,label+' actual saved record opens current scene source from library');
 await page.evaluate(()=>productUpgradeTest.editWorldNarration('当前来源：雨停之后，站台很安静。'));await detail.getByText('当前来源：雨停之后，站台很安静。',{exact:true}).waitFor();check(await detail.getByText('雨声渐渐停了，你们的话还没有说完。',{exact:true}).count()===0,label+' edited source replaces previous raw passage live');
 await page.screenshot({path:out+'/'+theme+'-'+width+'-source.png'});
 if(width===390){const axe=await new AxeBuilder({page}).analyze();report.axe.push({theme,violations:axe.violations,incomplete:axe.incomplete});check(axe.violations.length===0,label+' current record source passes automatic accessibility scan');}
 await page.evaluate(()=>productUpgradeTest.removeWorldScene());await detail.getByText('原始来源已不可用，可能已删除、撤回或移出当前范围。上方仅保留当前保存的摘要。',{exact:true}).waitFor();check(await detail.getByText('当前来源：雨停之后，站台很安静。',{exact:true}).count()===0,label+' deleted source removes raw passage but retains explicitly saved summary');
 await page.keyboard.press('Escape');await detail.waitFor({state:'hidden'});check(await row.getByRole('button').evaluate(n=>n===document.activeElement),label+' closing source returns focus to saved record');
 check(await page.locator('.vg-memory-exhibit').evaluate(n=>n.scrollWidth<=n.clientWidth+1),label+' narrow library fits viewport');
 const isolation=await page.evaluate(()=>productUpgradeTest.snapshot().isolation);check(Object.values(isolation).every(n=>n===0),label+' no network/model/media attempted');
 if(width===390){
  await page.getByRole('button',{name:'返回世界',exact:true}).click();
  await page.evaluate(async()=>{await productUpgradeTest.go('home');await productUpgradeTest.seedWorldReading();await productUpgradeTest.go('world');});
  await page.getByRole('button',{name:'继续这一幕',exact:true}).click();await page.getByText('但有些话，或许才刚刚开始。',{exact:true}).waitFor();
  await page.evaluate(async()=>{await productUpgradeTest.pauseWorldRecordScene();productUpgradeTest.worldSettingsOwner('world-record-another-owner');});
  await page.getByText('这一幕暂时无法打开，请重新读取或返回世界。',{exact:true}).waitFor();
  check((await page.evaluate(()=>productUpgradeTest.worldReadingScene())).status==='paused',label+' another owner cannot resume previous account scene');
  check(await page.getByText('但有些话，或许才刚刚开始。',{exact:true}).count()===0,label+' rejected scene shows no previous owner passage');
 }
 if(width===390&&theme==='dark')report.video=await page.video().path();await context.close();
 }check(report.errors.length===0,'no browser runtime errors');report.status='pass';
}catch(e){report.status='failed';report.failure=e.stack;for(const context of browser.contexts())for(const page of context.pages()){report.failureDom=await page.locator('body').innerText().catch(()=>undefined);await page.screenshot({path:out+'/failure-last.png'}).catch(()=>{});}process.exitCode=1;}finally{await browser.close();await new Promise(r=>preview.server.close(r));fs.writeFileSync(out+'/result.json',JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,checks:report.checks.length,failure:report.failure}));}
