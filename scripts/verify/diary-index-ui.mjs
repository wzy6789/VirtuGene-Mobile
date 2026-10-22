import {productPreview} from '../preview-product-upgrade.mjs';
import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs';import assert from 'node:assert/strict';
const phase=process.argv.find(x=>x.startsWith('--phase='))?.split('=')[1]||'before';
const out=process.env.VG_DIARY_INDEX_OUT??'.tmp-preview/ui-overhaul-20261016/diary-index/'+phase;fs.mkdirSync(out,{recursive:true});
const report={checks:[],errors:[],axe:[],scope:'Actual diary manager, fresh synthetic local account and default welcome record; no AI/export/import/notification or device calls.'};
const preview=await productPreview({port:0,production:true,output:out+'/server'}),browser=await chromium.launch({channel:'chrome',headless:true});
try{for(const width of [320,390,430])for(const theme of ['dark','light']){
 const context=await browser.newContext({viewport:{width,height:844},isMobile:true,hasTouch:true,recordVideo:phase==='after'&&width===390&&theme==='dark'?{dir:out,size:{width,height:844}}:undefined}),page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
 const check=(ok,label)=>{assert.ok(ok,theme+'/'+width+': '+label);report.checks.push(theme+'/'+width+': '+label);};
 await page.goto(preview.address+'/app');await page.evaluate(async theme=>{while(!window.productUpgradeReady)await new Promise(requestAnimationFrame);productUpgradeTest.theme(theme);await productUpgradeTest.go('diary');},theme);
 const root=page.locator('.vg-diary').first();await root.waitFor();await root.getByRole('status',{name:'正在唤醒日记'}).waitFor({state:'hidden'});
 await page.screenshot({path:out+'/'+theme+'-'+width+'.png'});
 check(await root.getByRole('heading',{level:1,name:'日记',exact:true}).count()===1,'one real page title');
 check(await root.getByText('PERSONAL ARCHIVE',{exact:true}).count()===0,'no marketing hero before records');
 check(await root.getByText('连续记录',{exact:true}).count()===1,'streak appears once');
 const disclosure=root.locator('details').filter({has:page.locator('summary').filter({hasText:'心情回顾'})});
 check(await disclosure.count()===1&&(await disclosure.getAttribute('open'))===null,'mood charts collapsed initially');
 await disclosure.locator('summary').click();check(await disclosure.getByText('全部日记心情分布',{exact:true}).isVisible(),'existing distribution retains its all-diary scope');
 await disclosure.locator('summary').click();check(await disclosure.getAttribute('open')===null,'mood review can close');
 check(await root.evaluate(n=>n.scrollWidth<=n.clientWidth+1),'portrait has no horizontal overflow');
 if(width===390){const axe=await new AxeBuilder({page}).analyze();report.axe.push({theme,violations:axe.violations,incomplete:axe.incomplete});check(axe.violations.length===0,'no automatic accessibility violations');}
 const search=root.getByRole('searchbox',{name:'搜索日记'});await search.fill('不可能匹配的日记字串');await root.getByText('没有找到匹配的日记',{exact:true}).waitFor();check(true,'search shows real zero results');await search.fill('');
 await root.getByRole('button',{name:'时间线',exact:true}).click();await root.getByText('我的第一篇日记',{exact:true}).waitFor();check(true,'timeline shows actual record');
 await root.getByRole('button',{name:'标签',exact:true}).click();await root.getByRole('button',{name:/^#第一篇/}).first().waitFor();check(true,'tag view retained');
 await root.getByRole('button',{name:'日历',exact:true}).click();await root.getByRole('button',{name:'下个月',exact:true}).click();await root.getByRole('button',{name:'回到本月',exact:true}).click();check(true,'calendar month controls retained');
 await root.getByRole('button',{name:'导出日记',exact:true}).click();const exportDialog=page.getByRole('dialog',{name:'导出与备份',exact:true});await exportDialog.waitFor();check(await exportDialog.getByRole('button',{name:/完整备份/}).count()===1,'export and complete backup entry retained');await page.keyboard.press('Escape');await exportDialog.waitFor({state:'hidden'});
 await root.getByRole('button',{name:'手账更多选项',exact:true}).click();const tools=page.getByRole('dialog',{name:'手账工具',exact:true});await tools.waitFor();check(await tools.getByRole('button',{name:/回收站/}).count()===1,'trash remains in tools');check(await tools.getByRole('button',{name:/谁能看到我的日记/}).count()===1,'sharing permission remains reachable');await page.keyboard.press('Escape');await tools.waitFor({state:'hidden'});
 await root.getByRole('button',{name:'写日记',exact:true}).click();await page.getByRole('button',{name:'返回手账',exact:true}).waitFor();check(true,'write action opens existing daily editor');await page.getByRole('button',{name:'返回手账',exact:true}).click();await root.getByRole('heading',{name:'日记',exact:true}).waitFor();check(true,'daily editor returns to manager');
 if(width===320){await root.evaluate(root=>{const sizes=[...root.querySelectorAll('*')].filter(n=>n instanceof HTMLElement&&!n.closest('svg')&&(n.matches('input')||[...n.childNodes].some(c=>c.nodeType===Node.TEXT_NODE&&c.textContent.trim()))).map(n=>[n,parseFloat(getComputedStyle(n).fontSize),parseFloat(getComputedStyle(n).lineHeight)]);for(const[n,size,line]of sizes){n.style.setProperty('font-size',size*2+'px','important');if(Number.isFinite(line))n.style.setProperty('line-height',line*2+'px','important');}});await page.screenshot({path:out+'/'+theme+'-320-text200.png'});check(await root.evaluate(root=>{const r=root.getBoundingClientRect();return[...root.querySelectorAll('button,input,summary')].every(n=>{const b=n.getBoundingClientRect();return b.width===0||(b.left>=r.left-1&&b.right<=r.right+1);});}),'200% text keeps controls inside viewport');}
 const isolation=await page.evaluate(()=>productUpgradeTest.snapshot().isolation);check(Object.values(isolation).every(n=>n===0),'isolated from model and media');
 if(phase==='after'&&width===390&&theme==='dark')report.video=await page.video().path();await context.close();
}assert.equal(report.errors.length,0);report.status='pass';}catch(e){report.status='failed';report.failure=e.stack;process.exitCode=1;}finally{await browser.close();await new Promise(r=>preview.server.close(r));fs.writeFileSync(out+'/result.json',JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,checks:report.checks.length,errors:report.errors,failure:report.failure,video:report.video}));}
