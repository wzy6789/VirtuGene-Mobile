/** M2 actual-component visuals + interaction evidence. Never rewrites baseline. */
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { productPreview } from '../preview-product-upgrade.mjs';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const parent = process.env.VG_PRODUCT_M2_OUTPUT || '.tmp-preview/ui-overhaul-20261015/m2';
const out = join(parent, stamp); mkdirSync(out, { recursive: true });
const preview = process.env.VG_PRODUCT_PREVIEW_URL ? null : await productPreview({ port: 0 });
const address = process.env.VG_PRODUCT_PREVIEW_URL || preview.address;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const report = { startedAt: new Date().toISOString(), browser: browser.version(), address, checks: [], screenshots: [], videos: [], axe: [], errors: [], externalRequests: [], limitations: ['Windows desktop Chrome mobile viewport emulation; not Android.', '200% text test doubles computed text sizes in the browser; it is not a claim about Android font-scale rendering.', 'Voice states are explicitly simulated; real audio, microphone and native bridge are disabled.'] };
const sha = value => createHash('sha256').update(value).digest('hex');
const assert = (value, detail) => { if (!value) throw Error(typeof detail === 'string' ? detail : JSON.stringify(detail)); };
const check = async (name, run) => { try { const detail = await run(); report.checks.push({ name, pass: true, detail }); } catch (e) { report.checks.push({ name, pass: false, error: e.message }); console.log('FAIL ' + name + ': ' + e.message); } };
const settle = page => page.waitForTimeout(500);
const api = (page, method, ...args) => page.evaluate(async ({ method, args }) => window.productUpgradeTest[method](...args), { method, args });
async function capture(page, file) { const path = join(out, file); await page.screenshot({ path, fullPage: false }); report.screenshots.push({ file, sha256: sha(readFileSync(path)) }); }
async function newPage(width = 390, theme = 'dark', reducedMotion = 'reduce', record = false) {
  const context = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, colorScheme: theme, reducedMotion, ...(record?{recordVideo:{dir:join(out,'video'),size:{width,height:844}}}:{}) });
  await context.route('**/*', route => {
    const url = route.request().url();
    if (!url.startsWith(address + '/') && !url.startsWith('data:') && !url.startsWith('blob:')) { report.externalRequests.push(url); return route.abort(); }
    return route.continue();
  });
  const page = await context.newPage(); page.setDefaultTimeout(8000);
  page.on('pageerror', e => report.errors.push({ width, theme, error: e.message }));
  await page.goto(`${address}/app?theme=${theme}`);
  await page.waitForFunction(() => window.productUpgradeReady, { timeout: 60000 });
  await page.evaluate(() => document.fonts.ready); await settle(page);
  return { context, page };
}
const overflow = page => page.evaluate(() => {
  const surface=[...document.querySelectorAll('[role="dialog"][aria-modal="true"]')].filter(el=>el.getBoundingClientRect().height>0).at(-1)??document.body;
  const strips=[...surface.querySelectorAll('.vg-filter-strip')].map(el=>({overflow:getComputedStyle(el).overflowX,width:el.getBoundingClientRect().width,scrollWidth:el.scrollWidth}));
  const visibleOverflow=[...surface.querySelectorAll('button,input,textarea,h1,h2,h3,p')].filter(el=>{
    const r=el.getBoundingClientRect(),s=getComputedStyle(el),strip=el.closest('.vg-filter-strip');
    // Offscreen chips belong to a bounded horizontal scroller, not page overflow.
    if(strip&&['auto','scroll'].includes(getComputedStyle(strip).overflowX)&&strip.getBoundingClientRect().right<=innerWidth+1)return false;
    return r.width>0&&r.height>0&&r.top<innerHeight&&r.bottom>0&&s.visibility!=='hidden'&&!el.closest('[inert],[hidden],.sr-only')&&(r.left< -1||r.right>innerWidth+1);
  }).slice(0,8).map(el=>({tag:el.tagName,text:el.textContent?.slice(0,70),rect:el.getBoundingClientRect().toJSON()}));
  return {viewport:innerWidth,document:document.documentElement.scrollWidth,visibleOverflow,intentionalHorizontalScrollers:strips};
});
async function textScale(page, scale) { return page.evaluate(scale => { const list=[...document.querySelectorAll('body *')].filter(el => !el.closest('svg,#preview-isolation-label') && [...el.childNodes].some(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim())).map(el => [el, parseFloat(getComputedStyle(el).fontSize)]); for(const [el,size] of list)el.style.setProperty('font-size',`${size*scale}px`,'important'); return list.length; }, scale); }
async function reachable(page, locator) { await locator.scrollIntoViewIfNeeded(); const box=await locator.boundingBox(); assert(box && box.width >= 44 && box.height >= 44, { box, target: await locator.textContent() }); assert(box.x >= -1 && box.x + box.width <= 321 && box.y >= -1 && box.y + box.height <= 845, { box }); return box; }
try {
  // Same fixture and viewport matrix as before: actual production components.
  for (const width of [320,390,430]) for (const theme of ['dark','light']) {
    const { context, page } = await newPage(width, theme);
    report.fixtureSha256 ??= sha(JSON.stringify(await page.evaluate(() => window.productUpgradeFixture)));
    for (const screen of ['home','characters','profile','chat','call','call-connected']) {
      await api(page,'go',screen); await settle(page);
      await capture(page,`${screen}-${theme}-${width}.png`);
      await check(`${screen} ${theme} ${width}: no horizontal overflow`, async () => { const state=await overflow(page); assert(state.document<=width && state.visibleOverflow.length===0,state); return state; });
      if (width === 390) {
        const result = await new AxeBuilder({ page }).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
        report.axe.push({ screen, theme, violations: result.violations, incomplete: result.incomplete });
        await check(`${screen} ${theme}: axe WCAG`, () => { assert(result.violations.length===0,result.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>n.target)}))); });
      }
    }
    await context.close();
  }
  const { context, page } = await newPage(390,'dark','no-preference',true);
  await check('stage selection changes role without navigation or session mutation', async () => {
    const before=await api(page,'snapshot'); await page.getByRole('button',{name:'展示程砚',exact:true}).click();
    assert(await page.locator('[data-stage-character]').getAttribute('data-stage-character')==='b','stage did not select 程砚');
    const after=await api(page,'snapshot'); assert(after.selectedCharacterId===before.selectedCharacterId&&!after.navigation.chatFromList&&!after.navigation.chatFromCharacters,after); return { before:before.selectedCharacterId,after:after.selectedCharacterId };
  });
  await check('continue stage opens selected real conversation', async () => {
    await page.getByRole('button',{name:'继续对话',exact:true}).click(); await page.locator('.chat-header').waitFor(); const state=await api(page,'snapshot'); assert(state.selectedCharacterId==='b'&&state.sessionId==='b'&&state.navigation.chatFromList,state); assert((await page.locator('.chat-header').innerText()).includes('程砚'),'wrong chat header');
  });
  await api(page,'go','home'); await settle(page);
  await check('stage collapse persists across tab return and page reload', async () => {
    await page.getByRole('button',{name:'收起今日角色舞台',exact:true}).click(); await api(page,'go','characters'); await settle(page); await api(page,'go','home'); await settle(page); assert(await page.locator('.vg-today-stage.is-collapsed').count()===1,'return lost collapse');
    await page.reload(); await page.waitForFunction(()=>window.productUpgradeReady); await settle(page); assert(await page.locator('.vg-today-stage.is-collapsed').count()===1,'reload lost collapse');
  });
  await check('stage collapse and visible roles are account scoped', async () => {
    await api(page,'account','preview-second-owner'); await settle(page); assert(await page.locator('.vg-today-stage.is-collapsed').count()===0,'old collapse leaked'); assert(await page.locator('[data-stage-character]').getAttribute('data-stage-character')==='other-role','wrong account stage'); assert(!(await page.locator('.vg-conversation-scroll').innerText()).includes('知微'),'old role leaked');
    await page.getByRole('button',{name:'收起今日角色舞台',exact:true}).click(); await api(page,'account','stream-test-user'); await settle(page); assert(await page.locator('.vg-today-stage.is-collapsed').count()===1,'first preference missing'); await page.locator('.vg-today-expand').click();
  });
  await check('home search shows one matching conversation, no duplicate stage', async () => {
    await page.getByRole('textbox',{name:'搜索聊天',exact:true}).fill('程砚'); await settle(page); assert(await page.locator('.vg-conversation-row').count()===1,'search duplicates'); assert(await page.locator('[data-stage-character]').count()===0,'search left duplicate stage'); assert((await page.locator('.vg-conversation-row').innerText()).includes('程砚'),'wrong match'); await page.getByRole('button',{name:'清空搜索',exact:true}).click();
  });
  await api(page,'go','characters'); await settle(page);
  await check('gallery renders each local role once across featured and list', async () => { for(const name of ['知微','程砚','闻川']) assert(await page.getByRole('button',{name:`打开${name}的角色空间`,exact:true}).count()===1,`duplicate ${name}`); });
  await check('offscreen tag remains reachable in its bounded horizontal scroller',async()=>{
    const chip=page.locator('.vg-filter-strip').getByRole('button',{name:'写作',exact:true});await chip.scrollIntoViewIfNeeded();await chip.click();await settle(page);
    assert(await chip.getAttribute('aria-pressed')==='true','tag did not activate');assert(await page.getByRole('button',{name:/打开.*的角色空间/}).count()===1,'tag selection not applied');assert(await page.getByRole('button',{name:'打开闻川的角色空间',exact:true}).count()===1,'wrong tag result');
    await page.getByRole('button',{name:'已选 1 项，清除筛选',exact:true}).click();await settle(page);
  });
  await check('gallery filter and no-results recovery use actual controls', async () => {
    await page.getByRole('textbox',{name:'搜索角色',exact:true}).fill('沉静'); await settle(page); assert(await page.getByRole('button',{name:/打开.*的角色空间/}).count()===1,'search did not filter'); assert(await page.getByRole('button',{name:'打开程砚的角色空间',exact:true}).count()===1,'tag search wrong');
    await page.getByRole('textbox',{name:'搜索角色',exact:true}).fill('不存在的预览名字'); await page.getByRole('button',{name:'清除筛选',exact:true}).click(); assert(await page.getByRole('textbox',{name:'搜索角色',exact:true}).inputValue()==='','clear did not reset');
  });
  await check('gallery opens role space, returns to same scroll offset and keeps filters', async () => {
    await api(page,'seedMany',30); await settle(page); const scroll=page.locator('.vg-gallery-scroll'); await scroll.evaluate(el=>{el.scrollTop=620}); await settle(page); const before=await scroll.evaluate(el=>el.scrollTop);
    const role=page.getByRole('button',{name:'打开预览角色01的角色空间',exact:true}); await role.scrollIntoViewIfNeeded(); const actual=await scroll.evaluate(el=>el.scrollTop); assert(actual>100,{reason:'fixture must exercise a nonzero scroll position',actual}); await role.click(); await page.locator('.vg-character-space').waitFor(); assert((await page.locator('.vg-space-identity').innerText()).includes('预览角色01'),'wrong profile'); await page.locator('.vg-character-space').getByRole('button',{name:'返回',exact:true}).click(); await settle(page); const after=await scroll.evaluate(el=>el.scrollTop); assert(Math.abs(actual-after)<3,{before,actual,after}); return {before,actual,after};
  });
  await check('role-space continue targets that character and returns to gallery', async () => {
    await page.getByRole('textbox',{name:'搜索角色',exact:true}).fill('闻川'); await page.getByRole('button',{name:'打开闻川的角色空间',exact:true}).click(); await page.locator('.vg-space-chat-action').click(); await page.locator('.chat-header').waitFor(); const state=await api(page,'snapshot'); assert(state.selectedCharacterId==='c'&&state.navigation.chatFromCharacters,state); await page.evaluate(()=>history.back()); await page.getByRole('textbox',{name:'搜索角色',exact:true}).waitFor(); assert(await page.getByRole('textbox',{name:'搜索角色',exact:true}).inputValue()==='闻川','gallery search reset');
  });
  await check('role-space voice opens preparation for that role without starting capture', async () => {
    await page.getByRole('button',{name:'打开闻川的角色空间',exact:true}).click(); await page.locator('.vg-space-voice-action').click(); await settle(page); const state=await api(page,'snapshot'); assert(state.call.target?.characterId==='c'&&state.call.target?.userId==='stream-test-user'&&!state.call.busy&&!state.call.phase,state.call); assert(state.isolation.microphoneBlocked===0&&state.isolation.nativeBridgeBlocked===0,state.isolation); const copy=await page.locator('.vg-voice-call-modal').innerText(); assert(copy.includes('准备')||copy.includes('用声音'),'preparation missing'); return state.call;
  });
  await context.close();
  const video=await page.video()?.path();if(video)report.videos.push({path:video,sha256:sha(readFileSync(video)),scope:'actual M2 navigation with synthetic records; no real audio'});
  // Observe the real gallery -> profile -> chat handoff, including interruptions.
  for (const interruption of ['finish','resize','reduce','owner']) {
    const motion=await newPage(390,'dark','no-preference');
    await check(`profile to chat shared portrait/surface: ${interruption} cleanup`,async()=>{
      if(interruption==='owner'){await api(motion.page,'account','preview-second-owner');await api(motion.page,'account','stream-test-user');}
      await api(motion.page,'go','characters');await settle(motion.page);
      await motion.page.getByRole('button',{name:'打开知微的角色空间',exact:true}).click();await motion.page.locator('.vg-space-chat-action').waitFor();await settle(motion.page);
      await motion.page.evaluate(interruption=>{
        const observed={ghost:false,surface:false,ghostText:'',surfaceText:'',surfaceBackground:'',interrupted:false,samples:[]};window.__handoffObserved=observed;
        const observer=new MutationObserver(()=>{
          const ghost=document.querySelector('.vg-soul-ghost'),surface=document.querySelector('.vg-soul-surface');
          if(ghost){observed.ghost=true;observed.ghostText=ghost.textContent;}
          if(surface){observed.surface=true;observed.surfaceText=surface.textContent;observed.surfaceBackground=getComputedStyle(surface).backgroundImage;}
          if(ghost||surface)observed.samples.push({at:performance.now(),ghost:!!ghost,surface:!!surface});
          if(surface&&!observed.interrupted&&interruption!=='finish'){
            observed.interrupted=true;
            if(interruption==='resize')window.dispatchEvent(new Event('resize'));
            if(interruption==='reduce')window.productUpgradeTest.reduced(true);
            if(interruption==='owner')void window.productUpgradeTest.account('preview-second-owner');
          }
        });observer.observe(document.body,{subtree:true,childList:true});setTimeout(()=>observer.disconnect(),1100);
      },interruption);
      await motion.page.locator('.vg-space-chat-action').click(); await motion.page.waitForTimeout(1150);
      const observed=await motion.page.evaluate(()=>({...window.__handoffObserved,ghosts:document.querySelectorAll('.vg-soul-ghost').length,surfaces:document.querySelectorAll('.vg-soul-surface').length,hiddenSources:document.querySelectorAll('[data-soul-hidden]').length,owner:window.productUpgradeTest.snapshot().owner}));
      assert(observed.ghost&&observed.surface,observed); assert(!observed.ghostText&&!observed.surfaceText&&!observed.surfaceBackground.includes('url('),observed);
      assert(observed.ghosts===0&&observed.surfaces===0&&observed.hiddenSources===0,observed);
      if(interruption!=='finish')assert(observed.interrupted,observed);if(interruption==='owner')assert(observed.owner==='preview-second-owner',observed);
      return observed;
    });
    await motion.context.close();
  }
  for (const theme of ['dark','light']) {
    const narrow=await newPage(320,theme);
    await api(narrow.page,'rename','a','知微与漫长午后的一段温柔对话');
    for(const screen of ['home','characters','profile']) {
      await api(narrow.page,'go',screen); await settle(narrow.page);
      await check(`${screen} ${theme}: 320 long name no overflow`,async()=>{const state=await overflow(narrow.page);assert(state.document<=320&&state.visibleOverflow.length===0,state);});
      await capture(narrow.page,`${screen}-${theme}-320-long-name.png`);
      await textScale(narrow.page,2); await settle(narrow.page);
      await capture(narrow.page,`${screen}-${theme}-320-text-200.png`);
      await check(`${screen} ${theme}: 200% text primary action reachable`,async()=>{
        const locator=screen==='home'?narrow.page.getByRole('button',{name:'继续对话',exact:true}):screen==='characters'?narrow.page.getByRole('button',{name:'＋ 添加角色',exact:true}):narrow.page.locator('.vg-space-chat-action');
        return await reachable(narrow.page,locator);
      });
      // Fresh mount removes measurement-only inline styles from this stress case.
      await narrow.page.reload(); await narrow.page.waitForFunction(()=>window.productUpgradeReady); await api(narrow.page,'rename','a','知微与漫长午后的一段温柔对话');
    }
    await narrow.context.close();
  }
  await check('no browser runtime errors',()=>assert(report.errors.length===0,report.errors));
  await check('all network stayed in local isolated origin',()=>assert(report.externalRequests.length===0,report.externalRequests));
} catch(e) { report.errors.push({fatal:e.stack}); }
finally {
  report.finishedAt=new Date().toISOString(); report.pass=report.errors.length===0&&report.checks.every(c=>c.pass); report.count=report.checks.length;
  writeFileSync(join(out,'result.json'),JSON.stringify(report,null,2)); writeFileSync(join(parent,'latest.json'),JSON.stringify({out,result:join(out,'result.json'),pass:report.pass,count:report.count},null,2));
  console.log(JSON.stringify({out,pass:report.pass,checks:report.count,failures:report.checks.filter(c=>!c.pass).map(c=>({name:c.name,error:c.error})),errors:report.errors}));
  await browser.close(); if(preview)await new Promise(resolve=>preview.server.close(resolve));
  if (!report.pass) process.exitCode = 1;
}
