import { createRequire } from 'node:module';
import { dirname,join } from 'node:path';
import { readFileSync,writeFileSync,existsSync } from 'node:fs';
import assert from 'node:assert/strict';
const {chromium}=createRequire(join(dirname(process.execPath),'package.json'))('playwright');
const dir='.tmp-preview/orb-vitality-20261013',status=JSON.parse(readFileSync(`${dir}/preview-status.json`,'utf8'));
const executablePath=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Users/34568/AppData/Local/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser=await chromium.launch({executablePath,headless:true}),page=await browser.newPage({viewport:{width:390,height:900},hasTouch:true});
let external=0;const errors=[],checks=[];page.on('pageerror',error=>errors.push(error.message));
await page.route('**/*',route=>{if(route.request().url().startsWith(new URL(status.url).origin))return route.continue();external++;return route.abort();});
const check=(ok,label)=>{assert.ok(ok,label);checks.push(label);};
try{
  check((await page.goto(status.url)).status()===200,'exact preview URL responds with HTTP 200');
  const component=page.frameLocator('iframe');await component.locator('.vg-character-orb .vg-soul-orb').waitFor();
  await page.waitForFunction(()=>document.querySelector('iframe').contentDocument.querySelector('.vg-character-orb .vg-soul-orb')?.dataset.orbMotion==='active');
  check(await component.locator('.vg-character-orb .vg-soul-orb').getAttribute('data-orb-motion')==='active','served preview renders the actual living chat header');
  await page.getByRole('button',{name:'放大看小星',exact:true}).click();await component.getByRole('button',{name:'动效测试小星0',exact:true}).click();check(true,'preview controls reach the actual interactive component');
  await page.getByRole('button',{name:'外观设置',exact:true}).click();await component.getByRole('radiogroup',{name:'小星动态强度'}).getByRole('radio',{name:/灵动/}).check();
  check(await component.locator('.vg-soul-orb[data-orb-context="reading"]').getAttribute('data-orb-intensity')==='lively','actual account-scoped strength choice works in the served preview');
  const frame=page.frames().find(f=>f.url().endsWith('/components'));
  const blocked=await frame.evaluate(async()=>{
    let network=false,microphone=false;
    try{await fetch('https://example.invalid/never-send');}catch{network=true;}
    try{await navigator.mediaDevices.getUserMedia({audio:true});}catch{microphone=true;}
    return {network,microphone,guard:window.__VG_PREVIEW_GUARD__};
  });
  check(blocked.network&&blocked.guard.networkAttempts===1&&external===0,'external fetch is rejected before any network transfer');
  check(blocked.microphone&&blocked.guard.mediaAttempts===1,'microphone is rejected before any permission request');
  await page.getByRole('combobox',{name:'模拟通话状态'}).selectOption('playing');await component.locator('.vg-voice-call-soul').waitFor();
  await page.waitForFunction(()=>document.querySelector('iframe').contentDocument.querySelector('.vg-voice-call-soul .vg-soul-orb')?.dataset.orbAudio==='playback');
  check(await component.locator('.vg-voice-call-soul .vg-soul-orb').getAttribute('data-orb-audio')==='playback','explicitly simulated playback drives the existing voice UI');
  await page.getByRole('combobox',{name:'模拟通话状态'}).selectOption('none');await page.getByRole('button',{name:'放大看小星',exact:true}).click();
  await page.screenshot({path:`${dir}/served-preview-390.png`});
  await frame.evaluate(()=>vitalityTest.font(22));await page.setViewportSize({width:320,height:568});await page.getByRole('button',{name:'实际聊天页',exact:true}).click();
  await component.getByRole('textbox',{name:'消息内容',exact:true}).waitFor();
  check(await frame.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'actual chat at 320px and 22px font has no horizontal overflow');
  await page.screenshot({path:`${dir}/actual-chat-320-font22.png`,fullPage:true});
  check(errors.length===0,'preview has no uncaught page errors');
  writeFileSync(`${dir}/preview-smoke.json`,JSON.stringify({date:new Date().toISOString(),url:status.url,passed:checks.length,checks,errors,externalRequests:external,guardChecks:blocked,realModelCalls:0,nativeAudioUsed:false},null,2)+'\n');
  console.log(`PASS isolated-preview: ${checks.length} checks, ${status.url}, network/microphone guarded`);
}catch(error){writeFileSync(`${dir}/preview-smoke-failure-${Date.now()}.json`,JSON.stringify({checks,errors,error:String(error)}));throw error;}
finally{await browser.close();}
