import {chromium} from 'playwright';
import {starfieldPreview} from '../preview-starfield-upgrade.mjs';
import {mkdirSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const production=process.env.VG_STAGE2_CHAT_PRODUCTION==='1';
const out=process.env.VG_STAGE2_CHAT_OUT??'.tmp-preview/stage2-ui-20261018/S03-B2/checks';mkdirSync(out,{recursive:true});
const server=await starfieldPreview({port:0,output:out+'/server',stage2Samples:true,samplePresentation:!production}),browser=await chromium.launch({channel:'chrome'});
const report={checks:[],screenshots:[],errors:[],limitations:[production?'Actual MobileLayout/ChatPage without presentation-prop injection.':'Actual MobileLayout/ChatPage with a preview-only optional surface prop.','Independent origin, synthetic rows and controlled SSE transport; no real model or Android keyboard.','Prepend races checked separately in stage2-chat-history; browser keyboard simulation is not Android IME.']};
const check=(pass,name,detail)=>{report.checks.push({pass:!!pass,name,detail});assert(pass,name+' '+JSON.stringify(detail??''));};
try{
 for(const theme of ['dark','light'])for(const [width,height,font] of [[390,844,100],[320,640,100],[360,800,100],[430,932,100],[320,640,200]]){
  const page=await browser.newPage({viewport:{width,height},isMobile:true,hasTouch:true,deviceScaleFactor:1,reducedMotion:'reduce'});page.setDefaultTimeout(10000);page.on('pageerror',e=>report.errors.push(e.message));
  await page.goto(server.address+`/app?virtugene-preview=mobile&theme=${theme}&sample=chat`);await page.waitForFunction(()=>window.stage2Ready||window.stage2Error);check(!await page.evaluate(()=>window.stage2Error),'fixture starts');await page.locator('.chat-room').waitFor();if(production)check(await page.locator('.chat-room.vg-chat-paper').count()===1,'actual default ChatWindow uses accepted reading layout without injected surface prop');await page.locator('.vg-chat-paper').waitFor();await page.evaluate(()=>document.fonts.ready);
  if(font!==100)await page.evaluate(f=>document.documentElement.style.setProperty('font-size',f+'%','important'),font);
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  const label=`${theme}-${width}-font${font}`,data=await page.evaluate(()=>{const room=document.querySelector('.vg-chat-paper'),bubble=room.querySelector('.vg-message-bubble'),input=room.querySelector('textarea'),rect=el=>{const r=el.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right};};return {bg:getComputedStyle(room).backgroundColor,paletteBg:getComputedStyle(room).getPropertyValue('--chat-bg').trim(),overflow:document.documentElement.scrollWidth>innerWidth,rootFont:parseFloat(getComputedStyle(document.documentElement).fontSize),bubbleFont:parseFloat(getComputedStyle(bubble).fontSize),inputFont:parseFloat(getComputedStyle(input).fontSize),headerButtons:[...room.querySelectorAll('.chat-header button')].filter(b=>b.getBoundingClientRect().width).map(rect),text:room.textContent,...window.stage2Samples.snapshot()};});
  check(data.mobileLayout&&data.IS_MOBILE&&!data.native,label+' actual mobile shell');check(!data.overflow,label+' no horizontal overflow');if(production){const rgb=hex=>'rgb('+[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)).join(', ')+')';check(data.bg===rgb(data.paletteBg),label+' saved role palette retained rather than forced to sample colors',data);}else check(data.bg===(theme==='dark'?'rgb(16, 21, 29)':'rgb(244, 242, 237)'),label+' scoped graphite/paper surface',data.bg);check(data.text.includes('扉页上有人留下'),label+' real saved message');check(data.headerButtons.every(b=>b.width>=44&&b.height>=44&&b.x>=0&&b.right<=width+1),label+' header actions keep44px targets',data.headerButtons);
  if(font===200)check(data.rootFont>=28&&data.bubbleFont>=28&&data.inputFont>=28,label+' actual200% body and composer',data);
  await page.screenshot({path:out+'/'+label+'.png'});report.screenshots.push({file:label+'.png',data});
  const input=page.getByRole('textbox',{name:'消息内容',exact:true});await input.fill('留在这里的草稿');await input.blur();check(await input.inputValue()==='留在这里的草稿',label+' blur preserves composer draft');
  if(width===320){
   await page.evaluate(()=>window.chatStreamTest.submit('慢慢说'));await page.waitForFunction(()=>window.chatStreamTest.requests().length===1);const status=page.getByRole('status',{name:'正在回应',exact:true});await status.waitFor();const measure=await status.evaluate(el=>({height:el.getBoundingClientRect().height,line:parseFloat(getComputedStyle(el).lineHeight),width:el.clientWidth,scroll:el.scrollWidth}));check(measure.height<=measure.line+1&&measure.scroll<=measure.width+1,label+' waiting status stays readable on one line',measure);await page.getByRole('button',{name:'停止生成',exact:true}).click();await page.getByRole('button',{name:'停止生成',exact:true}).waitFor({state:'hidden'});
  }
  if(width===390){
   await page.evaluate(()=>window.chatStreamTest.submit('想听你说说'));await page.waitForFunction(()=>window.chatStreamTest.requests().length===1);await page.getByText('正在回应',{exact:true}).waitFor();check(await page.locator('[data-streaming-reply]').count()===0,theme+' waiting has no empty bubble');
   await page.evaluate(()=>window.chatStreamTest.push(0,'嗯，我在听。'));await page.locator('[data-streaming-reply]').waitFor();const before=await page.locator('.vg-streaming-part').count();await page.evaluate(()=>window.chatStreamTest.push(0,'你慢慢说，不着急。'));await page.waitForFunction(()=>document.querySelector('[data-streaming-reply]')?.textContent?.includes('不着急'));check(await page.locator('.vg-streaming-part').count()===before,theme+' continuation updates same bubble');await page.evaluate(()=>window.chatStreamTest.finish(0));await page.getByRole('button',{name:'停止生成',exact:true}).waitFor({state:'hidden'});check((await page.evaluate(()=>window.stage2Samples.records())).some(m=>m.role==='assistant'&&m.content.includes('不着急')),theme+' stream persists through real pipeline');
   const isolated=await page.evaluate(()=>window.stage2Samples.snapshot());check(Object.values(isolated.isolation).every(n=>n===0)&&isolated.extraNetwork===0,theme+' no external model/media/native attempts',isolated);
   await page.evaluate(()=>window.stage2Samples.openChat(true));await page.getByRole('button',{name:'和 TA 说句话',exact:true}).waitFor();check(await page.locator('.opening-scene').isVisible(),theme+' existing empty state retained');
  }
  await page.close();
 }
 check(report.errors.length===0,'no runtime errors',report.errors);report.pass=true;
}catch(e){report.pass=false;report.failure=e.stack;process.exitCode=1;}
finally{report.source=server.manifest;writeFileSync(out+'/result.json',JSON.stringify(report,null,2));await browser.close();await new Promise(r=>server.server.close(r));}
console.log(JSON.stringify({out,pass:report.pass,checks:report.checks.length,failure:report.failure}));
