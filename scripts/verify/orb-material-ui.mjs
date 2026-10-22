import { build } from 'esbuild';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, readdirSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const phase = process.env.VG_ORB_MATERIAL_PHASE || 'after';
const out = process.env.VG_ORB_MATERIAL_OUT || `.tmp-preview/starfield-upgrade-20261017/P5a/${phase}/${Date.now()}`;
mkdirSync(out,{recursive:true});
const report={at:new Date().toISOString(),phase,checks:[],screenshots:[],errors:[],geometry:{}};
const sourceBefore=process.env.VG_ORB_MATERIAL_SOURCE_BEFORE, cssDirectory=process.env.VG_ORB_MATERIAL_CSS_BEFORE || 'dist/renderer/assets';
const tokens=readFileSync('src/styles/theme-tokens.css','utf8'), css=readdirSync(cssDirectory).filter(p=>p.endsWith('.css')).map(p=>readFileSync(cssDirectory+'/'+p,'utf8')).join('\n');
const compiled=await build({entryPoints:['scripts/verify/orb-material-fixture.tsx'],bundle:true,write:false,metafile:true,format:'iife',platform:'browser',jsx:'automatic',loader:{'.css':'empty','.png':'dataurl','.webp':'dataurl'},define:{'import.meta.env':'{"DEV":true}','process.env.NODE_ENV':'"production"',__APP_VERSION__:'"material-test"'},plugins:sourceBefore?[{name:'immutable-material-baseline',setup(b){b.onLoad({filter:/SoulOrb\.tsx$/},args=>args.path===resolve('src/components/ui/SoulOrb.tsx')?{contents:readFileSync(sourceBefore,'utf8'),loader:'tsx',resolveDir:resolve('src/components/ui')}:undefined);}}]:[]});
const fingerprint=Object.keys(compiled.metafile.inputs).filter(path=>existsSync(path)).map(path=>({path:sourceBefore&&resolve(path)===resolve('src/components/ui/SoulOrb.tsx')?sourceBefore:path,sha256:createHash('sha256').update(readFileSync(sourceBefore&&resolve(path)===resolve('src/components/ui/SoulOrb.tsx')?sourceBefore:path)).digest('hex')}));
report.styles={directory:cssDirectory,sha256:createHash('sha256').update(css).digest('hex')};
writeFileSync(out+'/source-hashes.json',JSON.stringify(fingerprint,null,2));
const html=`<!doctype html><html class="dark" lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}\n${tokens}
html,body{margin:0;background:var(--bg);color:var(--text);font:14px system-ui}#app.mobile-layout{display:block;height:auto;min-height:100vh;overflow:visible;--chat-user:#756797;--chat-accent:var(--vg-accent);--chat-cyan:var(--vg-cyan)}.orb-material-lab{padding:16px;max-width:1080px;margin:auto;height:auto;overflow:visible}.orb-material-lab h1{font-size:20px}.orb-material-lab p,.orb-material-lab h2{font-size:13px;color:var(--text-secondary)}.orb-material-row{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:8px}.orb-material-row figure{display:flex;flex-direction:column;align-items:center;gap:8px;min-width:0;margin:0;padding:12px 0;background:var(--bg-panel);border-radius:12px}.orb-material-row figcaption{font-size:12px;line-height:1.5}.orb-material-row:has([data-size="160"]){grid-template-columns:repeat(4,minmax(0,1fr))}@media(max-width:600px){.orb-material-row{grid-template-columns:repeat(4,minmax(0,1fr))}.orb-material-row:has([data-size="160"]){grid-template-columns:repeat(2,minmax(0,1fr))}}
</style><script>window.orbMaterialTestOrigin=true;window.materialCalls={network:0,microphone:0,audio:0};Math.random=()=>.5;window.fetch=async()=>{materialCalls.network++;throw Error('network disabled')};if(navigator.mediaDevices)navigator.mediaDevices.getUserMedia=async()=>{materialCalls.microphone++;throw Error('microphone disabled')};HTMLMediaElement.prototype.play=async()=>{materialCalls.audio++;throw Error('audio disabled')};</script></head><body><div id="app" class="mobile-layout"></div><script src="/fixture.js"></script></body></html>`;
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/fixture.js'?'application/javascript':'text/html;charset=utf-8');res.end(req.url==='/fixture.js'?compiled.outputFiles[0].text:html);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:'chrome'});
let page;
async function check(name,run){try{report.checks.push({name,pass:true,detail:await run()});}catch(error){report.checks.push({name,pass:false,error:String(error)});}}
try{
 page=await browser.newPage({viewport:{width:1080,height:1800},deviceScaleFactor:1,reducedMotion:'reduce'});page.on('pageerror',e=>report.errors.push(e.message));
 await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>window.orbMaterial);
 for(const theme of ['dark','light'])for(const host of ['plain','character','voice'])for(const color of ['auto','violet','mint','blue','rose','amber']){
  await page.evaluate(mode=>window.orbMaterial.setMode(mode),{host,color,theme});await page.waitForFunction(({host,color,theme})=>window.orbMaterialMode?.host===host&&window.orbMaterialMode.color===color&&window.orbMaterialMode.theme===theme,{host,color,theme});
  const key=`${theme}-${host}-${color}`;
  const geometry=await page.locator('figure').evaluateAll(nodes=>Object.fromEntries(nodes.map(n=>[`${n.dataset.size}-${n.dataset.emotion}`,n.querySelector('.vg-orb-face').outerHTML])));
  report.geometry[key]=geometry;
  await check(`${key}: complete emotions, native sizes and no continuous frame clock`,async()=>{
    const boxes=await page.locator('figure .vg-soul-orb').evaluateAll(nodes=>nodes.map(n=>({size:+n.closest('figure').dataset.size,w:n.getBoundingClientRect().width,h:n.getBoundingClientRect().height,motion:n.dataset.orbMotion})));
    assert.equal(boxes.length,72);assert(boxes.every(b=>b.w===b.size&&b.h===b.size&&b.motion==='paused'));
    if(color!=='auto'){
      const selected={violet:'#8069dd',mint:'#57bda2',blue:'#649fdb',rose:'#cf7ba3',amber:'#d7a366'}[color];
      assert.equal(await page.locator('.vg-soul-orb').first().evaluate(n=>getComputedStyle(n).getPropertyValue('--orb-body').trim()),selected,'chosen user color remains the material input');
    }
    const clock=await page.evaluate(()=>window.orbMaterial.motion());assert.equal(clock.clients,0);assert.equal(clock.scheduled,false);return clock;
  });
  await check(`${key}: left-upper light stays local and glass is not a stack of halos`,async()=>{
    const sample=page.locator('figure[data-size="44"][data-emotion="idle"] .vg-soul-orb');
    const data=await sample.evaluate(node=>{
      const paths=[...node.querySelectorAll('svg path')];
      const sheen=paths.find(p=>p.getAttribute('d')?.startsWith('M69 91')||p.getAttribute('data-orb-sheen')!==null);
      return{wideHalos:paths.filter(p=>+p.getAttribute('stroke-width')>=6).length,shellOpacity:+(node.querySelector('image')?.getAttribute('opacity')??0),sheenOpacity:+sheen?.getAttribute('stroke-opacity'),sheenLength:sheen?.getTotalLength(),filters:[...node.querySelectorAll('filter')].length};
    });
    assert.equal(data.wideHalos,0);assert(data.shellOpacity<=.16);assert.equal(data.filters,0);
    if(host!=='voice'){assert(data.sheenOpacity<=.35);assert(data.sheenLength<=65);}
    return data;
  });
  await check(`${key}: intrinsic SVG eye-to-surface contrast stays at least 3`,async()=>{
    const contrast=await page.locator('figure[data-size="44"][data-emotion="idle"] .vg-soul-orb').evaluate(async node=>{
      const svg=node.querySelector('svg'), copy=svg.cloneNode(true), originals=[svg,...svg.querySelectorAll('*')], clones=[copy,...copy.querySelectorAll('*')];
      for(let i=0;i<originals.length;i++){
        const source=originals[i],target=clones[i],style=getComputedStyle(source);
        for(const name of ['fill','stroke','stop-color'])if(source.getAttribute(name)?.includes('var('))target.setAttribute(name,style.getPropertyValue(name));
        target.style.opacity=style.opacity;
      }
      copy.setAttribute('width','256');copy.setAttribute('height','256');copy.style.width='256px';copy.style.height='256px';
      const image=new Image();image.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(new XMLSerializer().serializeToString(copy));await image.decode();
      const canvas=document.createElement('canvas');canvas.width=canvas.height=256;const ctx=canvas.getContext('2d');ctx.fillStyle=getComputedStyle(node.closest('figure')).backgroundColor;ctx.fillRect(0,0,256,256);ctx.drawImage(image,0,0,256,256);
      const rect=svg.getBoundingClientRect();const luma=rgb=>{const v=[...rgb].slice(0,3).map(n=>n/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4);return .2126*v[0]+.7152*v[1]+.0722*v[2];};
      const samples=[...svg.querySelectorAll('.vg-orb-face>path')].slice(0,2).map((eye,index)=>{
        const at=x=>{const p=new DOMPoint(x,0).matrixTransform(eye.getScreenCTM());return ctx.getImageData(Math.floor((p.x-rect.x)*256/rect.width),Math.floor((p.y-rect.y)*256/rect.height),1,1).data;};
        const a=luma(at(0)),b=luma(at(index?16:-16));return(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
      });return Math.min(...samples);
    });assert(contrast>=3,`intrinsic eye contrast ${contrast}`);return{intrinsicSvgContrast:contrast,notNativeSizeAntialiasMeasurement:true};
  });
  if(color==='auto'){
    const file=key+'.png';await page.screenshot({path:out+'/'+file,fullPage:true});report.screenshots.push(file);
    for(const [suffix,selector] of [['44','section:has(figure[data-size="44"])'],['160-idle','figure[data-size="160"][data-emotion="idle"]']]){const file=`${key}-${suffix}.png`;await page.locator(selector).screenshot({path:out+'/'+file});report.screenshots.push(file);}
    if(phase==='baseline'&&host==='voice'){
      const sample=page.locator('figure[data-size="160"][data-emotion="idle"]');
      for(const [layer,selector] of [['shell','.vg-orb-glass-shell'],['core','.vg-orb-core'],['ring','.vg-orb-glass']]){
        await sample.locator(selector).evaluate(n=>n.style.visibility='hidden');const file=`${key}-without-${layer}.png`;await sample.screenshot({path:out+'/'+file});report.screenshots.push(file);await sample.locator(selector).evaluate(n=>n.style.removeProperty('visibility'));
      }
    }
  }
 }
 if(phase!=='baseline')await check('facial geometry is identical to the immutable baseline in every theme, color and host',()=>{
   const baseline=JSON.parse(readFileSync(process.env.VG_ORB_MATERIAL_BASELINE,'utf8'));assert.deepEqual(report.geometry,baseline.geometry);return{matrices:Object.keys(report.geometry).length,faces:36*72};
 });
 await check('explicit auto override still follows the role palette without changing saved settings',async()=>{
   const saved=await page.evaluate(()=>({...localStorage}));
   await page.evaluate(()=>window.orbMaterial.setMode({host:'character',color:'auto',theme:'light',explicitAuto:true}));await page.waitForFunction(()=>window.orbMaterialMode?.explicitAuto===true);
   assert((await page.locator('.vg-soul-orb').first().getAttribute('style')).includes('--chat-accent'));
   assert.deepEqual(await page.evaluate(()=>({...localStorage})),saved);
 });
 await check('model/capture/audio paths remain unused',async()=>{const calls=await page.evaluate(()=>window.materialCalls);assert(Object.values(calls).every(n=>n===0));return calls;});
 await check('compiled source inputs still match',()=>{for(const input of fingerprint)assert.equal(createHash('sha256').update(readFileSync(input.path)).digest('hex'),input.sha256);});
}catch(error){report.errors.push(error.stack||String(error));}
finally{await browser.close();await new Promise(r=>server.close(r));report.pass=Object.keys(report.geometry).length===36&&report.checks.length===(phase==='baseline'?111:112)&&report.checks.every(c=>c.pass)&&!report.errors.length;writeFileSync(out+'/result.json',JSON.stringify(report,null,2));console.log(JSON.stringify({out,pass:report.pass,checks:report.checks.length,failed:report.checks.filter(c=>!c.pass),errors:report.errors}));}
if(!report.pass)process.exitCode=1;
