import {chromium} from 'playwright';
import {starfieldPreview} from '../preview-starfield-upgrade.mjs';
import {mkdirSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const before=process.env.VG_MEMORY_BEFORE==='1',out=process.env.VG_MEMORY_OUT||`.tmp-preview/stage2-ui-20261018/S06-A/${before?'before':'checks'}`;mkdirSync(out,{recursive:true});
const server=await starfieldPreview({port:0,output:out+'/server'}),browser=await chromium.launch({channel:'chrome'}),report={at:new Date().toISOString(),checks:[],errors:[],screenshots:[],limits:['Actual MobileLayout and WorldMemoryPage; isolated synthetic IndexedDB, not the signed-in account or Android.','No model, microphone, audio or native calls.']};
const check=(ok,name)=>{report.checks.push({name,pass:!!ok});assert(ok,name);};
try{
for(const theme of ['dark','light'])for(const [width,height,font]of [[390,844,100],[320,640,200],[430,932,100]]){
 const page=await browser.newPage({viewport:{width,height},isMobile:true,hasTouch:true,reducedMotion:'reduce'});page.setDefaultTimeout(7000);page.on('pageerror',e=>report.errors.push(e.message));await page.goto(server.address+`/app?virtugene-preview=mobile&theme=${theme}&state=memory-sample&view=memory`);await page.locator('[data-exhibit-id]').nth(39).waitFor();await page.evaluate(()=>document.fonts.ready);if(font!==100){await page.evaluate(()=>window.starfieldPreview.memoryFixture('long'));await page.evaluate(f=>document.documentElement.style.setProperty('font-size',f+'%','important'),font);}await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 const label=`${theme}-${width}-font${font}`,shot=async(state)=>{const file=label+'-'+state+'.png';await page.screenshot({path:out+'/'+file});report.screenshots.push({file,theme,width,height,font,state});};
 check(await page.locator('.vg-memory-exhibit').evaluate(el=>el.scrollWidth<=el.clientWidth+1),label+' no horizontal overflow');await shot('list');
 if(!before){
  check(await page.locator('.vg-memory-exhibit.vg-light-paper').count()===1,label+' adopted approved local paper palette');
  check(await page.locator('[data-exhibit-id]').first().getByText('世界故事',{exact:true}).count()===1,label+' actual saved source type is readable on each card');
  const search=page.getByRole('searchbox',{name:'搜索世界经历'});await search.fill('没有这个片段');await page.getByRole('status').filter({hasText:'当前已载入的经历里没有找到'}).waitFor();check(await page.getByRole('button',{name:'加载更早经历',exact:true}).count()===1,label+' no-results preserves older-page action');await page.getByRole('button',{name:'清空搜索',exact:true}).click();
  check(await page.getByRole('button',{name:'清空搜索',exact:true}).count()===0,label+' clear search resets filter');
  const rows=page.locator('[data-exhibit-id]'),trigger=rows.nth(5).getByRole('button'),title=await rows.nth(5).locator('strong').innerText();await trigger.scrollIntoViewIfNeeded();const top=await page.locator('.vg-memory-exhibit').evaluate(el=>el.scrollTop);await trigger.click();const detail=page.getByRole('dialog',{name:'记录详情',exact:true});await detail.getByRole('heading',{name:title,exact:true}).waitFor();check(await detail.evaluate(el=>el.classList.contains('vg-record-paper')),label+' actual source-checked detail uses reading surface');await shot('detail');await detail.getByRole('button',{name:'返回',exact:true}).click();await detail.waitFor({state:'hidden'});check(await trigger.evaluate(el=>document.activeElement===el),label+' return restores selected card focus');check(Math.abs(await page.locator('.vg-memory-exhibit').evaluate(el=>el.scrollTop)-top)<2,label+' return preserves list position');
  await page.getByRole('button',{name:'加载更早经历',exact:true}).click();await rows.nth(42).waitFor();check(await rows.count()===43,label+' existing cursor appends remaining3 without duplicates');
  if(width===390){
   await search.fill('雨后的站台');const first=rows.first().getByRole('button');await first.click();await detail.getByRole('heading',{name:'雨后的站台',exact:true}).waitFor();await page.evaluate(()=>window.starfieldPreview.memoryFixture('edit'));await detail.getByRole('heading',{name:'更新后的站台记录',exact:true}).waitFor();check(await detail.getByText('这是当前编辑后的完整摘要。',{exact:true}).isVisible(),theme+' source-checked selected edit updates current body');
   await page.evaluate(()=>window.starfieldPreview.memoryFixture('delete-first'));await detail.getByText('这条记录已不可用，可能已删除、移出当前世界或调整为私密。旧内容不再展示。',{exact:true}).waitFor();check(await detail.getByText('这是当前编辑后的完整摘要。',{exact:true}).count()===0,theme+' deleted selected record removes old body');await detail.getByRole('button',{name:'返回',exact:true}).click();await search.fill('');check(await rows.count()===42,theme+' deletion keeps remaining loaded identities');
  }
 }
 check(await page.evaluate(()=>Object.values(window.starfieldPreview.snapshot().isolation).every(n=>n===0)),label+' zero external attempts');await page.close();
}
check(report.errors.length===0,'no runtime errors');report.pass=true;
}catch(e){report.pass=false;report.failure=e.stack;process.exitCode=1;}
finally{report.source=server.manifest;writeFileSync(out+'/result.json',JSON.stringify(report,null,2));await browser.close();await new Promise(r=>server.server.close(r));}
console.log(JSON.stringify({out,pass:report.pass,checks:report.checks.length,failure:report.failure}));
