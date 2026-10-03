// Independent browser verification; does not rebuild or alter shared fixtures.
const { createRequire } = require('module');
const path = require('path');
const fs = require('fs');
const http = require('http');
const assert = require('assert/strict');
const { build } = require('esbuild');
const { chromium } = createRequire(path.join(path.dirname(process.execPath), 'package.json'))('playwright');
const output = path.resolve('.tmp-preview/page-motion-20261002');
fs.mkdirSync(output, { recursive: true });
let checks = 0;
const check = (value, message) => { assert.ok(value, message); checks++; };
const html = `<!doctype html><html class="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
*{box-sizing:border-box}body{margin:0;background:#131520;color:#eeeef6;font:16px system-ui}.mobile-layout{height:100dvh;overflow:hidden}.swipe-owner{height:100%;position:relative;touch-action:pan-y}.vg-page-transition{position:relative;z-index:2;height:100%;background:#191c2a}.surface{padding:24px;height:100%}.scroller{height:400px;overflow:auto;background:#252838;border-radius:16px;padding:20px}.vg-page-exit{position:absolute!important;inset:0;z-index:1;pointer-events:none!important}.vg-motion-snapshot,.vg-motion-snapshot *{animation:none!important;transition:none!important}
</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`;
(async () => {
  const result = await build({ entryPoints: ['scripts/verify/page-motion.tsx'], bundle: true, write: false, jsx: 'automatic', format: 'iife', define: { 'import.meta.env': '{}', __APP_VERSION__: '"verify"' }, logLevel: 'warning' });
  const script = result.outputFiles[0].contents;
  const server = http.createServer((request, response) => {
    if (request.url === '/fixture.js') { response.setHeader('content-type', 'text/javascript'); response.end(script); }
    else if (request.url === '/favicon.ico') { response.statusCode = 204; response.end(); }
    else { response.setHeader('content-type', 'text/html'); response.end(html); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => !!window.pageMotionTest);
    const wait = (ms = 350) => page.waitForTimeout(ms);
    const navigate = (tab, depth = 0) => page.evaluate(({ tab, depth }) => window.pageMotionTest.navigate(tab, depth), { tab, depth });
    const touch = (type, x, y = 200, count = 1) => page.evaluate(args => window.pageMotionTest.touch(...args), [type, x, y, count]);
    const state = () => page.evaluate(() => {
      const owner = document.querySelector('[data-page-swipe]');
      const live = document.querySelector('[data-live-page]:not(.vg-page-exit)');
      const ghost = document.querySelector('.vg-page-exit');
      const x = el => { const value = getComputedStyle(el).transform; return value === 'none' ? 0 : new DOMMatrixReadOnly(value).m41; };
      return { tab: live.dataset.livePage, ownerX: x(owner), liveX: x(live), ghostX: ghost ? x(ghost) : null, ghosts: document.querySelectorAll('.vg-page-exit').length, ghostInert: ghost?.inert, ghostHidden: ghost?.getAttribute('aria-hidden'), ghostScroll: ghost?.querySelector('.scroller').scrollTop, running: document.getAnimations().length, willChange: live.style.willChange, commits: window.pageMotionTest.commits() };
    });
    await page.locator('.scroller').evaluate(el => { el.scrollTop = 183; });
    await navigate('world');
    let s = await state();
    check(s.ghosts === 1 && s.ghostInert && s.ghostHidden === 'true', 'outgoing page is one inert snapshot');
    check(s.ghostScroll === 183, 'outgoing scroll position is preserved');
    check(s.liveX > 0, 'forward tab comes from the right');
    await wait(40);
    await navigate('chat');
    s = await state();
    check(s.ghosts === 1 && s.liveX < 0, 'rapid reversal changes direction without accumulating snapshots');
    await navigate('me');
    await navigate('world');
    await wait();
    s = await state();
    check(s.ghosts === 0 && s.running === 0 && s.willChange === '', 'settled page releases animations and compositing hints');
    await navigate('world', 1);
    s = await state();
    check(s.liveX > 26, 'entering a detail has a distinct depth transition');
    await wait();
    await navigate('world');
    check((await state()).liveX < 0, 'leaving a detail returns in the opposite direction');
    await wait();

    // Re-grabbing a return animation preserves its displayed position.
    await touch('touchstart', 200);
    await touch('touchmove', 155);
    await wait(20);
    await touch('touchcancel', 155);
    await wait(25);
    const regrab = await page.evaluate(() => {
      const owner = document.querySelector('[data-page-swipe]');
      const x = () => { const v = getComputedStyle(owner).transform; return v === 'none' ? 0 : new DOMMatrixReadOnly(v).m41; };
      const before = x();
      window.pageMotionTest.touch('touchstart', 180);
      return { before, after: x() };
    });
    check(Math.abs(regrab.before - regrab.after) < .5, 'taking over a rebound starts at its actual visual position');
    await touch('touchmove', 200);
    await wait(20);
    const dragged = await state();
    check(Math.abs(dragged.ownerX - regrab.after) < 22, 'second drag continues smoothly from the frozen pose');
    await touch('touchcancel', 200);
    await wait();
    check(Math.abs((await state()).ownerX) < .1, 'cancelled takeover settles exactly at rest');

    // A new touch during the 110ms release cancels its pending navigation.
    const beforeCancelled = (await state()).commits;
    await touch('touchstart', 240);
    await touch('touchmove', 100);
    await touch('touchend', 100);
    await touch('touchstart', 160);
    await touch('touchcancel', 160);
    await wait();
    check((await state()).commits === beforeCancelled, 'new gesture can cancel an unfinished release');

    // Observe every commit frame: the incoming surface never inherits the drag.
    await page.evaluate(() => {
      window.pageFrames = [];
      window.recordPages = true;
      const record = () => {
        const owner = document.querySelector('[data-page-swipe]');
        const live = document.querySelector('[data-live-page]:not(.vg-page-exit)');
        const ghost = document.querySelector('.vg-page-exit');
        const transform = getComputedStyle(owner).transform;
        const ghostTransform = ghost ? getComputedStyle(ghost).transform : 'none';
        window.pageFrames.push({ tab: live.dataset.livePage, ownerX: transform === 'none' ? 0 : new DOMMatrixReadOnly(transform).m41, ghostX: ghostTransform === 'none' ? null : new DOMMatrixReadOnly(ghostTransform).m41, ghosts: document.querySelectorAll('.vg-page-exit').length });
        if (window.recordPages) requestAnimationFrame(record);
      };
      requestAnimationFrame(record);
    });
    await touch('touchstart', 240);
    await touch('touchmove', 100);
    await wait(20);
    await touch('touchend', 100);
    await wait(180);
    const frames = await page.evaluate(() => { window.recordPages = false; return window.pageFrames; });
    check(frames.some(frame => frame.tab === 'characters'), 'swipe navigates within 180ms after release');
    check(frames.filter(frame => frame.tab === 'characters').every(frame => Math.abs(frame.ownerX) < .1), 'incoming page has no leftover wrapper displacement in any recorded frame');
    check(frames.some(frame => frame.tab === 'characters' && frame.ghosts === 1), 'swipe retains the outgoing frame during handoff');
    const handoffIndex = frames.findIndex(frame => frame.tab === 'characters');
    check(handoffIndex > 0 && Math.abs(frames[handoffIndex].ghostX - frames[handoffIndex - 1].ownerX) < 5, 'outgoing snapshot continues from the exact released position');
    await wait();
    check((await state()).commits === beforeCancelled + 1, 'successful swipe commits once');

    await page.evaluate(() => window.pageMotionTest.asynchronous(true));
    await touch('touchstart', 140);
    await touch('touchmove', 280);
    await touch('touchend', 280);
    await wait(170);
    s = await state();
    check(s.tab === 'world' && s.ownerX === 0 && s.ghosts === 1, 'asynchronous history navigation performs the same clean handoff');
    await wait();
    await page.evaluate(() => window.pageMotionTest.asynchronous(false));

    await touch('touchstart', 230);
    await touch('touchmove', 100);
    await touch('touchend', 100);
    const beforeResize = (await state()).commits;
    await page.setViewportSize({ width: 430, height: 780 });
    await wait();
    s = await state();
    check(s.commits === beforeResize && s.ownerX === 0 && s.ghosts === 0, 'resize cancels pending navigation and clears drag');
    await navigate('me');
    await page.setViewportSize({ width: 320, height: 640 });
    await wait(50);
    s = await state();
    check(s.ghosts === 0 && s.liveX === 0, 'resize during page animation lands at a clean layout');

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await navigate('world');
    s = await state();
    check(s.running === 0 && s.ghosts === 0 && s.liveX === 0, 'reduced motion skips all page choreography');
    await touch('touchstart', 220);
    await touch('touchmove', 80);
    await touch('touchend', 80);
    await wait(30);
    s = await state();
    check(s.tab === 'characters' && s.ownerX === 0 && s.running === 0, 'reduced-motion swipes navigate without delayed or residual motion');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await navigate('world');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await wait(30);
    check((await state()).running === 0 && (await state()).ghosts === 0, 'changing reduced-motion preference cancels active choreography');

    // The persisted in-app preference must also interrupt an active transition.
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await navigate('me'); await wait(30);
    check((await state()).running > 0, 'normal motion remains enabled before an app preference change');
    await page.evaluate(() => {
      document.documentElement.dataset.vgReducedMotion = 'true';
      window.dispatchEvent(new Event('vg:motion-preference'));
    });
    s = await state();
    check(s.running === 0 && s.ghosts === 0 && s.liveX === 0, 'app preference cancels active page motion and discards retained frames');
    await navigate('characters');
    check((await state()).running === 0 && (await state()).ghosts === 0, 'app preference skips choreography on future page entries');
    await touch('touchstart', 100);
    await touch('touchmove', 240);
    await touch('touchend', 240);
    await wait(30);
    s = await state();
    check(s.tab === 'world' && s.ownerX === 0 && s.running === 0, 'app reduced-motion gesture still navigates without a release delay');
    await page.evaluate(() => {
      document.documentElement.dataset.vgReducedMotion = 'false';
      window.dispatchEvent(new Event('vg:motion-preference'));
    });
    await navigate('world', 1);
    check((await state()).running > 0, 'turning the app preference off restores purposeful page transitions');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await navigate('me');
    check((await state()).running === 0, 'an app preference of false never overrides the operating system');
    check(errors.length === 0, `no browser errors: ${errors.join('; ')}`);
    fs.writeFileSync(path.join(output, 'frame-handoff.json'), JSON.stringify(frames, null, 2));
    const report = `PASS ${checks} page motion checks: interrupted navigation, scroll snapshots, gesture takeover, synchronous/asynchronous handoff, resize, OS and in-app reduced motion.\n`;
    fs.writeFileSync(path.join(output, 'result.txt'), report);
    console.log(report);
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
