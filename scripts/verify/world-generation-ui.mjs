import {productPreview} from '../preview-product-upgrade.mjs';import {chromium} from 'playwright';import AxeBuilder from '@axe-core/playwright';import assert from 'node:assert/strict';import fs from 'node:fs';
const phase=process.argv.find(x=>x.startsWith('--phase='))?.slice(8)||'before',out=process.env.VG_WORLD_GENERATION_OUT||'.tmp-preview/ui-overhaul-20261016/world-generation/'+phase;fs.mkdirSync(out,{recursive:true});
const preview=await productPreview({port:0}),browser=await chromium.launch({channel:'chrome',headless:true}),report={checks:[],errors:[],axe:[],scope:'Actual world UI, pipeline, JSON parsing, SSE and IndexedDB with local synthetic model transport. Not live model quality or Android.'};const check=(ok,label)=>{assert.ok(ok,label);report.checks.push(label);};
try{for(const theme of ['dark','light'])for(const width of [320,390,430]){
 const height=width===320?568:width===430?932:844,label=theme+'/'+width;
 const context=await browser.newContext({viewport:{width,height},isMobile:true,hasTouch:true,reducedMotion:width===320?'reduce':'no-preference',recordVideo:width===390?{dir:out,size:{width,height}}:undefined}),page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
 await page.goto(preview.address+'/app');await page.evaluate(async({theme,width})=>{while(!window.productUpgradeReady)await new Promise(requestAnimationFrame);productUpgradeTest.theme(theme);await productUpgradeTest.seedWorldReading();await productUpgradeTest.installWorldGeneration(width===390?84:28);await productUpgradeTest.go('world');},{theme,width});
 if(!await page.getByRole('button',{name:'继续这一幕',exact:true}).isVisible())await page.getByRole('button',{name:'星域',exact:true}).click();
 await page.getByRole('button',{name:'继续这一幕',exact:true}).click();
 if(width===390)await page.getByRole('button',{name:'查看更早内容',exact:true}).click();
 await page.getByText('雨停了。',{exact:true}).waitFor();await page.locator('.vg-soul-ghost').waitFor({state:'detached'});
 const input=page.getByRole('textbox',{name:'世界消息内容',exact:true});await input.fill('知微，聊聊此刻吧。');await page.getByRole('button',{name:'发送',exact:true}).click();
 await page.waitForFunction(()=>productUpgradeTest.worldGenerationState().actors.length===1);
 check(await page.locator('.vg-stream-live').count()===0,theme+' JSON prefix alone does not create an empty live line');
 check(await page.getByRole('button',{name:'世界正在回应',exact:true}).isDisabled(),theme+' waiting is represented by actual busy send control');
 const live=page.locator('.vg-beat-line.vg-stream-live');await page.evaluate(()=>productUpgradeTest.worldGenerationPush(0,'先在这里聊一会儿'));await live.filter({hasText:'先在这里聊一会儿'}).waitFor();
 check(await live.count()===1,theme+' first visible SSE body creates one live line');
 await live.evaluate(n=>{window.__worldLive=n;});
 const scroller=page.locator('.vg-canvas-scroll');await scroller.evaluate(n=>{n.scrollTop=Math.max(0,n.scrollHeight-n.clientHeight-300);n.dispatchEvent(new Event('scroll'));});await page.waitForTimeout(80);const readingTop=await scroller.evaluate(n=>n.scrollTop);
 await page.evaluate(()=>productUpgradeTest.worldGenerationPush(0,'，我在听。'));await live.filter({hasText:'，我在听。'}).waitFor();check(await live.evaluate(n=>n===window.__worldLive),theme+' additional SSE text preserves the live line node');
 await page.waitForTimeout(100);check(Math.abs(await scroller.evaluate(n=>n.scrollTop)-readingTop)<2,label+' continuing SSE does not pull history reader to bottom');
 await page.evaluate(()=>productUpgradeTest.worldGenerationFinish(0));await page.getByText('先在这里聊一会儿，我在听。',{exact:true}).waitFor();
 for(let attempt=0;attempt<100;attempt++){const ready=await page.evaluate(async()=>{const rows=await productUpgradeTest.worldGenerationRows();return rows.turns.some(t=>t.status==='completed');});if(ready)break;if(attempt===99)throw Error('Turn did not complete');await page.waitForTimeout(30);}
 await page.locator('.vg-stream-live').waitFor({state:'detached'});const rows=await page.evaluate(()=>productUpgradeTest.worldGenerationRows());
 check(rows.entries.filter(e=>e.content==='知微，聊聊此刻吧。').length===1,theme+' user action is saved once');
 check(rows.entries.filter(e=>e.content==='先在这里聊一会儿，我在听。').length===1,theme+' completed SSE body is saved once');
 if(width===390)check(await page.getByText('雨停了。',{exact:true}).count()===1,label+' completing a turn retains history loaded beyond the initial sixty entries');
 check(Math.abs(await scroller.evaluate(n=>n.scrollTop)-readingTop)<2,label+' persisted reply also preserves history reading position');
 await page.getByRole('button',{name:'↓ 新内容',exact:true}).click();await page.waitForTimeout(350);
 check(await scroller.evaluate(n=>n.scrollHeight-n.scrollTop-n.clientHeight<60),label+' explicit new-content action returns to latest');
 await input.fill('知微，这一条稍后重试。');await page.evaluate(()=>productUpgradeTest.worldGenerationFail());await page.getByRole('button',{name:'发送',exact:true}).click();await page.getByRole('button',{name:'重试',exact:true}).waitFor();
 check(await page.locator('.vg-user-action').filter({hasText:'知微，这一条稍后重试。'}).count()===1,theme+' failed actor preserves visible user text');
 await page.getByRole('button',{name:'重试',exact:true}).evaluate(n=>{n.click();n.click();});await page.waitForFunction(()=>productUpgradeTest.worldGenerationState().actors.length===2);await page.evaluate(()=>{productUpgradeTest.worldGenerationPush(1,'这一次接上了。');productUpgradeTest.worldGenerationFinish(1);});await page.getByText('这一次接上了。',{exact:true}).waitFor();await page.getByRole('button',{name:'重试',exact:true}).waitFor({state:'hidden'});
 check((await page.evaluate(()=>productUpgradeTest.worldGenerationRows())).entries.filter(e=>e.content==='知微，这一条稍后重试。').length===1,theme+' retry does not duplicate user action');
 check(await page.locator('.vg-canvas-scroll').evaluate(n=>n.scrollWidth<=n.clientWidth+1)&&await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),label+' generated reading content and document fit phone width');
 await page.screenshot({path:out+'/'+theme+'-'+width+'-retry.png'});
 // Two same-frame intent events exercise the real user-action callback before a React commit.
 await page.evaluate(()=>{window.dispatchEvent(new CustomEvent('vg:world-say',{detail:'知微，同一条指令只发一次。'}));window.dispatchEvent(new CustomEvent('vg:world-say',{detail:'知微，同一条指令只发一次。'}));});
 await page.waitForFunction(()=>productUpgradeTest.worldGenerationState().actors.length===3);await page.evaluate(()=>{productUpgradeTest.worldGenerationPush(2,'收到这一条。');productUpgradeTest.worldGenerationFinish(2);});await page.getByText('收到这一条。',{exact:true}).waitFor();await page.waitForTimeout(350);
 const final=await page.evaluate(()=>productUpgradeTest.worldGenerationRows());check(final.entries.filter(e=>e.content==='知微，同一条指令只发一次。').length===1,theme+' same-frame intent cannot enqueue duplicate world actions');
 await input.fill('知微，继续这一段。');await page.getByRole('button',{name:'发送',exact:true}).click();await page.waitForFunction(()=>productUpgradeTest.worldGenerationState().actors.length===4);
 await scroller.evaluate(n=>{n.scrollTop=Math.max(0,n.scrollHeight-n.clientHeight-300);n.dispatchEvent(new Event('scroll'));});
 await page.evaluate(()=>{productUpgradeTest.failWorldGenerationStateOnce();productUpgradeTest.worldGenerationPush(3,'这是失败轮次的旧正文。');productUpgradeTest.worldGenerationFinish(3);});
 await page.getByRole('button',{name:'重试',exact:true}).waitFor();await page.getByText('这是失败轮次的旧正文。',{exact:true}).waitFor();
 check(await page.getByRole('alert').filter({hasText:'这一轮没有接上'}).count()===1,label+' generated-turn failure has an accessible localized alert');
 check(await page.getByRole('button',{name:'重试',exact:true}).evaluate(n=>{const r=n.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;}),label+' failure retry remains visible while history is scrolled up');
 check(await page.getByRole('button',{name:'↓ 新内容',exact:true}).evaluate(n=>{const r=n.getBoundingClientRect(),error=document.querySelector('.vg-canvas-bottom [role="alert"]')?.closest('.vg-feedback-card')?.getBoundingClientRect();return !error||r.bottom<=error.top;}),label+' new-content control stays above failure feedback without overlap');
 if(width===390){const axe=await new AxeBuilder({page}).analyze();report.axe.push({theme,state:'generation-failure',violations:axe.violations,incomplete:axe.incomplete});check(axe.violations.length===0,label+' generation failure passes automatic accessibility scan');}
 await page.screenshot({path:out+'/'+theme+'-'+width+'-failure.png'});
 await page.getByRole('button',{name:'重试',exact:true}).click();await page.waitForFunction(()=>productUpgradeTest.worldGenerationState().actors.length===5);
 await page.evaluate(()=>{productUpgradeTest.worldGenerationPush(4,'这是重试后保留的正文。');productUpgradeTest.worldGenerationFinish(4);});await page.getByText('这是重试后保留的正文。',{exact:true}).waitFor();await page.getByRole('button',{name:'重试',exact:true}).waitFor({state:'hidden'});
 await page.getByText('这是失败轮次的旧正文。',{exact:true}).waitFor({state:'hidden',timeout:3000});check(true,label+' retry removes replaced failed-generation body from visible UI');
 check(!(await page.evaluate(()=>productUpgradeTest.worldGenerationRows())).entries.some(e=>e.content==='这是失败轮次的旧正文。'),label+' retry also removes superseded generated body from local storage');
 await input.fill('知微，前一轮刷新慢一些。');await page.getByRole('button',{name:'发送',exact:true}).click();await page.waitForFunction(()=>productUpgradeTest.worldGenerationState().actors.length===6);
 await page.evaluate(()=>{productUpgradeTest.holdWorldGenerationRefresh();productUpgradeTest.worldGenerationPush(5,'前一轮已经说完。');productUpgradeTest.worldGenerationFinish(5);});await page.waitForFunction(()=>productUpgradeTest.worldGenerationRefreshState().entered);
 await input.fill('知微，这是新一轮。');await page.getByRole('button',{name:'发送',exact:true}).click();await page.waitForFunction(()=>productUpgradeTest.worldGenerationState().actors.length===7);
 await page.evaluate(()=>productUpgradeTest.worldGenerationPush(6,'新一轮正在回应'));await live.filter({hasText:'新一轮正在回应'}).waitFor();
 await page.evaluate(()=>productUpgradeTest.releaseWorldGenerationRefresh());await page.waitForTimeout(150);
 check(await live.filter({hasText:'新一轮正在回应'}).count()===1,label+' older refresh does not clear a newer live reply');
 check(await page.locator('.vg-user-action').filter({hasText:'知微，这是新一轮。'}).count()===1,label+' older refresh does not hide the next user action');
 await page.evaluate(()=>productUpgradeTest.worldGenerationFinish(6,'。'));await page.getByText('新一轮正在回应。',{exact:true}).waitFor();
 if(width===390){
  await input.fill('知微，我们接下来做什么？');await page.evaluate(()=>productUpgradeTest.worldGenerationSuggestions(['沿着站台走一会儿','留在原地继续聊']));await page.getByRole('button',{name:'发送',exact:true}).click();await page.waitForFunction(()=>productUpgradeTest.worldGenerationState().actors.length===8);await page.evaluate(()=>{productUpgradeTest.worldGenerationPush(7,'可以慢慢走，也可以就在这里。');productUpgradeTest.worldGenerationFinish(7);});
  await page.getByRole('button',{name:/^灵感\s*沿着站台走一会儿/}).click();
  const choice=page.getByRole('button',{name:'沿着站台走一会儿',exact:true});await choice.waitFor();await choice.click();await page.waitForFunction(()=>productUpgradeTest.worldGenerationState().actors.length===9);
  check((await page.evaluate(()=>productUpgradeTest.worldGenerationRows())).entries.some(e=>e.kind==='choice'&&e.content==='沿着站台走一会儿'),label+' actual generated suggestion submits a stored choice');
  await page.evaluate(()=>{productUpgradeTest.worldGenerationPush(8,'那就一起慢慢走。');productUpgradeTest.worldGenerationFinish(8);});await page.getByText('那就一起慢慢走。',{exact:true}).waitFor();
  await page.getByRole('button',{name:'世界控制',exact:true}).click();await page.getByRole('dialog',{name:'世界偏好',exact:true}).getByRole('button',{name:/^写入世界记录/}).click();await page.getByText('这一段已经写入世界记录。',{exact:true}).waitFor();
  await page.getByRole('button',{name:'离开世界',exact:true}).click();await page.getByRole('navigation',{name:'世界档案'}).or(page.getByRole('button',{name:'星域',exact:true})).first().waitFor();if(!await page.getByRole('navigation',{name:'世界档案'}).isVisible())await page.getByRole('button',{name:'星域',exact:true}).click();await page.getByRole('navigation',{name:'世界档案'}).getByRole('button',{name:/^记忆/}).click();const record=page.locator('.vg-memory-exhibit-list li').filter({hasText:'雨后的站台'});await record.getByRole('button').click();const detail=page.getByRole('dialog',{name:'记录详情',exact:true});await detail.getByText('来源原文（当前）',{exact:true}).click();await detail.getByText('那就一起慢慢走。',{exact:true}).waitFor();
  check(true,label+' generated choice reply is readable through saved record current source');await page.keyboard.press('Escape');await detail.waitFor({state:'hidden'});await page.getByRole('button',{name:'返回世界',exact:true}).click();await page.getByRole('button',{name:'继续这一幕',exact:true}).or(page.getByRole('button',{name:'星域',exact:true})).first().waitFor();if(!await page.getByRole('button',{name:'继续这一幕',exact:true}).isVisible())await page.getByRole('button',{name:'星域',exact:true}).click();await page.getByRole('button',{name:'继续这一幕',exact:true}).click();await page.getByText('那就一起慢慢走。',{exact:true}).waitFor();
  await input.fill('知微，等我回来再聊。');await page.getByRole('button',{name:'发送',exact:true}).click();await page.waitForFunction(()=>productUpgradeTest.worldGenerationState().actors.length===10);await page.getByRole('button',{name:'离开世界',exact:true}).click();await page.getByRole('navigation',{name:'世界档案'}).or(page.getByRole('button',{name:'星域',exact:true})).first().waitFor();if(!await page.getByRole('navigation',{name:'世界档案'}).isVisible())await page.getByRole('button',{name:'星域',exact:true}).click();await page.getByRole('navigation',{name:'世界档案'}).waitFor();await page.evaluate(()=>{productUpgradeTest.worldGenerationPush(9,'这是离开后才到达的正文。');productUpgradeTest.worldGenerationFinish(9);});await page.waitForTimeout(180);
  check(await page.getByText('这是离开后才到达的正文。',{exact:true}).count()===0,label+' late stream does not render into the world hub after leaving');
 }
 check((await page.evaluate(()=>productUpgradeTest.worldGenerationState())).calls.every(c=>c.stage!=='unknown'),theme+' every synthetic transport call belongs to a recognized real pipeline stage');
 await context.close();
}check(report.errors.length===0,'no browser runtime errors');report.status='pass';}catch(e){report.status='failed';report.failure=e.stack;for(const c of browser.contexts())for(const page of c.pages()){report.dom=await page.locator('body').innerText();await page.screenshot({path:out+'/failure.png'});}process.exitCode=1;}finally{await browser.close();await new Promise(r=>preview.server.close(r));fs.writeFileSync(out+'/result.json',JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,checks:report.checks.length,failure:report.failure}));}
