import {chromium} from 'playwright';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const out='.tmp-preview/stage2-ui-20261018/S04/live';mkdirSync(out,{recursive:true});
const manifest=JSON.parse(readFileSync('.tmp-preview/stage2-ui-20261018/S04/settled-preview/source-hashes.json','utf8'));
const sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex');const drift=()=>manifest.inputs.filter(i=>existsSync(i.path)&&sha(i.path)!==i.sha256);
const browser=await chromium.launch({channel:'chrome'}),report={at:new Date().toISOString(),checks:[],screenshots:[],errors:[],source:manifest,limits:['Actual isolated mobile components, synthetic records; no user account or native device.','No production model/microphone/playback/native bridge attempts.','Static artwork; the visual reviewer is the current assistant, runtime model/reasoning unconfirmed.']};
const check=(ok,name,detail)=>{report.checks.push({pass:!!ok,name,detail});assert(ok,name+' '+JSON.stringify(detail??''));};
try{
 check(drift().length===0,'live source identity matches current worktree',drift());
 for(const theme of ['dark','light'])for(const [name,query,selector]of [['directory','state=mixed-status&view=stage','.vg-stage-list'],['detail','state=six&view=detail','.vg-sector-title'],['reader','state=reader-sample&view=canvas','.vg-stream'],['finished','state=reader-sample&view=canvas&sceneState=finished','.vg-canvas-finished']]){
  const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1,reducedMotion:'reduce'});page.setDefaultTimeout(8000);page.on('pageerror',e=>report.errors.push(e.message));const url=`http://127.0.0.1:5296/app?virtugene-preview=mobile&theme=${theme}&${query}`;await page.goto(url);await page.locator(selector).waitFor();await page.evaluate(async()=>{await document.fonts.ready;const cover=document.querySelector('.vg-sector-cover img');if(cover)await cover.decode().catch(()=>{});await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
  if(name==='reader'||name==='finished')await page.locator('.vg-canvas-scroll').evaluate(el=>{el.scrollTop=0;el.dispatchEvent(new Event('scroll'));});
  const data=await page.evaluate(()=>window.starfieldPreview.snapshot());check(data.mobileLayout&&data.IS_MOBILE&&!data.native,theme+' '+name+' actual mobile identity');check(Object.values(data.isolation).every(n=>n===0),theme+' '+name+' zero model/media/native attempts',data.isolation);check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),theme+' '+name+' no horizontal overflow');
  if(name==='finished'){check(await page.getByRole('textbox',{name:'世界消息内容',exact:true}).count()===0,theme+' finished scene stays read-only');check(await page.getByRole('button',{name:'返回星域',exact:true}).isVisible(),theme+' finished has visible return');}
  const file=`${name}-${theme}-390.png`;await page.screenshot({path:out+'/'+file});report.screenshots.push({file,url,at:new Date().toISOString(),viewport:{width:390,height:844,dpr:1,font:100,safeArea:'browser env zero'},data});await page.close();
 }
 check(report.errors.length===0,'no runtime errors',report.errors);check(drift().length===0,'sources stayed unchanged',drift());report.pass=true;
}catch(e){report.pass=false;report.failure=e.stack;process.exitCode=1;}
finally{await browser.close();writeFileSync(out+'/result.json',JSON.stringify(report,null,2));}
console.log(JSON.stringify({out,pass:report.pass,checks:report.checks.length,failure:report.failure}));
