import {chromium} from 'playwright';
import {mkdirSync,writeFileSync} from 'node:fs';
const out=process.env.VG_SCENE_EVIDENCE??'.tmp-preview/chat-scenes-collection-20261019/demo';mkdirSync(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true,recordVideo:{dir:out,size:{width:390,height:844}}}),page=await context.newPage();
await page.goto('http://127.0.0.1:5321/?demo=snow-study&theme=dark');await page.waitForFunction(()=>document.querySelector('.vg-chat-scene')?.dataset.sceneLoad==='ready');
const states=[];
for(const id of ['home-bedroom','home-living','snow-study','mist-coast','hearth-cabin','night-train','cafe-afternoon','cafe-rain-night']){
 await page.evaluate(id=>window.sceneTest.scene(id),id);await page.waitForFunction(id=>document.querySelector('.vg-chat-scene')?.dataset.sceneId===id&&document.querySelector('.vg-chat-scene')?.dataset.sceneLoad==='ready',id);
 await page.waitForTimeout(2200);await page.screenshot({path:`${out}/${id}-dark.png`});states.push({id,at:await page.evaluate(()=>performance.now()),state:await page.evaluate(()=>window.sceneTest.inspect())});
}
await page.evaluate(()=>window.backgroundTest.theme('light'));await page.waitForTimeout(1000);await page.screenshot({path:out+'/rain-night-light.png'});
const video=await page.video().path();await context.close();await browser.close();writeFileSync(out+'/capture.json',JSON.stringify({video,states,scope:'Unaltered actual ChatWindow at 390x844, 2x DPR. Synthetic local messages and controlled transport. No model or microphone calls; desktop recording, not Android evidence.'},null,2));console.log(JSON.stringify({video,scenes:states.length}));
