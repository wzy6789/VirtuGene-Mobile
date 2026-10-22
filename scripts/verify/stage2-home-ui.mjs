import {chromium} from 'playwright';
import {starfieldPreview} from '../preview-starfield-upgrade.mjs';
import {mkdirSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const out=process.env.VG_STAGE2_HOME_OUT??'.tmp-preview/stage2-ui-20261018/S03-B1/checks';mkdirSync(out,{recursive:true});
const server=await starfieldPreview({port:0,output:out+'/server'}),browser=await chromium.launch({channel:'chrome'});
const report={checks:[],screenshots:[],errors:[],limitations:['Actual MobileLayout, isolated synthetic records, not signed-in sidebar or Android.','No homepage full-screen background bitmap: existing SVG orb and real text/controls.']};
const check=(pass,name,detail)=>{report.checks.push({pass:!!pass,name,detail});assert(pass,name+' '+JSON.stringify(detail??''));};
try{
 for(const theme of ['dark','light'])for(const [width,height,font,state] of [[390,844,100,'home-sample'],[320,640,100,'home-sample'],[360,800,100,'home-sample'],[320,640,200,'long-name'],[430,932,100,'home-sample']]){
  const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:1,isMobile:true,hasTouch:true,reducedMotion:'reduce'});page.setDefaultTimeout(8000);page.on('pageerror',e=>report.errors.push(e.message));
  await page.goto(server.address+`/app?virtugene-preview=mobile&theme=${theme}&state=${state}`);await page.getByRole('button',{name:'聊一聊',exact:true}).waitFor();await page.evaluate(async()=>{await document.fonts.ready;window.starfieldPreview.motion(false);});
  if(font!==100)await page.evaluate(f=>document.documentElement.style.setProperty('font-size',f+'%','important'),font);
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  const label=`${theme}-${width}-font${font}`;
  const data=await page.evaluate(()=>{const root=document.querySelector('.vg-world-page'),buttons=[...root.querySelectorAll('.vg-world-assistant button')],rect=el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right};};return {bg:getComputedStyle(root).backgroundColor,overflow:document.documentElement.scrollWidth>innerWidth,rootFont:parseFloat(getComputedStyle(document.documentElement).fontSize),buttons:buttons.map(rect),recent:root.querySelectorAll('.vg-world-recent').length,nav:document.querySelector('[aria-label="主导航"]')?.textContent,...window.starfieldPreview.snapshot()};});
  check(data.IS_MOBILE&&data.mobileLayout&&!data.native,label+' actual mobile');check(!data.overflow,label+' no horizontal overflow');check(data.bg===(theme==='dark'?'rgb(16, 21, 29)':'rgb(244, 242, 237)'),label+' approved scoped palette',data.bg);check(data.buttons.length===2&&data.buttons.every(b=>b.width>=44&&b.height>=48),label+' both primary actions remain reachable',data.buttons);
  if(font===100)check(Math.abs(data.buttons[0].y-data.buttons[1].y)<1,label+' chat left and today right share one row');
  else check(data.rootFont>=28&&data.buttons[0].y<=data.buttons[1].y,label+' actual200% text keeps primary first');
  if(state==='home-sample')check(data.recent===1,label+' one real stored recent record');
  check(Object.values(data.isolation).every(n=>n===0),label+' zero model/media/native attempts',data.isolation);
  const file=label+'.png';await page.screenshot({path:out+'/'+file});report.screenshots.push({file,data});
  if(width===390){
   await page.getByRole('button',{name:'助理空间',exact:true}).click();await page.locator('.vg-assistant-hub').waitFor();check(await page.locator('.vg-assistant-tabs [aria-current="page"]').innerText()==='今日',theme+' secondary opens actual today');await page.getByRole('button',{name:'返回世界',exact:true}).click();await page.getByRole('button',{name:'聊一聊',exact:true}).waitFor();
   await page.getByRole('button',{name:'聊一聊',exact:true}).click();await page.locator('.vg-assistant-hub').waitFor();check(await page.locator('.vg-assistant-tabs [aria-current="page"]').innerText()==='对话',theme+' primary opens actual chat');const picker=page.getByRole('dialog',{name:'选择对话模型',exact:true});if(await picker.isVisible())await picker.getByRole('button',{name:'返回',exact:true}).click();await page.getByRole('button',{name:'返回世界',exact:true}).click();
   await page.evaluate(()=>window.starfieldPreview.setState('empty'));await page.getByRole('button',{name:'聘用生活助理',exact:true}).waitFor();check(await page.locator('.vg-world-assistant button').count()===1,theme+' unhired has real hire path, no fake chat');
  }
  await page.close();
 }
 check(report.errors.length===0,'no runtime errors',report.errors);report.pass=true;
}catch(e){report.pass=false;report.failure=e.stack;process.exitCode=1;}
finally{report.source=server.manifest;writeFileSync(out+'/result.json',JSON.stringify(report,null,2));await browser.close();await new Promise(r=>server.server.close(r));}
console.log(JSON.stringify({out,pass:report.pass,checks:report.checks.length,failure:report.failure}));
