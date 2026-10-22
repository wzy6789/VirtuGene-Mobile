import { chromium } from 'playwright';
import { starfieldPreview } from '../preview-starfield-upgrade.mjs';
import { mkdirSync,writeFileSync,readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const out=process.env.VG_STARFIELD_OUTPUT||`.tmp-preview/starfield-upgrade-20261017/P0/checks/${Date.now()}`;
mkdirSync(out,{recursive:true});
const report={at:new Date().toISOString(),phase:'P0',checks:[],errors:[],screenshots:[],limitations:['Independent Playwright Chrome, not the signed-in right sidebar.','Controlled records; no Android/native GPU or real model conclusion.','P0 baseline does not assert the new visual or later phase requirements.']};
let preview,browser;
const check=async(name,run)=>{try{const detail=await run();report.checks.push({name,pass:true,detail});}catch(error){report.checks.push({name,pass:false,error:String(error)});}};
try{
  preview=await starfieldPreview({port:0,output:out+'/server'});
  browser=await chromium.launch({channel:'chrome'});
  for(const theme of ['dark','light'])for(const [width,height] of [[320,740],[360,800],[390,844],[430,932]]){
    const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:1,isMobile:true,hasTouch:true,reducedMotion:'reduce'});
    const page=await context.newPage();page.setDefaultTimeout(8000);page.on('pageerror',error=>report.errors.push(error.message));
    await page.goto(preview.address+`/app?virtugene-preview=mobile&theme=${theme}`);
    await page.waitForFunction(()=>window.starfieldReady||window.starfieldStartupError);
    await page.locator('.mobile-layout').waitFor();await page.evaluate(()=>document.fonts.ready);
    await check(`${theme}-${width}: actual mobile identity/viewport`,async()=>{const s=await page.evaluate(()=>window.starfieldPreview.snapshot());assert.equal(s.IS_MOBILE,true);assert.equal(s.native,false);assert.equal(s.mobileLayout,true);assert.equal(s.viewport.width,width);assert.equal(s.viewport.height,height);assert.equal(s.viewport.dpr,1);assert.equal(s.desktopTitlebar,false);return s;});
    for(const state of ['empty','one','six','many','assistant','long-name']){
      await page.evaluate(state=>window.starfieldPreview.setState(state),state);
      await page.locator('.vg-world-page').waitFor();await page.getByRole('navigation',{name:'世界入口',exact:true}).waitFor();
      await check(`${theme}-${width}-${state}: no root overflow`,async()=>{const d=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));assert(d.scroll<=d.width+1);return d;});
      const file=`${theme}-${width}-${state}.png`;await page.screenshot({path:out+'/'+file});report.screenshots.push(file);
      if(state==='many'){
        await page.getByRole('button',{name:'星域',exact:true}).click();await page.locator('.vg-world-constellation').waitFor();
        await check(`${theme}-${width}: fifty fixture IDs remain`,async()=>{const s=await page.evaluate(()=>window.starfieldPreview.snapshot());assert.equal(s.sceneIds.length,50);return{sceneCount:s.sceneIds.length};});
      }
    }
    await page.evaluate(()=>window.starfieldPreview.setState('load-error'));await page.getByText('世界读取失败',{exact:true}).waitFor();
    await check(`${theme}-${width}: controlled error and retry`,async()=>{await page.getByRole('button',{name:'重新读取',exact:true}).click();await page.getByText('世界读取失败',{exact:true}).waitFor({state:'hidden'});});
    await page.evaluate(()=>window.starfieldPreview.setState('loading'));await page.getByRole('status',{name:'正在读取你的世界'}).waitFor();
    await check(`${theme}-${width}: release controlled loading`,async()=>{await page.evaluate(()=>window.starfieldPreview.releaseLoading());await page.getByRole('status',{name:'正在读取你的世界'}).waitFor({state:'hidden'});});
    await check(`${theme}-${width}: isolation counters`,async()=>{const s=await page.evaluate(()=>window.starfieldPreview.snapshot());assert(Object.values(s.isolation).every(n=>n===0),JSON.stringify(s.isolation));return s.isolation;});
    await context.close();
  }
  await check('compiled source hashes still match',async()=>{for(const input of preview.manifest.inputs)assert.equal(createHash('sha256').update(readFileSync(input.path)).digest('hex'),input.sha256,input.path);return{inputs:preview.manifest.inputs.length};});
}catch(error){report.errors.push(error.stack||String(error));}
finally{await browser?.close();if(preview)await new Promise(resolve=>preview.server.close(resolve));report.pass=report.errors.length===0&&report.checks.length>0&&report.checks.every(c=>c.pass);writeFileSync(out+'/result.json',JSON.stringify(report,null,2));console.log(JSON.stringify({out,pass:report.pass,checks:report.checks.length,failed:report.checks.filter(c=>!c.pass),errors:report.errors}));}
if(!report.pass)process.exitCode=1;
