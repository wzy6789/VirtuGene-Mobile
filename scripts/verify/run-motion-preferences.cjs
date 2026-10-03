// Actual settings, persisted preference and motion components in an isolated browser.
const { createRequire } = require('module');
const path = require('path'), fs = require('fs'), http = require('http'), assert = require('assert/strict');
const { build } = require('esbuild');
const { chromium } = createRequire(path.join(path.dirname(process.execPath), 'package.json'))('playwright');
const fixture = `
  import React, { useState } from 'react';
  import { createRoot } from 'react-dom/client';
  import { flushSync } from 'react-dom';
  import { SettingsPanel } from './src/components/settings/SettingsPanel';
  import { TagInput, FontRuler, PressLightCard } from './src/components/ui/PhysicalInteractions';
  import { AnimatedValue } from './src/components/ui/AnimatedValue';
  import { SoulAtmosphere } from './src/components/ui/SoulAtmosphere';
  import { useSettingsStore } from './src/store/settings-store';
  import { useAuthStore } from './src/store/auth-store';
  import { installUiPreferences } from './src/lib/ui-preferences';
  const stopPreferences = installUiPreferences();
  const bootPreference = document.documentElement.dataset.vgReducedMotion;
  useAuthStore.setState({ userId: 'motion-preference-owner', username: '界面验证', apiKey: '' });
  let openSettings, changeProbes;
  const manyTags = ['温柔', '细心', '可靠', '幽默', '坦率', '冷静', '好奇', '浪漫'];
  function App() {
    const [open, setOpen] = useState(true);
    const [tags, setTags] = useState(['温柔', '细心']);
    const [count, setCount] = useState(1);
    const size = useSettingsStore(state => state.chatFontSize);
    openSettings = () => flushSync(() => setOpen(true));
    changeProbes = () => flushSync(() => { setTags(manyTags); setCount(value => value + 1); });
    return <main className="mobile-layout" style={{ position: 'relative', minHeight: '100dvh', maxWidth: 430, margin: '0 auto', padding: 20 }}>
      <SoulAtmosphere />
      <div style={{ position: 'relative' }}><h1 style={{fontSize:20,marginBottom:24}}>动态效果验证</h1>
        <TagInput value={tags} onChange={setTags} suggestions={manyTags} label="性格标签" />
        <p style={{margin:'20px 0'}}>局部数值：<AnimatedValue value={count} /></p>
        <FontRuler value={size} onChange={value => useSettingsStore.getState().setChatFontSize(value)} />
        <PressLightCard style={{marginTop:24,padding:20,width:'100%'}} className="vg-world-life-entry">按住反馈</PressLightCard>
        <button type="button" onClick={() => setOpen(true)}>打开设置</button>
      </div>
      <SettingsPanel open={open} onClose={() => setOpen(false)} />
    </main>;
  }
  createRoot(document.getElementById('root')).render(<App />);
  window.motionPreferences = {
    bootPreference, store: useSettingsStore, changeProbes,
    enterAppearance() {
      openSettings();
      const row = [...document.querySelectorAll('.vg-preference-row')].find(node => node.textContent.includes('外观与阅读'));
      if (row) flushSync(() => row.click());
    },
    toggle() {
      const button = document.querySelector('[role="switch"][aria-label="减少动态效果"]');
      if (!button) throw new Error('Real appearance switch is missing');
      flushSync(() => button.click());
    },
    startProbes() { changeProbes(); },
    dispose() { stopPreferences(); },
  };
`;

