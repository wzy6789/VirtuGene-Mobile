import {chromium} from 'playwright';
import {mkdirSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const out='.tmp-preview/stage2-ui-20261018/S03-B/live';mkdirSync(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome'}),report={pages:[],checks:[],errors:[]};
const check=(ok,name,detail)=>{report.checks.push({pass:!!ok,name,detail});assert(ok,name);};
const ratio=(a,b)=>{const lum=s=>{const n=s.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});return n[0]*.2126+n[1]*.7152+n[2]*.0722;};const x=lum(a),y=lum(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
try{
 for(const theme of ['dark','light'])for(const sample of ['home','chat','reading']){
  const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1,reducedMotion:'reduce'});page.on('pageerror',e=>report.errors.push(e.message));
  const url=`http://127.0.0.1:5294/app?virtugene-preview=mobile&theme=${theme}&sample=${sample}${sample==='home'?'&state=home-sample':sample==='reading'?'&open=record':''}`;
  await page.goto(url);await page.waitForFunction(()=>window.stage2Ready||window.stage2Error);check(!await page.evaluate(()=>window.stage2Error),sample+' fixture ready');
  const selector=sample==='home'?'.vg-world-home-sample':sample==='chat'?'.vg-chat-paper':'.vg-record-paper';await page.locator(selector).waitFor();await page.evaluate(()=>document.fonts.ready);
  await page.evaluate(async selector=>{const root=document.querySelector(selector),url=getComputedStyle(root,'::before').backgroundImage.match(/url\(["']?(.*?)["']?\)/)?.[1];if(url){const bitmap=new Image();bitmap.src=url;await bitmap.decode();}await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));},selector);
  const data=await page.evaluate(({selector,sample})=>{const root=document.querySelector(selector),cs=getComputedStyle(root);const targets=sample==='chat'?[...root.querySelectorAll('.vg-message-bubble')]:sample==='reading'?[root.querySelector('.vg-record-prose'),root.querySelector('.vg-record-metadata')]:[root.querySelector('.vg-world-head p'),root.querySelector('.vg-world-assistant button')];return {bg:cs.backgroundColor,text:targets.filter(Boolean).map(el=>{const s=getComputedStyle(el);return{color:s.color,bg:s.backgroundColor,font:s.fontSize,weight:s.fontWeight,copy:el.textContent.slice(0,30)};}),pseudo:sample==='chat'?getComputedStyle(root,'::before').backgroundImage:undefined,...window.stage2Samples.snapshot()};},{selector,sample});
  check(data.mobileLayout&&data.IS_MOBILE,theme+' '+sample+' actual mobile shell');check(Object.values(data.isolation).every(n=>n===0)&&data.requests===0&&data.extraNetwork===0,theme+' '+sample+' isolated no model/media');
  for(const t of data.text){const bg=t.bg==='rgba(0, 0, 0, 0)'?data.bg:t.bg;t.contrast=ratio(t.color,bg);check(t.contrast>=4.5,theme+' '+sample+' readable text',t);}
  const file=`${sample}-${theme}-390.png`;await page.screenshot({path:out+'/'+file});report.pages.push({sample,theme,url,file,at:new Date().toISOString(),fontScale:100,safeArea:'browser env, zero',motion:'system reduce + application reduce; static sample',data});await page.close();
 }
 check(report.errors.length===0,'no runtime errors',report.errors);report.pass=true;
}catch(e){report.pass=false;report.failure=e.stack;process.exitCode=1;}
finally{writeFileSync(out+'/result.json',JSON.stringify(report,null,2));await browser.close();}
console.log(JSON.stringify({out,pass:report.pass,checks:report.checks.length,failure:report.failure}));
