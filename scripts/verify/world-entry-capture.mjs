import {productPreview} from '../preview-product-upgrade.mjs';
import {chromium} from 'playwright';
import {existsSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const phase=process.argv.includes('--before')?'before':'after',out=`.tmp-preview/ui-overhaul-20261015/world-entry/${phase}`;
if(phase==='before'&&existsSync(`${out}/result.json`))throw Error('Refusing to overwrite original world before evidence');
mkdirSync(out,{recursive:true});
const preview=await productPreview({port:0}),browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext({viewport:{width:1100,height:960}}),page=await context.newPage();
const result={phase,scope:'Actual production world page, saved synthetic scene/characters, no model or microphone; desktop only.',screenshots:[],sourceHashes:{},errors:[]};page.on('pageerror',e=>result.errors.push(e.message));
try{await page.goto(preview.address);const app=page.frameLocator('iframe');await app.locator('body').evaluate(async()=>{while(!window.productUpgradeReady)await new Promise(requestAnimationFrame);await productUpgradeTest.seedWorld();});
for(const width of [320,390,430])for(const theme of ['dark','light']){
 await page.locator('iframe').evaluate((node,width)=>node.style.width=`${width}px`,width);await app.locator('body').evaluate(async(node,theme)=>{await productUpgradeTest.go('home');productUpgradeTest.theme(theme);await productUpgradeTest.go('world');},theme);
 await app.getByRole('button',{name:'继续这一幕',exact:true}).waitFor();await page.waitForTimeout(150);await page.locator('iframe').screenshot({path:`${out}/world-${theme}-${width}.png`});result.screenshots.push(`${out}/world-${theme}-${width}.png`);
}
result.isolation=await app.locator('body').evaluate(()=>productUpgradeTest.snapshot().isolation);if(Object.values(result.isolation).some(value=>value!==0))throw Error('Preview isolation counter is nonzero');
for(const path of ['src/components/world/MobileWorldPage.tsx','src/components/world/WorldResumeCard.tsx','src/styles/globals.css','src/styles/mobile-refinement.css','src/styles/mobile-soul.css'])result.sourceHashes[path]=createHash('sha256').update(readFileSync(path)).digest('hex');
result.status='pass';}catch(error){result.status='failed';result.failure=error.stack;throw error;}finally{await browser.close();await new Promise(resolve=>preview.server.close(resolve));writeFileSync(`${out}/result.json`,JSON.stringify(result,null,2));console.log(JSON.stringify({status:result.status,phase,screenshots:result.screenshots.length}));}