(async () => {
  const output = path.resolve('.tmp-preview/motion-preferences-20261002'); fs.mkdirSync(output, { recursive: true });
  const result = await build({ stdin: { contents: fixture, resolveDir: process.cwd(), sourcefile: 'motion-preferences.tsx', loader: 'tsx' }, outdir: path.join(output, 'bundle'), write: false, bundle: true, format: 'iife', platform: 'browser', jsx: 'automatic', loader: { '.png': 'dataurl', '.webp': 'dataurl' }, define: { 'import.meta.env': JSON.stringify({ DEV: true, VITE_AI_GATEWAY_URL: '', VITE_AI_GATEWAY_TOKEN: '' }), __APP_VERSION__: JSON.stringify(JSON.parse(fs.readFileSync('package.json', 'utf8')).version) } });
  const script = result.outputFiles.find(file => file.path.endsWith('.js')).contents;
  const assets = path.resolve('dist/renderer/assets');
  const css = fs.readFileSync(path.join(assets, fs.readdirSync(assets).find(file => file.endsWith('.css'))));
  const html = '<!doctype html><html lang="zh-CN" class="dark"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>';
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1').pathname;
    if (url === '/favicon.ico') { response.writeHead(204); response.end(); return; }
    if (url.endsWith('.woff2')) { response.setHeader('content-type', 'font/woff2'); response.end(fs.readFileSync(path.join(assets, path.basename(url)))); return; }
    response.setHeader('content-type', url === '/fixture.js' ? 'text/javascript' : url === '/styles.css' ? 'text/css' : 'text/html; charset=utf-8');
    response.end(url === '/fixture.js' ? script : url === '/styles.css' ? css : html);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  let checks = 0;
  const check = (value, label) => { assert.ok(value, label); checks++; console.log('PASS ' + label); };
  const preference = () => page.evaluate(() => ({ attribute: document.documentElement.dataset.vgReducedMotion, stored: window.motionPreferences.store.getState().reduceMotion, boot: window.motionPreferences.bootPreference, persisted: JSON.parse(localStorage.getItem('virtugene-settings') || '{}').state?.reduceMotion }));
  const enter = async () => {
    await page.evaluate(() => window.motionPreferences.enterAppearance());
    // The real settings panel resets its page in an effect when reopening.
    await page.waitForTimeout(50);
    const row = page.getByRole('button', { name: /外观与阅读/ });
    if (await row.count()) await row.click();
    await page.getByRole('switch', { name: '减少动态效果', exact: true }).waitFor();
  };
  const toggle = () => page.evaluate(() => window.motionPreferences.toggle());
  const animations = () => page.evaluate(() => ({ details: document.querySelector('.vg-settings-detail:not(.vg-settings-detail-exit)')?.getAnimations().length ?? 0, ghosts: document.querySelectorAll('.vg-settings-detail-exit').length, tags: document.querySelector('.vg-tag-field').getAnimations({ subtree: true }).length, value: document.querySelector('.vg-animated-value').getAnimations().length, ruler: document.querySelector('.vg-font-ticks').getAnimations().length }));
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}/?virtugene-preview=mobile`);
    await page.waitForFunction(() => !!window.motionPreferences); await page.waitForTimeout(340);
    check((await preference()).boot === 'false', 'normal preference is installed before the first rendered UI');
    await enter();
    await page.getByRole('switch', { name: '减少动态效果', exact: true }).waitFor();
    await toggle();
    let state = await preference();
    check(state.stored && state.persisted && state.attribute === 'true', 'actual appearance switch updates the effective attribute and persistent storage');
    check(await page.getByRole('switch', { name: '减少动态效果', exact: true }).getAttribute('aria-checked') === 'true', 'switch announces the saved preference');
    let motion = await animations();
    check(motion.details === 0 && motion.ghosts === 0, 'switching during the settings transition clears its live animation and outgoing frame');
    await page.screenshot({ path: path.join(output, 'reduced-motion-dark.png') });
    await page.reload(); await page.waitForFunction(() => !!window.motionPreferences);
    state = await preference();
    check(state.boot === 'true' && state.stored && state.attribute === 'true', 'reloading restores the preference before React mounts');
    await enter(); await toggle();
    check(!(await preference()).stored && (await preference()).attribute === 'false', 'turning the control off restores normal motion');
    await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click(); await page.waitForTimeout(340);
    const slider = page.getByRole('slider', { name: '聊天字号' });
    await slider.focus(); await page.keyboard.press('Home');
    const bounds = await slider.boundingBox();
    await page.mouse.move(bounds.x + bounds.width * .5, bounds.y + bounds.height * .5); await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width * .5 + 110, bounds.y + bounds.height * .5, { steps: 3 }); await page.mouse.up();
    check((await animations()).ruler > 0, 'actual ruler creates its boundary rebound before the preference changes');
    const cancellation = await page.evaluate(() => {
      window.motionPreferences.startProbes();
      window.motionPreferences.enterAppearance();
      const tags = document.querySelector('.vg-tag-field');
      const before = { tags: tags.getAnimations({ subtree: true }).length, value: document.querySelector('.vg-animated-value').getAnimations().length, ruler: document.querySelector('.vg-font-ticks').getAnimations().length };
      window.motionPreferences.toggle();
      return { before, after: { tags: tags.getAnimations({ subtree: true }).length, value: document.querySelector('.vg-animated-value').getAnimations().length, ruler: document.querySelector('.vg-font-ticks').getAnimations().length } };
    });
    check(cancellation.before.tags > 0 && cancellation.before.value > 0, 'actual tag layout and changed value animate in the normal mode');
    check(Object.values(cancellation.after).every(count => count === 0), 'the real switch interrupts tag flow, changed value and ruler rebound immediately');
    await enter();
    await page.emulateMedia({ reducedMotion: 'reduce' }); await toggle();
    state = await preference();
    check(!state.stored && state.attribute === 'true', 'system reduced motion remains effective with the application toggle off');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.waitForFunction(() => document.documentElement.dataset.vgReducedMotion === 'false');
    check((await preference()).attribute === 'false', 'restoring the system preference restores normal motion when the application setting is off');
    await toggle();
    for (const width of [320, 390, 430]) {
      await page.setViewportSize({ width, height: 640 });
      await page.evaluate(() => document.fonts.ready);
      check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.querySelector('[role="dialog"]').getBoundingClientRect().right <= innerWidth + 1), `real appearance settings fit ${width}px without horizontal overflow`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(output, 'appearance-dark.png') });
    check(errors.length === 0, `no browser runtime or asset errors: ${errors.join('; ')}`);
    const report = `PASS ${checks} motion preference checks: real settings control, storage/reload, initial sync, interruption, OS authority, narrow layouts and browser errors.\n`;
    fs.writeFileSync(path.join(output, 'result.txt'), report); console.log(report);
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
