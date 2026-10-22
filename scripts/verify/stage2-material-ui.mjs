import {uiSystemPreview} from '../preview-ui-system.mjs';
import {chromium} from 'playwright';
import {mkdirSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const out='.tmp-preview/stage2-ui-20261018/S02';
mkdirSync(out,{recursive:true});
const server=await uiSystemPreview({port:0,watch:false,output:out+'/server'}),browser=await chromium.launch({channel:'chrome'});
const report={checks:[],screenshots:[],errors:[],limits:['Candidate tokens applied only to sample root; production application theme remains unchanged.','No V1/V2 approval implied; no Android verification.']};
try{
 for(const theme of ['dark','light'])for(const [width,font] of [[390,100],[320,200]]){
  const page=await browser.newPage({viewport:{width,height:844},reducedMotion:'reduce'});page.on('pageerror',e=>report.errors.push(e.message));
  await page.goto(server.address+'/?theme='+theme);await page.waitForFunction(()=>!!window.uiSystemContract);
  const old=await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--bg'));
  await page.evaluate(font=>{document.querySelector('main').classList.add('vg-light-paper');document.documentElement.style.fontSize=font+'%';const style=document.createElement('style');style.textContent='main.vg-light-paper{background:var(--bg);color:var(--text)}main.vg-light-paper .contract-two-columns,main.vg-light-paper .contract-state-grid{grid-template-columns:minmax(0,1fr)}main.vg-light-paper button{font-size:max(15px,.9375rem);white-space:normal}main.vg-light-paper h2{font-size:max(18px,1.125rem)}main.vg-light-paper p,main.vg-light-paper label{font-size:max(13px,.8125rem)}';document.head.append(style);},font);
  await page.evaluate(()=>document.fonts.ready);
  // Preference installation can commit after first paint. Wait for the actual
  // scoped sample colors, then apply text zoom without a pending root reset.
  await page.waitForFunction(theme=>getComputedStyle(document.querySelector('main')).backgroundColor===(theme==='dark'?'rgb(16, 21, 29)':'rgb(244, 242, 237)'),theme);
  await page.evaluate(font=>document.documentElement.style.setProperty('font-size',font+'%','important'),font);
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  const data=await page.evaluate(()=>{const root=document.querySelector('main'),s=getComputedStyle(root);const rgb=v=>v.match(/[\d.]+/g).slice(0,3).map(Number);const lum=c=>rgb(c).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0);const ratio=(a,b)=>(Math.max(lum(a),lum(b))+.05)/(Math.min(lum(a),lum(b))+.05);const b=root.querySelector('.vg-button-primary:not(:disabled)'),bs=getComputedStyle(b);return {body:ratio(s.color,s.backgroundColor),action:ratio(bs.color,bs.backgroundColor),pageBg:s.backgroundColor,globalBg:getComputedStyle(document.documentElement).getPropertyValue('--bg'),overflow:document.documentElement.scrollWidth>innerWidth,rootFont:getComputedStyle(document.documentElement).fontSize,isolation:window.uiContractIsolation};});
  assert(data.body>=7&&data.action>=4.5&&!data.overflow&&data.globalBg===old,JSON.stringify(data));assert(Object.values(data.isolation).every(n=>n===0));
  report.checks.push({theme,width,font,pass:true,data});
  await page.locator('#forms').scrollIntoViewIfNeeded();const file=`${theme}-${width}-font${font}.png`;await page.screenshot({path:out+'/'+file});report.screenshots.push(file);
  await page.close();
 }
 assert.equal(report.errors.length,0);report.pass=true;
}catch(e){report.pass=false;report.failure=e.stack;process.exitCode=1;}
finally{writeFileSync(out+'/result.json',JSON.stringify(report,null,2));await browser.close();await server.close();}
console.log(JSON.stringify({pass:report.pass,checks:report.checks.length,failure:report.failure}));
