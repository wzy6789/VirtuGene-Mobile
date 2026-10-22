import {productPreview} from '../preview-product-upgrade.mjs';
import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const phase=process.argv.find(x=>x.startsWith('--phase='))?.split('=')[1]||'before';
const out=process.env.VG_WORLD_SETTINGS_OUT||'.tmp-preview/ui-overhaul-20261016/world-settings/'+phase;fs.mkdirSync(out,{recursive:true});
const preview=await productPreview({port:0,production:true,output:out+'/server'}),browser=await chromium.launch({channel:'chrome',headless:true});
const report={checks:[],errors:[],axe:[],scope:'Real WorldSettingsPage, local owner-scoped repositories and controlled read/write failure or delay. Desktop Chrome only; no real model, microphone or Android.'};
const check=(ok,label)=>{assert.ok(ok,label);report.checks.push(label);};
try{
 for(const theme of ['dark','light'])for(const width of phase==='before'?[320]:[320,390,430]){
  const context=await browser.newContext({viewport:{width,height:844},isMobile:true,hasTouch:true,recordVideo:width===390&&theme==='dark'?{dir:out,size:{width,height:844}}:undefined}),page=await context.newPage();
  page.on('pageerror',e=>report.errors.push(e.message));const label=theme+'/'+width;
  const setup=async()=>{await page.goto(preview.address+'/app');await page.evaluate(async theme=>{while(!window.productUpgradeReady)await new Promise(requestAnimationFrame);productUpgradeTest.theme(theme);await productUpgradeTest.worldSettingsFixture();},theme);};
  await setup();await page.evaluate(()=>{productUpgradeTest.controlWorldSettings('listByWorld','fail');productUpgradeTest.openWorldSettings();});
  await page.waitForFunction(()=>productUpgradeTest.worldSettingsControl().entered);await page.waitForTimeout(320);
  await page.screenshot({path:out+'/'+theme+'-'+width+'-read-failure.png'});
  check(await page.getByRole('alert').filter({hasText:'世界设定读取失败'}).count()===1,label+' initial failure offers feedback instead of infinite loading');
  check(await page.getByText('还没有任何设定。',{exact:false}).count()===0,label+' read failure is not presented as empty data');
  await page.getByRole('button',{name:'重新读取世界设定'}).click();await page.getByText('这里一直是秋天。',{exact:true}).waitFor();
  check(true,label+' retry restores actual settings');
  if(phase==='paper'){
   check(await page.locator('.vg-settings-world.vg-light-paper').count()===1,label+' approved local paper palette');
   check(await page.getByRole('textbox',{name:'新的世界设定'}).evaluate(el=>parseFloat(getComputedStyle(el).fontSize)>=16),label+' readable16px composer');
   check(await page.getByRole('heading',{name:'新增设定',exact:true}).count()===1,label+' clear creation heading');
   await page.screenshot({path:out+'/'+theme+'-'+width+'-paper.png'});
   await page.getByRole('button',{name:'编辑',exact:true}).click();await page.getByRole('textbox',{name:'编辑世界设定'}).fill('取消后不应该保存的内容');await page.getByRole('button',{name:'取消',exact:true}).click();
   check(!(await page.evaluate(()=>productUpgradeTest.worldSettingRows())).some(row=>row.content==='取消后不应该保存的内容'),label+' cancel editor never writes draft');
   await page.getByRole('button',{name:'删除',exact:true}).click();const confirm=page.getByRole('dialog',{name:'删除长期设定？',exact:true});check(await confirm.getByText('这里一直是秋天。',{exact:true}).isVisible(),label+' delete confirmation identifies actual setting');await confirm.getByRole('button',{name:'保留设定',exact:true}).click();await confirm.waitFor({state:'hidden'});check((await page.evaluate(()=>productUpgradeTest.worldSettingRows())).some(row=>row.content==='这里一直是秋天。'),label+' cancel deletion retains actual record');
   if(width===320){const input=page.getByRole('textbox',{name:'新的世界设定'});await input.focus();await page.setViewportSize({width,height:420});await input.scrollIntoViewIfNeeded();const bounds=await input.boundingBox();check(bounds.y>=0&&bounds.y+bounds.height<=420,label+' composer remains visible with shortened viewport');await page.screenshot({path:out+'/'+theme+'-320-short-input.png'});await page.setViewportSize({width,height:844});}
  }
  if(phase==='focus-red'){
   await page.getByRole('button',{name:'编辑',exact:true}).click();await page.getByRole('textbox',{name:'编辑世界设定'}).fill('编辑后的秋天。');
   await page.evaluate(()=>productUpgradeTest.controlWorldSettings('listByWorld','hold'));await page.getByRole('button',{name:'保存',exact:true}).click();
   await page.waitForFunction(()=>productUpgradeTest.worldSettingsControl().entered);await page.waitForTimeout(80);
   await page.evaluate(()=>productUpgradeTest.releaseWorldSettings());await page.getByRole('button',{name:'编辑',exact:true}).waitFor();await page.waitForTimeout(80);
   check(await page.getByRole('button',{name:'编辑',exact:true}).evaluate(n=>n===document.activeElement),label+' edited card regains focus after delayed refresh');
   await context.close();continue;
  }
  const input=page.getByRole('textbox',{name:'新的世界设定'});await input.fill('这里永远是晴天。');
  await page.evaluate(()=>productUpgradeTest.controlWorldSettings('upsert','fail'));await page.getByRole('button',{name:'记下来',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'未能保存设定'}).waitFor();check(await input.inputValue()==='这里永远是晴天。',label+' failed creation retains typed draft');
  await page.getByRole('button',{name:'记下来',exact:true}).click();await page.getByText('这里永远是晴天。',{exact:true}).waitFor();check(await input.inputValue()==='',label+' successful creation clears draft');
  const card=page.locator('.vg-setting-card').filter({hasText:'这里一直是秋天。'});
  await card.getByRole('button',{name:'编辑',exact:true}).click();const edit=page.getByRole('textbox',{name:'编辑世界设定'});await edit.fill('这里的秋天很漫长。');
  await page.evaluate(()=>productUpgradeTest.controlWorldSettings('update','fail'));await page.locator('.vg-setting-card').filter({has:edit}).getByRole('button',{name:'保存',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'未能保存修改'}).waitFor();check(await edit.inputValue()==='这里的秋天很漫长。',label+' edit failure keeps editor and text');
  await page.locator('.vg-setting-card').filter({has:edit}).getByRole('button',{name:'保存',exact:true}).click();await page.getByText('这里的秋天很漫长。',{exact:true}).waitFor();
  const revised=page.locator('.vg-setting-card').filter({hasText:'这里的秋天很漫长。'});
  await revised.getByRole('button',{name:'编辑',exact:true}).click();
  await page.evaluate(()=>productUpgradeTest.controlWorldSettings('listByWorld','hold'));await page.getByRole('button',{name:'保存',exact:true}).click();
  await page.waitForFunction(()=>productUpgradeTest.worldSettingsControl().entered);await page.waitForTimeout(80);
  await page.evaluate(()=>productUpgradeTest.releaseWorldSettings());await revised.getByRole('button',{name:'编辑',exact:true}).waitFor();await page.waitForTimeout(80);
  check(await revised.getByRole('button',{name:'编辑',exact:true}).evaluate(n=>n===document.activeElement),label+' edit focus restored after delayed list refresh');
  await page.evaluate(()=>productUpgradeTest.controlWorldSettings('setActive','hold'));await revised.getByRole('button',{name:'暂停',exact:true}).click();await page.waitForFunction(()=>productUpgradeTest.worldSettingsControl().entered);
  check(await revised.getByRole('button',{name:'暂停',exact:true}).isDisabled(),label+' pending operation disables duplicate changes');
  check((await page.evaluate(()=>productUpgradeTest.worldSettingsControl())).calls===1,label+' one pause write starts');
  await page.evaluate(()=>productUpgradeTest.releaseWorldSettings());await revised.getByRole('button',{name:'恢复',exact:true}).waitFor();
  await revised.getByRole('button',{name:'删除',exact:true}).click();const dialog=page.getByRole('dialog',{name:'删除长期设定？'});
  await page.evaluate(()=>productUpgradeTest.controlWorldSettings('remove','fail'));await dialog.getByRole('button',{name:'删除设定',exact:true}).click();
  await dialog.getByRole('alert').filter({hasText:'未能删除设定'}).waitFor();check(await dialog.isVisible(),label+' failed deletion keeps confirmation and retry');
  if(width===390){await page.waitForTimeout(220);await page.screenshot({path:out+'/'+theme+'-delete-failure.png'});}
  await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});check(await revised.getByRole('button',{name:'删除',exact:true}).evaluate(n=>n===document.activeElement),label+' escape restores delete trigger focus');
  await revised.getByRole('button',{name:'删除',exact:true}).click();await page.evaluate(()=>productUpgradeTest.controlWorldSettings('remove','hold'));await page.getByRole('dialog').getByRole('button',{name:'删除设定',exact:true}).click();
  await page.waitForFunction(()=>productUpgradeTest.worldSettingsControl().entered);await page.keyboard.press('Escape');check(await page.getByRole('dialog').isVisible(),label+' pending delete cannot dismiss feedback or submit again');
  await page.evaluate(()=>productUpgradeTest.releaseWorldSettings());await revised.getByText('这里的秋天很漫长。',{exact:true}).waitFor({state:'hidden'});
  check(!(await page.evaluate(()=>productUpgradeTest.worldSettingRows())).some(f=>f.content==='这里的秋天很漫长。'),label+' confirmed deletion removes actual record');
  await page.locator('.vg-modal-exit').waitFor({state:'hidden'});await page.screenshot({path:out+'/'+theme+'-'+width+'-ready.png'});
  check(await page.locator('.vg-settings-world').evaluate(n=>n.scrollWidth<=n.clientWidth+1),label+' settings fit viewport');
  check(await page.locator('.vg-settings-world button').evaluateAll(nodes=>nodes.filter(n=>n.getClientRects().length).every(n=>n.getBoundingClientRect().height>=44)),label+' visible controls retain 44px targets');
  if(width===320){const a=await new AxeBuilder({page}).analyze();report.axe.push({theme,violations:a.violations,incomplete:a.incomplete});check(a.violations.length===0,label+' automatic accessibility scan');}
  await page.locator('.vg-setting-card').filter({hasText:'这里永远是晴天。'}).getByRole('button',{name:'编辑',exact:true}).click();await page.getByRole('textbox',{name:'编辑世界设定'}).fill('这里的湖水很平静。');await page.evaluate(()=>productUpgradeTest.controlWorldSettings('listByWorld','fail'));await page.getByRole('button',{name:'保存',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'世界设定读取失败'}).waitFor();
  check(await page.getByRole('textbox',{name:'编辑世界设定'}).count()===0&&(await page.evaluate(()=>productUpgradeTest.worldSettingRows())).some(f=>f.content==='这里的湖水很平静。'),label+' successful write is not reported as failed when list refresh fails');
  check(await page.getByRole('alert').filter({hasText:'未能保存修改'}).count()===0,label+' refresh error is distinct from mutation error');
  await page.getByRole('button',{name:'重新读取世界设定'}).click();await page.getByText('这里的湖水很平静。',{exact:true}).waitFor();
  if(width===390){
   await setup();await page.evaluate(()=>{productUpgradeTest.controlWorldSettings('listByWorld','hold');productUpgradeTest.openWorldSettings();});
   await page.waitForFunction(()=>productUpgradeTest.worldSettingsControl().entered);
   const samples=await page.evaluate(async()=>{productUpgradeTest.worldSettingsOwner('world-settings-other');const seen=[];for(let i=0;i<8;i++){await new Promise(requestAnimationFrame);seen.push(document.querySelector('.vg-settings-world')?.textContent??'');}return seen;});await page.getByText('另一账号的春天。',{exact:true}).waitFor();
   check(samples.every(text=>!text.includes('这里一直是秋天。')),label+' owner change never paints old cards in sampled next frames');
   await page.evaluate(()=>productUpgradeTest.releaseWorldSettings());await page.waitForTimeout(100);
   check(await page.getByText('另一账号的春天。',{exact:true}).count()===1&&await page.getByText('这里一直是秋天。',{exact:true}).count()===0,label+' late old-owner read cannot overwrite new cards');
   await setup();await page.evaluate(()=>productUpgradeTest.openWorldSettings());await page.getByText('这里一直是秋天。',{exact:true}).waitFor();
   await input.fill('这里必须种满银杏。');await page.evaluate(()=>productUpgradeTest.controlWorldSettings('ensureDefaultWorld','hold'));await page.getByRole('button',{name:'记下来',exact:true}).click();
   await page.waitForFunction(()=>productUpgradeTest.worldSettingsControl().entered);await page.evaluate(()=>productUpgradeTest.worldSettingsOwner('world-settings-other'));await page.getByText('另一账号的春天。',{exact:true}).waitFor();
   await page.evaluate(()=>productUpgradeTest.releaseWorldSettings());await page.waitForTimeout(100);
   check(!(await page.evaluate(()=>productUpgradeTest.worldSettingRows())).some(f=>f.content==='这里必须种满银杏。'),label+' account change before interpretation prevents late write from starting');
   check(await input.inputValue()==='',label+' old-owner input and busy state are discarded');
   await input.fill('这里有一条小溪。');await page.evaluate(()=>productUpgradeTest.controlWorldSettings('upsert','hold'));
   await page.getByRole('button',{name:'记下来',exact:true}).evaluate(n=>{n.click();n.click();});await page.waitForFunction(()=>productUpgradeTest.worldSettingsControl().entered);
   check((await page.evaluate(()=>productUpgradeTest.worldSettingsControl())).calls===1,label+' synchronous double click starts only one write');
   await page.evaluate(()=>productUpgradeTest.releaseWorldSettings());await page.getByText('这里有一条小溪。',{exact:true}).waitFor();
   await input.fill('这里已经开始保存的旧账号记录。');await page.evaluate(()=>productUpgradeTest.controlWorldSettings('upsert','hold'));await page.getByRole('button',{name:'记下来',exact:true}).click();await page.waitForFunction(()=>productUpgradeTest.worldSettingsControl().entered);
   await page.evaluate(()=>productUpgradeTest.worldSettingsOwner('stream-test-user'));await page.getByText('这里一直是秋天。',{exact:true}).waitFor();await page.evaluate(()=>productUpgradeTest.releaseWorldSettings());await page.waitForTimeout(100);
   const oldRows=await page.evaluate(()=>productUpgradeTest.worldSettingRows('world-settings-other')),newRows=await page.evaluate(()=>productUpgradeTest.worldSettingRows('stream-test-user'));
   check(oldRows.some(f=>f.content==='这里已经开始保存的旧账号记录。')&&!newRows.some(f=>f.content==='这里已经开始保存的旧账号记录。'),label+' already authorized pending write retains original owner');
   check(await page.getByText('世界记住了。',{exact:true}).count()===0&&await input.inputValue()==='',label+' old operation completion cannot clear or notify new owner');
  }
  const isolation=await page.evaluate(()=>productUpgradeTest.snapshot().isolation);check(Object.values(isolation).every(v=>v===0),label+' no attempted external model, network or media');
  if(width===320){
   await page.locator('.vg-settings-world').evaluate(root=>{const rows=[root,...root.querySelectorAll('*')].map(n=>({n,size:parseFloat(getComputedStyle(n).fontSize)}));for(const {n,size} of rows)n.style.fontSize=size*2+'px';});
   check(await page.locator('.vg-settings-world').evaluate(n=>n.scrollWidth<=n.clientWidth+1),label+' 200 percent computed text fits narrow page');
   await page.screenshot({path:out+'/'+theme+'-320-large-text.png'});
  }
  if(width===390&&theme==='dark')report.video=await page.video().path();
  await context.close();
 }
 check(report.errors.length===0,'no uncaught browser errors');report.status='pass';
}catch(e){report.status='failed';report.failure=e.stack;process.exitCode=1;}finally{await browser.close();await new Promise(r=>preview.server.close(r));fs.writeFileSync(out+'/result.json',JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,checks:report.checks.length,errors:report.errors,failure:report.failure}));}
