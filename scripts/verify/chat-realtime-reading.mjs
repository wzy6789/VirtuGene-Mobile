import {chromium} from 'playwright';
import {mkdirSync,writeFileSync} from 'node:fs';
const origin=process.env.VG_SCENE_ORIGIN??'http://127.0.0.1:5322',out=process.env.VG_SCENE_EVIDENCE??'.tmp-preview/chat-realtime-20261019/reading';mkdirSync(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true}),page=await context.newPage();
const report={checks:[],contrast:[],screenshots:[],errors:[],limitations:['Actual components with isolated synthetic data and controlled transport. Desktop mobile viewport; no Android IME/GPU or model/microphone test.']};
const api=(owner,name,...args)=>page.evaluate(({owner,name,args})=>window[owner][name](...args),{owner,name,args});
const ready=async()=>{await page.waitForFunction(()=>{const s=window.sceneTest.inspect()[0];return s?.state==='ready'&&s.backend==='webgl2';});await page.waitForTimeout(100);};
const check=(value,name,detail)=>{report.checks.push({name,pass:!!value,detail});if(!value)throw Error(name);};
const snap=async name=>{const path=out+'/'+name+'.png';await page.screenshot({path});report.screenshots.push(path);};
async function contrast(name){
 const rows=await page.evaluate(()=>{
  const canvas=document.createElement('canvas'),c=canvas.getContext('2d');canvas.width=canvas.height=1;
  const rgba=value=>{c.clearRect(0,0,1,1);c.fillStyle=value;c.fillRect(0,0,1,1);return [...c.getImageData(0,0,1,1).data].map((n,i)=>i===3?n/255:n);};
  const lum=value=>value.slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
  const selectors=['.vg-message-bubble','.vg-message-quote','.vg-message-text code','.vg-message-text a','.chat-thread .text-sub','.chat-thread .rounded-full','.chat-composer-input'];
  const rows=[];for(const selector of selectors)for(const node of document.querySelectorAll(selector)){
   if(!node.getClientRects().length)continue;const box=node.getBoundingClientRect();if(box.bottom<=55||box.top>=innerHeight-70)continue;
   let bg=[0,0,0,0],parent=node,opacity=1;
   while(parent){const style=getComputedStyle(parent);opacity*=Number(style.opacity);const color=rgba(style.backgroundColor),a=bg[3]+color[3]*(1-bg[3]);if(a)bg=[0,1,2].map(i=>(bg[i]*bg[3]+color[i]*color[3]*(1-bg[3]))/a).concat(a);if(bg[3]>=.999)break;parent=parent.parentElement;}
   const pseudo=selector==='.chat-composer-input'?getComputedStyle(node,'::placeholder'):getComputedStyle(node),fg=rgba(pseudo.color),foreground=fg.slice(0,3).map((v,i)=>v*fg[3]+bg[i]*(1-fg[3])),a=lum(foreground),b=lum(bg),ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05),point={x:Math.max(1,box.left+8),y:Math.max(1,box.top+12)};
   rows.push({selector,color:pseudo.color,background:bg,opacity,ratio,sample:point,sampleVisible:node.contains(document.elementFromPoint(point.x,point.y)),body:selector==='.vg-message-bubble'});
  }return rows;
 });
 report.contrast.push({name,rows});check(rows.some(r=>r.body)&&rows.every(r=>r.ratio>=4.5&&r.background[3]>=.99)&&rows.filter(r=>r.body).every(r=>r.ratio>=7),name+' opaque body >=7 and auxiliary >=4.5',rows);await snap('contrast-'+name);
}
page.on('pageerror',e=>report.errors.push(e.message));
try{
 await page.goto(origin);await page.waitForFunction(()=>window.sceneTest);await api('backgroundTest','setup',0);const ids=await page.evaluate(()=>window.sceneTest.scenes.map(s=>s.id));
 for(const id of ids){
  await api('sceneTest','stock',2);
  for(const width of [320,390,430])for(const theme of ['dark','light']){
   await page.setViewportSize({width,height:width===320?640:width===430?932:844});await api('backgroundTest','theme',theme);await api('sceneTest','scene',id,'auto',{renderer:'auto',parallaxEnabled:false});await ready();
   const shape=await page.locator('.chat-room').evaluate(n=>({width:n.clientWidth,scroll:n.scrollWidth,canvas:n.querySelector('.vg-scene-webgl')?.getBoundingClientRect().width,input:n.querySelector('textarea')?.getBoundingClientRect().right}));
   check(shape.scroll<=shape.width+1&&Math.abs(shape.canvas-width)<1&&shape.input<=width+1,id+' '+theme+' '+width+' complete crop and composer',shape);await snap(id+'-'+theme+'-'+width);
  }
  await page.setViewportSize({width:390,height:844});await api('sceneTest','stock',7);
  for(const theme of ['dark','light']){await api('backgroundTest','theme',theme);await ready();await contrast(id+'-'+theme+'-quote');await page.locator('.vg-message-text pre').last().scrollIntoViewIfNeeded();await page.waitForTimeout(220);await contrast(id+'-'+theme+'-code');}
 }
 await api('sceneTest','stock',500);const thread=page.locator('.chat-thread');await thread.evaluate(n=>n.scrollTop-=600);await page.waitForTimeout(200);const top=await thread.evaluate(n=>n.scrollTop);await api('sceneTest','scene','home-bedroom');await ready();check(Math.abs(await thread.evaluate(n=>n.scrollTop)-top)<2,'scene change preserves history reading position');
 await api('chatStreamTest','submit','保留停止前的正文。');await page.waitForFunction(()=>window.chatStreamTest.requests().length===1);await api('chatStreamTest','push',0,'这段文字已经显示。');await page.waitForTimeout(100);await page.getByRole('button',{name:'停止生成',exact:true}).click();await page.waitForTimeout(250);check(await page.getByText('这段文字已经显示。',{exact:true}).count()===1&&await page.getByRole('textbox',{name:'消息内容'}).isEnabled(),'stop retains visible reply with actual 3D room mounted');
 check(report.errors.length===0,'no unexpected page errors',report.errors);report.status='pass';
}catch(error){report.status='failed';report.failure=String(error);process.exitCode=1;await snap('failure').catch(()=>{});console.error(error);}
finally{await context.close();await browser.close();writeFileSync(out+'/result.json',JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,checks:report.checks.length,failure:report.failure,out}));}
