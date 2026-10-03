// Isolated browser checks for interruptible modal motion; does not use the app's data or server.
const { createRequire } = require('module');
const path = require('path');
const fs = require('fs');
const http = require('http');
const assert = require('assert/strict');
const { build } = require('esbuild');
const { chromium } = createRequire(path.join(path.dirname(process.execPath), 'package.json'))('playwright');
const fixture = `
  import React, { useState } from 'react';
  import { createRoot } from 'react-dom/client';
  import { flushSync } from 'react-dom';
  import { Modal } from './src/components/ui/Modal';
  import { SoulAtmosphere } from './src/components/ui/SoulAtmosphere';
  import { visualSnapshot, restoreSnapshotScroll } from './src/lib/mobile-motion';
  let update, allowed = true;
  function App() {
    const [panels, setPanels] = useState([]); update = setPanels;
    return <><div className="mobile-layout"><SoulAtmosphere /></div>{panels.includes('prior') && <Modal open title="prior" onClose={() => setPanels([])} mobileFullHeight><p>Inserted before the old menu</p></Modal>}
    {panels.filter(id => id !== 'prior').map(id => <Modal key={id} open title={id} onClose={() => setPanels(items => items.filter(item => item !== id))} mobileFullHeight canSnapshotOnExit={() => allowed}>
      <label htmlFor={'field-' + id}>Name</label><input id={'field-' + id} name="testName" defaultValue="User" />
      <input type="password" name="credential" defaultValue="private-motion-secret" />
      {Array.from({length: 55}, (_, i) => <p key={i} style={{height: 30}}>Settings row {i}</p>)}
    </Modal>)}</>;
  }
  createRoot(document.getElementById('root')).render(<App />);
  window.motionTest = {
    show(panels) { flushSync(() => update(panels)); },
    allow(value) { allowed = value; },
    snapshot: visualSnapshot, restore: restoreSnapshotScroll,
  };
`;

