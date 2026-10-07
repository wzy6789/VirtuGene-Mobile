import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { dirname, join, basename } from 'node:path';
import { readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
const { chromium } = createRequire(join(dirname(process.execPath), 'package.json'))('playwright');
const bundle = await build({ entryPoints: ['scripts/verify/character-profile.tsx'], bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', loader: { '.png': 'dataurl', '.webp': 'dataurl', '.css': 'empty' }, define: { 'import.meta.hot': 'undefined', 'import.meta.env': '{"DEV":true,"VITE_AI_GATEWAY_URL":""}', __APP_VERSION__: '"test"' } });
const assets = 'dist/renderer/assets';
const css = readdirSync(assets).filter(f => f.endsWith('.css')).map(f => `<link rel="stylesheet" href="/assets/${f}">`).join('');
const server = createServer((req, res) => {
  if (req.url.startsWith('/test.js')) { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles[0].text); }
  else if (req.url.startsWith('/assets/')) { try { res.setHeader('Content-Type', req.url.endsWith('.css') ? 'text/css' : 'font/woff2'); res.end(readFileSync(join(assets, basename(req.url)))); } catch { res.writeHead(404); res.end(); } }
  else { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(`<!doctype html><html class="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1">${css}<style>html,body,#app{height:100%;margin:0}</style></head><body><div id="app" class="mobile-layout"></div><script src="/test.js"></script></body></html>`); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
let checks = 0;
const check = (ok, label) => { if (!ok) throw Error(label); checks++; console.log(`ok ${label}`); };
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/?virtugene-preview=mobile`);
  await page.waitForFunction(() => !!window.characterProfile);
  const open = async (existing = false, shared = false) => {
    await page.evaluate(([existing, shared]) => window.characterProfile.setup(existing, shared), [existing, shared]);
    await page.getByRole('button').filter({ hasText: '艾莉' }).first().click();
    await page.getByRole('dialog', { name: '角色资料', exact: true }).waitFor();
  };
  await open();
  const dialog = page.getByRole('dialog', { name: '角色资料', exact: true });
  check(await page.getByRole('button', { name: '添加到我', exact: true }).count() === 0, 'profile removes the separate add action');
  check(await dialog.getByRole('button', { name: '开始聊天', exact: true }).count() === 1, 'profile exposes exactly one chat action');
  check((await dialog.getByRole('button', { name: '开始聊天', exact: true }).boundingBox()).height >= 44, 'primary chat action preserves touch size');
  check(await dialog.locator('.vg-profile-primary svg').count() === 0, 'chat action has no arrow');
  await page.waitForTimeout(280);
  const profileBounds = await dialog.boundingBox();
  check(profileBounds.x === 0 && profileBounds.y === 0 && profileBounds.width === 390 && profileBounds.height === 844, 'role profile is a full page');
  await dialog.getByRole('button', {name:'返回',exact:true}).click();
  await page.getByRole('dialog',{name:'基因实验室',exact:true}).waitFor();
  check(await page.getByRole('dialog',{name:'角色资料',exact:true}).count() === 0, 'profile back returns to the existing library');
  await page.waitForTimeout(280);
  mkdirSync('.tmp-preview/character-profile', { recursive: true });
  await page.screenshot({path:'.tmp-preview/character-profile/library-dark.png'});
  await page.getByRole('button').filter({hasText:'艾莉'}).first().click();
  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${width}px role card has no horizontal overflow`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  mkdirSync('.tmp-preview/character-profile', { recursive: true });
  await page.screenshot({ path: '.tmp-preview/character-profile/dark.png', fullPage: true });
  await page.evaluate(() => { document.documentElement.classList.remove('dark'); document.documentElement.dataset.theme = 'light'; });
  await page.screenshot({ path: '.tmp-preview/character-profile/light.png', fullPage: true });
  await page.evaluate(() => { document.documentElement.classList.add('dark'); document.documentElement.dataset.theme = 'dark'; });
  await dialog.getByRole('button', { name: '开始聊天', exact: true }).evaluate(button => { button.click(); button.click(); });
  await page.getByText('已进入聊天', { exact: true }).waitFor();
  let rows = await page.evaluate(() => window.characterProfile.records());
  const copy = rows.characters.find(c => c.sourcePresetId === 'source-profile');
  check(!!copy && copy.createdBy === 'profile-preview-owner' && !copy.isPreset && rows.selectedId === copy.id, 'one click adds owned copy and selects that actual copy');
  check(rows.characters.filter(c => c.sourcePresetId === 'source-profile').length === 1 && rows.selected === 1, 'rapid double click creates only one role and enters once');
  check(rows.sessions.filter(s => s.characterId === copy.id).length === 1 && rows.messages.filter(m => m.sessionId === rows.sessionId && m.role === 'assistant').length === 1, 'chat starts one real session with one greeting');
  check(copy.catchphrase === '果然没错' && copy.boundaries === '尊重彼此的生活' && !!copy.model && !!copy.voice, 'adoption preserves speech, boundaries, model and voice');
  check(rows.characters.find(c => c.id === 'source-profile').isPreset, 'library template stays intact');
  check(rows.network === 0, 'opening and adding role requires no model request');
  await open(true); await page.getByRole('button', { name: '开始聊天', exact: true }).click();
  await page.getByText('已进入聊天', { exact: true }).waitFor();
  rows = await page.evaluate(() => window.characterProfile.records());
  check(rows.selectedId === 'existing-copy' && rows.sessionId === 'existing-session', 'already added template reuses existing owned conversation');
  check(rows.messages.some(m => m.id === 'old-message') && rows.characters.find(c => c.id === 'existing-copy').signature === '用户改过的签名', 'returning preserves old messages and user edits');
  check(rows.characters.filter(c => c.sourcePresetId === 'source-profile').length === 1, 'reopening never makes a second owned copy');
  await open(false, true); await page.getByRole('button', { name: '开始聊天', exact: true }).click();
  await page.getByText('已进入聊天', { exact: true }).waitFor();
  rows = await page.evaluate(() => window.characterProfile.records());
  check(rows.characters.find(c => c.id === rows.selectedId).createdBy === 'profile-preview-owner' && rows.selectedId !== 'source-profile', 'shared role also becomes own copy before chatting');
  await open(); const concurrent = await page.evaluate(() => window.characterProfile.concurrent());
  check(concurrent[0] === concurrent[1], 'overlapping adoption requests resolve to the same character');
  await page.evaluate(() => window.characterProfile.scene());
  await page.locator('.scene-card > button').click();
  const scene = page.getByRole('dialog',{name:'此刻设置',exact:true});
  await scene.waitFor(); await page.waitForTimeout(280);
  check((await scene.boundingBox()).height === 844 && await page.locator('.scene-settings-overlay').count() === 0, 'scene preferences also use page navigation');
  await scene.getByRole('button',{name:'午后',exact:true}).click();
  await scene.getByRole('button',{name:'窗边',exact:true}).click();
  await scene.getByRole('button',{name:'轻松',exact:true}).click();
  await page.waitForFunction(async () => {const rows=await window.characterProfile.records();const s=rows.sessions.find(s=>s.id==='scene-session');return s?.sceneTimeOfDay==='afternoon' && s?.scenePlace==='窗边' && s?.sceneAtmosphere==='light';});
  const sceneRows = await page.evaluate(() => window.characterProfile.records());
  const storedScene = sceneRows.sessions.find(s=>s.id==='scene-session');
  check(storedScene.scenePlace === '窗边' && storedScene.sceneTimeOfDay === 'afternoon' && storedScene.sceneAtmosphere === 'light', 'scene page persists real time, place and atmosphere');
  await scene.getByRole('button',{name:'返回',exact:true}).click();
  await page.locator('.scene-card > button').click();
  await scene.waitFor();
  check(await scene.getByRole('button',{name:'窗边',exact:true}).getAttribute('aria-pressed') === 'true', 'scene settings remain selected after returning and reopening');
  check(errors.length === 0, `no browser exceptions: ${errors.join(', ')}`);
  console.log(`PASS character-profile: ${checks} real UI and DB checks`);
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
