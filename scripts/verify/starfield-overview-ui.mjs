import { chromium } from 'playwright';
import { starfieldPreview } from '../preview-starfield-upgrade.mjs';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const out=process.env.VG_STARFIELD_OVERVIEW_OUTPUT||`.tmp-preview/starfield-upgrade-20261017/P3/checks/${Date.now()}`;
mkdirSync(out,{recursive:true});
const report={at:new Date().toISOString(),phase:'P3',checks:[],errors:[],screenshots:[],limits:['Playwright on isolated records; not the signed-in sidebar.','The overview renders the full supplied list; existing management handles records beyond the loaded50.','P4 parent-page ordering, private-data revocation and busy/failed continue flow are not covered by this static phase.']};
let server,browser;
async function check(name,run){try{report.checks.push({name,pass:true,detail:await run()});}catch(error){report.checks.push({name,pass:false,error:String(error)});throw error;}}
async function start(page,state){await page.evaluate(state=>window.starfieldPreview.setState(state),state);await page.getByRole('button',{name:'星域',exact:true}).waitFor();await page.getByRole('button',{name:'星域',exact:true}).click();await page.locator('[data-starfield-overview]').waitFor();await page.evaluate(async()=>{await document.fonts.ready;for(const img of document.querySelectorAll('[data-starfield-map] img'))await img.decode();});}
async function showOverview(page){await page.locator('[data-starfield-overview]').evaluate(node=>{const scroller=node.closest('.vg-world-page');scroller.scrollTop+=node.getBoundingClientRect().top-scroller.getBoundingClientRect().top;});}
try{
  const manifest=JSON.parse(readFileSync('src/assets/starfield/manifest.json','utf8'));
  await check('production art budget and fingerprint',()=>{const bytes=readFileSync(`src/assets/starfield/${manifest.file}`);assert(bytes.length<=700*1024);assert.equal(createHash('sha256').update(bytes).digest('hex'),manifest.sha256);return{bytes:bytes.length,dimensions:manifest.dimensions,sourceSha256:manifest.sourceSha256};});
  server=await starfieldPreview({port:0,output:out+'/server'});browser=await chromium.launch({channel:'chrome'});
  const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1,isMobile:true,hasTouch:true,reducedMotion:'no-preference'});
  const page=await context.newPage();page.setDefaultTimeout(8000);page.on('pageerror',e=>report.errors.push(e.message));
  await page.goto(server.address+'/app?virtugene-preview=mobile');await page.waitForFunction(()=>window.starfieldReady);
  for(const theme of ['dark','light'])for(const width of [320,360,390,430]){
    await page.setViewportSize({width,height:844});await page.evaluate(theme=>window.starfieldPreview.theme(theme),theme);
    for(const [state,count] of [['empty',0],['one',1],['six',6],['many',50],['long-scenes',6]]){
      await start(page,state);
      await check(`${theme}-${width}-${state}: complete native list / bounded map / stable static art`,async()=>{
        const data=await page.locator('[data-starfield-overview]').evaluate(node=>{
          const markers=[...node.querySelectorAll('[data-scene-marker]')],rows=[...node.querySelectorAll('[data-scene-row]')],map=node.querySelector('[data-starfield-map]'),img=map.querySelector('img');
          const box=el=>{const r=el.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height};};
          return{width:innerWidth,scroll:document.documentElement.scrollWidth,map:box(map),markers:markers.map(m=>({id:m.dataset.sceneMarker,...box(m)})),rows:rows.map(m=>({id:m.dataset.sceneRow,tag:m.tagName,...box(m)})),image:{naturalWidth:img.naturalWidth,naturalHeight:img.naturalHeight,...box(img)},runningAnimations:node.getAnimations({subtree:true}).filter(a=>a.playState==='running').length,canvasCount:node.querySelectorAll('canvas').length,ids:window.starfieldPreview.snapshot().sceneIds,text:node.textContent};
        });
        assert.equal(data.rows.length,count);assert.equal(data.markers.length,Math.min(6,count));assert.deepEqual([...new Set(data.rows.map(r=>r.id))].sort(),[...data.ids].sort());assert(data.markers.every(m=>data.ids.includes(m.id)&&m.w>=44&&m.h>=44&&m.x>=data.map.x&&m.x+m.w<=data.map.x+data.map.w));assert(data.rows.every(r=>r.tag==='BUTTON'&&r.h>=44));assert(data.scroll<=width);assert(data.map.h>=260&&data.map.h<=300);assert.equal(data.image.naturalWidth,1254);assert.equal(data.runningAnimations,0);assert.equal(data.canvasCount,0);assert(!/WORLD MATRIX|NO WORLD SIGNAL|个世界仍在/.test(data.text));delete data.text;return data;
      });
      if(width===390||state==='long-scenes'&&width===320){await showOverview(page);const file=`${theme}-${width}-${state}.png`;await page.screenshot({path:out+'/'+file});report.screenshots.push(file);}
      if(state==='six'){
        await check(`${theme}-${width}: status filters preserve exact scene IDs`,async()=>{
          const group=page.getByRole('group',{name:'场景状态筛选'});
          for(const [label,suffixes] of [['进行中',[1,4]],['暂停',[0,3]],['已保存',[2,5]]]){
            await group.getByRole('button',{name:label,exact:true}).click();const ids=await page.locator('[data-scene-row]').evaluateAll(nodes=>nodes.map(n=>n.dataset.sceneRow).sort());assert.deepEqual(ids,suffixes.map(i=>`starfield-fixture:alpha:scene:${i}`).sort());
          }
          await group.getByRole('button',{name:'全部',exact:true}).click();assert.equal(await page.locator('[data-scene-row]').count(),6);
        });
      }
    }
    await check(`${theme}-${width}: decode failure keeps every scene accessible`,async()=>{
      const ids=await page.locator('[data-scene-row]').evaluateAll(nodes=>nodes.map(n=>n.dataset.sceneRow));
      await page.locator('[data-starfield-map] img').evaluate(img=>img.src='data:image/webp;base64,AA==');
      await page.locator('[data-starfield-poster-fallback]').waitFor();assert.deepEqual(await page.locator('[data-scene-row]').evaluateAll(nodes=>nodes.map(n=>n.dataset.sceneRow)),ids);
      const first=page.locator('[data-scene-row]').first();const label=await first.getAttribute('aria-label');await first.focus();await page.keyboard.press('Enter');await page.locator('.vg-scene-constellation').waitFor();assert.equal(await page.locator('.vg-scene-constellation').getAttribute('aria-label'),'世界星域：'+label.replace('查看场景：',''));
    });
  }
  await start(page,'one');
  await check('map marker opens existing scene preview, not model generation',async()=>{await page.locator('[data-scene-marker]').first().click();await page.locator('.vg-scene-constellation').waitFor();assert((await page.locator('.vg-scene-constellation').innerText()).includes('雨后的站台'));});
  await start(page,'empty');
  await check('create goes to existing form without submitting',async()=>{await page.locator('[data-starfield-overview]').getByRole('button',{name:'开启新场景',exact:true}).last().click();await page.locator('.vg-stage-create').waitFor();const s=await page.evaluate(()=>window.starfieldPreview.snapshot());assert.equal(s.navigation.activeView,'stage');});
  await check('no external model / capture / playback / native calls',async()=>{const s=await page.evaluate(()=>window.starfieldPreview.snapshot());assert(Object.values(s.isolation).every(n=>n===0),JSON.stringify(s.isolation));return s.isolation;});
  await check('all compiled source fingerprints still current',()=>{for(const input of server.manifest.inputs)assert.equal(createHash('sha256').update(readFileSync(input.path)).digest('hex'),input.sha256,input.path);return{inputs:server.manifest.inputs.length};});
}catch(error){report.errors.push(error.stack||String(error));}
finally{await browser?.close();if(server)await new Promise(r=>server.server.close(r));report.pass=report.checks.length===61&&report.checks.every(c=>c.pass)&&report.errors.length===0;writeFileSync(out+'/result.json',JSON.stringify(report,null,2));console.log(JSON.stringify({out,pass:report.pass,checks:report.checks.length,failed:report.checks.filter(c=>!c.pass),errors:report.errors}));}
if(!report.pass)process.exitCode=1;
