// Focused P9 palette/state coverage; not a repeat of the full application suite.
import {uiSystemPreview} from '../preview-ui-system.mjs';
import {chromium} from 'playwright';
import {mkdirSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const out=process.env.VG_STATE_COLORS_OUT??`.tmp-preview/starfield-upgrade-20261017/P9/state-colors-${Date.now()}`;
mkdirSync(out,{recursive:true});
const preview=await uiSystemPreview({port:0,watch:false,output:out+'/preview'}),browser=await chromium.launch({channel:'chrome',headless:true});
const report={at:new Date().toISOString(),samples:[],errors:[],limits:['Production CSS token/state contract samples plus real FeedbackNotice and input; CSS samples do not claim every business handler was exercised.','Disabled text has no WCAG AA minimum; report its actual contrast without claiming4.5.','DOM computed-color compositing at the flat sample surface; no Android/physical display assertion.']};
async function inspect(locator){return locator.evaluate(el=>{
 const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d');
 const rgba=value=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=value;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data].map((v,i)=>i===3?v/255:v);};
 const over=(a,b,opacity=1)=>a.slice(0,3).map((v,i)=>v*a[3]*opacity+b[i]*(1-a[3]*opacity));
 let bg=[255,255,255];const ancestors=[];for(let n=el.parentElement;n;n=n.parentElement)ancestors.unshift(n);
 for(const n of ancestors){const s=getComputedStyle(n);bg=over(rgba(s.backgroundColor),bg,Number(s.opacity));}
 const s=getComputedStyle(el),parent=bg,ownBg=over(rgba(s.backgroundColor),parent),fg=over(rgba(s.color),ownBg);
 const group=rgb=>rgb.map((v,i)=>v*Number(s.opacity)+parent[i]*(1-Number(s.opacity)));
 const luminance=rgb=>rgb.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0);
 const a=luminance(group(fg)),b=luminance(group(ownBg)),r=el.getBoundingClientRect();
 return {foreground:s.color,background:s.backgroundColor,backgroundImage:s.backgroundImage,opacity:s.opacity,contrast:(Math.max(a,b)+.05)/(Math.min(a,b)+.05),width:r.width,height:r.height,outline:s.outlineStyle,outlineWidth:parseFloat(s.outlineWidth),focusVisible:el.matches(':focus-visible'),disabled:el.disabled,hover:el.matches(':hover'),active:el.matches(':active')};
});}
try{
 for(const theme of ['dark','light']){
  const page=await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'});page.on('pageerror',e=>report.errors.push(e.message));
  await page.goto(preview.address+'/?theme='+theme);await page.waitForFunction(()=>!!window.uiSystemContract);await page.evaluate(()=>document.fonts.ready);
  // Sample the exact shipped semantic classes, without inventing business state.
  await page.evaluate(()=>{const host=document.createElement('section');host.id='p9-states';host.style.cssText='display:grid;gap:16px;padding:20px;background:var(--bg-panel)';for(const variant of ['primary','secondary','ghost','danger']){const b=document.createElement('button');b.type='button';b.className='vg-button vg-button-'+variant;b.textContent='操作状态样本';b.dataset.p9Variant=variant;host.append(b);}document.querySelector('main').append(host);});
  for(const variant of ['primary','secondary','ghost','danger']){
   const target=page.locator('[data-p9-variant="'+variant+'"]');await target.scrollIntoViewIfNeeded();await page.mouse.move(0,0);
   const normal=await inspect(target);assert(normal.contrast>=4.5&&normal.height>=44&&normal.width>=44,theme+'/'+variant+' normal');
   await target.hover();await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));const hover=await inspect(target);assert(hover.hover&&hover.contrast>=4.5,theme+'/'+variant+' hover');
   await page.mouse.down();await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));const pressed=await inspect(target);report.currentProbe={theme,variant,pressed};assert(pressed.active&&pressed.contrast>=4.5,theme+'/'+variant+' pressed '+JSON.stringify(pressed));await page.mouse.up();
   await page.keyboard.press('Tab');await target.focus();const focus=await inspect(target);assert(focus.focusVisible&&focus.outline!=='none'&&focus.outlineWidth>=2&&focus.contrast>=4.5,theme+'/'+variant+' keyboard focus');
   await target.evaluate(el=>{el.disabled=true;});const disabled=await inspect(target);assert(disabled.disabled&&Number(disabled.opacity)<Number(normal.opacity),theme+'/'+variant+' disabled');
   report.samples.push({theme,variant,normal,hover,pressed,focus,disabled});
  }
  const draft=page.getByLabel('聊天草稿',{exact:true});await draft.fill('失败后保留这条草稿');await page.getByRole('button',{name:'模拟保存失败',exact:true}).click();const notice=page.getByText('示例保存失败，输入内容已保留。',{exact:true});await notice.waitFor();
  const error=await inspect(notice);assert(error.contrast>=4.5&&await draft.inputValue()==='失败后保留这条草稿',theme+' real failure notice');report.samples.push({theme,variant:'actual-error-notice',error});
  const isolation=await page.evaluate(()=>window.uiContractIsolation);assert(Object.values(isolation).every(n=>n===0));
  await page.close();
 }
 assert.equal(report.errors.length,0);report.pass=true;
}catch(e){report.pass=false;report.failure=e.stack;process.exitCode=1;}
finally{writeFileSync(out+'/result.json',JSON.stringify(report,null,2));await browser.close();await preview.close();}
console.log(JSON.stringify({out,pass:report.pass,samples:report.samples.length,failure:report.failure}));
