import { build } from 'esbuild';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';

const before = process.argv.includes('--before');
const output = process.env.VG_VOICE_STAGE_OUTPUT || '.tmp-preview/ui-overhaul-20261015/voice-stage';
mkdirSync(output, { recursive:true });
const bundle = await build({ stdin:{contents:`import './scripts/verify/voice-call-ui';
import {useVoiceCallStore} from './src/store/voice-call-store';
import {useVoiceCallUIStore} from './src/store/voice-call-ui-store';
import {callOrbSignal} from './src/lib/voice-call/orb-signal';
import {getChatAtmosphereVariables} from './src/lib/chat-atmosphere';
import {installUiFont} from './src/lib/ui-font';
installUiFont();
window.voiceStageTest = {
theme(id){const panel=document.querySelector('.vg-voice-call-modal');for(const [key,value] of Object.entries(getChatAtmosphereVariables(id)))panel.style.setProperty(key,value)},
view(patch){const call=useVoiceCallStore.getState();useVoiceCallStore.setState({view:{...call.view,...patch}})},
record(exchanges, foreign=false){const call=useVoiceCallStore.getState();useVoiceCallStore.setState({record:{id:'stage-transcript',...call.owner,userId:foreign?'foreign-owner':call.owner.userId,startedAt:Date.now()-134000,endedAt:Date.now(),voice:'茉莉',summaryState:'pending',status:'active',messageIds:[],exchanges}})},
signal(){return callOrbSignal('ui-call-user','ui-call-role','ui-call-session')},
name(name){const target=useVoiceCallUIStore.getState().target;useVoiceCallUIStore.setState({target:{...target,character:{...target.character,name}}})}
};`,resolveDir:process.cwd(),sourcefile:'voice-stage-fixture.ts',loader:'ts'}, outfile:'voice-stage.js', bundle:true, write:false, platform:'browser', format:'iife', jsx:'automatic', loader:{ '.webp':'dataurl','.png':'dataurl' }, define:{ 'import.meta.env':'{"DEV":true}','import.meta.hot':'undefined',__APP_VERSION__:'"test"' } });
const js = bundle.outputFiles.find(file => file.path.endsWith('.js')).text;
const css = readdirSync('dist/renderer/assets').filter(file => file.endsWith('.css')).map(file => readFileSync(`dist/renderer/assets/${file}`,'utf8')).join('\n') + '\n' + bundle.outputFiles.find(file => file.path.endsWith('.css')).text;
const fontFiles=new Set(readdirSync('dist/renderer/assets').filter(name=>name.endsWith('.woff2')));
const server = createServer((req,res) => {
  const name=new URL(req.url,'http://127.0.0.1').pathname.split('/').pop();
  if(fontFiles.has(name)){res.setHeader('Content-Type','font/woff2');res.end(readFileSync(`dist/renderer/assets/${name}`));return;}
  res.setHeader('Content-Type',req.url==='/test.js'?'application/javascript':'text/html;charset=utf-8'); res.end(req.url==='/test.js'?js:`<html lang="zh-CN" class="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script src="/test.js"></script></body></html>`);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser = await chromium.launch({channel:'chrome',headless:true});
const context = await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});
const page = await context.newPage();
const errors=[],checks=[];let externalRequests=0;
page.on('pageerror',error=>errors.push(error.message));
await page.route('**/*',route=>{if(new URL(route.request().url()).hostname==='127.0.0.1')return route.continue();externalRequests++;return route.abort();});
try {
  await page.goto(`http://127.0.0.1:${server.address().port}/?virtugene-preview=mobile`);
  await page.waitForFunction(()=>window.callUiTest);
  await page.evaluate(()=>window.callUiTest.open());
  await page.getByRole('button',{name:'开始通话',exact:true}).waitFor();
  await page.evaluate(()=>window.callUiTest.playing());
  if(before)await page.getByRole('button',{name:'显示字幕',exact:true}).click();
  await page.locator('.vg-voice-call-captions').waitFor();
  await page.evaluate(()=>document.fonts.ready);
  const fonts=await page.evaluate(async()=>{
    const faces=await document.fonts.load('400 16px "VG Sans"','今天有点累，想和你说说话。静音扬声器文字结束通话');
    return faces.map(face=>({family:face.family,status:face.status}));
  });
  writeFileSync(`${output}/fonts.json`,JSON.stringify(fonts,null,2));
  assert.ok(fonts.length>0&&fonts.every(face=>face.status==='loaded'),'Real local UI font must load before visual comparison');
  checks.push('Local VG Sans font loaded before screenshots');
  for(const theme of ['dark','light']) {
    await page.evaluate(value=>document.documentElement.classList.toggle('dark',value==='dark'),theme);
    await page.screenshot({path:`${output}/${before?'before':'after'}-${theme}-390.png`});
  }
  if(process.argv.includes('--fidelity')) {
    assert.equal(await page.getByRole('button',{name:'停下，听我说',exact:true}).count(),0,'Voice call keeps four primary controls without an extra interrupt bar');
    assert.ok(!(await page.locator('.vg-voice-call').innerText()).includes('停下，听我说'),'Hints must not refer to the removed voice button');
    checks.push('Voice call has no extra interrupt bar or stale instruction');
    const geometry=await page.locator('.vg-voice-call-modal').evaluate(panel=>({
      footerBorder:getComputedStyle(panel.querySelector('.vg-modal-footer')).borderTopWidth,
      footerBackground:getComputedStyle(panel.querySelector('.vg-voice-call-footer')).backgroundColor,
      fontFamily:getComputedStyle(panel).fontFamily,
      bodyFontFamily:getComputedStyle(document.body).fontFamily,
      labels:[...panel.querySelectorAll('.vg-voice-call-controls button,.vg-voice-caption-person')].map(node=>parseFloat(getComputedStyle(node).fontSize)),
    }));
    writeFileSync(`${output}/fidelity.json`,JSON.stringify(geometry,null,2));
    assert.equal(geometry.footerBorder,'0px','Call atmosphere must not be split by a sheet footer divider');
    assert.equal(geometry.footerBackground,'rgba(0, 0, 0, 0)','Controls must share the continuous call surface');
    assert.ok(geometry.labels.every(size=>size>=14),'Primary control and speaker labels must be readable at the reference scale');
    checks.push('Continuous call surface and readable reference-scale labels');
    const material=await page.locator('.vg-voice-call-controls button svg').evaluateAll(nodes=>nodes.map(node=>{const s=getComputedStyle(node);return {gradient:s.backgroundImage,shadow:s.boxShadow,fill:s.fill,color:s.color}}));
    assert.ok(material.every(value=>value.gradient!=='none'&&value.shadow!=='none'),'All four action discs retain highlight and depth');
    assert.equal(await page.locator('.vg-voice-call-hangup path').getAttribute('fill'),'currentColor','Hangup has a solid, legible handset');
    await page.evaluate(()=>window.voiceStageTest.view({muted:true}));
    const muted=await page.locator('.vg-voice-call-controls button').first().locator('svg').evaluate(node=>({background:getComputedStyle(node).backgroundColor,color:getComputedStyle(node).color}));
    assert.notEqual(muted.background,muted.color,'Muted state must keep its icon distinguishable');
    await page.screenshot({path:`${output}/material-muted-light.png`});
    await page.evaluate(()=>window.voiceStageTest.view({muted:false}));
    writeFileSync(`${output}/material.json`,JSON.stringify({material,muted},null,2));
    checks.push('Four textured action discs, solid hangup, distinct mute state');
  }
  if(!before) {
    for(const scheme of ['dark','light'])for(const theme of ['cool','warm','lively','calm','steady','mysterious']) {
      await page.evaluate(({scheme,theme})=>{document.documentElement.classList.toggle('dark',scheme==='dark');window.voiceStageTest.theme(theme);}, {scheme,theme});
      await page.screenshot({path:`${output}/reference-${theme}-${scheme}.png`});
      assert.ok(await page.locator('.vg-voice-call-controls button').evaluateAll(nodes=>nodes.every(node=>node.getBoundingClientRect().bottom<=innerHeight)));
      assert.ok(await page.locator('.vg-voice-call-soul .vg-soul-orb').evaluate(node=>node.querySelectorAll('*').length<=160));
      checks.push(`${scheme}/${theme}: reference layout and safe shared orb clone size`);
      if (process.env.VG_VOICE_STAGE_AXE === '1') {
        const accessibility = await new AxeBuilder({page}).include('.vg-voice-call-modal').analyze();
        writeFileSync(`${output}/axe-${theme}-${scheme}.json`,JSON.stringify(accessibility,null,2));
        assert.deepEqual(accessibility.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})),[]);
        checks.push(`${scheme}/${theme}: axe has no violations (incomplete retained)`);
      }
    }
    assert.equal(await page.locator('.vg-voice-call-controls button').count(),4);checks.push('Four real controls');
    assert.ok(await page.locator('.vg-voice-call-soul').evaluate(node=>node.getBoundingClientRect().height>=200));checks.push('Central orb larger than identity portrait');
    assert.ok(!(await page.locator('.vg-voice-call').innerText()).includes('内部动作'));checks.push('Generated-only text hidden');
    const beforeCommits=await page.evaluate(()=>window.callUiTest.commits());
    await page.evaluate(async()=>{window.callUiTest.noisyCapture();await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
    assert.equal(await page.evaluate(()=>window.callUiTest.commits()),beforeCommits);checks.push('Capture frames do not rerender surface');
    for(const theme of ['dark','light'])for(const width of [320,390,430]) {
      await page.setViewportSize({width,height:844});await page.evaluate(value=>document.documentElement.classList.toggle('dark',value==='dark'),theme);
      writeFileSync(`${output}/layout-${theme}-${width}.json`,JSON.stringify(await page.locator('.vg-voice-call').evaluate(node=>({width:node.clientWidth,scroll:node.scrollWidth,nodes:[...node.querySelectorAll('*')].filter(el=>el.getBoundingClientRect().right>innerWidth||el.matches('.vg-voice-call-identity,.vg-voice-call-identity>div,.vg-voice-call-header strong')).map(el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return {class:el.className,tag:el.tagName,width:r.width,left:r.left,right:r.right,display:s.display,position:s.position,margin:s.margin,gap:s.gap,justify:s.justifyContent,flex:s.flex};})})),null,2));
      assert.ok(await page.locator('.vg-voice-call').evaluate(node=>node.scrollWidth<=node.clientWidth+1));
      assert.ok(await page.locator('.vg-voice-call-controls button').evaluateAll(nodes=>nodes.every(node=>{const r=node.getBoundingClientRect();return r.width>=48&&r.height>=48&&r.bottom<=innerHeight;})));
      await page.screenshot({path:`${output}/after-${theme}-${width}.png`});checks.push(`${theme} ${width}: no overflow, 48px controls visible`);
    }
    const longSpeech='今天的风很轻，你可以慢慢说。我会认真听完，也会记得你已经说过的事情。'.repeat(24);
    await page.evaluate(text=>window.voiceStageTest.view({speakingText:text,heardText:'',userText:'想把今天的事情慢慢说完。'}),longSpeech);
    const spokenParagraph=page.locator('.vg-voice-caption-current .vg-voice-caption-line').last().locator('p');
    const compactHeight=await spokenParagraph.evaluate(node=>node.clientHeight);
    await page.getByRole('button',{name:'展开完整字幕',exact:true}).click();
    assert.ok(await spokenParagraph.evaluate(node=>node.clientHeight)>compactHeight*2);assert.equal(await spokenParagraph.innerText(),longSpeech);checks.push('Long current caption expands without dropping text');
    await page.getByRole('button',{name:'收起完整字幕',exact:true}).click();
    const transcript = Array.from({length:24},(_,index)=>({turnId:`turn-${index}`,userText:`第${index+1}轮：确实说过的话。`,generatedText:'不应显示的未播放草稿',heardText:'不可信heardText',interrupted:index===0,
      segments:[{id:`segment-${index}`,turnId:`turn-${index}`,text:`第${index+1}轮：确认播放的回应。`,generatedAt:1,playedAt:2,playedFrames:24,interrupted:false},
        {id:`unplayed-${index}`,turnId:`turn-${index}`,text:'尚未播放',generatedAt:1,interrupted:true}],metrics:{turnId:`turn-${index}`,stoppedAt:1}}));
    await page.evaluate(exchanges=>window.voiceStageTest.record(exchanges),transcript);
    await page.getByRole('button',{name:'本次记录 · 24',exact:true}).click();
    const transcriptPanel=page.locator('.vg-voice-caption-history');
    assert.equal(await page.locator('.vg-voice-caption-turn').count(),24);
    assert.ok(!(await transcriptPanel.innerText()).includes('不可信heardText')&&!(await transcriptPanel.innerText()).includes('不应显示的未播放草稿')&&!(await transcriptPanel.innerText()).includes('尚未播放'));checks.push('History derives only confirmed played segments');
    await transcriptPanel.evaluate(node=>node.scrollTop=240);const readTop=await transcriptPanel.evaluate(node=>node.scrollTop);
    await page.evaluate(exchanges=>window.voiceStageTest.record(exchanges),[...transcript,{...transcript[0],turnId:'new-turn',userText:'新的一轮',segments:[]}]);
    assert.equal(await transcriptPanel.evaluate(node=>node.scrollTop),readTop);checks.push('New saved turn does not steal transcript reading position');
    await page.screenshot({path:`${output}/history-reading.png`});
    await page.evaluate(exchanges=>window.voiceStageTest.record(exchanges,true),[{...transcript[0],userText:'FOREIGN_PRIVATE_TEXT'}]);
    assert.ok(!(await page.locator('.vg-voice-call').innerText()).includes('FOREIGN_PRIVATE_TEXT'));checks.push('Foreign record identity cannot enter captions');
    for(const [phase,label] of [['initializing','正在准备声音'],['connecting','正在连接'],['listening','正在听你说'],['recognizing','正在听清'],['generating','正在想回应'],['playing','正在回应'],['interrupting','正在停下'],['paused','通话已暂停'],['error','连接需要恢复'],['ended','通话已结束']]) {
      await page.evaluate(phase=>window.voiceStageTest.view({phase,muted:false,inputMode:'voice',inputModePending:false,error:undefined}),phase);
      assert.equal(await page.locator('.vg-voice-call-status').innerText(),label);checks.push(`True phase label: ${phase}`);
    }
    await page.evaluate(()=>window.voiceStageTest.view({phase:'generating',level:.95,speakingText:'',inputMode:'voice',muted:false}));
    assert.deepEqual(await page.evaluate(()=>window.voiceStageTest.signal()),{captureLevel:0,playback:false});checks.push('Waiting has no invented speaking amplitude');
    await page.evaluate(()=>window.voiceStageTest.view({phase:'listening',level:.4}));
    assert.deepEqual(await page.evaluate(()=>window.voiceStageTest.signal()),{captureLevel:.4,playback:false});checks.push('Capture feedback uses real level only while listening');
    for(const patch of [{muted:true},{muted:false,inputMode:'text'},{inputMode:'voice',inputModePending:true}]) {
      await page.evaluate(patch=>window.voiceStageTest.view(patch),patch);assert.equal((await page.evaluate(()=>window.voiceStageTest.signal())).captureLevel,0);
    }checks.push('Muted/text/pending input has zero capture');
    await page.evaluate(()=>window.voiceStageTest.view({phase:'playing',inputMode:'voice',inputModePending:false,speakingText:'已开始播放的句子。'}));
    assert.deepEqual(await page.evaluate(()=>window.voiceStageTest.signal()),{captureLevel:0,playback:true});checks.push('Playing feedback gated on playback text receipt');
    await page.keyboard.press('Escape');
    await page.evaluate(()=>window.callUiTest.hosted());
    await page.getByRole('button',{name:'收起通话',exact:true}).click();
    await page.getByRole('button',{name:/返回与晓来的语音通话/}).waitFor();assert.equal(await page.evaluate(()=>window.hostedCall.ends()),0);
    await page.getByRole('button',{name:/返回与晓来的语音通话/}).click();checks.push('Minimize/restore preserves single call ownership');
    await page.evaluate(()=>window.voiceStageTest.name('这是一个十二字以上的非常长的角色名字'));
    await page.setViewportSize({width:320,height:568});
    assert.ok(await page.locator('.vg-voice-call-header').evaluate(node=>node.scrollWidth<=node.clientWidth+1));
    assert.ok(await page.locator('.vg-voice-call-controls button').evaluateAll(nodes=>nodes.every(node=>node.getBoundingClientRect().bottom<=innerHeight)));checks.push('Long name in short narrow viewport keeps controls reachable');
    await page.screenshot({path:`${output}/long-name-320.png`});
    if(process.argv.includes('--fidelity')) {
      for(const viewport of [{width:320,height:568},{width:844,height:390}]) {
        await page.setViewportSize(viewport);
        await page.locator('.vg-voice-call-modal').evaluate(panel=>{
          const nodes=[panel,...panel.querySelectorAll('*:not(svg):not(svg *)')];
          const sizes=nodes.map(node=>parseFloat(getComputedStyle(node).fontSize)*2);
          nodes.forEach((node,index)=>{node.dataset.originalFont=node.style.fontSize;node.style.fontSize=`${sizes[index]}px`;});
        });
        const targets=await page.locator('.vg-voice-call-controls button').evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect();return {left:r.left,right:r.right,bottom:r.bottom,width:r.width,height:r.height}}));
        writeFileSync(`${output}/large-text-${viewport.width}.json`,JSON.stringify(targets,null,2));
        assert.ok(targets.every(r=>r.left>=0&&r.right<=viewport.width&&r.bottom<=viewport.height&&r.width>=48&&r.height>=48),'Large-text and landscape keep all four actions reachable');
        const iconTops=await page.locator('.vg-voice-call-controls button svg').evaluateAll(nodes=>nodes.map(node=>node.getBoundingClientRect().top));
        assert.ok(Math.max(...iconTops)-Math.min(...iconTops)<=1,'Action discs stay aligned when enlarged labels wrap');
        await page.screenshot({path:`${output}/large-text-${viewport.width}.png`});
        await page.locator('.vg-voice-call-modal').evaluate(panel=>[panel,...panel.querySelectorAll('[data-original-font]')].forEach(node=>{node.style.fontSize=node.dataset.originalFont;delete node.dataset.originalFont;}));
        checks.push(`${viewport.width}x${viewport.height}: actual 200% text size preserves actions`);
      }
    }
    await page.evaluate(()=>window.voiceStageTest.name('晓来'));
    await page.setViewportSize({width:390,height:844});
    for(const systemReduce of [true,false]) {
      await page.emulateMedia({reducedMotion:systemReduce?'reduce':'no-preference'});
      await page.evaluate(system=>{document.documentElement.dataset.vgReducedMotion=system?'false':'true';window.dispatchEvent(new Event('vg:motion-preference'));},systemReduce);
      assert.equal(await page.locator('.vg-voice-call-halo').evaluate(node=>getComputedStyle(node).animationName),'none');
      const svg=page.locator('.vg-voice-call-soul svg'),snapshot=await svg.innerHTML();await page.waitForTimeout(180);assert.equal(await svg.innerHTML(),snapshot);
    }checks.push('OS and app reduced motion stop halo and orb');
    await page.emulateMedia({reducedMotion:'no-preference'});await page.evaluate(()=>{document.documentElement.dataset.vgReducedMotion='false';window.dispatchEvent(new Event('vg:motion-preference'));document.documentElement.setAttribute('data-vg-background','true');});
    assert.equal(await page.locator('.vg-voice-call-halo').evaluate(node=>getComputedStyle(node).animationName),'none');
    const backgroundOrb=page.locator('.vg-voice-call-soul svg'),paused=await backgroundOrb.innerHTML();await page.waitForTimeout(180);assert.equal(await backgroundOrb.innerHTML(),paused);checks.push('Background stops decorative and orb frames');
    await page.evaluate(()=>{document.documentElement.removeAttribute('data-vg-background');window.hostedCall.cleanup();});
    const recordingContext=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'no-preference',recordVideo:{dir:`${output}/video`,size:{width:390,height:844}}});
    await recordingContext.route('**/*',route=>{if(new URL(route.request().url()).hostname==='127.0.0.1')return route.continue();externalRequests++;return route.abort();});
    const recording=await recordingContext.newPage();await recording.goto(`http://127.0.0.1:${server.address().port}/?virtugene-preview=mobile`);await recording.waitForFunction(()=>window.callUiTest);
    await recording.evaluate(()=>window.callUiTest.hosted());await recording.evaluate(()=>window.callUiTest.state('listening'));
    await recording.waitForTimeout(1800);await recording.screenshot({path:`${output}/listening-dark-390.png`});
    await recording.evaluate(()=>window.voiceStageTest.view({phase:'generating',speakingText:'',heardText:'',level:0}));await recording.waitForTimeout(1800);
    await recording.evaluate(()=>window.callUiTest.playing());await recording.waitForTimeout(1800);
    await recording.getByRole('button',{name:'收起通话',exact:true}).click();await recording.waitForTimeout(600);
    await recording.getByRole('button',{name:/返回与晓来的语音通话/}).click();await recording.waitForTimeout(600);
    await recording.evaluate(()=>{document.documentElement.classList.remove('dark');window.callUiTest.state('listening');});await recording.waitForTimeout(600);await recording.screenshot({path:`${output}/listening-light-390.png`});
    await recording.evaluate(()=>window.hostedCall.cleanup());await recordingContext.close();
    checks.push('Recorded local simulated lifecycle, no microphone or network');
  }
  assert.deepEqual(errors,[]);assert.equal(externalRequests,0);
  writeFileSync(`${output}/${before?'before':'result'}.json`,JSON.stringify({checks,errors,externalRequests,models:0,microphone:0,deviceTested:false,scope:'Real UI with isolated lifecycle and record fixtures; no Android/audio-service performance claim'},null,2));
  console.log(JSON.stringify({before,checks:checks.length,errors,externalRequests,output}));
} finally { await browser.close();await new Promise(resolve=>server.close(resolve)); }
