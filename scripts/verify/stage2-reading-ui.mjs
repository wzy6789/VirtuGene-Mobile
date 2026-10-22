import {chromium} from 'playwright';
import {starfieldPreview} from '../preview-starfield-upgrade.mjs';
import {mkdirSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const out=process.env.VG_STAGE2_READING_OUT??'.tmp-preview/stage2-ui-20261018/S03-B3/checks';mkdirSync(out,{recursive:true});
const server=await starfieldPreview({port:0,output:out+'/server',stage2Samples:true}),browser=await chromium.launch({channel:'chrome'});
const report={checks:[],screenshots:[],errors:[],limitations:['Real MobileLayout → WorldMemoryPage → TimelineRecordDialog with optional presentation prop only in preview.','Synthetic record and source rows on isolated origin; not user records, Android, or model prose quality.']};
const check=(pass,name,detail)=>{report.checks.push({pass:!!pass,name,detail});assert(pass,name+' '+JSON.stringify(detail??''));};
try{
 for(const theme of ['dark','light'])for(const [width,height,font] of [[390,844,100],[320,640,100],[360,800,100],[430,932,100],[320,640,200]]){
  const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:1,isMobile:true,hasTouch:true,reducedMotion:'reduce'});page.setDefaultTimeout(8000);page.on('pageerror',e=>report.errors.push(e.message));
  await page.goto(server.address+`/app?virtugene-preview=mobile&theme=${theme}&sample=reading`);await page.waitForFunction(()=>window.stage2Ready||window.stage2Error);check(!await page.evaluate(()=>window.stage2Error),'fixture starts');
  const trigger=page.locator('[data-exhibit-id="stage2-reading-record"] button');await trigger.click();const dialog=page.getByRole('dialog',{name:'记录详情',exact:true});await dialog.locator('.vg-record-prose').waitFor();await page.evaluate(()=>document.fonts.ready);
  if(font!==100)await page.evaluate(f=>document.documentElement.style.setProperty('font-size',f+'%','important'),font);await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  const label=`${theme}-${width}-font${font}`,data=await dialog.evaluate(el=>{const prose=el.querySelector('.vg-record-prose'),r=el.getBoundingClientRect(),scroller=el.querySelector('[data-modal-scroll]'),cs=getComputedStyle(prose);return {bg:getComputedStyle(el).backgroundColor,color:cs.color,font:parseFloat(cs.fontSize),lineHeight:parseFloat(cs.lineHeight),rootFont:parseFloat(getComputedStyle(document.documentElement).fontSize),width:r.width,height:r.height,x:r.x,overflow:scroller.scrollWidth>scroller.clientWidth+1,pageOverflow:document.documentElement.scrollWidth>innerWidth,scrollable:scroller.scrollHeight>scroller.clientHeight,metadataBeforeBody:!!(el.querySelector('.vg-record-metadata').compareDocumentPosition(prose)&Node.DOCUMENT_POSITION_FOLLOWING),text:prose.textContent,...window.stage2Samples.snapshot()};});
  check(data.mobileLayout&&data.IS_MOBILE&&!data.native,label+' real mobile route');check(!data.overflow&&!data.pageOverflow&&data.x>=0&&data.width<=width+1,label+' no horizontal clipping',data);check(data.bg===(theme==='dark'?'rgb(16, 21, 29)':'rgb(244, 242, 237)'),label+' dark remains graphite, light is paper');check(data.height>=height-2&&data.scrollable,label+' full-height single reading scroll');check(data.metadataBeforeBody&&data.text.includes('那句没说完的话'),label+' current source/scope before stored prose');check(data.font>=16&&data.lineHeight/data.font>=1.7,label+' readable prose rhythm',data.font);
  if(font===200)check(data.rootFont>=28&&data.font>=28,label+' actual200% text retained');
  await page.screenshot({path:out+'/'+label+'.png'});report.screenshots.push({file:label+'.png',data});
  const summary=dialog.locator('summary');await summary.click();await dialog.getByText('以下是当前保存的来源片段，不是收藏时的历史快照。',{exact:true}).waitFor();check(await dialog.locator('.border-l-2').count()===8,label+' initial source read stays bounded to8');await dialog.getByRole('button',{name:'加载更早的片段',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.vg-record-paper .border-l-2').length===12);check(true,label+' explicit source expansion reads remaining4');
  await dialog.getByRole('button',{name:'返回',exact:true}).click();await dialog.waitFor({state:'hidden'});check(await trigger.evaluate(el=>document.activeElement===el),label+' close restores actual list trigger focus');
  if(width===390){
   await page.evaluate(()=>window.stage2Samples.holdReading());await trigger.click();await dialog.getByText('正在读取当前记录…',{exact:true}).waitFor();check(await dialog.locator('.vg-record-prose').count()===0,theme+' pending selected read has no old prose');await page.evaluate(()=>window.stage2Samples.releaseReading());await dialog.locator('.vg-record-prose').waitFor();await dialog.getByRole('button',{name:'返回',exact:true}).click();await dialog.waitFor({state:'hidden'});
   await page.evaluate(()=>window.stage2Samples.failNextReading());await trigger.click();await dialog.getByRole('alert').waitFor();await dialog.getByRole('button',{name:'重新读取',exact:true}).click();await dialog.locator('.vg-record-prose').waitFor();check(true,theme+' failed selected read can retry');
   await page.evaluate(()=>window.stage2Samples.removeReadingSource());await dialog.locator('summary').click();await dialog.getByText('原始来源已不可用，可能已删除、撤回或移出当前范围。上方仅保留当前保存的摘要。',{exact:true}).waitFor();check(await dialog.locator('.border-l-2').count()===0,theme+' deleted source never leaves old source text');
   await page.evaluate(()=>window.stage2Samples.revokeReading());await dialog.getByText('这条记录已不可用，可能已删除、移出当前世界或调整为私密。旧内容不再展示。',{exact:true}).waitFor();check(await dialog.locator('.vg-record-prose').count()===0,theme+' moved record removes old prose');
  }
  const isolation=await page.evaluate(()=>window.stage2Samples.snapshot());check(Object.values(isolation.isolation).every(n=>n===0)&&isolation.requests===0&&isolation.extraNetwork===0,label+' zero model/media/native calls',isolation.isolation);await page.close();
 }
 check(report.errors.length===0,'no runtime errors',report.errors);report.pass=true;
}catch(e){report.pass=false;report.failure=e.stack;process.exitCode=1;}
finally{report.source=server.manifest;writeFileSync(out+'/result.json',JSON.stringify(report,null,2));await browser.close();await new Promise(r=>server.server.close(r));}
console.log(JSON.stringify({out,pass:report.pass,checks:report.checks.length,failure:report.failure}));