(async () => {
  const output = path.resolve('.tmp-preview/modal-motion-20261002');
  fs.mkdirSync(output, { recursive: true });
  const result = await build({ stdin: { contents: fixture, resolveDir: process.cwd(), sourcefile: 'modal-motion.tsx', loader: 'tsx' }, bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', define: { 'import.meta.env': JSON.stringify({ DEV: true }) } });
  const cssFile = process.env.VG_MOTION_CSS || path.join('dist/renderer/assets', fs.readdirSync('dist/renderer/assets').find(file => file.endsWith('.css')));
  const css = fs.readFileSync(cssFile);
  const html = '<!doctype html><html class="dark"><head><link rel="stylesheet" href="/styles.css"><style>.vg-motion-snapshot,.vg-motion-snapshot *,.vg-motion-snapshot *::before,.vg-motion-snapshot *::after{animation:none!important;transition:none!important}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>';
  const server = http.createServer((req, res) => {
    if (req.url === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    res.setHeader('Content-Type', req.url === '/fixture.js' ? 'text/javascript' : req.url === '/styles.css' ? 'text/css' : 'text/html');
    res.end(req.url === '/fixture.js' ? result.outputFiles[0].contents : req.url === '/styles.css' ? css : html);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  let checks = 0;
  const check = (condition, message) => { assert.ok(condition, message); checks++; };
  const show = panels => page.evaluate(panels => window.motionTest.show(panels), panels);
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => !!window.motionTest);
    await show(['first']); await page.waitForTimeout(340);
    check(await page.locator('.vg-soul-aura').first().evaluate(el => getComputedStyle(el).animationPlayState === 'paused'), 'covered ambient layers stop compositor work while a sheet is open');
    const replacement = await page.evaluate(() => {
      window.motionTest.show(['second']);
      const root = document.querySelector('.vg-modal-overlay');
      const ghost = root.querySelector('.vg-modal-exit');
      return { opacity: +getComputedStyle(root).opacity, ghosts: document.querySelectorAll('.vg-modal-exit').length, dialogs: document.querySelectorAll('[role="dialog"]').length,
        safe: ghost.inert && ghost.getAttribute('aria-hidden') === 'true' && !ghost.querySelector('[role],[name],[id]'),
        secret: ghost.querySelector('input[type="password"]').value };
    });
    check(replacement.opacity === 1 && replacement.ghosts === 1 && replacement.dialogs === 1, 'sibling replacement retains one steady scrim and one inert outgoing panel');
    check(replacement.safe && replacement.secret !== 'private-motion-secret', 'snapshot releases HTML/form identities and credential value');
    await page.waitForTimeout(340);
    check(await page.locator('.vg-modal-exit').count() === 0, 'handoff releases outgoing frame');
    const insertedBefore = await page.evaluate(() => {
      window.motionTest.show(['prior']);
      const root = document.querySelector('.vg-modal-overlay');
      return { opacity: +getComputedStyle(root).opacity, ghost: root.querySelectorAll('.vg-modal-exit').length };
    });
    check(insertedBefore.opacity === 1 && insertedBefore.ghost === 1, 'a portal inserted before the old sibling still receives its handoff');
    await show(['parent', 'child']); await page.waitForTimeout(340);
    const nested = await page.evaluate(() => {
      window.motionTest.show(['parent', 'next-child']);
      const overlays = [...document.querySelectorAll('.vg-modal-overlay')];
      return { count: overlays.length, opacity: +getComputedStyle(overlays[1]).opacity, ghost: overlays[1].querySelectorAll('.vg-modal-exit').length };
    });
    check(nested.count === 2 && nested.opacity === 1 && nested.ghost === 1, 'nested replacement preserves the child scrim without disturbing its parent');
    await show([]); await page.waitForTimeout(260);
    check(await page.locator('.vg-soul-aura').first().evaluate(el => getComputedStyle(el).animationPlayState === 'running'), 'ambient layers resume after live and exiting sheets leave');
    await show(['rapid']); await page.waitForTimeout(45);
    const reversal = await page.evaluate(() => {
      const before = document.querySelector('[role="dialog"]').getBoundingClientRect().top;
      window.motionTest.show([]);
      const snapshot = document.querySelector('.vg-modal-exit .vg-modal-panel');
      return { before, after: snapshot.getBoundingClientRect().top };
    });
    check(Math.abs(reversal.before - reversal.after) < 1, 'closing an entering sheet captures its exact interrupted position');
    await show(['rapid-again']);
    check(await page.locator('.vg-modal-exit').count() <= 1, 'rapid reversal retains at most one outgoing visual');
    await page.setViewportSize({ width: 320, height: 700 });
    await page.waitForTimeout(30);
    check(await page.locator('.vg-modal-exit').count() === 0, 'resize discards outgoing frame');
    check(await page.locator('[role="dialog"]').evaluate(el => el.style.willChange) === '', 'resize releases promoted panel layer');
    await show([]); await page.waitForTimeout(260);
    await show(['scroll']); await page.waitForTimeout(340);
    const scrolling = await page.evaluate(() => {
      const scroll = document.querySelector('[data-modal-scroll]'); scroll.scrollTop = 330;
      window.motionTest.show([]);
      return document.querySelector('.vg-modal-exit [data-modal-scroll]').scrollTop;
    });
    check(scrolling === 330, 'closing a long form preserves its scroll position');
    await page.evaluate(() => window.motionTest.allow(false));
    await page.waitForTimeout(35);
    check(await page.locator('.vg-modal-exit').count() === 0, 'revoked access removes a retained snapshot before another paint');
    await show(['blocked']); await page.waitForTimeout(340); await show([]);
    check(await page.locator('.vg-modal-exit').count() === 0, 'denied access never creates an exit snapshot');
    await page.evaluate(() => window.motionTest.allow(true));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await show(['reduced']);
    check(await page.locator('[role="dialog"]').evaluate(el => el.getAnimations().length) === 0, 'reduced motion opens without animation');
    await show([]);
    check(await page.locator('.vg-modal-exit').count() === 0, 'reduced motion closes without retained visuals');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await show(['app-preference']); await page.waitForTimeout(35);
    check(await page.locator('[role="dialog"]').evaluate(el => el.getAnimations().length > 0), 'normal sheets retain their entrance motion');
    await page.evaluate(() => {
      document.documentElement.dataset.vgReducedMotion = 'true';
      window.dispatchEvent(new Event('vg:motion-preference'));
    });
    check(await page.locator('[role="dialog"]').evaluate(el => el.getAnimations().length === 0 && el.style.willChange === ''), 'app reduced-motion setting interrupts active sheet animations');
    await show([]);
    check(await page.locator('.vg-modal-exit').count() === 0, 'app reduced motion closes without an outgoing frame');
    await page.evaluate(() => {
      document.documentElement.dataset.vgReducedMotion = 'false';
      window.dispatchEvent(new Event('vg:motion-preference'));
    });
    await show(['app-exit']); await page.waitForTimeout(340); await show([]);
    check(await page.locator('.vg-modal-exit').count() === 1, 'turning the app preference off restores sheet exit motion');
    await page.evaluate(() => {
      document.documentElement.dataset.vgReducedMotion = 'true';
      window.dispatchEvent(new Event('vg:motion-preference'));
    });
    check(await page.locator('.vg-modal-exit').count() === 0, 'app preference immediately drops a retained closing sheet');
    await page.evaluate(() => document.documentElement.removeAttribute('data-vg-reduced-motion'));
    const snapshots = await page.evaluate(() => {
      const large = document.createElement('div'); large.innerHTML = '<span></span>'.repeat(12000);
      let cloned = false; const native = large.cloneNode.bind(large); large.cloneNode = (...args) => { cloned = true; return native(...args); };
      const start = performance.now(); const result = window.motionTest.snapshot(large); const elapsed = performance.now() - start;
      const transcript = document.createElement('div'); transcript.append(document.createTextNode('word '.repeat(45000)));
      let transcriptCloned = false;
      const cloneTranscript = transcript.cloneNode.bind(transcript);
      transcript.cloneNode = (...args) => { transcriptCloned = true; return cloneTranscript(...args); };
      const textBudget = window.motionTest.snapshot(transcript) === null && !transcriptCloned;
      const fragmented = document.createElement('div');
      for (let i = 0; i < 2000; i++) fragmented.append(document.createTextNode('text'));
      let fragmentedCloned = false;
      const cloneFragments = fragmented.cloneNode.bind(fragmented);
      fragmented.cloneNode = (...args) => { fragmentedCloned = true; return cloneFragments(...args); };
      const nodeBudget = window.motionTest.snapshot(fragmented) === null && !fragmentedCloned;
      const media = document.createElement('div'); media.innerHTML = '<video autoplay></video>';
      const horizontal = document.createElement('div'); horizontal.style.cssText = 'width:100px;overflow:auto'; horizontal.innerHTML = '<div style="width:1000px;height:20px"></div>';
      document.body.append(horizontal); horizontal.scrollLeft = 140;
      const copy = window.motionTest.snapshot(horizontal); document.body.append(copy); window.motionTest.restore(copy);
      const left = copy.scrollLeft; horizontal.remove(); copy.remove();
      return { bounded: result === null && !cloned, textBudget, nodeBudget, elapsed, media: window.motionTest.snapshot(media) === null, left };
    });
    check(snapshots.bounded, 'oversized content is rejected before DOM cloning');
    check(snapshots.textBudget, 'oversized text transcript is rejected before allocating a duplicate');
    check(snapshots.nodeBudget, 'fragmented text nodes are bounded independently of element count');
    check(snapshots.media, 'media elements are not cloned or restarted');
    check(snapshots.left === 140, 'horizontal-only scrollers restore correctly');
    check(errors.length === 0, `no browser runtime errors: ${errors.join('; ')}`);
    const report = `PASS ${checks} modal motion checks; large-tree budget check ${snapshots.elapsed.toFixed(2)} ms\nALL PASS\n`;
    fs.writeFileSync(path.join(output, 'result.txt'), report); console.log(report);
  } finally {
    await browser.close(); server.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
