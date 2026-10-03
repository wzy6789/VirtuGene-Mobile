const { createRequire } = require('module');
const path = require('path'), fs = require('fs'), http = require('http'), assert = require('assert/strict');
const { build } = require('esbuild');
const { chromium } = createRequire(path.join(path.dirname(process.execPath), 'package.json'))('playwright');
const fixture = `
import React, {useState} from 'react'; import {createRoot} from 'react-dom/client';
import {useSlideOutCancel} from './src/components/ui/useSlideOutCancel';
import {SwipeBackView} from './src/components/ui/SwipeBackView';
import {FontRuler,MultiFilterChips} from './src/components/ui/PhysicalInteractions';
import {ImagePreview} from './src/components/ui/ImagePreview';
const images=['#5442a5','#245d68','#755174'].map((color,i)=>'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="340" height="450"><rect width="340" height="450" fill="'+color+'"/><text x="150" y="240" fill="white" font-size="80">'+(i+1)+'</text></svg>'));
function Fixture(){useSlideOutCancel();const [clicks,setClicks]=useState(0),[backs,setBacks]=useState(0),[size,setSize]=useState(14),[tags,setTags]=useState([]),[media,setMedia]=useState(false);
return <main className="mobile-layout" style={{padding:20,height:'100dvh'}}><button id="action" onPointerDown={e=>e.currentTarget.setPointerCapture(e.pointerId)} onClick={()=>setClicks(v=>v+1)} style={{width:140,height:48}}>测试操作</button><output id="clicks">{clicks}</output>
<MultiFilterChips options={['温柔','冷静']} value={tags} onChange={setTags}/><FontRuler value={size} onChange={setSize}/><output id="size">{size}</output>
<div style={{height:240,background:'#1c2030',marginTop:30,overflow:'hidden'}}><SwipeBackView onBack={()=>setBacks(v=>v+1)}><div id="back" style={{height:'100%',padding:16}}>边缘返回</div></SwipeBackView></div><output id="backs">{backs}</output>
<button id="open" onClick={()=>setMedia(true)} style={{height:48}}>打开图片</button>{media&&<ImagePreview images={images} onClose={()=>setMedia(false)}/>}</main>}
createRoot(document.getElementById('root')).render(<React.StrictMode><Fixture/></React.StrictMode>);`;
(async () => {
  const result = await build({ stdin: { contents: fixture, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, jsx: 'automatic', define: { 'import.meta.env': '{"DEV":true}', __APP_VERSION__: '"verify"' }, logLevel: 'warning' });
  const cssName = fs.readdirSync('dist/renderer/assets').find(file => file.endsWith('.css'));
  const css = fs.readFileSync(path.join('dist/renderer/assets', cssName));
  const server = http.createServer((req, res) => {
    if (req.url === '/app.js') { res.setHeader('content-type','text/javascript'); res.end(result.outputFiles[0].contents); }
    else if(req.url === '/app.css'){res.setHeader('content-type','text/css');res.end(css);}
    else res.end('<!doctype html><html class="dark"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="app.css"><body><div id="root"></div><script src="app.js"></script></body></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({channel:'chrome',headless:true});
  const page = await browser.newPage({viewport:{width:390,height:844},hasTouch:true});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));let checks=0;
  const check=(v,label)=>{assert.ok(v,label);checks++;console.log('PASS '+label);};
  const output=path.resolve('.tmp-preview/advanced-interactions-20261002');fs.mkdirSync(output,{recursive:true});
  const touch=async(type,x,y=400)=>page.locator('#back').evaluate((el,{type,x,y})=>{const e=new Event(type,{bubbles:true,cancelable:true});Object.defineProperty(e,'touches',{value:type==='touchend'?[]:[{clientX:x,clientY:y}]});el.dispatchEvent(e);},{type,x,y});
  const backX=()=>page.locator('[data-swipe-back]').evaluate(el=>{const t=getComputedStyle(el).transform;return t==='none'?0:new DOMMatrixReadOnly(t).m41;});
  const drag=async(x,y,dx,dy)=>{await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+dx,y+dy,{steps:5});};
  try{
    await page.goto('http://127.0.0.1:'+server.address().port);await page.locator('#action').waitFor();
    const action=page.locator('#action'),box=await action.boundingBox();
    await drag(box.x+30,box.y+20,170,0);check(await action.getAttribute('data-press-cancelled')!==null,'slide out provides a cancellation state');await page.mouse.up();
    check(await page.locator('#clicks').textContent()==='0','release outside a captured button cancels its action');
    await action.focus();await page.keyboard.press('Enter');check(await page.locator('#clicks').textContent()==='1','keyboard activation remains native');
    await action.click();check(await page.locator('#clicks').textContent()==='2','ordinary button taps still act once');
    await touch('touchstart',8);await touch('touchmove',170);await page.waitForTimeout(30);check(Math.abs(await backX()-162)<2,'edge return follows the finger directly');
    await touch('touchmove',140);await touch('touchend',140);await page.waitForTimeout(320);check(await page.locator('#backs').textContent()==='0'&&Math.abs(await backX())<1,'reversing before release cancels even beyond the distance threshold');
    await touch('touchstart',8);await touch('touchmove',55);await touch('touchend',55);await page.waitForTimeout(150);check(await page.locator('#backs').textContent()==='1','a short fast edge flick commits once');await page.waitForTimeout(240);
    await touch('touchstart',100);await touch('touchmove',125);await touch('touchend',125);await page.waitForTimeout(30);const rebound=await backX();
    await touch('touchstart',110);check(Math.abs(await backX()-rebound)<4,'new touch takes over a returning page at its current position');await touch('touchcancel',110);await page.waitForTimeout(320);
    await page.getByRole('button',{name:'温柔',exact:true}).click();
    check(await page.locator('.vg-filter-heading > button').evaluate(el=>el.getAnimations().length===0)&&await page.locator('.vg-filter-count .vg-animated-value').evaluate(el=>el.getAnimations().length>0),'filter transition moves only the changed count');
    const ruler=page.getByRole('slider',{name:'聊天字号'});await ruler.focus();await page.keyboard.press('End');await page.waitForTimeout(200);const rb=await ruler.boundingBox();
    await drag(rb.x+rb.width/2,rb.y+rb.height/2,-150,0);check(await page.locator('.vg-font-landing').textContent()==='松手选 22 px','ruler previews its landing before release: '+await page.locator('.vg-font-landing').textContent());
    const elastic=await page.locator('.vg-font-ticks').evaluate(el=>Math.abs(new DOMMatrixReadOnly(getComputedStyle(el).transform).m41));check(elastic>2&&elastic<28&&await page.locator('#size').textContent()==='22','ruler edge resistance stays bounded and never writes an invalid size');await page.screenshot({path:path.join(output,'landing-preview.png')});await page.mouse.up();await page.waitForTimeout(300);
    check(await page.locator('.vg-font-ticks').evaluate(el=>Math.abs(new DOMMatrixReadOnly(getComputedStyle(el).transform).m41)<.1),'ruler releases its elastic offset');
    await page.locator('#open').click();await page.waitForTimeout(350);await page.screenshot({path:path.join(output,'image-preview.png')});const stage=page.locator('.vg-media-stage');const sb=await stage.boundingBox();const x=sb.x+sb.width*.6,y=sb.y+sb.height*.4;
    await drag(x,y,-100,20);check(await stage.getAttribute('data-gesture-direction')==='x','horizontal image gesture locks before diagonal drift');await page.mouse.move(x-120,y+150);check(await stage.evaluate(el=>Math.abs(new DOMMatrixReadOnly(getComputedStyle(el).transform).m42)<1),'horizontal image gesture never starts downward dismissal');await page.mouse.up();await page.waitForTimeout(320);check(await stage.getAttribute('data-preview-index')==='1','locked image swipe selects only the adjacent image');
    await page.getByRole('button',{name:'上一张图片'}).click();await page.waitForTimeout(320);await drag(x,y,140,0);const edge=await page.locator('.vg-media-track').evaluate(el=>new DOMMatrixReadOnly(getComputedStyle(el).transform).m41);check(edge>0&&edge<38,'first image gives elastic boundary feedback');await page.mouse.up();await page.waitForTimeout(50);const pose=await page.locator('.vg-media-track').evaluate(el=>new DOMMatrixReadOnly(getComputedStyle(el).transform).m41);await page.mouse.move(x,y);await page.mouse.down();const takeover=await page.locator('.vg-media-track').evaluate(el=>new DOMMatrixReadOnly(getComputedStyle(el).transform).m41);check(Math.abs(takeover-pose)<5,'image rebound can be interrupted without jumping');await page.mouse.up();await page.waitForTimeout(320);
    await drag(x,y,10,55);check(await stage.getAttribute('data-gesture-direction')==='y','downward image gesture owns its direction');await page.mouse.move(x+130,y+145);await page.mouse.up();await page.waitForTimeout(30);check(await stage.count()===1,'image remains available during its dismissal animation');
    await page.mouse.move(x,y+40);await page.mouse.down();await page.mouse.up();await page.waitForTimeout(300);check(await stage.count()===1&&await stage.getAttribute('data-preview-index')==='0','grabbing a dismissing image cancels close and restores it');
    await drag(x,y,5,150);await page.mouse.up();await page.waitForTimeout(260);check(await stage.count()===0,'locked downward gesture closes without changing images');
    await page.emulateMedia({reducedMotion:'reduce'});await page.locator('#open').click();await page.getByRole('button',{name:'下一张图片'}).click();check(await page.locator('.vg-media-track').evaluate(el=>el.getAnimations().length===0),'reduced motion retains navigation without slide animations');await page.keyboard.press('Escape');
    for(const width of [320,390,430]){await page.setViewportSize({width,height:844});check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'controls fit '+width+'px');}
    await page.screenshot({path:path.join(output,'controls-dark.png')});check(errors.length===0,'no browser runtime errors');
    fs.writeFileSync(path.join(output,'result.txt'),'PASS '+checks+' advanced interaction checks\n');console.log('ALL PASS '+checks);
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
