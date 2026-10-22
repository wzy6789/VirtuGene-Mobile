import {chromium} from 'playwright';
import {mkdirSync,writeFileSync} from 'node:fs';
const out=process.env.VG_SCENE_EVIDENCE??'.tmp-preview/chat-scenes-collection-20261019/collection',origin='http://127.0.0.1:5321';mkdirSync(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true,recordVideo:{dir:out,size:{width:390,height:844}}}),page=await context.newPage();
const report={checks:[],scenes:[],screenshots:[],errors:[],external:0,limitations:['Actual product components with synthetic local DB and controlled transport. No model/microphone access. Desktop Chrome, not Android GPU/IME/thermal/battery evidence.']};
const check=(pass,name,detail)=>{report.checks.push({pass:!!pass,name,detail});if(!pass)throw Error(name);console.log('PASS '+name);};
const api=(owner,name,...args)=>page.evaluate(({owner,name,args})=>window[owner][name](...args),{owner,name,args});
const ready=async()=>{await page.waitForFunction(()=>document.querySelector('.chat-room .vg-chat-scene')?.dataset.sceneLoad==='ready');await page.waitForTimeout(600);};
const snap=async name=>{const path=`${out}/${name}.png`;await page.screenshot({path});report.screenshots.push(path);};
const open=async()=>{await page.getByRole('button',{name:'聊天设置',exact:true}).click();await page.getByRole('dialog',{name:'聊天设置',exact:true}).getByRole('button',{name:/聊天外观/}).click();const editor=page.getByRole('dialog',{name:'聊天外观',exact:true});await editor.waitFor();await page.waitForTimeout(650);return editor;};
const close=async()=>{await page.getByRole('dialog',{name:'聊天设置',exact:true}).getByRole('button',{name:'返回',exact:true}).click();await page.waitForTimeout(200);};
page.on('pageerror',e=>report.errors.push(e.message));
try{
 await page.goto(origin);await page.waitForFunction(()=>window.sceneTest);await api('backgroundTest','setup',0);await api('sceneTest','stock',2);
 const scenes=await page.evaluate(()=>window.sceneTest.scenes.map(s=>({id:s.id,label:s.label,effect:s.effect,thumbnail:s.thumbnail,steam:s.steam,depths:s.layered.layers.map(l=>({id:l.id,depth:l.depthFactor,max:l.maxOffsetPx}))})));
 check(scenes.length===8&&scenes.every(s=>s.thumbnail?.width===360&&s.thumbnail?.height===800),'all eight scenes have lightweight local gallery thumbnails');
 for(const scene of scenes){
  await api('sceneTest','scene',scene.id);await ready();
  await page.waitForFunction(()=>window.sceneTest.inspect()[0]?.particles?.frames>2);
  let record=(await api('sceneTest','inspect'))[0];
  check(record.effectiveQuality==='balanced'&&record.particles.effect===scene.effect,scene.id+' runs its own local effect without static-budget fallback',record);
  check(await page.locator('.vg-scene-steam').count()===(scene.steam?1:0),scene.id+' only has steam when an actual cup anchor exists');
  check(record.selectionBytes<=48*1024*1024,scene.id+' fits decoded-pixel budget');
  for(const theme of ['dark','light']){await api('backgroundTest','theme',theme);await snap(scene.id+'-short-'+theme);}
  const input=page.getByRole('textbox',{name:'消息内容'});await input.focus();await page.waitForTimeout(100);const before=(await api('sceneTest','inspect'))[0];await page.waitForTimeout(200);const after=(await api('sceneTest','inspect'))[0];
  check(after.reason==='input'&&after.particles.frames===before.particles.frames&&JSON.stringify(after.animations)===JSON.stringify(before.animations),scene.id+' freezes particles and all WAAPI clocks on input');
  await page.evaluate(()=>document.activeElement.blur());
  report.scenes.push({scene,...record});
 }
 await api('backgroundTest','theme','dark');await api('sceneTest','scene','snow-study');await ready();const previous=await api('backgroundTest','rows');const editor=await open();const filters=editor.getByRole('group',{name:'按氛围筛选场景'});
 await filters.getByRole('button',{name:'温馨',exact:true}).click();
 check(await editor.locator('.vg-scene-choice').count()===3&&await editor.locator('.vg-scene-choices-selection').isVisible(),'mood browsing filters thumbnails without changing selected room');
 check((await api('backgroundTest','rows')).roleRow.revision===previous.roleRow.revision,'mood filtering never writes preferences');
 await filters.getByRole('button',{name:'冰冷',exact:true}).click();check(await editor.locator('.vg-scene-choice').count()===1,'cold filter locates the snow study');
 await filters.getByRole('button',{name:'全部场景',exact:true}).click();
 await filters.getByRole('button',{name:'居家',exact:true}).click();check(await editor.locator('.vg-scene-choice').count()===4&&await editor.getByRole('button',{name:'暖灯卧室',exact:true}).count()===1&&await editor.getByRole('button',{name:'晨光客厅',exact:true}).count()===1,'home category includes distinct bedroom and living-room environments');await filters.getByRole('button',{name:'全部场景',exact:true}).click();
 const thumbs=await editor.locator('.vg-scene-choice img').evaluateAll(nodes=>nodes.map(n=>({src:n.getAttribute('src'),w:n.getAttribute('width'),h:n.getAttribute('height')})));
 check(thumbs.length===8&&thumbs.every(t=>t.src.includes('thumbnail-')&&t.w==='360'&&t.h==='800'),'gallery uses only thumbnail assets, never unselected full posters',thumbs);
 await page.setViewportSize({width:320,height:844});await page.evaluate(()=>document.documentElement.style.fontSize='32px');await page.waitForTimeout(250);
 check(await editor.evaluate(n=>n.scrollWidth<=n.clientWidth+1),'320px gallery at 200% font keeps horizontal scrolling scoped to chips');await snap('gallery-320-font200');
 await page.evaluate(()=>document.documentElement.style.fontSize='');await page.setViewportSize({width:390,height:844});await editor.locator('.vg-scene-choices').scrollIntoViewIfNeeded();await snap('gallery-dark-390');
 await editor.getByRole('button',{name:'壁炉小屋',exact:true}).click();await page.waitForTimeout(700);check((await api('sceneTest','resources')).reservedBytes<=48*1024*1024,'snow-study plus cabin preview stays within shared resource cap');
 await editor.getByRole('button',{name:'取消',exact:true}).click();await page.getByRole('button',{name:'放弃修改',exact:true}).click();await close();await ready();check((await api('backgroundTest','rows')).roleRow.config.scene.id==='snow-study','cancelled new-room draft keeps the previous scene');
 const saveEditor=await open();await saveEditor.getByRole('button',{name:'夜行列车',exact:true}).click();await saveEditor.getByRole('button',{name:'保存',exact:true}).click();await saveEditor.waitFor({state:'hidden'});await close();await ready();await api('backgroundTest','reload');await ready();check((await api('backgroundTest','rows')).roleRow.config.scene.id==='night-train','new-room selection commits and survives repository reload');
 for(const scene of scenes.slice(2)){await api('sceneTest','scene',scene.id);await ready();await api('backgroundTest','reduced',true);await ready();check((await api('sceneTest','inspect'))[0].effectiveQuality==='static'&&await page.locator('.vg-scene-particle-slot').count()===0,scene.id+' reduced motion has no particle executor');await api('backgroundTest','reduced',false);await ready();}
 await api('chatStreamTest','unmount');await page.waitForTimeout(250);const resources=await api('sceneTest','resources');check(resources.entries===0&&resources.runtimes===0&&resources.subscriptions===0&&resources.particleEngine.length===0,'collection teardown releases every host and container',resources);
 const remote=await page.evaluate(()=>performance.getEntriesByType('resource').filter(r=>!r.name.startsWith(location.origin)&&!r.name.startsWith('data:')&&!r.name.startsWith('blob:')).map(r=>r.name));
 check(remote.length===0&&report.errors.length===0,'no external transport and no runtime errors',{remote,errors:report.errors});report.status='pass';
}catch(error){report.status='failed';report.failure=String(error);process.exitCode=1;await snap('failure').catch(()=>{});console.error(error);}
finally{await context.close();await browser.close();writeFileSync(out+'/result.json',JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,checks:report.checks.length,failure:report.failure}));}
