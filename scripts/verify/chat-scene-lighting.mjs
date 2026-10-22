import {chromium} from 'playwright';
import {mkdirSync,writeFileSync} from 'node:fs';
const origin=process.env.VG_SCENE_ORIGIN??'http://127.0.0.1:5327',out=process.env.VG_SCENE_EVIDENCE??'.tmp-preview/chat-immersive-light-20261021/lighting';
mkdirSync(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true}),page=await context.newPage();
const report={checks:[],errors:[],external:0,scope:'Actual mobile chat component and both light render paths, isolated sample DB, no model or microphone. Desktop browser only.'};
const check=(pass,name,detail)=>{report.checks.push({pass:!!pass,name,detail});if(!pass)throw Error(name);};
const api=(owner,name,...args)=>page.evaluate(({owner,name,args})=>window[owner][name](...args),{owner,name,args});
const lights=()=>page.locator('.vg-scene-light-field').evaluateAll(nodes=>nodes.map(n=>({kind:n.className,rect:[n.getBoundingClientRect().x,n.getBoundingClientRect().y,n.getBoundingClientRect().width,n.getBoundingClientRect().height],opacity:getComputedStyle(n).opacity,animation:n.getAnimations().map(a=>({time:a.currentTime,state:a.playState}))})));
const ready=backend=>page.waitForFunction(backend=>{const s=window.sceneTest.inspect()[0];return s?.state==='ready'&&s.backend===backend;},backend);
page.on('pageerror',e=>report.errors.push(e.message));page.on('request',r=>{if(new URL(r.url()).origin!==origin&&!/^(blob|data):/.test(r.url()))report.external++;});
try{
  await page.goto(origin);await page.waitForFunction(()=>window.sceneTest);await api('backgroundTest','setup',0);await api('sceneTest','stock',2);
  for(const id of ['guofeng-tea-room','urban-window-seat']){
    await api('sceneTest','scene',id,'auto',{renderer:'auto',parallaxEnabled:false});await ready('webgl2');await page.waitForTimeout(500);
    for(const theme of ['dark','light'])for(const width of [320,390,430]){
      await api('backgroundTest','theme',theme);await page.setViewportSize({width,height:844});await page.waitForTimeout(180);
      const layout=await page.locator('.chat-room').evaluate(n=>({width:n.clientWidth,scroll:n.scrollWidth,buttons:[...n.querySelectorAll('button')].filter(b=>b.getBoundingClientRect().width>0).map(b=>({label:b.getAttribute('aria-label'),width:b.getBoundingClientRect().width})),bubbles:[...n.querySelectorAll('.vg-message-bubble')].map(b=>({color:getComputedStyle(b).color,opacity:getComputedStyle(b).opacity,visible:b.getBoundingClientRect().width>0}))}));
      check(layout.scroll<=layout.width+1&&layout.bubbles.length===2&&layout.bubbles.every(b=>b.visible&&b.opacity==='1'),id+'/'+theme+'/'+width+' keeps opaque reading bubbles and fits the mobile viewport',layout);
      await page.screenshot({path:`${out}/${id}-${theme}-${width}.png`});
    }
    await page.setViewportSize({width:390,height:844});await api('backgroundTest','theme','dark');
    await api('sceneTest','scene',id,'auto',{renderer:'layered',parallaxEnabled:false});await ready('layered');await page.waitForFunction(()=>document.querySelectorAll('.vg-scene-light-field').length===4);await page.waitForTimeout(450);
    const running=await lights();await page.waitForTimeout(160);const running2=await lights();
    check(running.length===4&&running.every((n,i)=>n.animation.length===1&&running2[i].animation[0].time>n.animation[0].time),id+' four local light fields use the existing animation owner',running2);
    await page.screenshot({path:`${out}/${id}-layered-dark.png`});
    await page.getByRole('textbox',{name:'消息内容'}).focus();await page.waitForTimeout(100);const paused=await lights();await page.waitForTimeout(200);const paused2=await lights();
    check(paused.every((n,i)=>n.animation[0].state==='paused'&&n.animation[0].time===paused2[i].animation[0].time),id+' input freezes every new light field without resetting its phase',paused2);
    await page.evaluate(()=>document.activeElement.blur());await page.waitForTimeout(180);const resumed=await lights();
    check(resumed.every((n,i)=>n.animation[0].time>paused[i].animation[0].time),id+' blur resumes the same four light clocks',resumed);
    await page.evaluate(()=>document.documentElement.setAttribute('data-vg-background',''));await page.waitForTimeout(100);const hidden=await lights();await page.waitForTimeout(160);const hidden2=await lights();
    check(hidden.every((n,i)=>n.animation[0].time===hidden2[i].animation[0].time),id+' background pauses local lighting',hidden2);await page.evaluate(()=>document.documentElement.removeAttribute('data-vg-background'));
    await api('chatStreamTest','unmount');await page.waitForTimeout(180);
    const remaining=await page.evaluate(()=>document.getAnimations().filter(a=>a.effect?.target?.classList?.contains('vg-scene-light-field')).length);
    check(remaining===0&&await page.locator('.vg-scene-light-field').count()===0,id+' unmount cancels every new light animation');await api('chatStreamTest','remount');await ready('layered');
  }
  check(report.errors.length===0&&report.external===0,'no runtime errors or external model/media requests',{errors:report.errors,external:report.external});report.status='pass';
}catch(error){report.status='failed';report.failure=String(error);process.exitCode=1;await page.screenshot({path:out+'/failure.png'}).catch(()=>{});}
finally{await context.close();await browser.close();writeFileSync(out+'/result.json',JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,checks:report.checks.length,failure:report.failure}));}
