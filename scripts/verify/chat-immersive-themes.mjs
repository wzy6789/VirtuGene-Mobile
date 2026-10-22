/** Exercise new themes through the actual editor, repository and mobile chat. */
import {chromium} from 'playwright';
import {mkdirSync,writeFileSync} from 'node:fs';
const origin=process.env.VG_SCENE_ORIGIN??'http://127.0.0.1:5329',out=process.env.VG_SCENE_EVIDENCE??'.tmp-preview/chat-immersive-themes-20261021/choices';
mkdirSync(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true}),page=await context.newPage();
const report={checks:[],errors:[],external:[],screenshots:[],scope:'Actual ChatAppearanceEditor and ChatWindow, isolated local synthetic messages and controlled transport. No provider, microphone, Android IME/GPU or user account data.'};
const check=(pass,name,detail)=>{report.checks.push({pass:!!pass,name,detail});if(!pass)throw Error(name);};
const api=(owner,name,...args)=>page.evaluate(({owner,name,args})=>window[owner][name](...args),{owner,name,args});
const ready=async()=>{await page.waitForFunction(()=>{const s=window.sceneTest.inspect()[0];return s?.state==='ready'&&s.backend==='webgl2';});await page.waitForTimeout(170);};
page.on('pageerror',error=>report.errors.push(error.message));
page.on('console',message=>{if(message.type()==='error'&&/THREE|WebGL|shader|VALIDATE_STATUS/i.test(message.text()))report.errors.push(message.text());});
page.on('request',request=>{if(!request.url().startsWith(origin)&&!/^(blob|data):/.test(request.url()))report.external.push(request.url());});
try{
 await page.goto(origin);await page.waitForFunction(()=>window.sceneTest);await api('backgroundTest','setup',0);await api('sceneTest','stock',2);await api('sceneTest','scene','cafe-afternoon');await ready();
 for(const [id,label,filter]of [['polar-refuge','极北之地 · 寒冬','冰冷'],['orbital-observatory','星域观景舱','星域'],['moonlit-bedroom','月光卧室','居家']]){
  await page.getByRole('button',{name:'聊天设置',exact:true}).click();
  const settings=page.getByRole('dialog',{name:'聊天设置',exact:true});await settings.getByRole('button',{name:/聊天外观/}).click();
  const editor=page.getByRole('dialog',{name:'聊天外观',exact:true});await editor.waitFor();
  await editor.getByRole('button',{name:filter,exact:true}).click();
  check(await editor.getByRole('button',{name:label,exact:true}).count()===1,id+' appears in the correct live gallery category');
  await editor.getByRole('button',{name:label,exact:true}).click();await editor.locator('.vg-background-preview').scrollIntoViewIfNeeded();
  await page.waitForFunction(id=>Array.from(document.querySelectorAll('.vg-chat-scene')).some(n=>n.dataset.sceneId===id&&n.dataset.sceneLoad==='ready'&&n.dataset.sceneRenderer==='webgl2'),id);
  check(await editor.locator('.vg-chat-scene').getAttribute('data-scene-id')===id,id+' previews actual shaders before save');
  await editor.getByRole('button',{name:'保存',exact:true}).click();await editor.waitFor({state:'hidden'});await settings.getByRole('button',{name:'返回',exact:true}).click();await ready();
  check((await api('backgroundTest','rows')).roleRow.config.scene.id===id,id+' saves through actual role preferences');
  await api('backgroundTest','reload');await ready();check(await page.locator('.chat-room .vg-chat-scene').getAttribute('data-scene-id')===id,id+' restores the selected room after repository reload');
  for(const width of [320,390,430]){
   await page.setViewportSize({width,height:844});
   for(const theme of ['dark','light']){
    await api('backgroundTest','theme',theme);await page.waitForTimeout(220);
    const layout=await page.evaluate(()=>{const input=document.querySelector('.chat-composer-input'),r=input.getBoundingClientRect();return{overflow:document.documentElement.scrollWidth>innerWidth,input:{left:r.left,right:r.right,width:r.width},viewport:innerWidth};});
    check(!layout.overflow&&layout.input.left>=0&&layout.input.right<=width&&layout.input.width>=110,`${id} ${width}px ${theme} keeps the real composer and page in bounds`,layout);
    const path=`${out}/${id}-${theme}-${width}.png`;await page.screenshot({path});report.screenshots.push(path);
   }
  }
  await page.setViewportSize({width:390,height:844});await api('backgroundTest','theme','dark');
 }
 check(report.errors.length===0&&report.external.length===0,'no shader/runtime error or external transport',report.errors);report.status='pass';
}catch(error){report.status='failed';report.failure=String(error);process.exitCode=1;console.error(error);await page.screenshot({path:out+'/failure.png'}).catch(()=>{});}
finally{await context.close();await browser.close();writeFileSync(out+'/result.json',JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,checks:report.checks.length,failure:report.failure,errors:report.errors}));}
