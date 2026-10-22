import {scaleTextFromBaseline} from './text-reflow.mjs';
import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import {mkdirSync,writeFileSync} from 'node:fs';
import {productPreview} from '../preview-product-upgrade.mjs';
const out=process.env.VG_ASSISTANT_LAYOUT_OUT??'.tmp-preview/stage2-ui-20261018/S10-D/layout';mkdirSync(out,{recursive:true});
const preview=await productPreview({port:0,production:true,output:out+'/server'});
const browser=await chromium.launch({channel:'chrome'}),report={checks:[],cases:[],errors:[],axe:[],scope:'Actual assistant hub within MobileLayout; local synthetic account. Actual computed font doubling, not Android textZoom/IME.'};
const check=(pass,name,data)=>report.checks.push({pass:!!pass,name,data});
try{
 for(const theme of ['dark','light'])for(const [width,height,scale] of [[390,844,1],[320,640,1],[430,932,1],[320,640,2],[320,440,2]]){
  const context=await browser.newContext({viewport:{width,height},reducedMotion:'reduce'}),page=await context.newPage();
  page.on('pageerror',e=>report.errors.push(e.message));await page.goto(`${preview.address}/app?virtugene-preview=mobile&page=assistant&theme=${theme}`);await page.waitForFunction(()=>window.productUpgradeReady);
  const hub=page.locator('.vg-assistant-hub');await hub.waitFor();await hub.getByRole('heading',{name:'这是一个用于窄屏核验的助理名字',exact:true}).waitFor();await page.evaluate(()=>document.fonts.ready);
  const name=await hub.locator('h1').getAttribute('title'),label=`${theme}-${width}-${height}-font${scale*100}`;
  const enlarge=async()=>{if(scale===2)await scaleTextFromBaseline(page,'.vg-assistant-hub','.soul-orb,.vg-soul-orb,.sr-only,[aria-hidden="true"]');};
  await enlarge();
  const nav=page.getByRole('navigation',{name:'助理页面',exact:true});
  for(const tab of ['今日','待处理','对话']){
   await nav.getByRole('button',{name:tab==='待处理'?/待处理/:tab,exact:tab!=='待处理'}).click();
   if(tab==='对话')await page.getByRole('textbox',{name:'消息内容',exact:true}).waitFor();
   await enlarge();
   const metrics=await hub.evaluate(root=>{const rect=n=>{const r=n.getBoundingClientRect();return{w:r.width,h:r.height,x:r.x,right:r.right,bottom:r.bottom};};return{overflow:root.scrollWidth-root.clientWidth,docOverflow:document.documentElement.scrollWidth-innerWidth,headingFont:parseFloat(getComputedStyle(root.querySelector('h1')).fontSize),headerButtons:[...root.querySelectorAll('.vg-assistant-header button')].map(rect),tabs:[...root.querySelectorAll('.vg-assistant-tabs button')].map(rect),fonts:[...document.fonts].filter(f=>f.status==='loaded').length};});
   report.cases.push({label,tab,metrics});check(metrics.overflow<=1&&metrics.docOverflow<=1,`${label}/${tab}: no horizontal overflow`,metrics);
   check([...metrics.headerButtons,...metrics.tabs].every(r=>r.w>=44&&r.h>=44&&r.x>=0&&r.right<=width+1),`${label}/${tab}: identity actions and tabs retain44px`,metrics);
   check(metrics.fonts>0&&await hub.locator('h1').getAttribute('title')===name,`${label}/${tab}: real fonts and full assistant identity preserved`);
   if(scale===2)check(metrics.headingFont>=34,`${label}/${tab}: actual title font doubled`,metrics.headingFont);
   if(tab==='对话'){
    const composer=await page.getByRole('textbox',{name:'消息内容',exact:true}).evaluate(n=>{const r=n.getBoundingClientRect(),p=n.closest('.vg-assistant-panel').getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height,bottom:r.bottom,panelBottom:p.bottom};});
    check(composer.w>=44&&composer.h>=44&&composer.y>=0&&composer.bottom<=Math.min(height,composer.panelBottom)+1,`${label}: composer remains within visible chat panel`,composer);
    const shortcuts=await page.locator('.vg-secretary-quick-grid button').evaluateAll(nodes=>nodes.map(n=>({label:n.textContent,w:n.clientWidth,overflow:n.scrollWidth-n.clientWidth})));
    check(shortcuts.every(n=>n.overflow<=1),`${label}: quick-action labels reflow without overlap`,shortcuts);
   }
   if(tab==='待处理')check(await page.locator('.vg-assistant-pending-content').evaluate(n=>n.clientHeight>=44),`${label}: pending content keeps a visible reading area`);
   await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
   await page.screenshot({path:`${out}/${label}-${tab}.png`});
   if(width===390&&tab==='今日'){const a=await new AxeBuilder({page}).include('.vg-assistant-hub').withRules(['color-contrast']).analyze();report.axe.push({label,violations:a.violations,incomplete:a.incomplete});check(a.violations.length===0,`${label}: visible text contrast scan`,a.violations);}
  }
  const input=page.getByRole('textbox',{name:'消息内容',exact:true});await input.fill('仍然留在这里的草稿');
  if(scale===2){
   await page.getByRole('button',{name:'展开更多办事',exact:true}).click();
   await page.getByRole('button',{name:'查记录',exact:true}).click();
   check(await input.inputValue()==='帮我查找日记，关键词是：',label+': scrollable quick actions remain reachable and only populate a local draft');
   await page.getByRole('button',{name:'收起更多办事',exact:true}).click();
   await input.fill('仍然留在这里的草稿');
  }
  await page.evaluate(()=>window.assistantComposer=document.querySelector('.chat-composer-input'));
  await nav.getByRole('button',{name:'今日',exact:true}).click();check(await page.locator('#assistant-chat').evaluate(n=>n.hidden&&n.inert),label+': inactive conversation is hidden and inert');
  await nav.getByRole('button',{name:'对话',exact:true}).click();check(await input.inputValue()==='仍然留在这里的草稿'&&await page.evaluate(()=>assistantComposer===document.querySelector('.chat-composer-input')),label+': same composer and draft survive navigation');
  const isolation=await page.evaluate(()=>productUpgradeTest.snapshot().isolation);check(Object.values(isolation).filter(v=>typeof v==='number').every(n=>n===0),label+': no model/media/native attempts',isolation);await context.close();
 }
 check(report.errors.length===0,'No browser errors',report.errors);
}catch(e){report.failure=e.stack;}
finally{report.pass=!report.failure&&report.checks.every(c=>c.pass);writeFileSync(out+'/result.json',JSON.stringify(report,null,2));await browser.close();await new Promise(r=>preview.server.close(r));}
console.log(JSON.stringify({pass:report.pass,checks:report.checks.length,failed:report.checks.filter(c=>!c.pass),failure:report.failure}));if(!report.pass)process.exitCode=1;
