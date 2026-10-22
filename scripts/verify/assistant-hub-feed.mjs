import {productPreview} from '../preview-product-upgrade.mjs';import {chromium} from 'playwright';import AxeBuilder from '@axe-core/playwright';import fs from 'node:fs';import assert from 'node:assert/strict';
const phase=process.argv.find(x=>x.startsWith('--phase='))?.split('=')[1]||'before',out='.tmp-preview/ui-overhaul-20261016/assistant-hub-feed/'+phase;fs.mkdirSync(out,{recursive:true});
const report={checks:[],errors:[],axe:[],scope:'Actual assistant hub with real local owned failed request; controlled table read failure, isolated model/media. Not Android.'};
const preview=await productPreview({port:0}),browser=await chromium.launch({channel:'chrome',headless:true});let active;
try{for(const theme of ['dark','light'])for(const width of [320,390,430]){
 const context=await browser.newContext({viewport:{width,height:844},isMobile:true,hasTouch:true,recordVideo:phase==='after'&&theme==='dark'&&width===320?{dir:out,size:{width,height:844}}:undefined}),page=await context.newPage();active=page;page.on('pageerror',e=>report.errors.push(e.message));
 const check=(ok,label)=>{assert.ok(ok,theme+'/'+width+': '+label);report.checks.push(theme+'/'+width+': '+label);};
 await page.goto(preview.address+'/app');await page.evaluate(async theme=>{while(!window.productUpgradeReady)await new Promise(requestAnimationFrame);productUpgradeTest.theme(theme);await productUpgradeTest.openInboxReadFixture(true,true);},theme);
 await page.getByRole('alert').filter({hasText:'办事记录读取失败'}).waitFor();await page.waitForTimeout(320);await page.screenshot({path:out+'/'+theme+'-'+width+'-failure.png'});
 check((await page.getByRole('button',{name:'未办成',exact:false}).filter({has:page.locator('span')}).first().innerText()).includes('—'),'failed category count is unknown rather than zero');
 await page.getByRole('button',{name:/^未办成/}).click();
 await page.getByRole('button',{name:'重新读取办事记录',exact:true}).waitFor();
 check(await page.getByRole('button',{name:'重新读取办事记录',exact:true}).count()===1,'one shared retry rather than conflicting feeds');
 await page.evaluate(()=>productUpgradeTest.allowInboxRead());await page.getByRole('button',{name:'重新读取办事记录',exact:true}).click();await page.getByText('核对明天的安排',{exact:true}).waitFor();
 check(await page.getByRole('alert').filter({hasText:'办事记录读取失败'}).count()===0,'retry updates both counts and content');
 check((await page.locator('.vg-assistant-categories [aria-pressed="true"]').innerText()).includes('1'),'selected category has actual count after retry');
 check(await page.getByText('1 条请求',{exact:true}).count()===1,'content summary agrees with category');
 const layout=await page.locator('.vg-assistant-header').evaluate(n=>({width:n.clientWidth,scroll:n.scrollWidth,buttons:[...n.querySelectorAll('button')].filter(x=>{const r=x.getBoundingClientRect();return r.width&&r.height&&(r.width<44||r.height<44);}).map(x=>x.getAttribute('aria-label'))}));
 check(layout.scroll<=layout.width+1,'header fits viewport');check(layout.buttons.length===0,'header keeps 44px touch targets');
 await page.screenshot({path:out+'/'+theme+'-'+width+'-ready.png'});
 if(width===390){const axe=await new AxeBuilder({page}).analyze();report.axe.push({theme,violations:axe.violations,incomplete:axe.incomplete});check(axe.violations.length===0,'ready has no automatic accessibility violations');}
 const reads=await page.evaluate(()=>window.__inboxReadFixture.calls);check(reads===2,'one failed read and one retry serve the whole hub');
 const tabs=page.getByRole('navigation',{name:'助理页面'});
 await tabs.getByRole('button',{name:'对话',exact:true}).click();const input=page.locator('#assistant-chat textarea');await input.waitFor();await input.fill('尚未发送的安排');await input.evaluate(node=>{window.__assistantDraftNode=node;});
 await tabs.getByRole('button',{name:'今日',exact:true}).click();check(await page.locator('#assistant-chat').evaluate(n=>n.hidden&&n.inert),'hidden conversation remains inert');
 await tabs.getByRole('button',{name:'对话',exact:true}).click();check(await input.inputValue()==='尚未发送的安排'&&await input.evaluate(n=>n===window.__assistantDraftNode),'tab return preserves draft and mounted input');
 if(width===320){await tabs.getByRole('button',{name:/待处理/}).click();await page.locator('.vg-assistant-hub').evaluate(root=>{const values=[...root.querySelectorAll('*')].filter(n=>n instanceof HTMLElement&&!n.closest('svg')&&[...n.childNodes].some(c=>c.nodeType===Node.TEXT_NODE&&c.textContent.trim())).map(n=>[n,parseFloat(getComputedStyle(n).fontSize),parseFloat(getComputedStyle(n).lineHeight)]);for(const[n,size,line]of values){n.style.setProperty('font-size',size*2+'px','important');if(Number.isFinite(line))n.style.setProperty('line-height',line*2+'px','important');}});await page.screenshot({path:out+'/'+theme+'-320-text200.png'});check(await page.locator('.vg-assistant-header').evaluate(n=>{const r=n.getBoundingClientRect();return n.scrollWidth<=n.clientWidth+1&&[...n.querySelectorAll('button')].every(b=>{const x=b.getBoundingClientRect();return x.left>=r.left-1&&x.right<=r.right+1;});}),'200% text keeps header controls in viewport');}
 check(Object.values(await page.evaluate(()=>productUpgradeTest.snapshot().isolation)).every(n=>n===0),'no model or media calls');await context.close();
 }assert.equal(report.errors.length,0);report.status='pass';}catch(e){report.status='failed';report.failure=e.stack;report.dom=await active?.evaluate(()=>document.body.innerText);process.exitCode=1;}finally{await browser.close();await new Promise(r=>preview.server.close(r));fs.writeFileSync(out+'/result.json',JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,checks:report.checks.length,failure:report.failure,dom:report.dom}));}
