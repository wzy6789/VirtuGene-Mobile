import {chromium} from 'playwright';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import assert from 'node:assert/strict';
const out=process.env.VG_CHAT_DETAILS_OUT??'.tmp-preview/stage2-ui-20261018/S08-A2/details';mkdirSync(out,{recursive:true});
const address=process.env.VG_CHAT_DETAILS_ADDRESS??'http://127.0.0.1:5300';
const browser=await chromium.launch({channel:'chrome'}),report={checks:[],limitations:['Actual components, synthetic records, no model/audio/native calls.','CSS entrance states inspected on the actual saved message row; no synthetic message is persisted.']};
const check=(ok,name,data)=>{report.checks.push({pass:!!ok,name,data});assert(ok,name+' '+JSON.stringify(data??''));};
try{
 for(const theme of ['dark','light']){
  const page=await browser.newPage({viewport:{width:320,height:640},isMobile:true,hasTouch:true,reducedMotion:'no-preference'});
  await page.goto(address+`/app?virtugene-preview=mobile&sample=chat&theme=${theme}`);await page.locator('.chat-room.vg-chat-paper').waitFor();
  const initialHeader=await page.locator('.chat-header').evaluate(el=>el.getBoundingClientRect().height);check(initialHeader>=55&&initialHeader<=57,theme+' standard header is56px',initialHeader);
  const name='古月娜与远方星河的守望者';await page.evaluate(name=>window.stage2Samples.readingPreferences(name,false),name);
  await page.waitForFunction(name=>document.querySelector('.chat-header [role=heading]')?.textContent===name,name);
  for(const font of [100,200]){
   await page.evaluate(font=>document.documentElement.style.setProperty('font-size',font+'%','important'),font);
   const data=await page.evaluate(()=>{const h=document.querySelector('.chat-header'),t=h.querySelector('[role=heading]'),r=t.getBoundingClientRect(),hr=h.getBoundingClientRect();return{height:r.height,line:parseFloat(getComputedStyle(t).lineHeight),title:t.title,header:hr.height,buttons:[...h.querySelectorAll('button')].filter(b=>b.getBoundingClientRect().width).map(b=>{const r=b.getBoundingClientRect();return{w:r.width,h:r.height,x:r.x,right:r.right};}),overflow:document.documentElement.scrollWidth>innerWidth};});
   check(!data.overflow&&data.buttons.every(b=>b.w>=44&&b.h>=44&&b.x>=0&&b.right<=321),theme+font+' long name preserves touch targets',data);
   check(data.title===name&&data.height<=data.line*2+1,theme+font+' name capped at two lines with full title',data);
   await page.screenshot({path:out+`/${theme}-long-name-font${font}.png`});
  }
  await page.evaluate(()=>document.documentElement.style.setProperty('font-size','100%','important'));
  const animation=()=>page.locator('.vg-chat-message-row').first().evaluate(row=>{const c=row.querySelector('.vg-chat-message-content');return{name:getComputedStyle(c).animationName,duration:getComputedStyle(c).animationDuration};});
  check((await animation()).name==='none',theme+' historical rows have no entrance');
  await page.locator('.vg-chat-message-row').first().evaluate(row=>row.classList.add('animate-message-in'));
  check((await animation()).name==='vg-chat-paper-arrive'&&(await animation()).duration==='0.2s',theme+' new saved row uses 200ms entrance');
  await page.evaluate(()=>document.documentElement.dataset.vgReducedMotion='true');
  check((await animation()).name==='none',theme+' application reduced motion suppresses new row entrance',await animation());
  await page.evaluate(()=>delete document.documentElement.dataset.vgReducedMotion);await page.emulateMedia({reducedMotion:'reduce'});
  check((await animation()).name==='none',theme+' system reduced motion suppresses new row entrance');
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.locator('.vg-chat-message-row').first().evaluate(row=>row.dataset.streamed='true');
  check((await animation()).name==='none',theme+' saved streamed row never replays entrance');
  const isolated=await page.evaluate(()=>window.stage2Samples.snapshot());check(isolated.requests===0&&isolated.extraNetwork===0&&Object.values(isolated.isolation).every(n=>n===0),theme+' no model/media/native attempts');await page.close();
 }
 report.pass=true;
}catch(e){report.pass=false;report.failure=e.stack;process.exitCode=1;}
finally{writeFileSync(out+'/result.json',JSON.stringify(report,null,2));await browser.close();}
console.log(JSON.stringify({out,pass:report.pass,checks:report.checks.length,failure:report.failure}));
