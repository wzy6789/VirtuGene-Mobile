import {createRequire} from 'node:module';
import {dirname,join,resolve,extname,sep} from 'node:path';
import {readFileSync,mkdirSync} from 'node:fs';
import {createServer} from 'node:http';
const {chromium} = createRequire(join(dirname(process.execPath),'package.json'))('playwright');
const root = resolve('.'), artifacts = join(root,'.tmp-preview/workbench-motion');
mkdirSync(artifacts,{recursive:true});
const server = createServer((req,res) => {
  const file = resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
  if (!file.startsWith(root+sep)) { res.writeHead(403).end(); return; }
  try {
    res.setHeader('Content-Type', ({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.woff2':'font/woff2','.webp':'image/webp'})[extname(file)] || 'application/octet-stream');
    res.end(readFileSync(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise(r => server.listen(0,'127.0.0.1',r));
const browser = await chromium.launch({channel:'chrome',headless:true});
const url = `http://127.0.0.1:${server.address().port}/docs/prototypes/workbench.html`;
let checks = 0;
const check = (ok,label) => { if (!ok) throw new Error(label); checks++; console.log('ok '+label); };
try {
  const context = await browser.newContext({viewport:{width:390,height:844},hasTouch:true});
  const page = await context.newPage(), errors = [];
  page.on('pageerror',e => errors.push(e.message));
  await page.goto(url); await page.evaluate(() => document.fonts.ready);
  const cdp = await context.newCDPSession(page);
  await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
  const actualFonts = async selector => {
    const {root} = await cdp.send('DOM.getDocument');
    const {nodeId} = await cdp.send('DOM.querySelector',{nodeId:root.nodeId,selector});
    return (await cdp.send('CSS.getPlatformFontsForNode',{nodeId})).fonts;
  };
  for (const selector of ['#page-heading','.focus-row .task-title','.focus-body .meta','.reason','.filter button','.stat strong']) {
    const fonts = await actualFonts(selector);
    check(fonts.length > 0 && fonts.every(f => f.isCustomFont),`${selector} renders every glyph with bundled fonts`);
  }
  check(await page.evaluate(() => getComputedStyle(document.body).fontSynthesis === 'none'),'text never uses synthetic bold');
  check(await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.focus-row .task-title')).fontSize) >= 14 && parseFloat(getComputedStyle(document.querySelector('.focus-body .meta')).fontSize) >= 11.5),'task title and supporting information have readable type sizes');
  const contrast = await page.evaluate(() => {
    const rgb = color => color.match(/[\d.]+/g).slice(0,3).map(Number).map(c => {const v=c/255;return v <= .04045 ? v/12.92 : ((v+.055)/1.055)**2.4;});
    const luminance = color => {const [r,g,b]=rgb(color);return r*.2126+g*.7152+b*.0722;};
    const styles = getComputedStyle(document.documentElement), sample = document.createElement('span');document.body.append(sample);
    const value = token => {sample.style.color=styles.getPropertyValue(token);return luminance(getComputedStyle(sample).color);};
    const background=value('--raised');
    const ratios=['--ink','--sub','--purple','--cyan','--danger'].map(t => {const foreground=value(t);return (Math.max(foreground,background)+.05)/(Math.min(foreground,background)+.05);});
    sample.remove();return ratios;
  });
  check(contrast.every(r => r >= 4.5),'all dark reading and semantic text colors exceed 4.5:1 on the raised surface');
  const click = selector => page.evaluate(s => document.querySelector(s).click(),selector);
  const settle = () => page.waitForTimeout(450);
  const transformY = () => page.evaluate(() => {
    const t = getComputedStyle(document.querySelector('.sheet')).transform;
    return t === 'none' ? 0 : new DOMMatrixReadOnly(t).m42;
  });
  await settle();
  await page.evaluate(() => { window.originalTab = document.getElementById('tab-today'); window.originalIndicator = document.querySelector('.cabin-tab-indicator'); });
  await click('#tab-projects'); await page.waitForTimeout(60); await click('#tab-week'); await page.waitForTimeout(60); await click('#tab-inbox');
  check(await page.evaluate(() => window.originalTab === document.getElementById('tab-today') && window.originalIndicator === document.querySelector('.cabin-tab-indicator')), 'rapid navigation retains tab and sliding indicator identities');
  await settle();
  check(await page.locator('[role=tab][aria-selected=true]').getAttribute('data-nav') === 'inbox' && await page.locator('#content').getAttribute('aria-labelledby') === 'tab-inbox', 'rapid reversals finish on the requested accessible page');
  await click('#tab-today'); await settle();
  await page.evaluate(() => { window.originalFocus = document.querySelector('.focus'); window.originalTask = document.querySelector('.focus-row[data-motion-key="focus-t3"]'); window.originalTitle = window.originalTask.querySelector('.task-title'); });
  await click('[data-task-filter=waiting]'); await click('[data-task-filter=due]');
  check(await page.evaluate(() => originalFocus === document.querySelector('.focus') && originalTitle === document.querySelector('[data-motion-key="focus-t3"] .task-title')), 'changing filters preserves unaffected focus content');
  await click('.focus [data-action=complete][data-id=t1]');
  check(await page.evaluate(() => JSON.parse(localStorage.getItem(key)).tasks.find(t => t.id === 't1').status === 'completed'), 'completion persists immediately during rearrangement');
  check(await page.evaluate(() => originalTask === document.querySelector('[data-motion-key="focus-t3"]')), 'completion reuses remaining task rows');
  await click('[data-action=undo]'); await settle();
  check(await page.evaluate(() => originalTask === document.querySelector('[data-motion-key="focus-t3"]') && document.querySelector('.focus-row .task-title').dataset.id === 't1'), 'mid-animation undo restores ordering without replacing unaffected rows');

  await click('#add'); await page.waitForTimeout(70);
  await page.evaluate(() => { window.originalScrim = document.querySelector('.sheet-wrap'); });
  await page.keyboard.press('Escape');
  check(await page.locator('[role=dialog]').count() === 0 && await page.locator('#task-form').count() === 0, 'closing removes interactive dialog and form immediately');
  await click('#add'); await page.waitForTimeout(70);
  check(await page.locator('[role=dialog]').count() === 1 && await page.locator('.cabin-sheet-exit').count() === 0 && await page.evaluate(() => originalScrim === document.querySelector('.sheet-wrap')), 'reopening during exit reuses the scrim and leaves a single live dialog');
  await settle();
  const touch = async (type,x,y) => cdp.send('Input.dispatchTouchEvent',{type,touchPoints:type === 'touchEnd' ? [] : [{x,y,id:1,radiusX:2,radiusY:2}]});
  async function startDrag() {
    const handle = await page.locator('.sheet > .handle').boundingBox();
    const point = {x:handle.x+handle.width/2,y:handle.y+handle.height/2};
    await touch('touchStart',point.x,point.y); return point;
  }
  let p = await startDrag();
  await touch('touchMove',p.x+38,p.y+4); await page.waitForTimeout(35); await touch('touchEnd');
  check(Math.abs(await transformY()) < 1 && await page.locator('[role=dialog]').count() === 1, 'horizontal handle movement never starts downward dismissal');
  p = await startDrag();
  await touch('touchMove',p.x,p.y+50); await page.waitForTimeout(140);
  check(Math.abs(await transformY()-50) < 3, 'sheet follows a direct touch drag');
  await touch('touchEnd'); await page.waitForTimeout(55);
  const halfway = await transformY();
  p = await startDrag();
  check(Math.abs(await transformY()-halfway) < 14, 'a second touch takes over the current spring position');
  await touch('touchMove',p.x,p.y+7); await page.waitForTimeout(150); await touch('touchEnd'); await settle();
  check(Math.abs(await transformY()) < 1 && await page.locator('[role=dialog]').count() === 1, 'short drags settle without discarding unsaved input');
  await page.locator('#task-form [name=title]').fill('保留未保存的输入');
  p = await startDrag(); await touch('touchMove',p.x,p.y+45); await page.waitForTimeout(150); await touch('touchEnd'); await settle();
  check(await page.locator('#task-form [name=title]').inputValue() === '保留未保存的输入', 'cancelled dismissal preserves the current form');
  p = await startDrag(); await touch('touchMove',p.x,p.y+210); await page.waitForTimeout(35);
  const pull1 = await transformY();
  await touch('touchMove',p.x,p.y+300); await page.waitForTimeout(35);
  const pull2 = await transformY();
  check(pull1 > 120 && pull2 > pull1 && pull2-pull1 < 50 && pull2 < 190, 'resistance increases beyond the dismissal range');
  await touch('touchEnd');
  check(await page.evaluate(pull => {
    const ghost=document.querySelector('.cabin-sheet-ghost');
    return ghost && new DOMMatrixReadOnly(getComputedStyle(ghost).transform).m42 >= pull-2;
  },pull2),'dismissal continues downward from the dragged position');
  await settle();
  check(await page.locator('[role=dialog]').count() === 0 && await page.locator('.cabin-sheet-exit').count() === 0 && await page.evaluate(() => !document.getElementById('content').inert), 'completed touch dismissal restores background and cleans exit visuals');

  const add = await page.locator('#add').boundingBox();
  await touch('touchStart',add.x+20,add.y+20);
  await touch('touchMove',add.x-30,add.y+20); await touch('touchEnd'); await page.waitForTimeout(150);
  check(await page.locator('[role=dialog]').count() === 0 && await page.locator('[data-cabin-pressed]').count() === 0, 'sliding outside a pressed button cancels opening');
  await page.locator('#add').focus(); await page.keyboard.press('Enter'); await settle();
  check(await page.locator('[role=dialog]').count() === 1 && await page.evaluate(() => document.querySelector('.sheet').contains(document.activeElement)), 'keyboard activation still opens and focuses the dialog');
  await page.keyboard.press('Escape'); await settle();
  check(await page.evaluate(() => document.activeElement.id === 'add'), 'closing restores keyboard focus to the original control');
  await click('#add'); await settle();
  await page.mouse.click(10,10); await settle();
  check(await page.locator('[role=dialog]').count() === 0,'tapping the scrim dismisses without changing data');
  await click('#tab-projects'); await settle();
  await click('[data-action=project][data-id=p1]'); await settle();
  await page.evaluate(() => { window.originalScrim = document.querySelector('.sheet-wrap'); });
  await click('[data-action=edit-project]');
  check(await page.evaluate(() => originalScrim === document.querySelector('.sheet-wrap')) && await page.locator('[role=dialog]').count() === 1, 'nested sheets reuse their scrim and keep one accessible dialog');
  await settle(); await page.keyboard.press('Escape'); await settle();

  await click('#tab-today'); await settle();
  await click('[data-action=task-center]'); await settle();
  await page.evaluate(() => { window.originalCenterRow = document.querySelector('.task-center-row'); window.originalSearch = document.getElementById('task-search'); });
  await click('[data-action=toggle-selection]'); await settle();
  await page.evaluate(() => { window.selectedRow = document.querySelector('.task-center-row'); });
  await page.locator('[data-select-task]').first().check();
  check(await page.evaluate(() => selectedRow === document.querySelector('.task-center-row')), 'batch selection preserves task row identity');
  await page.locator('#task-search').fill('客户');
  check(await page.evaluate(() => document.activeElement.id === 'task-search') && await page.locator('#task-search').inputValue() === '客户', 'search retains input and focus while updating results');
  await page.keyboard.press('Escape'); await settle();

  await click('#add'); await page.waitForTimeout(60); await page.emulateMedia({reducedMotion:'reduce'});
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  check(await page.evaluate(() => document.getAnimations().filter(a => a.playState === 'running').length === 0) && await page.locator('.cabin-sheet-exit').count() === 0, 'changing motion preference cancels all in-flight effects');
  await page.keyboard.press('Escape'); await click('#tab-inbox');
  check(await page.evaluate(() => document.getAnimations().filter(a => a.playState === 'running').length === 0), 'reduced motion remains immediate for page and sheet transitions');
  await page.emulateMedia({reducedMotion:'no-preference'}); await click('#tab-today'); await settle();
  const effects = await page.evaluate(() => document.getAnimations().filter(a => a.playState === 'running').map(a => a.effect.getKeyframes()));
  check(effects.every(frames => frames.every(f => Object.keys(f).every(k => ['offset','computedOffset','easing','composite','transform','opacity'].includes(k)))), 'remaining active decoration animates only opacity and transform');
  await page.waitForTimeout(1000);
  check(await page.evaluate(() => document.getAnimations().filter(a => a.playState === 'running').length === 0), 'resting cabin has no continuous animations');
  await context.setOffline(true);
  await click('[data-task-filter=waiting]'); await click('[data-task-filter=due]');
  const offlineFonts = await actualFonts('.focus-row .task-title');
  check(offlineFonts.length > 0 && offlineFonts.every(f => f.isCustomFont),'loaded local type remains consistent during offline interaction');
  await context.setOffline(false);

  await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
  const timing = await page.evaluate(async () => {
    const samples = [], original = document.querySelector('.focus');
    for (let i = 0; i < 40; i++) {
      await new Promise(r => requestAnimationFrame(r));
      const start = performance.now();
      document.querySelector(`[data-task-filter=${i % 2 ? 'due' : 'waiting'}]`).click();
      // Include style/layout flush; paints and device GPU cost are outside this measurement.
      document.getElementById('content').getBoundingClientRect();
      samples.push(performance.now()-start);
    }
    samples.sort((a,b) => a-b);
    return {cpuThrottle:4,operations:40,medianMs:samples[20],p95Ms:samples[38],maxMs:samples[39],focusRetained:original === document.querySelector('.focus')};
  });
  await cdp.send('Emulation.setCPUThrottlingRate',{rate:1});
  check(timing.focusRetained,'40 consecutive filters under CPU throttling preserve unrelated content');
  console.log('Filter timing (4x CPU, including layout): '+JSON.stringify(timing));
  await settle();
  check(await page.evaluate(() => document.getAnimations().filter(a => a.playState === 'running').length === 0),'rapid repeated filters leave no active effects after settling');

  for (const theme of ['dark','light']) {
    await page.evaluate(t => { document.documentElement.dataset.theme = t; },theme);
    for (const width of [320,390,430]) {
      await page.setViewportSize({width,height:844});
      for (const tab of ['today','projects','inbox','risks','week']) {
        await click('#tab-'+tab); await settle();
        check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.getElementById('content').scrollWidth <= document.getElementById('content').clientWidth), `${theme} ${tab} has no overflow at ${width}px`);
        await page.evaluate(() => document.activeElement?.blur());
        if (width === 390) await page.screenshot({path:join(artifacts,theme+'-'+tab+'.png')});
      }
    }
  }
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  await page.setViewportSize({width:1400,height:1060}); await click('#tab-today'); await settle();
  await page.evaluate(() => document.activeElement?.blur());
  await page.screenshot({path:join(artifacts,'desktop.png')});
  check(errors.length === 0,'no browser runtime errors: '+errors.join('; '));
  console.log(`Workbench motion: ${checks} checks passed. Screenshots: ${artifacts}`);
} finally { await browser.close(); await new Promise(r => server.close(r)); }
