import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import {mkdirSync,writeFileSync} from 'node:fs';
import {productPreview} from '../preview-product-upgrade.mjs';
const out=process.env.VG_DIARY_LAYOUT_OUT??'.tmp-preview/stage2-ui-20261018/S10-E/layout';mkdirSync(out,{recursive:true});
const preview=await productPreview({port:0,production:true,output:out+'/server'}),browser=await chromium.launch({channel:'chrome'});
const report={checks:[],cases:[],errors:[],axe:[],scope:'Actual DiaryPage/DiaryChatPage/DiaryView in MobileLayout, isolated long synthetic record. Computed text doubled, not Android IME/textZoom.'};
const check=(pass,name,data)=>report.checks.push({pass:!!pass,name,data});
try{
 for(const theme of process.env.VG_DIARY_OPTIONS_ONLY==='1'?['dark']:['dark','light'])for(const [width,height,scale]of process.env.VG_DIARY_OPTIONS_ONLY==='1'?[[320,480,2]]:[[390,844,1],[320,640,1],[320,640,2],[320,480,2]]){
  const context=await browser.newContext({viewport:{width,height},reducedMotion:'reduce'}),page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>report.errors.push(e.message));
  await page.goto(`${preview.address}/app?virtugene-preview=mobile&theme=${theme}`);await page.waitForFunction(()=>window.productUpgradeReady);const record=await page.evaluate(()=>productUpgradeTest.seedDiaryReading());
  const root=page.locator('.vg-diary').first();await root.getByRole('button',{name:'时间线',exact:true}).click();await root.getByText(record.title,{exact:true}).click();await page.getByRole('button',{name:'日记视图',exact:true}).click();await page.locator('.vg-diary-paper').waitFor();await page.evaluate(()=>document.fonts.ready);
  const enlarge=async()=>{
   if(scale!==2)return;
   await root.evaluate(root=>{
    window.diaryTextSizes??=new Map();
    // Newly mounted controls can inherit an already enlarged parent's font.
    // Restore the baseline synchronously before measuring them; do not turn200% into400%.
    for(const[n,v]of window.diaryTextSizes){n.style.fontSize=v.originalFont;n.style.lineHeight=v.originalLine;}
    for(const n of [root,...root.querySelectorAll('*')].filter(n=>n instanceof HTMLElement)){
     if(window.diaryTextSizes.has(n))continue;
     const s=getComputedStyle(n);window.diaryTextSizes.set(n,{originalFont:n.style.fontSize,originalLine:n.style.lineHeight,font:parseFloat(s.fontSize),line:parseFloat(s.lineHeight)});
    }
    for(const[n,v]of window.diaryTextSizes){n.style.fontSize=v.font*2+'px';if(Number.isFinite(v.line))n.style.lineHeight=v.line*2+'px';}
   });
  };await enlarge();
  const label=`${theme}-${width}-${height}-font${scale*100}`;
  const reading=await page.locator('.vg-diary-paper').evaluate(root=>({overflow:root.scrollWidth-root.clientWidth,title:root.querySelector('h1').textContent,text:root.textContent,font:parseFloat(getComputedStyle(root.querySelector('p')).fontSize),fonts:[...document.fonts].filter(f=>f.status==='loaded').length}));
  check(reading.overflow<=1&&reading.title===record.title&&reading.text.includes(record.content.split('\n\n').at(-1)),label+': complete long title and12 paragraphs reflow',reading);
  check(reading.fonts>0&&(scale===1||reading.font>=28),label+': actual font loaded and text scale applied',{font:reading.font,fonts:reading.fonts});
  await page.screenshot({path:`${out}/${label}-reading.png`});
  if(width===390){const axe=await new AxeBuilder({page}).include('.vg-diary-paper').withRules(['color-contrast']).analyze();report.axe.push({theme,violations:axe.violations,incomplete:axe.incomplete});check(axe.violations.length===0,label+': paper text contrast',axe.violations);}
  await page.getByRole('button',{name:'回到写作',exact:true}).click();const input=page.getByRole('textbox',{name:'写下日记片段',exact:true});await input.waitFor();await enlarge();await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  const writer=await input.evaluate(n=>{const r=n.getBoundingClientRect(),root=n.closest('.vg-diary'),p=root.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,bottom:r.bottom,rootBottom:p.bottom,overflow:root.scrollWidth-root.clientWidth};});
  report.cases.push({label,writer});check(writer.overflow<=1&&writer.w>=44&&writer.h>=44&&writer.bottom<=Math.min(height,writer.rootBottom)+1,label+': writer remains visible and no horizontal overflow',writer);
  await page.screenshot({path:`${out}/${label}-writer.png`});
  const text='失败后仍应完整保留，重试只写入一次。';await input.fill(text);await page.evaluate(()=>productUpgradeTest.diaryWriteFailure(true));await page.getByRole('button',{name:'保存日记片段',exact:true}).click();await page.getByText('尚未保存，内容仍在。',{exact:true}).waitFor();
  check(await input.inputValue()===text&&!(await page.evaluate(id=>productUpgradeTest.diaryRecord(id),record.id)).content.includes(text),label+': rejected write keeps input and does not change stored record');
  await enlarge();
  const failedInput=await input.evaluate(n=>{const r=n.getBoundingClientRect(),p=n.closest('.vg-diary').getBoundingClientRect();return{y:r.y,bottom:r.bottom,rootBottom:p.bottom};});check(failedInput.y>=0&&failedInput.bottom<=Math.min(height,failedInput.rootBottom)+1,label+': error notice does not cover or displace the input',failedInput);
  await page.screenshot({path:`${out}/${label}-write-error.png`});
  await page.getByRole('button',{name:'返回手账',exact:true}).click();check(await input.isVisible(),label+': unsaved error prevents losing record by back navigation');
  await page.evaluate(()=>productUpgradeTest.diaryWriteFailure(false));await page.getByRole('button',{name:'重试保存',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[aria-label="写下日记片段"]')?.value==='');
  const stored=await page.evaluate(id=>productUpgradeTest.diaryRecord(id),record.id);check(stored.content.split(text).length===2,label+': retry commits exactly once then clears input');
  if(scale===2){
   const toggle=page.getByRole('button',{name:'心情、天气与标签',exact:true});if(await toggle.isVisible()&&await toggle.getAttribute('aria-expanded')==='false')await toggle.click();
   const weather=page.getByRole('button',{name:'晴',exact:true});await weather.click();await page.waitForFunction(async id=>(await productUpgradeTest.diaryRecord(id)).weather==='☀️',record.id);check(await weather.getAttribute('aria-pressed')==='true',label+': scrolled weather option remains reachable and persists');
   await page.getByRole('navigation',{name:'主导航',exact:true}).waitFor({state:'visible'});
   await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
   const bounds=await input.evaluate(n=>{const r=n.getBoundingClientRect(),p=n.closest('.vg-diary').getBoundingClientRect();return{y:r.y,bottom:r.bottom,panelBottom:p.bottom};});check(bounds.y>=0&&bounds.bottom<=Math.min(height,bounds.panelBottom)+1,label+': operating auxiliary options keeps composer visible',bounds);
   await page.screenshot({path:`${out}/${label}-weather.png`});
  }
  if(width===390){
   const tools=page.getByRole('group',{name:'第1段操作',exact:true});await tools.getByRole('button',{name:'编辑这段',exact:true}).click();
   const edit=page.getByRole('textbox',{name:'编辑第1段',exact:true});await edit.fill('只在编辑框里的临时修改');await page.locator('.vg-diary-segment-editor').getByRole('button',{name:'取消',exact:true}).click();
   check((await page.evaluate(id=>productUpgradeTest.diaryRecord(id),record.id)).content===stored.content,label+': cancelling segment edit leaves persisted content unchanged');
   await tools.getByRole('button',{name:'编辑这段',exact:true}).click();const revised='编辑保存失败后仍留在当前页的段落';await edit.fill(revised);await page.evaluate(()=>productUpgradeTest.diaryWriteFailure(true));await page.locator('.vg-diary-segment-editor').getByRole('button',{name:'保存',exact:true}).click();await page.getByRole('button',{name:'重试保存',exact:true}).waitFor();
   check(await page.locator('.vg-diary-segment').filter({hasText:revised}).count()===1&&(await page.evaluate(id=>productUpgradeTest.diaryRecord(id),record.id)).content===stored.content,label+': failed edit remains visible with retry and persisted record untouched');
   await page.evaluate(()=>productUpgradeTest.diaryWriteFailure(false));await page.getByRole('button',{name:'重试保存',exact:true}).click();await page.getByRole('button',{name:'重试保存',exact:true}).waitFor({state:'hidden'});
   check((await page.evaluate(id=>productUpgradeTest.diaryRecord(id),record.id)).content.startsWith(revised),label+': edit retry persists the retained paragraph');
  }
  await page.getByRole('button',{name:'返回手账',exact:true}).click();await root.getByRole('heading',{name:'日记',exact:true}).waitFor();check(await root.getByText(record.title,{exact:true}).isVisible(),label+': return retains original record identity');
  check(Object.values((await page.evaluate(()=>productUpgradeTest.snapshot())).isolation).filter(v=>typeof v==='number').every(n=>n===0),label+': no model/media/native attempts');await context.close();
 }
 check(report.errors.length===0,'No runtime errors',report.errors);
}catch(e){report.failure=e.stack;}
finally{report.pass=!report.failure&&report.checks.every(c=>c.pass);writeFileSync(out+'/result.json',JSON.stringify(report,null,2));await browser.close();await new Promise(r=>preview.server.close(r));}
console.log(JSON.stringify({pass:report.pass,checks:report.checks.length,failed:report.checks.filter(c=>!c.pass).map(c=>({name:c.name,data:c.data})),failure:report.failure}));if(!report.pass)process.exitCode=1;
