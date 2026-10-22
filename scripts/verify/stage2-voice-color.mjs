import {chromium} from 'playwright';
import {mkdirSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const address=process.env.VG_VOICE_COLOR_ADDRESS??'http://127.0.0.1:5301',out=process.env.VG_VOICE_COLOR_OUT??'.tmp-preview/stage2-ui-20261018/S09-C2a/checks';mkdirSync(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome'}),report={checks:[],cases:[],scope:'Actual host/dialog/capsule, persisted role background in isolated IndexedDB. No real model/audio/capture.'};
const check=(ok,name,data)=>{report.checks.push({pass:!!ok,name,data});assert(ok,name+' '+JSON.stringify(data??''));};
try{
 for(const theme of ['dark','light']){
  const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,reducedMotion:'reduce'});await page.goto(address+'/?virtugene-preview=mobile&theme='+theme);await page.waitForFunction(()=>window.callUiTest);await page.evaluate(()=>callUiTest.hosted());await page.getByRole('button',{name:'收起通话',exact:true}).waitFor();
  const appearance=selector=>page.locator(selector+' .vg-soul-orb').evaluate(el=>{const c=getComputedStyle(el);return{body:c.getPropertyValue('--orb-body').trim(),rim:c.getPropertyValue('--orb-cyan').trim(),depth:c.getPropertyValue('--orb-depth').trim(),motion:el.dataset.orbIntensity,emotion:el.dataset.orbEmotion};});
  for(const color of ['mint','blue','rose','amber','violet','auto',null]){
   await page.evaluate(async color=>{callUiTest.globalOrbColor(color===null?'auto':'rose');await callUiTest.roleVisual(color,'lively');},color);await page.waitForFunction(()=>document.querySelector('.vg-voice-call-soul .vg-soul-orb')?.dataset.orbIntensity==='lively');await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));const full=await appearance('.vg-voice-call-soul');
   await page.getByRole('button',{name:'收起通话',exact:true}).click();await page.locator('.vg-voice-call-capsule').waitFor();const small=await appearance('.vg-voice-call-capsule');report.cases.push({theme,color,full,small});
   check(full.body===small.body&&full.rim===small.rim&&full.depth===small.depth,theme+':'+color+' preserves role palette in capsule',{full,small});check(small.motion==='lively'&&small.emotion===full.emotion,theme+':'+color+' preserves role motion preference and real state',{full,small});
   if(color==='mint'){await page.evaluate(()=>callUiTest.roleVisual('amber','gentle'));await page.waitForFunction(()=>document.querySelector('.vg-voice-call-capsule .vg-soul-orb')?.dataset.orbIntensity==='gentle');check((await appearance('.vg-voice-call-capsule')).body==='#d7a366',theme+' live role edit updates minimized face');}
   await page.getByRole('button',{name:/返回与晓来的语音通话/}).click();await page.getByRole('button',{name:'收起通话',exact:true}).waitFor();
  }
  check(Object.values(await page.evaluate(()=>voiceIsolation)).every(n=>n===0),theme+' no transport/capture/audio attempts');await page.close();
 }
 report.pass=true;
}catch(e){report.pass=false;report.failure=e.stack;process.exitCode=1;}
finally{await browser.close();writeFileSync(out+'/result.json',JSON.stringify(report,null,2));}
console.log(JSON.stringify({out,pass:report.pass,checks:report.checks.length,failure:report.failure}));
