import {chromium} from 'playwright';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const resume=process.env.VG_P2_RESUME==='1';
const out='.tmp-preview/ui-cinematic-rebuild-20261021/'+(resume?'p2-continuation':'p2');mkdirSync(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true,reducedMotion:'no-preference',colorScheme:'dark'});
const page=await context.newPage(),errors=[],checks=[],shots=[];
page.on('pageerror',e=>errors.push(e.message));
const shot=async name=>{const path=`${out}/${name}.png`;await page.screenshot({path});shots.push(path);};
const open=async view=>{await page.evaluate(v=>window.cinematicTest.open(v),view);await page.waitForTimeout(350);};
const readyScene=()=>page.waitForFunction(()=>document.querySelector('.vg-chat-scene')?.getAttribute('data-scene-load')==='ready');
const appearance=async()=>{await page.getByRole('button',{name:'聊天设置',exact:true}).click();await page.getByRole('button',{name:/聊天外观/}).click();await page.getByRole('dialog',{name:'聊天外观',exact:true}).waitFor();};
try{
 await page.goto(process.env.VG_CINEMA_URL??'http://127.0.0.1:5331/?view=chat');await page.waitForFunction(()=>window.cinematicReady||window.cinematicError);assert.equal(await page.evaluate(()=>window.cinematicError),undefined);
 await readyScene();await page.evaluate(()=>document.fonts.ready);await shot('chat-dusk-dark');
 if(!resume){
 await page.getByLabel('消息内容',{exact:true}).focus();await page.waitForTimeout(260);
 const input=await page.locator('.chat-room').evaluate(e=>({ambient:e.dataset.chatAmbient,avatar:e.dataset.chatAvatar,particles:e.dataset.chatParticles}));
 assert.deepEqual(input,{ambient:'low',avatar:'low',particles:'off'});checks.push('settled input retains low ambient/avatar while particles stop');await page.locator('.chat-header-title').focus();
 await appearance();const editor=page.getByRole('dialog',{name:'聊天外观',exact:true});
 const saved=await page.evaluate(()=>JSON.stringify(window.backgroundTest.rows().override));
 await editor.getByRole('radio',{name:'雨夜',exact:true}).click();await shot('appearance-night-preview');
 assert.equal(await page.evaluate(()=>JSON.stringify(window.backgroundTest.rows().override)),saved,'preview cannot persist');
 await editor.getByRole('button',{name:'取消',exact:true}).click();await page.getByRole('button',{name:'放弃修改',exact:true}).click();assert.equal(await page.evaluate(()=>JSON.stringify(window.backgroundTest.rows().override)),saved);checks.push('time preview/cancel does not write saved role appearance');
 await page.keyboard.press('Escape');await appearance();
 await editor.getByRole('radio',{name:'雨夜',exact:true}).click();await editor.getByRole('button',{name:'保存',exact:true}).click();await editor.waitFor({state:'detached'});await page.keyboard.press('Escape');await readyScene();
 assert.equal(await page.evaluate(()=>window.backgroundTest.rows().override.scene.timeVariantId),'rain-night');await shot('chat-night-dark');checks.push('time apply persists the real same-room night asset');
 }else{const prior=JSON.parse(readFileSync('.tmp-preview/ui-cinematic-rebuild-20261021/p2/failure.json','utf8'));checks.push(...prior.checks);}
 await page.locator('.chat-header-title').click();await page.getByRole('dialog').waitFor();await shot('character-detail');assert.ok((await page.locator('[role=dialog]').last().innerText()).includes('此刻'));await page.keyboard.press('Escape');checks.push('chat identity opens unified real character detail');
 await page.setViewportSize({width:320,height:740});await shot('chat-narrow-320');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),320);await page.setViewportSize({width:390,height:844});
 await open('messages');await shot('messages-dark');await page.getByRole('tab',{name:'对话',exact:true}).click();await page.waitForTimeout(400);await page.getByRole('tab',{name:'全部',exact:true}).click();checks.push('actual data-backed channels switch and return');
 await open('world');await shot('world-dark');
 await open('genes');
 await page.getByRole('button',{name:'＋ 添加角色',exact:true}).click();await page.getByLabel('搜索角色名字、签名或标签',{exact:true}).waitFor();await shot('gene-library-dark');
 await page.getByLabel('搜索角色名字、签名或标签',{exact:true}).fill('不存在的查询样例');await page.getByText('没有找到符合条件的角色',{exact:true}).waitFor();await page.getByLabel('搜索角色名字、签名或标签',{exact:true}).fill('');checks.push('gene directory has actual cards and a reachable empty search state');await page.keyboard.press('Escape');
 await page.evaluate(()=>window.cinematicTest.materials());await page.screenshot({path:out+'/material-calibration.png',fullPage:true});shots.push(out+'/material-calibration.png');
 assert.deepEqual(errors,[]);const isolation=await page.evaluate(()=>window.cinematicTest.snapshot());assert.equal(isolation.mediaAttempts,0);assert.equal(isolation.extraNetwork,0);
 writeFileSync(out+'/result.json',JSON.stringify({pass:true,checks,shots,errors,isolation,conditions:{width:390,height:844,dpr:2,font:'actual bundled defaults',motion:'no-preference',data:'synthetic isolated DB',transport:'controlled, no real providers'}},null,2));
 console.log(JSON.stringify({pass:true,checks:checks.length,shots:shots.length}));
}catch(e){await shot('failure');writeFileSync(out+'/failure.json',JSON.stringify({error:String(e),stack:e.stack,errors,checks,shots},null,2));console.error(e);process.exitCode=1;}
finally{await browser.close();}
