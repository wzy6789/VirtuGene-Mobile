/** V2 gap only: the real sample at its confirmed live origin, resized viewport.
 * This verifies browser layout continuity; it cannot prove Android IME behavior.
 */
import {chromium} from 'playwright';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

const out=process.env.VG_STAGE2_KEYBOARD_OUT??'.tmp-preview/stage2-ui-20261018/S03-B/keyboard';mkdirSync(out,{recursive:true});
const manifest=JSON.parse(readFileSync(process.env.VG_STAGE2_KEYBOARD_MANIFEST??'.tmp-preview/stage2-ui-20261018/S03-B/v2-preview/source-hashes.json','utf8'));
const sha=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
const drift=()=>manifest.inputs.filter(input=>existsSync(input.path)&&sha(input.path)!==input.sha256);
const report={at:new Date().toISOString(),checks:[],cases:[],errors:[],source:manifest.bundleSha256,model:'未确认',reasoningEffort:'未确认',limitations:['Viewport resizing while a real composer is focused, not an Android keyboard or visualViewport-only native resize.','Actual MobileLayout/ChatPage/ChatWindow on isolated origin; source manifest records whether sample presentation is injected.','No real model, microphone, audio, native bridge or new image-generation call.','History prepend races are checked separately in stage2-chat-history.']};
const check=(ok,name,detail)=>{report.checks.push({pass:!!ok,name,detail});assert(ok,name+' '+JSON.stringify(detail??''));};
let browser;
try{
 check(drift().length===0,'live sample source still matches current worktree',drift());
 browser=await chromium.launch({channel:'chrome'});
 for(const theme of ['dark','light'])for(const [width,height,shortHeight,font] of [[390,844,520,100],[320,640,420,100],[320,640,420,200]]){
  const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:1,isMobile:true,hasTouch:true,reducedMotion:'reduce'});page.setDefaultTimeout(7000);page.on('pageerror',e=>report.errors.push(e.message));
  await page.goto(`${process.env.VG_STAGE2_KEYBOARD_ADDRESS??'http://127.0.0.1:5294'}/app?virtugene-preview=mobile&theme=${theme}&sample=chat`);await page.waitForFunction(()=>window.stage2Ready||window.stage2Error);check(!await page.evaluate(()=>window.stage2Error),'sample startup');
  const input=page.getByRole('textbox',{name:'消息内容',exact:true});await input.waitFor();await page.evaluate(()=>document.fonts.ready);
  if(font!==100)await page.evaluate(font=>document.documentElement.style.setProperty('font-size',font+'%','important'),font);
  const savedBefore=await page.evaluate(()=>window.stage2Samples.records());
  const draft='键盘收起后，草稿仍留在这里。';await input.fill(draft);await input.focus();
  await page.setViewportSize({width,height:shortHeight});
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  const data=await page.evaluate(()=>{
   const rect=el=>{const r=el.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,right:r.right};};
   const room=document.querySelector('.vg-chat-paper'),input=room.querySelector('textarea'),thread=room.querySelector('[aria-label="聊天记录"]');
   const buttons=[...room.querySelectorAll('.chat-composer button')].filter(el=>el.getBoundingClientRect().width&&getComputedStyle(el).visibility!=='hidden');
   return{room:rect(room),input:rect(input),thread:rect(thread),focused:document.activeElement===input,overflow:document.documentElement.scrollWidth>innerWidth,font:parseFloat(getComputedStyle(input).fontSize),buttons:buttons.map(rect),snapshot:window.stage2Samples.snapshot()};
  });
  const label=`${theme}-${width}-font${font}`;
  check(!data.overflow,label+' reduced viewport has no horizontal overflow');
  check(data.focused&&data.input.y>=0&&data.input.bottom<=shortHeight+1,label+' focused composer stays inside reduced viewport',data.input);
  check(data.thread.height>=64,label+' reduced viewport keeps a readable message area',data.thread);
  check(data.buttons.length>=3&&data.buttons.every(r=>r.width>=44&&r.height>=44&&r.right<=width+1&&r.bottom<=shortHeight+1),label+' composer controls keep usable targets',data.buttons);
  if(font===200)check(data.font>=28,label+' actual enlarged composer text remains enlarged',data.font);
  await page.screenshot({path:out+'/'+label+'-short.png'});
  await input.blur();await page.setViewportSize({width,height});await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  check(await input.inputValue()===draft,label+' draft survives viewport restore');
  const after=await page.evaluate(async()=>({snapshot:window.stage2Samples.snapshot(),rows:await window.stage2Samples.records(),inputBottom:document.querySelector('textarea').getBoundingClientRect().bottom}));
  check(JSON.stringify(after.rows)===JSON.stringify(savedBefore),label+' layout changes do not mutate stored messages');
  check(after.inputBottom<=height+1,label+' restored composer is still on screen');
  check(after.snapshot.requests===0&&after.snapshot.extraNetwork===0&&Object.values(after.snapshot.isolation).every(n=>n===0),label+' zero model/media/native attempts',after.snapshot.isolation);
  report.cases.push({theme,width,height,shortHeight,font,data});await page.close();
 }
 check(drift().length===0,'source remained unchanged throughout check',drift());check(report.errors.length===0,'no runtime errors',report.errors);report.pass=true;
}catch(error){report.pass=false;report.failure=error.stack;process.exitCode=1;}
finally{if(browser)await browser.close();writeFileSync(out+'/result.json',JSON.stringify(report,null,2));}
console.log(JSON.stringify({out,pass:report.pass,checks:report.checks.length,failure:report.failure}));
