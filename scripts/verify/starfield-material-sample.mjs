import { chromium } from 'playwright';
import { uiSystemPreview } from '../preview-ui-system.mjs';
import { mkdirSync,writeFileSync,readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const out=process.env.VG_MATERIAL_OUTPUT||`.tmp-preview/starfield-upgrade-20261017/P1/checks/${Date.now()}`;
mkdirSync(out,{recursive:true});
const report={at:new Date().toISOString(),phase:'P1',checks:[],screenshots:[],errors:[],limitations:['Static material study, not implemented production UI.','Existing SVG orb material remains unchanged until P5.','Generated 2.5D concept is not yet a compressed production asset.','Browser screenshot does not prove Android GPU performance.']};
const check=async(name,run)=>{try{report.checks.push({name,pass:true,detail:await run()});}catch(error){report.checks.push({name,pass:false,error:String(error)});}};
let browser,preview;
try{
  preview=await uiSystemPreview({port:0,watch:false,material:true,output:out+'/server'});
  browser=await chromium.launch({channel:'chrome'});
  const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1,isMobile:true,hasTouch:true,reducedMotion:'reduce'});
  const page=await context.newPage();page.on('pageerror',error=>report.errors.push(error.message));
  for(const theme of ['dark','light'])for(const width of [320,390,430]){
    await page.setViewportSize({width,height:844});await page.goto(preview.address+'/?theme='+theme);
    await page.waitForFunction(()=>!!window.starfieldMaterial);await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(i=>i.decode()));});
    await check(`${theme}-${width}: material, boundaries, contrast, alpha`,async()=>{
      const s=await page.evaluate(()=>{
        const main=document.querySelector('.star-material-shell'),panel=document.querySelector('.sample-panel'),image=document.querySelector('.sample-world img'),orb=document.querySelector('.sample-orb .soul-orb');
        const style=getComputedStyle(main),ps=getComputedStyle(panel),primary=getComputedStyle(document.querySelector('.sample-primary'));
        const parse=color=>{const nums=color.match(/[\d.]+/g).map(Number);return nums.slice(0,3);};
        const luminance=color=>parse(color).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
        const ratio=(a,b)=>{const x=luminance(a),y=luminance(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
        const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;const paint=canvas.getContext('2d');paint.drawImage(image,0,0);
        const rect=(orb||document.querySelector('.sample-orb svg')).getBoundingClientRect();
        return{...window.starfieldMaterial.inspect(),scrollWidth:document.documentElement.scrollWidth,background:style.backgroundColor,panel:ps.backgroundColor,backdrop:ps.backdropFilter,
          textContrast:ratio(style.color,style.backgroundColor),subContrast:ratio(getComputedStyle(document.querySelector('.sample-intro')).color,style.backgroundColor),buttonContrast:ratio(primary.color,primary.backgroundColor),
          targetSizes:[...document.querySelectorAll('button')].map(b=>({width:b.getBoundingClientRect().width,height:b.getBoundingClientRect().height})),orb:{width:rect.width,height:rect.height},image:{width:image.naturalWidth,height:image.naturalHeight,cornerAlpha:paint.getImageData(0,0,1,1).data[3],centerAlpha:paint.getImageData(canvas.width>>1,canvas.height>>1,1,1).data[3]},animations:document.getAnimations({subtree:true}).filter(a=>a.playState==='running').length};
      });
      assert.equal(s.theme,theme);assert.equal(s.viewport.width,width);assert(s.scrollWidth<=width);assert(s.textContrast>=4.5);assert(s.subContrast>=4.5);assert(s.buttonContrast>=4.5);assert(s.targetSizes.every(r=>r.height>=48&&r.width>=44));assert.equal(s.image.cornerAlpha,0);assert(s.image.centerAlpha>200);assert.equal(s.backdrop,'none');assert.equal(s.animations,0);assert(Object.values(s.isolation).every(n=>n===0));return s;
    });
    const file=`${theme}-${width}.png`;await page.screenshot({path:out+'/'+file,fullPage:true});report.screenshots.push(file);
  }
  await check('sample CSS and asset fingerprint',()=>{const paths=['scripts/verify/starfield-material-sample.css','.tmp-preview/starfield-upgrade-20261017/P1/assets/mineral-world-concept.png'];return paths.map(path=>({path,sha256:createHash('sha256').update(readFileSync(path)).digest('hex')}));});
}catch(error){report.errors.push(error.stack||String(error));}
finally{await browser?.close();await preview?.close();report.pass=report.errors.length===0&&report.checks.length===7&&report.checks.every(c=>c.pass);writeFileSync(out+'/result.json',JSON.stringify(report,null,2));console.log(JSON.stringify({out,pass:report.pass,checks:report.checks.length,failed:report.checks.filter(c=>!c.pass),errors:report.errors}));}
if(!report.pass)process.exitCode=1;
