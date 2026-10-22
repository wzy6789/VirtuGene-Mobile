import {productPreview} from '../preview-product-upgrade.mjs';import {chromium} from 'playwright';import AxeBuilder from '@axe-core/playwright';import {mkdirSync,writeFileSync} from 'node:fs';import assert from 'node:assert/strict';
const out='.tmp-preview/ui-overhaul-20261015/world-entry/ui';mkdirSync(out,{recursive:true});
const preview=await productPreview({port:0}),browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext({viewport:{width:1100,height:960}}),page=await context.newPage();
const result={checks:[],errors:[],axe:[],scope:'Actual full UI/routes and IndexedDB; saved local synthetic world. No model, microphone or Android.',screenshots:[]};page.on('pageerror',e=>result.errors.push(e.message));
const app=page.frameLocator('iframe'),api=(method,...args)=>app.locator('body').evaluate((node,{method,args})=>productUpgradeTest[method](...args),{method,args});
const check=(value,name)=>{assert.ok(value,name);result.checks.push(name);};
const home=async()=>{await api('go','home');await api('go','world');await app.getByRole('button',{name:'继续这一幕',exact:true}).waitFor();};
try{
 await page.goto(preview.address);await app.locator('body').evaluate(async()=>{while(!window.productUpgradeReady)await new Promise(requestAnimationFrame);});const scene=await api('seedWorld');await home();
 await app.getByText('雨声渐渐停了，你们的话还没有说完。',{exact:true}).waitFor();check(true,'selected saved narration appears in the continuation cover');
 check(await app.getByRole('navigation',{name:'世界档案',exact:true}).getByRole('button').count()===4,'world records are directly accessible without opening constellation');
 for(const width of [320,390,430])for(const theme of ['dark','light']){
  await page.locator('iframe').evaluate((node,width)=>node.style.width=`${width}px`,width);await api('theme',theme);
  await app.locator('.vg-world-page').evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const dimensions=await app.locator('.vg-world-page').evaluate(n=>({scroll:n.scrollWidth,client:n.clientWidth,children:[...n.querySelectorAll('*')].filter(child=>child.getClientRects().length&&child.scrollWidth>child.clientWidth+2).slice(0,5).map(child=>({class:child.className,width:child.clientWidth,scroll:child.scrollWidth}))}));
  check(dimensions.scroll<=dimensions.client+1,`${width}/${theme}: world landing fits viewport ${JSON.stringify(dimensions)}`);
  check(await app.getByRole('navigation',{name:'世界入口'}).getByRole('button').evaluateAll(nodes=>nodes.every(n=>{const r=n.getBoundingClientRect();return r.width>=44&&r.height>=44;})),`${width}/${theme}: daily shortcuts retain touch targets`);
 }
 await page.locator('iframe').evaluate(node=>node.style.width='390px');
 for(const mode of ['dark','light']){await api('theme',mode);const axe=await new AxeBuilder({page}).include('iframe').analyze();result.axe.push({mode,violations:axe.violations,incomplete:axe.incomplete});check(axe.violations.length===0,`${mode}: world axe has no violations`);}
 await api('editWorldNarration','修改后的本地场景正文');await app.getByText('修改后的本地场景正文',{exact:true}).waitFor();check(true,'live source edit refreshes excerpt without page remount');
 await app.getByRole('button',{name:/未完成.*把那本书交给知微/}).click();const threads=app.getByRole('dialog',{name:'知微 还没做完的事',exact:true});await threads.waitFor();check(await threads.getByText('把那本书交给知微',{exact:true}).count()>0,'unfinished row opens actual continuity manager for its character');await threads.getByRole('button',{name:'返回',exact:true}).click();
 for(const [label,view] of [['朋友圈','moments'],['日记','diary'],['待办','todo'],['关系','relations'],['记忆','memory'],['年表','timeline'],['设定','worldSettings']]){
  await home();await app.getByRole('button',{name:label,exact:true}).click();check((await api('snapshot')).navigation.activeView===view,`${label}: actual destination remains connected`);
 }
 await home();await app.getByRole('button',{name:'星域',exact:true}).click();await app.getByRole('button',{name:'返回世界',exact:true}).waitFor();check(true,'constellation remains an optional exploration view');await app.getByRole('button',{name:'返回世界',exact:true}).click();
 await app.getByRole('button',{name:'继续这一幕',exact:true}).click();check((await api('snapshot')).navigation.canvasSceneId===scene.id,'continue opens the authorized saved scene');
 await home();await api('seedWorldEvent');await home();await app.getByText('这是一条本地模拟世界记录。',{exact:true}).waitFor();check(true,'recent record comes from a saved world event');await page.locator('iframe').screenshot({path:`${out}/recent-light-390.png`});result.screenshots.push(`${out}/recent-light-390.png`);
 await api('editWorldEvent','这条记录已经编辑。');await app.getByText('这条记录已经编辑。',{exact:true}).waitFor();check(true,'known recent event edit refreshes via primary keys');await api('removeWorldEvent');await app.getByText('这条记录已经编辑。',{exact:true}).waitFor({state:'hidden'});check(true,'deleted recent event leaves no cached record text');
 await api('go','home');await api('failWorldLoadOnce');await api('go','world');await app.getByText('世界读取失败',{exact:true}).waitFor();await app.getByRole('button',{name:'重新读取',exact:true}).click();await app.getByRole('button',{name:'继续这一幕',exact:true}).waitFor();check(true,'read error preserves navigation and actual retry recovers');
 await api('removeWorldScene');await app.getByRole('heading',{name:'留一段属于你们的时间',exact:true}).waitFor();check(await app.getByRole('button',{name:'继续这一幕',exact:true}).count()===0,'deleted source removes stale cover and continuation action');
 await page.locator('iframe').screenshot({path:`${out}/empty-light-390.png`});result.screenshots.push(`${out}/empty-light-390.png`);
 await app.getByRole('button',{name:'创建世界',exact:true}).click();check((await api('snapshot')).navigation.activeView==='stage'&&(await api('snapshot')).navigation.worldCreateIntent===true,'empty state opens the existing world creation flow');
 await api('seedWorld');await home();await api('removeWorldSource');await app.getByText('世界读取失败',{exact:true}).waitFor();check(await app.getByRole('heading',{name:'雨后的站台',exact:true}).count()===0,'world deletion removes its cover and recent-record surface');await app.getByRole('button',{name:'重新读取',exact:true}).click();await app.getByRole('heading',{name:'留一段属于你们的时间',exact:true}).waitFor();check(true,'retry can recover into a new empty world after source deletion');
 await api('seedWorld');await home();await api('account','world-other-account');await app.getByRole('heading',{name:'雨后的站台',exact:true}).waitFor({state:'hidden'});check(true,'account change removes previous world cover and excerpt');
 result.isolation=(await api('snapshot')).isolation;check(Object.values(result.isolation).every(value=>value===0),'all model/network/microphone/audio/native isolation counters remain zero');check(result.errors.length===0,'no browser runtime errors');result.status='pass';
}catch(error){result.status='failed';result.failure=error.stack;throw error;}finally{await browser.close();await new Promise(resolve=>preview.server.close(resolve));writeFileSync(`${out}/result.json`,JSON.stringify(result,null,2));console.log(JSON.stringify({status:result.status,checks:result.checks.length,failure:result.failure}));}
