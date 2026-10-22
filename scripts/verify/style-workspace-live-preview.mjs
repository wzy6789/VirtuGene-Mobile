import {chromium} from 'playwright';
import {mkdirSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const out='.tmp-preview/ui-overhaul-20261015/style-workspace/live';mkdirSync(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({viewport:{width:1100,height:960},recordVideo:{dir:out,size:{width:1100,height:960}}}),page=await context.newPage();
const result={checks:[],errors:[],screenshots:[],modelCalls:0,microphoneCalls:0,scope:'Actual full-product preview with existing local role assets and synthetic records. Unsaved draft only; not Android.'};
page.on('pageerror',e=>result.errors.push(e.message));
try{
 await page.goto('http://127.0.0.1:5290/');const app=page.frameLocator('iframe');
 await app.locator('body').evaluate(async()=>{while(!window.productUpgradeReady)await new Promise(requestAnimationFrame);await productUpgradeTest.go('style');});
 const editor=app.getByRole('dialog',{name:'角色造型间',exact:true});await editor.waitFor();
 await editor.getByRole('button',{name:'素材',exact:true}).click();
 const avatar=await editor.locator('.vg-background-preview header img').getAttribute('src');
 let buffer,mime;
 if(avatar.startsWith('data:')){mime=avatar.slice(5,avatar.indexOf(';'));buffer=Buffer.from(avatar.slice(avatar.indexOf(',')+1),'base64');}
 else{const local=new URL(avatar,'http://127.0.0.1:5290/app');assert.equal(local.origin,'http://127.0.0.1:5290');const response=await context.request.get(local.href);assert.ok(response.ok());buffer=await response.body();mime=response.headers()['content-type'];}
 await editor.getByLabel('上传角色头像').setInputFiles({name:mime.includes('png')?'role.png':'role.jpg',mimeType:mime,buffer});
 await editor.getByRole('slider',{name:'头像横向',exact:true}).waitFor();await editor.getByRole('button',{name:'保存外观',exact:true}).waitFor({state:'visible'});
 for(const mode of ['dark','light']){
   await app.locator('body').evaluate((node,mode)=>productUpgradeTest.theme(mode),mode);
   assert.equal(await app.locator('html').evaluate(node=>node.classList.contains('dark')),mode==='dark');
   result.checks.push(`${mode}: actual application shell uses requested theme`);
   await editor.locator('summary').filter({hasText:'预览选项'}).click();await editor.getByRole('button',{name:mode==='dark'?'深色':'浅色',exact:true}).click();await editor.locator('summary').filter({hasText:'预览选项'}).click();
   await editor.getByRole('button',{name:'色彩',exact:true}).click();await editor.getByRole('button',{name:'背景主题：雾月',exact:true}).click();await editor.getByRole('button',{name:'素材',exact:true}).click();
   await editor.locator('[data-modal-scroll]').evaluate(n=>n.scrollTop=0);await page.waitForTimeout(250);
   await page.locator('iframe').screenshot({path:`${out}/actual-${mode}-390.png`});result.screenshots.push(`${out}/actual-${mode}-390.png`);
 }
 await editor.getByRole('button',{name:'小球',exact:true}).click();await editor.getByRole('radio',{name:'冰蓝',exact:true}).check();await editor.getByRole('radio',{name:'活泼',exact:true}).check();
 await page.waitForTimeout(1000);await page.locator('iframe').screenshot({path:`${out}/actual-orb-light-390.png`});
 const isolation=await app.locator('body').evaluate(()=>productUpgradeTest.snapshot().isolation);result.isolation=isolation;
 assert.ok(Object.values(isolation).every(value=>value===0));result.checks.push('All model/network/microphone/audio/native isolation counters remain zero');
 assert.equal(result.errors.length,0);result.checks.push('Full preview entry renders actual workspace without uncaught errors');
 await editor.getByRole('button',{name:'关闭造型间',exact:true}).click();await app.getByRole('button',{name:'放弃修改',exact:true}).click();result.checks.push('Real preview draft closes through discard confirmation');result.status='pass';
}catch(error){result.status='failed';result.failure=error.stack;throw error;}finally{const video=page.video();await context.close();result.video=await video.path();await browser.close();writeFileSync(`${out}/result.json`,JSON.stringify(result,null,2));console.log(JSON.stringify({status:result.status,checks:result.checks.length}));}
