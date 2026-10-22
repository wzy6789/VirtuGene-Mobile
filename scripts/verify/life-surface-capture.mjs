import {productPreview} from '../preview-product-upgrade.mjs';
import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs';
const phase=process.argv.find(x=>x.startsWith('--phase='))?.split('=')[1]||'before';
const out='.tmp-preview/ui-overhaul-20261016/life-surface/'+phase;fs.mkdirSync(out,{recursive:true});
if(phase==='before'&&fs.existsSync(out+'/result.json'))throw Error('Preserve captured baseline');
const report={phase,pages:[],errors:[],scope:'Actual Diary/Moments/Assistant surfaces with synthetic local fixture. No model, microphone, network, notification or Android acceptance.'};
const preview=await productPreview({port:0}),browser=await chromium.launch({channel:'chrome',headless:true});
try{for(const width of [320,390,430])for(const theme of ['dark','light']){
 const context=await browser.newContext({viewport:{width,height:844},isMobile:true,hasTouch:true}),page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
 for(const [view,selector]of [['diary','.vg-diary'],['moments','.vg-moments-page'],['assistant','.vg-assistant-hub']]){
  await page.goto(preview.address+'/app');await page.evaluate(async({theme,view})=>{while(!window.productUpgradeReady)await new Promise(requestAnimationFrame);productUpgradeTest.theme(theme);await productUpgradeTest.go(view);},{theme,view});
  await page.locator(selector).waitFor();await page.waitForTimeout(400);
  const path=out+'/'+theme+'-'+width+'-'+view+'.png';await page.screenshot({path});
  const layout=await page.locator(selector).evaluate(root=>({width:root.clientWidth,scrollWidth:root.scrollWidth,smallButtons:[...root.querySelectorAll('button')].filter(n=>{const r=n.getBoundingClientRect();return r.width>0&&r.height>0&&(r.width<44||r.height<44);}).map(n=>({text:n.getAttribute('aria-label')||n.textContent.slice(0,45),width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height}))}));
  const axe=width===390?await new AxeBuilder({page}).analyze():null;
  report.pages.push({width,theme,view,path,layout,violations:axe?.violations,incomplete:axe?.incomplete,isolation:await page.evaluate(()=>productUpgradeTest.snapshot().isolation)});
 }await context.close();
}report.status='captured';}catch(e){report.status='failed';report.failure=e.stack;throw e;}finally{await browser.close();await new Promise(r=>preview.server.close(r));fs.writeFileSync(out+'/result.json',JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,pages:report.pages.length,errors:report.errors,violations:report.pages.filter(x=>x.violations?.length).map(x=>({view:x.view,theme:x.theme,ids:x.violations.map(v=>v.id)})),overflow:report.pages.filter(x=>x.layout.scrollWidth>x.layout.width+1).map(x=>[x.view,x.theme,x.width]),failure:report.failure}));}
